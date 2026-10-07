#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "hardware/clocks.h"
#include "hardware/watchdog.h"
#include "hardware/structs/powman.h"
#include "pico/bootrom.h"
#include "pico/rand.h"
#include "pico/stdlib.h"
#include "pio_usb.h"
#include "tusb.h"
#include "host/usbh_pvt.h"
#include "probe_protocol.h"

enum { HOST_PORT = 1, DP_PIN = 12, DM_PIN = 13, ENUM_MS = 10000, XFER_MS = 2000 };
typedef enum {
  IDLE, ARMED, ENUMERATING, DEVICE_DESC, CONFIG_HEADER, CONFIG_DESC,
  DETECT_OUT, DETECT_IN, INFO_OUT, INFO_IN, DONE, FAILED
} state_t;
static const char *const state_names[] = {
  "idle", "armed", "enumerating", "device_descriptor", "configuration_header", "configuration_descriptor",
  "detect_out", "detect_in", "info_out", "info_in", "done", "failed"
};
static state_t state;
static uint32_t deadline;
static bool host_started;
static uint32_t boot_id, reset_raw;
static bool reset_watchdog;
static uint8_t target;
static probe_endpoints_t endpoints;
static uint8_t rx[512] __attribute__((aligned(4)));
static uint8_t tx[64] __attribute__((aligned(4)));
static size_t tx_len;
static uint16_t config_len;

// All logging runs on core0 outside IRQs. Do not block USB service on a slow console.
static char log_ring[16384];
static size_t log_read, log_write;
static unsigned dropped;

static uint32_t now_ms(void) { return to_ms_since_boot(get_absolute_time()); }
uint32_t tusb_time_millis_api(void) { return now_ms(); }

static void log_event(const char *event, const char *fields, ...) {
  // Single-core, non-reentrant logging: keep large formatting buffers off stack.
  static char extra[1400], line[1600];
  va_list args;
  va_start(args, fields);
  int extra_len = vsnprintf(extra, sizeof(extra), fields, args);
  va_end(args);
  if (extra_len < 0 || (size_t)extra_len >= sizeof(extra)) { dropped++; return; }
  int len = snprintf(line, sizeof(line),
    "{\"event\":\"%s\",\"ms\":%lu,\"state\":\"%s\"%s}\n",
    event, (unsigned long)now_ms(), state_names[state], extra);
  size_t used = (log_write + sizeof(log_ring) - log_read) % sizeof(log_ring);
  if (len < 0 || (size_t)len >= sizeof(line) || (size_t)len >= sizeof(log_ring) - used) {
    dropped++;
    return;
  }
  for (int i = 0; i < len; i++) {
    log_ring[log_write] = line[i];
    log_write = (log_write + 1) % sizeof(log_ring);
  }
}

static void console_flush(void) {
  if (!tud_cdc_connected()) return;
  while (log_read != log_write && tud_cdc_write_available()) {
    size_t len = log_write > log_read ? log_write - log_read : sizeof(log_ring) - log_read;
    uint32_t written = tud_cdc_write(log_ring + log_read, (uint32_t)len);
    if (!written) break;
    log_read = (log_read + written) % sizeof(log_ring);
  }
  tud_cdc_write_flush();
}

// Enumeration includes short blocking delays. Keep the computer-facing CDC alive.
// Do not reenter tuh_task() from this hook.
void tusb_time_delay_ms_api(uint32_t ms) {
  uint32_t start = now_ms();
  while ((uint32_t)(now_ms() - start) < ms) {
    tud_task();
    console_flush();
    tight_loop_contents();
  }
}

static void log_bytes(const char *kind, const uint8_t *data, size_t len) {
  static char hex[1025];
  if (len > 512) len = 512;
  for (size_t i = 0; i < len; i++) snprintf(hex + 2 * i, 3, "%02x", data[i]);
  hex[2 * len] = 0;
  log_event(kind, ",\"length\":%u,\"hex\":\"%s\"", (unsigned)len, hex);
}

