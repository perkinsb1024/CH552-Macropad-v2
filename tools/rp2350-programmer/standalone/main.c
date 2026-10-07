#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "hardware/clocks.h"
#include "hardware/watchdog.h"
#include "pico/bootrom.h"
#include "pico/stdlib.h"
#include "pio_usb.h"
#include "tusb.h"
#include "host/usbh_pvt.h"
#include "probe_protocol.h"
#include "programmer.h"
#include "board_status.h"
#include "firmware_drive.h"

enum { HOST_PORT = 1, DP_PIN = 12, DM_PIN = 13, ENUM_MS = 10000,
       XFER_MS = 2000, COMMAND_GAP_MS = 20, INSERT_MS = 2000 };
typedef enum {
  IDLE, ARMED, ENUMERATING, DEVICE_DESC, CONFIG_HEADER, CONFIG_DESC,
  COMMAND_GAP, COMMAND_OUT, COMMAND_IN, DONE, FAILED
} state_t;
static const char *const state_names[] = {
  "idle", "armed", "enumerating", "device_descriptor", "configuration_header",
  "configuration_descriptor", "command_gap", "command_out", "command_in", "done", "failed"
};
static programmer_t programmer;
static const char *last_error = "";
static program_stage_t logged_stage = PROGRAM_ERROR;
static unsigned next_progress;
static state_t state;
static uint32_t deadline;
static bool host_started;
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
    tud_task_ext(0, false);
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

static bool active(void) { return state >= ENUMERATING && state <= COMMAND_IN; }

static void fail(const char *reason) {
  if (state == DONE || state == FAILED) return;
  const char *at = state_names[state];
  const char *phase = program_stage_name(logged_stage);
  size_t offset = programmer.offset;
  state = FAILED; // Invalidate before aborts can produce completion callbacks.
  last_error = reason;
  program_fail(&programmer, reason);
  board_color(32, 0, 0);
  log_event("failed", ",\"at\":\"%s\",\"reason\":\"%s\",\"phase\":\"%s\",\"offset\":%u",
    at, reason, phase, (unsigned)offset);
  if (target && endpoints.ep_in) tuh_edpt_abort_xfer(target, endpoints.ep_in);
  if (target && endpoints.ep_out) tuh_edpt_abort_xfer(target, endpoints.ep_out);
}

static void transfer_complete(tuh_xfer_t *xfer);

static bool submit(uint8_t ep, uint8_t *data, size_t len) {
  state = ep == endpoints.ep_in ? COMMAND_IN : COMMAND_OUT;
  deadline = now_ms() + (programmer.stage == PROGRAM_ERASE ? 10000 : XFER_MS);
  tuh_xfer_t xfer = {
    .daddr = target, .ep_addr = ep, .buflen = (uint32_t)len, .buffer = data,
    .complete_cb = transfer_complete
  };
  if (!tuh_edpt_xfer(&xfer)) { fail("bulk_submit_failed"); return false; }
  return true;
}

static void send_next(void) {
  tx_len = program_packet(&programmer, tx);
  if (!tx_len) { fail("invalid_program_state"); return; }
  if (programmer.stage != logged_stage) {
    logged_stage = programmer.stage;
    next_progress = 1024;
    log_event("phase", ",\"phase\":\"%s\"", program_stage_name(programmer.stage));
  }
  if (programmer.stage != PROGRAM_WRITE && programmer.stage != PROGRAM_VERIFY)
    log_bytes("bulk_out", tx, tx_len);
  submit(endpoints.ep_out, tx, tx_len);
}

static void schedule_next(void) {
  state = COMMAND_GAP;
  deadline = now_ms() + COMMAND_GAP_MS;
}

