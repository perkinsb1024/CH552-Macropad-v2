#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include "hardware/clocks.h"
#include "pico/stdlib.h"
#include "pio_usb.h"
#include "tusb.h"
#include "host/usbh_pvt.h"
#include "board_status.h"
#include "reader.h"
#include "result_disk.h"

enum { HOST_PORT = 1, DP_PIN = 12, DM_PIN = 13, ARM_MS = 2000,
       ENUM_MS = 10000, XFER_MS = 2000, GAP_MS = 20 };
typedef enum { IDLE, ARMED, ENUMERATING, DEVICE_DESC, CONFIG_HEADER,
               CONFIG_DESC, WAIT_REQUEST, BULK_OUT, BULK_IN, FINISHED } state_t;
static const char *const names[] = {"idle", "armed", "enumerating", "device_descriptor",
  "configuration_header", "configuration_descriptor", "waiting", "bulk_out", "bulk_in", "finished"};
static state_t state;
static uint32_t deadline, reconnect_at;
static bool host_started, reconnect_pending, published;
static uint8_t target;
static probe_endpoints_t endpoints;
static reader_t capture;
static uint8_t rx[512] __attribute__((aligned(4))), tx[64] __attribute__((aligned(4)));
static size_t tx_len;
static uint16_t config_len;
static uint8_t device_desc[18], config_desc[512];
static size_t device_desc_len, config_desc_len;
static char trace[16384], report[2048];
static size_t trace_len, console_read;
static unsigned dropped;

static uint32_t now_ms(void) { return to_ms_since_boot(get_absolute_time()); }
uint32_t tusb_time_millis_api(void) { return now_ms(); }
static bool active(void) { return state >= ENUMERATING && state < FINISHED; }