static bool active(void) { return state >= ENUMERATING && state <= INFO_IN; }

static void fail(const char *reason) {
  if (state == DONE || state == FAILED) return;
  const char *at = state_names[state];
  state = FAILED; // Invalidate before aborts can produce completion callbacks.
  log_event("failed", ",\"at\":\"%s\",\"reason\":\"%s\"", at, reason);
  if (target && endpoints.ep_in) tuh_edpt_abort_xfer(target, endpoints.ep_in);
  if (target && endpoints.ep_out) tuh_edpt_abort_xfer(target, endpoints.ep_out);
}

static void transfer_complete(tuh_xfer_t *xfer);

static bool submit(state_t next, uint8_t ep, uint8_t *data, size_t len) {
  state = next;
  deadline = now_ms() + XFER_MS;
  tuh_xfer_t xfer = {
    .daddr = target, .ep_addr = ep, .buflen = (uint32_t)len, .buffer = data,
    .complete_cb = transfer_complete
  };
  if (!tuh_edpt_xfer(&xfer)) { fail("bulk_submit_failed"); return false; }
  return true;
}

static void send_read_request(uint8_t command, state_t next) {
  size_t len;
  const uint8_t *request = probe_request(command, &len);
  if (!request || len > sizeof(tx)) { fail("request_not_allowed"); return; }
  memcpy(tx, request, len);
  tx_len = len;
  log_bytes("bulk_out", tx, len);
  submit(next, endpoints.ep_out, tx, len);
}

static void transfer_complete(tuh_xfer_t *xfer) {
  if (!active() || xfer->daddr != target) return;
  log_event("transfer", ",\"endpoint\":%u,\"result\":%u,\"length\":%lu",
    xfer->ep_addr, xfer->result, (unsigned long)xfer->actual_len);
  if (xfer->result != XFER_RESULT_SUCCESS) { fail("usb_transfer_failed"); return; }
  if (state == DEVICE_DESC) {
    log_bytes("device_descriptor", rx, xfer->actual_len);
    if (xfer->actual_len != sizeof(tusb_desc_device_t) || rx[0] != 18 || rx[1] != 1) {
      fail("invalid_device_descriptor"); return;
    }
    state = CONFIG_HEADER;
    deadline = now_ms() + XFER_MS;
    // Match enumeration: read the header, then wTotalLength, never the buffer size.
    // The first hardware trial returned an empty reply to our 512-byte request.
    if (!tuh_descriptor_get_configuration(target, 0, rx, 9, transfer_complete, 0))
      fail("configuration_header_submit_failed");
    return;
  }
  if (state == CONFIG_HEADER) {
    log_bytes("configuration_header", rx, xfer->actual_len);
    if (xfer->actual_len != 9 ||
        !(config_len = probe_config_length(rx, xfer->actual_len, sizeof(rx)))) {
      fail("invalid_configuration_header"); return;
    }
    state = CONFIG_DESC;
    deadline = now_ms() + XFER_MS;
    log_event("configuration_read", ",\"requested_length\":%u", config_len);
    if (!tuh_descriptor_get_configuration(target, 0, rx, config_len, transfer_complete, 0))
      fail("configuration_descriptor_submit_failed");
    return;
  }
  if (state == CONFIG_DESC) {
    log_bytes("configuration_descriptor", rx, xfer->actual_len);
    if (xfer->actual_len < 9) { fail("short_configuration_descriptor"); return; }
    const uint16_t total = probe_config_length(rx, xfer->actual_len, sizeof(rx));
    if (!total || total != config_len || total != xfer->actual_len) {
      fail("invalid_configuration_descriptor"); return;
    }
    send_read_request(0xa1, DETECT_OUT);
    return;
  }
  if (state == DETECT_OUT || state == INFO_OUT) {
    if (xfer->ep_addr != endpoints.ep_out || xfer->actual_len != tx_len) {
      fail("incomplete_bulk_out"); return;
    }
    memset(rx, 0, sizeof(rx));
    submit(state == DETECT_OUT ? DETECT_IN : INFO_IN, endpoints.ep_in, rx, 64);
    return;
  }
  if (xfer->ep_addr != endpoints.ep_in || xfer->actual_len > 64) {
    fail("invalid_bulk_in"); return;
  }
  log_bytes("bulk_in", rx, xfer->actual_len);
  if (state == DETECT_IN) {
    if (!probe_parse_detect(rx, xfer->actual_len)) { fail("not_a_valid_ch552_reply"); return; }
    send_read_request(0xa7, INFO_OUT);
  } else if (state == INFO_IN) {
    probe_info_t info;
    if (!probe_parse_info(rx, xfer->actual_len, &info)) { fail("invalid_config_reply"); return; }
    state = DONE;
    log_event("identified", ",\"chip\":\"CH552\",\"version\":\"%u.%u.%u\","
      "\"chip_id\":\"%02x%02x%02x%02x\",\"field_mask\":%u,\"read_only\":true",
      info.version[0], info.version[1], info.version[2], info.chip_id[0], info.chip_id[1],
      info.chip_id[2], info.chip_id[3], info.field_mask);
  }
}