static void transfer_complete(tuh_xfer_t *xfer) {
  if (!active() || xfer->daddr != target) return;
  // Keep offline logs bounded: progress events replace per-packet success logs.
  if (xfer->result != XFER_RESULT_SUCCESS)
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
    send_next();
    return;
  }
  if (state == COMMAND_OUT) {
    if (xfer->ep_addr != endpoints.ep_out || xfer->actual_len != tx_len) {
      fail("incomplete_bulk_out"); return;
    }
    if (programmer.stage == PROGRAM_REBOOT) {
      if (!program_reboot_sent(&programmer)) { fail("unexpected_reboot"); return; }
      state = DONE;
      board_color(0, 32, 0);
      log_event("program_completed", ",\"verified_bytes\":%u,\"reboot_sent\":true,"
        "\"verification\":\"bootloader_compare\",\"raw_code_readback\":false", PROGRAM_LIMIT);
      return;
    }
    memset(rx, 0, sizeof(rx));
    submit(endpoints.ep_in, rx, 64);
    return;
  }
  if (state != COMMAND_IN || xfer->ep_addr != endpoints.ep_in || xfer->actual_len > 64) {
    fail("invalid_bulk_in"); return;
  }
  const program_stage_t before = programmer.stage;
  const size_t previous_offset = programmer.offset;
  if (before != PROGRAM_WRITE && before != PROGRAM_VERIFY)
    log_bytes("bulk_in", rx, xfer->actual_len);
  if (!program_reply(&programmer, rx, xfer->actual_len)) {
    log_bytes("rejected_reply", rx, xfer->actual_len);
    log_bytes("rejected_request", tx, tx_len);
    fail(programmer.error); return;
  }
  if (before == PROGRAM_INFO) {
    log_event("identified", ",\"chip\":\"CH552\",\"version\":\"%u.%u.%u\","
      "\"chip_id\":\"%02x%02x%02x%02x\",\"read_only\":false",
      programmer.info.version[0], programmer.info.version[1], programmer.info.version[2],
      programmer.info.chip_id[0], programmer.info.chip_id[1],
      programmer.info.chip_id[2], programmer.info.chip_id[3]);
  }
  if (before == PROGRAM_WRITE || before == PROGRAM_VERIFY) {
    size_t completed = previous_offset + tx_len - 8;
    if (completed >= next_progress || completed == PROGRAM_LIMIT) {
      log_event("progress", ",\"phase\":\"%s\",\"completed\":%u,\"total\":%u",
        program_stage_name(before), (unsigned)completed, PROGRAM_LIMIT);
      next_progress += 1024;
    }
  }
  if (before == PROGRAM_FINAL_INFO) log_event("config_readback_verified", "");
  schedule_next();
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
    .name = "CH552 standalone programmer", .init = driver_init, .open = driver_open,
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
  board_color(32, 24, 0);
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
  log_event("status", ",\"protocol\":2,\"version\":\"%s\",\"board\":\"waveshare_rp2350_usb_a\","
    "\"mode\":\"standalone_programmer\",\"read_only\":false,\"host_started\":%s,"
    "\"phase\":\"%s\",\"offset\":%u,\"last_error\":\"%s\",\"dropped_logs\":%u,"
    "\"image\":\"%s\",\"image_crc32\":\"%08lx\",\"image_bytes\":%u,\"keys\":%u,\"image_status\":\"%s\",\"image_error\":\"%s\",\"storage_pending\":%s,"
    "\"config_format\":%u", PROBE_VERSION, host_started ? "true" : "false",
    program_stage_name(programmer.stage), (unsigned)programmer.offset, last_error, dropped,
    drive_info.name, (unsigned long)drive_crc, PROGRAM_LIMIT, drive_info.keys,
    drive_result == IMAGE_VALID ? "valid" : drive_result == IMAGE_INVALID ? "invalid" : "missing",
    drive_info.error, firmware_drive_pending() ? "true" : "false", drive_info.format);
}

static void arm(void) {
  if (state != IDLE || host_started || !firmware_drive_lock()) return;
  if (!program_init(&programmer, drive_image, sizeof(drive_image), drive_crc)) { fail(programmer.error); return; }
  state = ARMED;
  deadline = now_ms() + INSERT_MS;
  board_color(0, 24, 24);
  log_event("armed", ",\"delay_ms\":%u,\"instruction\":\"Plug in the macropad now\"", INSERT_MS);
}

