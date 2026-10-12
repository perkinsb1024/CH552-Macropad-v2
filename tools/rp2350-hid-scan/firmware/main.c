#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include "hardware/clocks.h"
#include "hardware/flash.h"
#include "hardware/sync.h"
#include "pico/stdlib.h"
#include "pio_usb.h"
#include "tusb.h"
#include "host/hcd.h"
#include "host/usbh_pvt.h"
#include "board_status.h"
#include "probe_protocol.h"
#include "result_disk.h"
#include "scan.h"
#include "store.h"

_Static_assert(PICO_FLASH_SIZE_BYTES == 2 * 1024 * 1024, "Physical flash size must remain 2MiB");
_Static_assert(SCANNER_APP_FLASH_BYTES == STORE_BASE, "Linker/storage boundary mismatch");
enum { HOST_PORT = 1, INSERT_MS = 8000, ENUM_MS = 10000, XFER_MS = 2000, OBSERVE_MS = 1000 };
typedef enum { IDLE, INSERT, ENUMERATING, DEVICE_DESC, CONFIG_HEADER, CONFIG_DESC,
  REPORT_DESC, SEND_WAIT, PROBE_OUT, OBSERVE, REMOVE_WAIT, BOOT_WAIT, BOOT_OUT,
  BOOT_IN, DONE } state_t;
static const char *const names[] = {"idle","insertion","enumerating","device_descriptor",
  "configuration_header","configuration_descriptor","report_descriptor","send_wait",
  "probe_out","observing","remove_wait","boot_wait","boot_out","boot_in","done"};
static state_t state;
static uint32_t deadline, session, reconnect_at;
static bool host_started, timer_started, reconnect_pending, published, factory_seen;
static bool checking, hit, boot_identity, scheduled_remove;
static uint8_t target, out_ep, in_ep, current_command, current_report_id;
static uint16_t report_length, config_length, packet_in, packet_out;
static uint16_t mounted_vid, mounted_pid;
static scan_layout_t layout, initial_layout;
static unsigned report_index, cursor, attempts, accepted, rejected;
static int last_result = -1;
static int last_actual_length = -1;
static probe_endpoints_t boot_endpoints;
static repeating_timer_t host_timer;
static uint8_t tx[65] __attribute__((aligned(4))), rx[1024] __attribute__((aligned(4)));
static uint8_t input[64] __attribute__((aligned(4)));
static size_t tx_length;
static uint8_t dev_desc[18], cfg_desc[1024], hid_desc[1024], boot_reply[64];
static size_t dev_length, cfg_length, hid_length, boot_length;
static char trace[16384], report[3072];
static char results[32768];
static size_t results_length;
static size_t trace_length, console_offset;
static unsigned dropped, input_count;
static const char *outcome = "not_run";
static store_t storage;
static bool saved_results;
static uint32_t candidate_at;
static bool result_pending;
static void reenumerate(void);

static bool record_result(const char *observation) {
  if (!result_pending) return true;
  char row[100];
  int n = snprintf(row, sizeof(row), "%lu,%u,%02X,%u,%d,%d,%s\n",
    (unsigned long)candidate_at, initial_layout.reports[report_index].id,
    current_command, initial_layout.reports[report_index].bytes, last_result, last_actual_length, observation);
  if (n <= 0 || (size_t)n >= sizeof(row) || (size_t)n > sizeof(results) - results_length) return false;
  memcpy(results + results_length, row, (size_t)n); results_length += (size_t)n;
  result_pending = false; return true;
}