static bool driver_init(void) { return true; }
static bool driver_open(uint8_t rhport, uint8_t daddr,
                        const tusb_desc_interface_t *itf, uint16_t max_len) {
  uint16_t vid, pid;
  tuh_vid_pid_get(daddr, &vid, &pid);
  if (rhport != HOST_PORT || state != ENUMERATING || target ||
      !probe_usb_identity(vid, pid)) return false;
  probe_endpoints_t parsed;
  if (!probe_parse_interface((const uint8_t *)itf, max_len, &parsed)) return false;
  const uint8_t *raw = (const uint8_t *)itf;
  if (!tuh_edpt_open(daddr, (const tusb_desc_endpoint_t *)(raw + parsed.in_offset)) ||
      !tuh_edpt_open(daddr, (const tusb_desc_endpoint_t *)(raw + parsed.out_offset))) return false;
  target = daddr;
  endpoints = parsed;
  log_event("interface", ",\"address\":%u,\"vid\":%u,\"pid\":%u,\"interface\":%u,"
    "\"ep_in\":%u,\"ep_out\":%u,\"packet_in\":%u,\"packet_out\":%u",
    daddr, vid, pid, endpoints.interface_number, endpoints.ep_in, endpoints.ep_out,
    endpoints.packet_in, endpoints.packet_out);
  return true;
}

static bool driver_config(uint8_t daddr, uint8_t itf) {
  usbh_driver_set_config_complete(daddr, itf);
  return true;
}
static bool driver_xfer(uint8_t daddr, uint8_t ep, xfer_result_t result, uint32_t len) {
  (void)daddr; (void)ep; (void)result; (void)len;
  return true; // Application transfers use transfer_complete instead.
}
static void driver_close(uint8_t daddr) {
  if (daddr == target) {
    if (active()) fail("target_removed");
    target = 0;
  }
}
const usbh_class_driver_t *usbh_app_driver_get_cb(uint8_t *count) {
  static const usbh_class_driver_t driver = {
    .name = "CH552 read-only probe", .init = driver_init, .open = driver_open,
    .set_config = driver_config, .xfer_cb = driver_xfer, .close = driver_close
  };
  *count = 1;
  return &driver;
}

void tuh_mount_cb(uint8_t daddr) {
  uint16_t vid, pid;
  tuh_vid_pid_get(daddr, &vid, &pid);
  log_event("mounted", ",\"address\":%u,\"vid\":%u,\"pid\":%u,\"speed\":%u",
    daddr, vid, pid, tuh_speed_get(daddr));
  if (!active()) return;
  if (!probe_usb_identity(vid, pid)) { fail("unexpected_usb_identity"); return; }
  if (daddr != target) { fail("unsupported_bootloader_interface"); return; }
  state = DEVICE_DESC;
  deadline = now_ms() + XFER_MS;
  if (!tuh_descriptor_get_device(target, rx, sizeof(tusb_desc_device_t), transfer_complete, 0))
    fail("device_descriptor_submit_failed");
}