static void command(char *line) {
  if (!strcmp(line, "status") || !strcmp(line, "info")) { status(); return; }
  if (!strcmp(line, "help")) {
    log_event("help", ",\"commands\":[\"status\",\"reset\",\"bootsel\"],"
      "\"note\":\"Press BOOT to arm; reset only with macropad unplugged\"");
    return;
  }
  // Resetting during a flash could strand partially programmed code.
  if (active() || state == ARMED) {
    log_event("error", ",\"reason\":\"programming_busy\""); return;
  }
  if (firmware_drive_pending() && (!strcmp(line, "reset") || !strcmp(line, "bootsel"))) {
    log_event("error", ",\"reason\":\"storage_busy\""); return;
  }
  if (!strcmp(line, "reset")) { watchdog_reboot(0, 0, 50); return; }
  if (!strcmp(line, "bootsel")) { reset_usb_boot(0, 0); return; }
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
  set_sys_clock_khz(120000, true); // PIO USB requires a multiple of 12MHz.
  gpio_init(DP_PIN);
  gpio_init(DM_PIN);
  gpio_disable_pulls(DP_PIN);
  gpio_disable_pulls(DM_PIN);
  gpio_set_dir(DP_PIN, GPIO_IN);
  gpio_set_dir(DM_PIN, GPIO_IN);
  const tusb_rhport_init_t device_init = {.role = TUSB_ROLE_DEVICE, .speed = TUSB_SPEED_FULL};
  if (!tusb_init(0, &device_init)) panic("USB device init failed");
  board_status_init();
  firmware_drive_init();
  log_event("startup", ",\"protocol\":2,\"version\":\"%s\",\"read_only\":false", PROBE_VERSION);
  static int last_image_state = -1;
  static uint32_t button_tick;
  static unsigned pressed_samples;
  while (true) {
    tud_task_ext(0, false);
    console_poll();
    if (state == IDLE) {
      firmware_drive_poll(now_ms());
      int image_state = firmware_drive_pending() ? 3 : (int)drive_result;
      if (image_state != last_image_state) { last_image_state = image_state; status(); }
    }
    if (state == IDLE && (uint32_t)(now_ms() - button_tick) >= 10) {
      button_tick = now_ms();
      bool lit = (button_tick / 250) % 2 == 0;
      // Blue means copying/saving; green is only shown after durable validation.
      bool pending = firmware_drive_pending();
      if (!lit) board_color(0, 0, 0);
      else if (pending) board_color(0, 0, 24);
      else if (drive_result == IMAGE_MISSING) board_color(32, 6, 0);
      else if (drive_result == IMAGE_INVALID) board_color(32, 0, 0);
      else board_color(0, 24, 0);
      if (board_boot_pressed()) pressed_samples++; else pressed_samples = 0;
      if (pressed_samples == 3) arm();
    }
    if (state == ARMED && (int32_t)(now_ms() - deadline) >= 0) {
      board_color(32, 24, 0);
      state = ENUMERATING;
      deadline = now_ms() + ENUM_MS;
      host_started = true;
      log_event("host_start", ",\"enumeration_timeout_ms\":%u", ENUM_MS);
      pio_usb_configuration_t cfg = PIO_USB_DEFAULT_CONFIG;
      cfg.pin_dp = DP_PIN;
      cfg.pinout = PIO_USB_PINOUT_DPDM;
      const tusb_rhport_init_t host_init = {.role = TUSB_ROLE_HOST, .speed = TUSB_SPEED_FULL};
      if (!tuh_configure(HOST_PORT, TUH_CFGID_RPI_PIO_USB_CONFIGURATION, &cfg) ||
          !tusb_init(HOST_PORT, &host_init)) fail("host_init_failed");
    }
    if (host_started && tuh_inited()) tuh_task_ext(0, false);
    // A pacing gap is a scheduled send, not a transfer deadline. Sample time once
    // so a tick between separate checks cannot turn the gap into a timeout.
    program_timer_t timer = program_deadline_action(state == COMMAND_GAP, active(), now_ms(), deadline);
    if (timer == PROGRAM_TIMER_NEXT) send_next();
    else if (timer == PROGRAM_TIMER_TIMEOUT) fail("timeout");
    console_flush();
    tight_loop_contents();
  }
}