static uint32_t now_ms(void) { return to_ms_since_boot(get_absolute_time()); }
uint32_t tusb_time_millis_api(void) { return now_ms(); }
static bool expired(uint32_t now) { return (int32_t)(now - deadline) >= 0; }
static bool running(void) { return state > IDLE && state < DONE; }
static void log_event(const char *event, const char *format, ...) {
  static char fields[2400], line[2600];
  if (published) return;
  va_list args; va_start(args, format);
  int n = vsnprintf(fields, sizeof(fields), format, args); va_end(args);
  if (n < 0 || (size_t)n >= sizeof(fields)) { dropped++; return; }
  n = snprintf(line, sizeof(line), "{\"event\":\"%s\",\"ms\":%lu,\"state\":\"%s\",\"session\":%lu%s}\n",
    event, (unsigned long)now_ms(), names[state], (unsigned long)session, fields);
  if (n < 0 || (size_t)n >= sizeof(line) || (size_t)n > sizeof(trace) - trace_length) { dropped++; return; }
  memcpy(trace + trace_length, line, (size_t)n); trace_length += (size_t)n;
}
static void log_bytes(const char *event, const uint8_t *data, size_t len) {
  static char hex[2049];
  if (len > 1024) len = 1024;
  for (size_t i = 0; i < len; i++) snprintf(hex + i * 2, 3, "%02x", data[i]);
  hex[len * 2] = 0;
  log_event(event, ",\"length\":%u,\"hex\":\"%s\"", (unsigned)len, hex);
}
static void console_flush(void) {
  if (tud_cdc_connected() && console_offset < trace_length)
    console_offset += tud_cdc_write(trace + console_offset, (uint32_t)(trace_length - console_offset));
  tud_cdc_write_flush();
}
void tusb_time_delay_ms_api(uint32_t delay) {
  uint32_t start = now_ms();
  while ((uint32_t)(now_ms() - start) < delay) {
    tud_task_ext(0, false); console_flush(); tight_loop_contents();
  }
}
static bool frame_timer(repeating_timer_t *timer) { (void)timer; pio_usb_host_frame(); return true; }
static bool flash_write(unsigned offset, const uint8_t *data, size_t len) {
  if (offset > 2 * STORE_SLOT || len > 2 * STORE_SLOT - offset) return false;
  uint32_t irq = save_and_disable_interrupts();
  if (data) flash_range_program(STORE_BASE + offset, data, len);
  else flash_range_erase(STORE_BASE + offset, len);
  restore_interrupts(irq);
  tud_task_ext(0, false); // Keep upstream serviced between flash operations.
  return true;
}
static void finish(const char *reason) {
  if (state == DONE) return;
  if (state == INSERT && host_started) (void)tuh_rhport_reset_bus(HOST_PORT, false);
  outcome = reason; state = DONE;
  // Terminal only: prevent PIO scheduling/IRQs while XIP flash is unavailable.
  if (timer_started) { cancel_repeating_timer(&host_timer); timer_started = false; }
  if (result_pending) (void)record_result(reason);
  log_event("finished", ",\"outcome\":\"%s\",\"attempts\":%u,\"dropped_events\":%u", reason, attempts, dropped);
  int n = snprintf(report, sizeof(report),
    "{\n\"scanner_version\":\"%s\",\n\"outcome\":\"%s\",\n"
    "\"factory_vid_pid\":\"1189:8890\",\n\"factory_interface\":1,\n"
    "\"factory_baseline_seen\":%s,\n\"bootloader_identity_confirmed\":%s,\n"
    "\"transition_after_probe\":%s,\n\"last_command\":%d,\n\"last_report_id\":%d,\n"
    "\"last_transfer_result\":%d,\n\"attempts\":%u,\n\"accepted_transfers\":%u,\n"
    "\"rejected_transfers\":%u,\n\"dropped_trace_events\":%u,\n"
    "\"observe_ms\":1000,\n\"scope\":\"First payload byte 00..FF; remaining bytes zero; descriptor-supported IDs 3,0,2\",\n"
    "\"skipped\":\"01..12,A1,AA,B0 (hex)\",\n"
    "\"transport\":\"%s\",\n\"storage\":\"Two CRC-protected RP2350 flash snapshots; commit at terminal outcome\",\n"
    "\"attribution\":\"Transition follows a probe and a host-forced USB re-enumeration; single trial, no power-cycle isolation\"\n}\n",
    SCAN_VERSION, reason, factory_seen ? "true" : "false", boot_identity ? "true" : "false",
    hit ? "true" : "false", attempts ? current_command : -1,
    attempts ? current_report_id : -1,
    last_result, attempts, accepted, rejected, dropped, out_ep ? "interrupt OUT" : "control SET_REPORT");
  result_disk_init();
  bool ok = n > 0 && (size_t)n < sizeof(report) && result_disk_add("REPORT  TXT", report, (size_t)n);
  ok &= result_disk_add("TRACE   TXT", trace, trace_length);
  ok &= result_disk_add("RESULTS CSV", results, results_length);
  if (dev_length) ok &= result_disk_add("USBDEV  BIN", dev_desc, dev_length);
  if (cfg_length) ok &= result_disk_add("USBCFG  BIN", cfg_desc, cfg_length);
  if (hid_length) ok &= result_disk_add("HIDRPT  BIN", hid_desc, hid_length);
  if (attempts) ok &= result_disk_add("LASTOUT BIN", tx, tx_length);
  if (boot_length) ok &= result_disk_add("A1      BIN", boot_reply, boot_length);
  const char *save_note = "Flash snapshot. A restored snapshot has passed header and disk CRC checks.\n"
    "If SAVEERR.TXT is present, this run was NOT saved; copy its RAM files now.\n";
  ok &= result_disk_add("SAVE    TXT", save_note, strlen(save_note));
  saved_results = ok && store_save(&storage, result_disk_image(), flash_write);
  if (!saved_results) {
    const char *error = "Flash save failed. Copy these RAM results before reset/power loss. Older flash results may remain.\n";
    result_disk_add("SAVEERR TXT", error, strlen(error));
  }
  published = true;
  if (!ok) { board_color(32, 0, 0); return; }
  result_drive_publish();
  if (!saved_results) board_color(32, 0, 0);
  else if (hit) board_color(0, 32, 0);
  else if (!strcmp(reason, "sweep_complete")) board_color(32, 12, 0);
  else board_color(32, 0, 0);
  tud_disconnect(); reconnect_pending = true; reconnect_at = now_ms() + 350;
}
static void transfer_complete(tuh_xfer_t *xfer);
static bool descriptor_request(uint8_t type, uint16_t length) {
  tusb_control_request_t setup = {.bmRequestType = type == 0x22 ? 0x81 : 0x80,
    .bRequest = 6, .wValue = (uint16_t)(type << 8), .wIndex = type == 0x22 ? 1 : 0, .wLength = length};
  tuh_xfer_t xfer = {.daddr = target, .ep_addr = 0, .setup = &setup, .buffer = rx,
    .complete_cb = transfer_complete, .user_data = session};
  deadline = now_ms() + XFER_MS;
  return tuh_control_xfer(&xfer);
}
static void reenumerate(void) {
  checking = true; scheduled_remove = true; state = REMOVE_WAIT;
  session++; // Reject every completion from the previous target session.
  if (!attempts) log_event("baseline_reenumeration", "");
  hcd_event_device_remove(HOST_PORT, false);
  // Next main-loop host task drains removal, closes endpoints/control transfer.
  deadline = now_ms() + 20;
}
static void input_complete(tuh_xfer_t *xfer) {
  if (!running() || xfer->user_data != session || xfer->daddr != target) return;
  if (xfer->result == XFER_RESULT_SUCCESS && xfer->actual_len <= sizeof(input) && input_count < 32) {
    input_count++; log_bytes("input_report", input, xfer->actual_len);
  }
  // Do not continuously requeue: each observation has a bounded input capture.
}
static void send_candidate(void) {
  if (report_index >= initial_layout.count) { finish("sweep_complete"); return; }
  if (!scan_next(&cursor, &current_command)) {
    report_index++; cursor = 0;
    if (report_index >= initial_layout.count) { finish("sweep_complete"); return; }
    if (!scan_next(&cursor, &current_command)) { finish("no_candidates"); return; }
  }
  scan_report_t r = initial_layout.reports[report_index];
  current_report_id = r.id;
  tx_length = scan_packet(r, current_command, tx);
  if (!tx_length) { finish("invalid_candidate"); return; }
  attempts++; last_result = -1; last_actual_length = -1;
  result_pending = true;
  candidate_at = now_ms();
  if (attempts == 1) log_bytes("first_output_report", tx, tx_length);
  state = PROBE_OUT; deadline = now_ms() + XFER_MS;
  bool sent;
  if (out_ep) {
    tuh_xfer_t xfer = {.daddr = target, .ep_addr = out_ep, .buffer = tx, .buflen = (uint32_t)tx_length,
      .complete_cb = transfer_complete, .user_data = session};
    sent = tuh_edpt_xfer(&xfer);
  } else {
    tusb_control_request_t setup = {.bmRequestType = 0x21, .bRequest = 9,
      .wValue = (uint16_t)(0x0200 | r.id), .wIndex = 1, .wLength = (uint16_t)tx_length};
    tuh_xfer_t xfer = {.daddr = target, .ep_addr = 0, .setup = &setup, .buffer = tx,
      .complete_cb = transfer_complete, .user_data = session};
    sent = tuh_control_xfer(&xfer);
  }
  if (!sent) { rejected++; finish("probe_submission_failed"); return; }
  if (in_ep && input_count < 32) {
    tuh_xfer_t xfer = {.daddr = target, .ep_addr = in_ep, .buffer = input, .buflen = packet_in,
      .complete_cb = input_complete, .user_data = session};
    (void)tuh_edpt_xfer(&xfer);
  }
}
static void transfer_complete(tuh_xfer_t *xfer) {
  if (!running() || xfer->user_data != session || xfer->daddr != target) return;
  if (!factory_seen || (xfer->result != XFER_RESULT_SUCCESS && (state != PROBE_OUT || rejected < 32)) || state == BOOT_IN || state == BOOT_OUT)
    log_event("transfer", ",\"endpoint\":%u,\"result\":%u,\"length\":%lu", xfer->ep_addr,
      xfer->result, (unsigned long)xfer->actual_len);
  if (state == PROBE_OUT) {
    last_result = (int)xfer->result;
    last_actual_length = (int)xfer->actual_len;
    bool ok = xfer->result == XFER_RESULT_SUCCESS && xfer->actual_len == tx_length;
    if (ok) accepted++; else {
      rejected++;
      if (rejected <= 32) log_event("probe_rejected", ",\"command\":%u,\"result\":%d", current_command, last_result);
    }
    state = OBSERVE; deadline = now_ms() + OBSERVE_MS; return;
  }
  if (xfer->result != XFER_RESULT_SUCCESS || xfer->actual_len > sizeof(rx)) { finish("usb_transfer_failed"); return; }
  if (state == DEVICE_DESC) {
    if (xfer->actual_len != 18 || rx[0] != 18 || rx[1] != 1) { finish("invalid_device_descriptor"); return; }
    if (!checking) { memcpy(dev_desc, rx, 18); dev_length = 18; log_bytes("factory_device_descriptor", rx, 18); }
    state = CONFIG_HEADER;
    if (!descriptor_request(2, 9)) finish("descriptor_submit_failed");
  } else if (state == CONFIG_HEADER) {
    config_length = probe_config_length(rx, xfer->actual_len, sizeof(rx));
    if (xfer->actual_len != 9 || !config_length) { finish("invalid_configuration_header"); return; }
    state = CONFIG_DESC;
    if (!descriptor_request(2, config_length)) finish("descriptor_submit_failed");
  } else if (state == CONFIG_DESC) {
    if (xfer->actual_len != config_length || probe_config_length(rx, xfer->actual_len, sizeof(rx)) != config_length) {
      finish("invalid_configuration_descriptor"); return;
    }
    if (!checking) { memcpy(cfg_desc, rx, config_length); cfg_length = config_length; log_bytes("factory_configuration", rx, config_length); }
    state = REPORT_DESC;
    if (!descriptor_request(0x22, report_length)) finish("report_descriptor_submit_failed");
  } else if (state == REPORT_DESC) {
    if (xfer->actual_len != report_length || !scan_parse_hid(rx, xfer->actual_len, &layout)) {
      log_bytes("rejected_report_descriptor", rx, xfer->actual_len); finish("unsupported_hid_descriptor"); return;
    }
    bool same_layout = layout.count == initial_layout.count;
    for (unsigned i = 0; i < layout.count && same_layout; i++)
      same_layout = layout.reports[i].id == initial_layout.reports[i].id && layout.reports[i].bytes == initial_layout.reports[i].bytes;
    if (checking && (!same_layout || hid_length != xfer->actual_len || memcmp(hid_desc, rx, hid_length))) {
      finish("factory_descriptor_changed"); return;
    }
    if (!checking) {
      memcpy(hid_desc, rx, report_length); hid_length = report_length; initial_layout = layout; factory_seen = true;
      log_bytes("factory_hid_descriptor", rx, report_length);
      log_event("baseline", ",\"report_count\":%u,\"out_endpoint\":%u", layout.count, out_ep);
      // Establish that a host-forced reset alone leaves this target in factory
      // mode before attributing any later transition to a candidate.
      reenumerate(); return;
    } else if (attempts && !record_result("factory")) { finish("results_capacity_exceeded"); return; }
    else if (!attempts) log_event("baseline_reset_passed", "");
    checking = false; state = SEND_WAIT; deadline = now_ms() + 20;
  } else if (state == BOOT_OUT) {
    if (xfer->actual_len != 21) { finish("boot_identification_out_incomplete"); return; }
    state = BOOT_IN; deadline = now_ms() + XFER_MS;
    tuh_xfer_t in = {.daddr = target, .ep_addr = boot_endpoints.ep_in, .buffer = rx, .buflen = 64,
      .complete_cb = transfer_complete, .user_data = session};
    if (!tuh_edpt_xfer(&in)) finish("boot_identification_submit_failed");
  } else if (state == BOOT_IN) {
    if (xfer->actual_len <= sizeof(boot_reply)) { memcpy(boot_reply, rx, xfer->actual_len); boot_length = xfer->actual_len; }
    log_bytes("bootloader_a1", rx, xfer->actual_len);
    if (!probe_parse_detect(rx, xfer->actual_len)) { finish("wch_identity_unconfirmed"); return; }
    boot_identity = true; hit = factory_seen && attempts != 0;
    finish(hit ? "bootloader_transition" : "bootloader_before_probe");
  }
}
static bool driver_init(void) { return true; }
static bool driver_open(uint8_t rhport, uint8_t addr, const tusb_desc_interface_t *itf, uint16_t len) {
  if (rhport != HOST_PORT || state != ENUMERATING || target) return false;
  uint16_t vid, pid; tuh_vid_pid_get(addr, &vid, &pid);
  const uint8_t *raw = (const uint8_t *)itf;
  if (probe_usb_identity(vid, pid)) {
    if (!probe_parse_interface(raw, len, &boot_endpoints)) return false;
    if (!tuh_edpt_open(addr, (const tusb_desc_endpoint_t *)(raw + boot_endpoints.in_offset)) ||
        !tuh_edpt_open(addr, (const tusb_desc_endpoint_t *)(raw + boot_endpoints.out_offset))) return false;
  } else {
    if (vid != 0x1189 || pid != 0x8890 || len < 9 || raw[2] != 1 || raw[5] != 3 || raw[3] != 0) return false;
    report_length = 0; out_ep = in_ep = 0; packet_out = packet_in = 0;
    for (size_t p = 9; p < len;) {
      unsigned n = raw[p]; if (n < 2 || n > len - p) return false;
      if (raw[p + 1] == 0x21) {
        if (n < 9 || raw[p + 5] != 1 || raw[p + 6] != 0x22) return false;
        report_length = raw[p + 7] | (uint16_t)raw[p + 8] << 8;
      } else if (raw[p + 1] == 5) {
        if (n != 7 || (raw[p + 3] & 3) != 3) return false;
        uint16_t packet = raw[p + 4] | (uint16_t)raw[p + 5] << 8;
        if (!packet || packet > 64 || !(raw[p + 2] & 15)) return false;
        if (!tuh_edpt_open(addr, (const tusb_desc_endpoint_t *)(raw + p))) return false;
        if (raw[p + 2] & 0x80) { if (in_ep) return false; in_ep = raw[p + 2]; packet_in = packet; }
        else { if (out_ep) return false; out_ep = raw[p + 2]; packet_out = packet; }
      }
      p += n;
    }
    if (!report_length || report_length > sizeof(rx)) return false;
  }
  target = addr; return true;
}
static bool driver_config(uint8_t addr, uint8_t itf) { usbh_driver_set_config_complete(addr, itf); return true; }
static bool driver_xfer(uint8_t a, uint8_t e, xfer_result_t r, uint32_t n) { (void)a; (void)e; (void)r; (void)n; return true; }
static void driver_close(uint8_t addr) { if (addr == target) target = 0; }
const usbh_class_driver_t *usbh_app_driver_get_cb(uint8_t *count) {
  static const usbh_class_driver_t driver = {.name = "Factory HID scanner", .init = driver_init,
    .open = driver_open, .set_config = driver_config, .xfer_cb = driver_xfer, .close = driver_close};
  *count = 1; return &driver;
}
void tuh_mount_cb(uint8_t addr) {
  if (state != ENUMERATING) return;
  tuh_vid_pid_get(addr, &mounted_vid, &mounted_pid);
  if (!factory_seen || probe_usb_identity(mounted_vid, mounted_pid))
    log_event("mounted", ",\"vid\":%u,\"pid\":%u", mounted_vid, mounted_pid);
  if (addr != target) { finish("unexpected_identity_or_interface"); return; }
  if (probe_usb_identity(mounted_vid, mounted_pid)) {
    state = BOOT_WAIT; deadline = now_ms() + 20;
  } else {
    state = DEVICE_DESC;
    if (!descriptor_request(1, 18)) finish("device_descriptor_submit_failed");
  }
}
void tuh_umount_cb(uint8_t addr) {
  if (!running() || scheduled_remove || addr != target) return;
  log_event("natural_disconnect", ",\"during_command\":%d", attempts ? current_command : -1);
  if (!factory_seen || !attempts) { finish("disconnected_before_probe"); return; }
  // Preserve uncertain delivery and wait before a forced identity check.
  session++; state = OBSERVE; deadline = now_ms() + OBSERVE_MS;
}
static void arm(void) {
  if (state != IDLE) return;
  published = false; trace_length = console_offset = 0; outcome = "running";
  result_drive_hide(); state = INSERT;
  static const char header[] = "adapter_ms,report_id,command_hex,payload_bytes,usb_result,actual_bytes,observation\n";
  memcpy(results, header, sizeof(header) - 1); results_length = sizeof(header) - 1;
  board_color(0, 24, 24);
  pio_usb_configuration_t cfg = PIO_USB_DEFAULT_CONFIG;
  cfg.pin_dp = 12; cfg.pinout = PIO_USB_PINOUT_DPDM; cfg.skip_alarm_pool = true;
  const tusb_rhport_init_t init = {.role = TUSB_ROLE_HOST, .speed = TUSB_SPEED_FULL};
  if (!tuh_configure(HOST_PORT, TUH_CFGID_RPI_PIO_USB_CONFIGURATION, &cfg) || !tusb_init(HOST_PORT, &init)) {
    finish("host_init_failed"); return;
  }
  host_started = true;
  // No host frames run yet. SE0 overrides the fixed R13 during target power-on.
  if (!tuh_rhport_reset_bus(HOST_PORT, true)) { finish("bus_hold_failed"); return; }
  deadline = now_ms() + INSERT_MS;
  log_event("armed", ",\"insertion_window_ms\":8000,\"data_lines\":\"held low until window ends\"");
}
static void poll(void) {
  if (host_started && state != INSERT && state != DONE) tuh_task_ext(0, false);
  uint32_t now = now_ms();
  if (running() && expired(now)) {
    if (state == INSERT) {
      if (!tuh_rhport_reset_bus(HOST_PORT, false)) { finish("bus_release_failed"); return; }
      state = ENUMERATING; deadline = now + ENUM_MS;
      board_color(24, 24, 0);
      timer_started = add_repeating_timer_us(-1000, frame_timer, NULL, &host_timer);
      if (!timer_started) finish("frame_timer_failed");
      else log_event("host_started", "");
    } else if (state == SEND_WAIT) send_candidate();
    else if (state == PROBE_OUT) {
      rejected++;
      if (rejected <= 32) log_event("probe_timeout", ",\"delivery_uncertain\":true");
      // Removal drains endpoint ownership before any subsequent buffer reuse.
      reenumerate();
    } else if (state == OBSERVE) reenumerate();
    else if (state == REMOVE_WAIT) {
      scheduled_remove = false; target = 0; state = ENUMERATING; deadline = now + ENUM_MS;
      hcd_event_device_attach(HOST_PORT, false);
    } else if (state == BOOT_WAIT) {
      size_t len; const uint8_t *req = probe_request(0xa1, &len);
      state = BOOT_OUT; deadline = now + XFER_MS;
      // Separate immutable request leaves LASTOUT.BIN as the candidate report.
      tuh_xfer_t xfer = {.daddr = target, .ep_addr = boot_endpoints.ep_out,
        .buffer = (uint8_t *)req, .buflen = (uint32_t)len, .complete_cb = transfer_complete, .user_data = session};
      log_bytes("bootloader_a1_request", req, len);
      if (!tuh_edpt_xfer(&xfer)) finish("boot_identification_submit_failed");
    } else finish(state == ENUMERATING ? "enumeration_timeout" : "transfer_timeout");
  }
  if (reconnect_pending && (int32_t)(now_ms() - reconnect_at) >= 0) {
    reconnect_pending = false; tud_connect();
  }
}
static void console_poll(void) {
  static char line[32]; static size_t len; static bool overflow;
  while (tud_cdc_available()) {
    char c; if (tud_cdc_read(&c, 1) != 1) break;
    if (c == '\n' || c == '\r') {
      if (len && !overflow) {
        line[len] = 0;
        if (!strcmp(line, "arm")) arm();
        else if (!strcmp(line, "stop") && running()) finish("stopped_by_operator");
        else if (!strcmp(line, "status") || !strcmp(line, "help")) {
          char text[180]; int n = snprintf(text, sizeof(text), "state=%s attempts=%u outcome=%s flash=%u commands=arm,status,stop,help\r\n",
            names[state], attempts, outcome, saved_results);
          if (n > 0 && (size_t)n < sizeof(text)) tud_cdc_write(text, (uint32_t)n);
        }
      }
      len = 0; overflow = false;
    } else if (c >= 32 && c <= 126 && !overflow) {
      if (len + 1 < sizeof(line)) line[len++] = c; else overflow = true;
    }
  }
}
int main(void) {
  set_sys_clock_khz(120000, true);
  gpio_init(12); gpio_init(13); gpio_disable_pulls(12); gpio_disable_pulls(13);
  gpio_set_dir(12, GPIO_IN); gpio_set_dir(13, GPIO_IN);
  board_status_init(); board_color(0, 0, 24);
  static uint8_t restored[STORE_DISK];
  saved_results = store_load(&storage, (const uint8_t *)(XIP_BASE + STORE_BASE), restored);
  if (saved_results) {
    result_disk_load(restored); result_drive_publish();
    // Restored results are immutable; no new scan runs without BOOT/arm.
  }
  const tusb_rhport_init_t device_init = {.role = TUSB_ROLE_DEVICE, .speed = TUSB_SPEED_FULL};
  if (!tusb_init(0, &device_init)) panic("USB device init failed");
  uint32_t button_at = 0; bool previous = true;
  while (true) {
    tud_task_ext(0, false); console_poll();
    if (state == IDLE && (uint32_t)(now_ms() - button_at) >= 20) {
      button_at = now_ms(); bool pressed = board_boot_pressed();
      if (pressed && !previous) arm();
      previous = pressed;
    }
    poll(); console_flush(); tight_loop_contents();
  }
}