void tuh_umount_cb(uint8_t daddr) {
  log_event("unmounted", ",\"address\":%u", daddr);
  if (active()) fail("device_removed");
}

static void status(void) {
  // Nominal DVDD thresholds from POWMAN BOD.VSEL; reserved encodings stay unknown.
  static const char *const bod_mv[] = {
    "473", "516", "559", "602", "645", "688", "731", "774", "817",
    "860", "903", "946", "989", "1032", "1075", "1118", "1161", "1204"
  };
  const uint32_t bod = powman_hw->bod;
  const unsigned vsel = (bod & POWMAN_BOD_VSEL_BITS) >> POWMAN_BOD_VSEL_LSB;
  log_event("status", ",\"protocol\":1,\"version\":\"%s\",\"board\":\"waveshare_rp2350_usb_a\","
    "\"dp\":12,\"dm\":13,\"clock_khz\":120000,\"host_started\":%s,\"read_only\":true,"
    "\"dropped_logs\":%u,\"boot_id\":\"%08lx\",\"reset_raw\":%lu,"
    "\"reset_brownout\":%s,\"reset_power_on\":%s,\"reset_run_pin\":%s,\"reset_watchdog\":%s,"
    "\"bod_raw\":%lu,\"bod_enabled\":%s,\"bod_vsel\":%u,\"bod_threshold_mv\":%s,"
    "\"dp_level\":%u,\"dm_level\":%u",
    PROBE_VERSION, host_started ? "true" : "false", dropped,
    (unsigned long)boot_id, (unsigned long)reset_raw,
    reset_raw & POWMAN_CHIP_RESET_HAD_BOR_BITS ? "true" : "false",
    reset_raw & POWMAN_CHIP_RESET_HAD_POR_BITS ? "true" : "false",
    reset_raw & POWMAN_CHIP_RESET_HAD_RUN_LOW_BITS ? "true" : "false",
    reset_watchdog ? "true" : "false", (unsigned long)bod,
    bod & POWMAN_BOD_EN_BITS ? "true" : "false", vsel,
    vsel < sizeof(bod_mv) / sizeof(bod_mv[0]) ? bod_mv[vsel] : "null",
    (unsigned)gpio_get(DP_PIN), (unsigned)gpio_get(DM_PIN));
}

static void command(char *line) {
  if (!strcmp(line, "status") || !strcmp(line, "info")) { status(); return; }
  if (!strcmp(line, "help")) {
    log_event("help", ",\"commands\":[\"status\",\"arm [0..30000ms]\",\"probe\","
      "\"cancel\",\"reset\",\"bootsel\"],\"note\":\"One host start per adapter reset\"");
    return;
  }
  if (!strcmp(line, "cancel")) {
    if (state == ARMED) { state = IDLE; log_event("cancelled", ""); }
    else if (active()) fail("cancelled_by_operator");
    else log_event("error", ",\"reason\":\"nothing_to_cancel\"");
    return;
  }
  if (!strcmp(line, "reset")) {
    watchdog_reboot(0, 0, 50);
    return;
  }
  if (!strcmp(line, "bootsel")) { reset_usb_boot(0, 0); return; }
  if (!strcmp(line, "probe") || !strcmp(line, "arm") || !strncmp(line, "arm ", 4)) {
    if (host_started || state != IDLE) {
      log_event("error", ",\"reason\":\"unplug_target_and_reset_adapter_before_retry\"");
      return;
    }
    unsigned long delay = !strcmp(line, "probe") ? 0 : 5000;
    if (!strncmp(line, "arm ", 4)) {
      char *end;
      delay = strtoul(line + 4, &end, 10);
      if (line[4] < '0' || line[4] > '9' || *end || delay > 30000) {
        log_event("error", ",\"reason\":\"delay_must_be_0_to_30000ms\""); return;
      }
    }
    state = ARMED;
    deadline = now_ms() + (uint32_t)delay;
    log_event("armed", ",\"delay_ms\":%lu,\"instruction\":\"Plug the macropad into USB-A now\","
      "\"dp_level\":%u,\"dm_level\":%u", delay,
      (unsigned)gpio_get(DP_PIN), (unsigned)gpio_get(DM_PIN));
    return;
  }
  log_event("error", ",\"reason\":\"unknown_command\"");
}

