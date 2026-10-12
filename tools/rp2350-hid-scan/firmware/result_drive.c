#include "result_disk.h"
#include "tusb.h"
#include <string.h>

static bool ready;
void result_drive_publish(void) { ready = true; }
bool result_drive_ready(void) { return ready; }
void tud_msc_inquiry_cb(uint8_t lun, uint8_t vendor[8], uint8_t product[16], uint8_t revision[4]) {
  (void)lun; memcpy(vendor, "MACROPAD", 8); memcpy(product, "CH552 HID SCAN  ", 16); memcpy(revision, "0100", 4);
}
bool tud_msc_test_unit_ready_cb(uint8_t lun) {
  if (!ready) tud_msc_set_sense(lun, 2, 0x3a, 0); // No medium until frozen capture.
  return ready;
}
void tud_msc_capacity_cb(uint8_t lun, uint32_t *count, uint16_t *size) {
  (void)lun; *count = RESULT_SECTORS; *size = RESULT_SECTOR;
}
bool tud_msc_is_writable_cb(uint8_t lun) { (void)lun; return false; }
int32_t tud_msc_read10_cb(uint8_t lun, uint32_t lba, uint32_t offset, void *out, uint32_t len) {
  if (!tud_msc_test_unit_ready_cb(lun)) return -1;
  if (!result_disk_read(lba, offset, out, len)) { tud_msc_set_sense(lun, 5, 0x21, 0); return -1; }
  return (int32_t)len;
}
int32_t tud_msc_write10_cb(uint8_t lun, uint32_t lba, uint32_t offset, uint8_t *data, uint32_t len) {
  (void)lba; (void)offset; (void)data; (void)len;
  tud_msc_set_sense(lun, 7, 0x27, 0); return -1; // DATA PROTECT, write protected.
}
bool tud_msc_start_stop_cb(uint8_t lun, uint8_t power, bool start, bool eject) {
  (void)lun; (void)power; (void)start; (void)eject; return true;
}
int32_t tud_msc_scsi_cb(uint8_t lun, const uint8_t command[16], void *out, uint16_t len) {
  (void)out; (void)len;
  if (command[0] == 0x35) return 0; // SYNCHRONIZE CACHE: nothing to write.
  tud_msc_set_sense(lun, 5, 0x20, 0); return -1;
}

void result_drive_hide(void) { ready = false; }