static void log_event(const char *event, const char *fields, ...) {
  // Core0 only, no reentrant calls. Large buffers stay off the 4KiB stack.
  static char extra[1400], line[1600];
  if (published) return; // TRACE.TXT remains an immutable snapshot.
  va_list args; va_start(args, fields);
  int n = vsnprintf(extra, sizeof(extra), fields, args); va_end(args);
  if (n < 0 || (size_t)n >= sizeof(extra)) { dropped++; return; }
  n = snprintf(line, sizeof(line), "{\"event\":\"%s\",\"ms\":%lu,\"state\":\"%s\"%s}\n",
    event, (unsigned long)now_ms(), names[state], extra);
  if (n < 0 || (size_t)n >= sizeof(line) || (size_t)n > sizeof(trace) - trace_len) { dropped++; return; }
  memcpy(trace + trace_len, line, (size_t)n); trace_len += (size_t)n;
}
static void log_bytes(const char *event, const uint8_t *data, size_t len) {
  static char hex[1025];
  if (len > 512) len = 512;
  for (size_t i = 0; i < len; i++) snprintf(hex + i * 2, 3, "%02x", data[i]);
  hex[len * 2] = 0;
  log_event(event, ",\"length\":%u,\"hex\":\"%s\"", (unsigned)len, hex);
}
static void console_flush(void) {
  if (!tud_cdc_connected()) return;
  if (console_read < trace_len) {
    uint32_t written = tud_cdc_write(trace + console_read, (uint32_t)(trace_len - console_read));
    console_read += written;
  }
  tud_cdc_write_flush();
}
// TinyUSB enumeration has short blocking delays; service only upstream here.
void tusb_time_delay_ms_api(uint32_t ms) {
  uint32_t start = now_ms();
  while ((uint32_t)(now_ms() - start) < ms) {
    tud_task_ext(0, false); console_flush(); tight_loop_contents();
  }
}
static void finish(void) {
  if (state == FINISHED) return;
  state = FINISHED;
  capture.finished = true;
  log_event("capture_finished", ",\"entry_confirmed\":%s,\"complete\":%s,\"dropped_trace_events\":%u",
    capture.identified ? "true" : "false", reader_complete(&capture) ? "true" : "false", dropped);
  size_t report_len = reader_report(&capture, READER_VERSION, report, sizeof(report));
  result_disk_init();
  bool ok = report_len && result_disk_add("REPORT  TXT", report, report_len);
  ok &= result_disk_add("TRACE   TXT", trace, trace_len);
  if (device_desc_len) ok &= result_disk_add("USBDEV  BIN", device_desc, device_desc_len);
  if (config_desc_len) ok &= result_disk_add("USBCFG  BIN", config_desc, config_desc_len);
  if (capture.detect_len) ok &= result_disk_add("A1      BIN", capture.detect, capture.detect_len);
  if (capture.config_len) ok &= result_disk_add("A7      BIN", capture.config, capture.config_len);
  for (unsigned i = 0; i < READER_CHUNKS; i++) {
    char name[] = "AB0     BIN"; name[2] = (char)('0' + i);
    if (capture.data_reply_len[i]) ok &= result_disk_add(name, capture.data_reply[i], capture.data_reply_len[i]);
  }
  if (capture.data_len) ok &= result_disk_add("DATA    BIN", capture.data, capture.data_len);
  // No callback reuses tx/rx after termination. An active transfer may still
  // own them after timeout; the files already hold independent copies.
  published = true;
  if (!ok) { board_color(32, 0, 0); return; }
  result_drive_publish();
  if (reader_complete(&capture)) board_color(0, 32, 0);
  else if (capture.identified) board_color(32, 12, 0);
  else board_color(32, 0, 0);
  // Refresh the computer's no-medium state, leaving host USB and target VBUS
  // running. Disconnect only the native, computer-facing USB controller.
  tud_disconnect(); reconnect_pending = true; reconnect_at = now_ms() + 350;
}
static void fail(const char *reason) {
  if (state == FINISHED) return;
  log_event("failed", ",\"reason\":\"%s\"", reason);
  reader_fail(&capture, reason); finish();
}
static void transfer_complete(tuh_xfer_t *xfer);
static void queue_request(void) {
  state = WAIT_REQUEST; deadline = now_ms() + GAP_MS;
}
static void submit_bulk(state_t next, uint8_t ep, uint8_t *data, size_t len) {
  state = next; deadline = now_ms() + XFER_MS;
  tuh_xfer_t xfer = {.daddr = target, .ep_addr = ep, .buflen = (uint32_t)len,
    .buffer = data, .complete_cb = transfer_complete};
  if (!tuh_edpt_xfer(&xfer)) fail("bulk_submit_failed");
}
static void transfer_complete(tuh_xfer_t *xfer) {
  if (!active() || xfer->daddr != target) return;
  log_event("transfer", ",\"endpoint\":%u,\"result\":%u,\"length\":%lu",
    xfer->ep_addr, xfer->result, (unsigned long)xfer->actual_len);
  if (xfer->result != XFER_RESULT_SUCCESS) { fail("usb_transfer_failed"); return; }
  if (xfer->actual_len > sizeof(rx)) { fail("oversized_usb_reply"); return; }
  if (state == DEVICE_DESC) {
    log_bytes("device_descriptor", rx, xfer->actual_len);
    if (xfer->actual_len != 18 || rx[0] != 18 || rx[1] != 1) { fail("invalid_device_descriptor"); return; }
    memcpy(device_desc, rx, 18); device_desc_len = 18;
    state = CONFIG_HEADER; deadline = now_ms() + XFER_MS;
    if (!tuh_descriptor_get_configuration(target, 0, rx, 9, transfer_complete, 0))
      fail("configuration_header_submit_failed");
    return;
  }
  if (state == CONFIG_HEADER) {
    log_bytes("configuration_header", rx, xfer->actual_len);
    if (xfer->actual_len != 9 || !(config_len = probe_config_length(rx, 9, sizeof(rx)))) {
      fail("invalid_configuration_header"); return;
    }
    state = CONFIG_DESC; deadline = now_ms() + XFER_MS;
    if (!tuh_descriptor_get_configuration(target, 0, rx, config_len, transfer_complete, 0))
      fail("configuration_descriptor_submit_failed");
    return;
  }
  if (state == CONFIG_DESC) {
    log_bytes("configuration_descriptor", rx, xfer->actual_len);
    if (xfer->actual_len != config_len || probe_config_length(rx, xfer->actual_len, sizeof(rx)) != config_len) {
      fail("invalid_configuration_descriptor"); return;
    }
    memcpy(config_desc, rx, config_len); config_desc_len = config_len;
    queue_request(); return;
  }
  if (state == BULK_OUT) {
    if (xfer->ep_addr != endpoints.ep_out || xfer->actual_len != tx_len) { fail("incomplete_bulk_out"); return; }
    memset(rx, 0, sizeof(rx)); submit_bulk(BULK_IN, endpoints.ep_in, rx, 64); return;
  }
  if (state != BULK_IN || xfer->ep_addr != endpoints.ep_in || xfer->actual_len > 64) {
    fail("unexpected_bulk_reply"); return;
  }
  log_bytes("bulk_in", rx, xfer->actual_len);
  reader_reply(&capture, rx, xfer->actual_len);
  if (capture.finished) finish();
  else queue_request();
}
static bool driver_init(void) { return true; }
static bool driver_open(uint8_t rhport, uint8_t daddr, const tusb_desc_interface_t *itf, uint16_t len) {
  uint16_t vid, pid; tuh_vid_pid_get(daddr, &vid, &pid);
  if (rhport != HOST_PORT || state != ENUMERATING || target || !probe_usb_identity(vid, pid)) return false;
  probe_endpoints_t parsed;
  if (!probe_parse_interface((const uint8_t *)itf, len, &parsed)) return false;
  const uint8_t *raw = (const uint8_t *)itf;
  if (!tuh_edpt_open(daddr, (const tusb_desc_endpoint_t *)(raw + parsed.in_offset)) ||
      !tuh_edpt_open(daddr, (const tusb_desc_endpoint_t *)(raw + parsed.out_offset))) return false;
  target = daddr; endpoints = parsed;
  log_event("interface", ",\"vid\":%u,\"pid\":%u,\"ep_in\":%u,\"ep_out\":%u", vid, pid, parsed.ep_in, parsed.ep_out);
  return true;
}
static bool driver_config(uint8_t daddr, uint8_t itf) { usbh_driver_set_config_complete(daddr, itf); return true; }
static bool driver_xfer(uint8_t daddr, uint8_t ep, xfer_result_t result, uint32_t len) {
  (void)daddr; (void)ep; (void)result; (void)len; return true;
}
static void driver_close(uint8_t daddr) {
  if (daddr == target) { if (active()) fail("target_removed"); target = 0; }
}
const usbh_class_driver_t *usbh_app_driver_get_cb(uint8_t *count) {
  static const usbh_class_driver_t driver = {.name = "CH552 read-only reader", .init = driver_init,
    .open = driver_open, .set_config = driver_config, .xfer_cb = driver_xfer, .close = driver_close};
  *count = 1; return &driver;
}
void tuh_mount_cb(uint8_t daddr) {
  uint16_t vid, pid; tuh_vid_pid_get(daddr, &vid, &pid);
  log_event("mounted", ",\"vid\":%u,\"pid\":%u", vid, pid);
  if (!active()) return;
  if (!probe_usb_identity(vid, pid)) { fail("unexpected_usb_identity"); return; }
  if (daddr != target) { fail("unsupported_bootloader_interface"); return; }
  state = DEVICE_DESC; deadline = now_ms() + XFER_MS;
  if (!tuh_descriptor_get_device(target, rx, 18, transfer_complete, 0)) fail("device_descriptor_submit_failed");
}
void tuh_umount_cb(uint8_t daddr) { (void)daddr; if (active()) fail("device_removed"); }
static void arm(void) {
  if (state != IDLE) return;
  state = ARMED; deadline = now_ms() + ARM_MS; board_color(0, 24, 24);
  log_event("armed", ",\"delay_ms\":2000,\"instruction\":\"Plug the unpowered macropad into USB-A now\"");
}
static void console_poll(void) {
  static char line[40]; static size_t len; static bool overflow;
  while (tud_cdc_available()) {
    char ch; if (tud_cdc_read(&ch, 1) != 1) break;
    if (ch == '\r' || ch == '\n') {
      if (!overflow && len) {
        line[len] = 0;
        if (!strcmp(line, "arm")) arm();
        else if (!strcmp(line, "status") || !strcmp(line, "help")) {
          // Short replies only; dropping a response cannot block target reads.
          static char status[256];
          int n = snprintf(status, sizeof(status), "state=%s entry=%u complete=%u files=%u commands=arm,status,help\r\n",
            names[state], capture.identified, reader_complete(&capture), result_drive_ready());
          if (n > 0 && (size_t)n < sizeof(status)) tud_cdc_write(status, (uint32_t)n);
        }
      }
      len = 0; overflow = false;
    } else if (ch >= 32 && ch <= 126 && !overflow) {
      if (len + 1 < sizeof(line)) line[len++] = ch; else overflow = true;
    }
  }
}
static void reader_poll(void) {
  if (state == ARMED && (int32_t)(now_ms() - deadline) >= 0) {
    state = ENUMERATING; deadline = now_ms() + ENUM_MS; host_started = true; board_color(24, 24, 0);
    log_event("host_start", ",\"dp_level\":%u,\"dm_level\":%u", (unsigned)gpio_get(DP_PIN), (unsigned)gpio_get(DM_PIN));
    pio_usb_configuration_t cfg = PIO_USB_DEFAULT_CONFIG; cfg.pin_dp = DP_PIN; cfg.pinout = PIO_USB_PINOUT_DPDM;
    const tusb_rhport_init_t host_init = {.role = TUSB_ROLE_HOST, .speed = TUSB_SPEED_FULL};
    if (!tuh_configure(HOST_PORT, TUH_CFGID_RPI_PIO_USB_CONFIGURATION, &cfg) || !tusb_init(HOST_PORT, &host_init))
      fail("host_init_failed");
  }
  if (host_started && tuh_inited()) tuh_task_ext(0, false);
  // Read state/time together after host callbacks may have changed both.
  if (active() && (int32_t)(now_ms() - deadline) >= 0) {
    if (state == WAIT_REQUEST) {
      tx_len = reader_request(&capture, tx);
      if (!tx_len) fail("request_not_allowed");
      else { log_bytes("bulk_out", tx, tx_len); submit_bulk(BULK_OUT, endpoints.ep_out, tx, tx_len); }
    } else fail("timeout");
  }
  if (reconnect_pending && (int32_t)(now_ms() - reconnect_at) >= 0) {
    reconnect_pending = false; tud_connect();
  }
}
int main(void) {
  set_sys_clock_khz(120000, true);
  gpio_init(DP_PIN); gpio_init(DM_PIN); gpio_disable_pulls(DP_PIN); gpio_disable_pulls(DM_PIN);
  gpio_set_dir(DP_PIN, GPIO_IN); gpio_set_dir(DM_PIN, GPIO_IN);
  reader_init(&capture); board_status_init(); board_color(0, 0, 24);
  const tusb_rhport_init_t device_init = {.role = TUSB_ROLE_DEVICE, .speed = TUSB_SPEED_FULL};
  if (!tusb_init(0, &device_init)) panic("USB device init failed");
  log_event("ready", ",\"version\":\"%s\",\"read_only\":true", READER_VERSION);
  uint32_t button_at = 0;
  bool button_previous = true; // Require release after ROM BOOTSEL flashing.
  while (true) {
    tud_task_ext(0, false); console_poll();
    if (state == IDLE && (uint32_t)(now_ms() - button_at) >= 20) {
      button_at = now_ms(); bool pressed = board_boot_pressed();
      if (pressed && !button_previous) arm();
      button_previous = pressed;
    }
    reader_poll();
    console_flush(); tight_loop_contents();
  }
}