static void console_poll(void) {
  static char line[80];
  static size_t len;
  static bool overflow;
  while (tud_cdc_available()) {
    char ch;
    if (tud_cdc_read(&ch, 1) != 1) break;
    if (ch == '\r' || ch == '\n') {
      if (overflow) log_event("error", ",\"reason\":\"command_too_long\"");
      else if (len) { line[len] = 0; command(line); }
      len = 0;
      overflow = false;
    } else if ((ch == '\b' || ch == 127) && !overflow) {
      if (len) len--;
    } else if (ch >= 32 && ch <= 126 && !overflow) {
      if (len + 1 < sizeof(line)) line[len++] = ch;
      else overflow = true;
    }
  }
}

int main(void) {
  // Snapshot hardware evidence before application initialization. Read only.
  reset_raw = powman_hw->chip_reset;
  reset_watchdog = watchdog_caused_reboot();
  boot_id = get_rand_32();
  // Match the operator's hub trials: VSEL 10 = nominal 0.903V on DVDD.
  // POWMAN writes require the password; keep detection enabled throughout.
  powman_hw->bod = POWMAN_PASSWORD_BITS | (10u << POWMAN_BOD_VSEL_LSB) |
                   POWMAN_BOD_EN_BITS;
  sleep_us(50); // Allow more than the specified 30us maximum programming delay.
  set_sys_clock_khz(120000, true); // PIO USB requires a multiple of 12MHz.
  gpio_init(DP_PIN);
  gpio_init(DM_PIN);
  gpio_disable_pulls(DP_PIN);
  gpio_disable_pulls(DM_PIN);
  gpio_set_dir(DP_PIN, GPIO_IN);
  gpio_set_dir(DM_PIN, GPIO_IN);
  const tusb_rhport_init_t device_init = {.role = TUSB_ROLE_DEVICE, .speed = TUSB_SPEED_FULL};
  if (!tusb_init(0, &device_init)) panic("USB device init failed");
  log_event("ready", ",\"protocol\":1,\"version\":\"%s\",\"read_only\":true", PROBE_VERSION);
  while (true) {
    tud_task();
    console_poll();
    if (state == ARMED && (int32_t)(now_ms() - deadline) >= 0) {
      state = ENUMERATING;
      deadline = now_ms() + ENUM_MS;
      host_started = true;
      log_event("host_start", ",\"enumeration_timeout_ms\":%u,\"dp_level\":%u,\"dm_level\":%u",
        ENUM_MS, (unsigned)gpio_get(DP_PIN), (unsigned)gpio_get(DM_PIN));
      pio_usb_configuration_t cfg = PIO_USB_DEFAULT_CONFIG;
      cfg.pin_dp = DP_PIN;
      cfg.pinout = PIO_USB_PINOUT_DPDM;
      const tusb_rhport_init_t host_init = {.role = TUSB_ROLE_HOST, .speed = TUSB_SPEED_FULL};
      if (!tuh_configure(HOST_PORT, TUH_CFGID_RPI_PIO_USB_CONFIGURATION, &cfg) ||
          !tusb_init(HOST_PORT, &host_init)) fail("host_init_failed");
    }
    if (host_started && tuh_inited()) tuh_task_ext(0, false);
    if (active() && (int32_t)(now_ms() - deadline) >= 0) fail("timeout");
    console_flush();
    tight_loop_contents();
  }
}
