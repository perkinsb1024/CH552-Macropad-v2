#include "firmware_drive.h"
#include "drive_store.h"
#include "hardware/flash.h"
#include "pico/flash.h"
#include "pico/stdlib.h"
#include "tusb.h"
#include <string.h>

_Static_assert(STORE_BASE == PROGRAMMER_APP_FLASH_BYTES, "storage must start at the linker flash boundary");
_Static_assert(STORE_BASE + 2 * STORE_SLOT == PICO_FLASH_SIZE_BYTES, "storage must fit the physical flash chip");
_Static_assert(STORE_SECTOR == FLASH_SECTOR_SIZE && FLASH_PAGE_SIZE == 256, "unexpected flash geometry");
static uint8_t disk[DRIVE_BYTES];
uint8_t drive_image[PROGRAM_LIMIT];
image_info_t drive_info;
image_result_t drive_result;
uint32_t drive_crc;
static drive_store_t store;
static bool dirty, locked, failed, inspect_pending;
static uint32_t last_write;
static struct { unsigned offset, size; const uint8_t *data; } operation;
static void flash_operation(void *unused) {
  (void)unused;
  if (operation.data) flash_range_program(STORE_BASE + operation.offset, operation.data, operation.size);
  else flash_range_erase(STORE_BASE + operation.offset, operation.size);
}
static bool store_write(unsigned offset, const uint8_t *data, unsigned size) {
  operation.offset = offset; operation.data = data; operation.size = size;
  return flash_safe_execute(flash_operation, NULL, 1000) == PICO_OK;
}
static void validate(void) {
  drive_result = image_drive_load(disk, drive_image, &drive_info);
  drive_crc = drive_result == IMAGE_VALID ? program_crc32(drive_image, PROGRAM_LIMIT) : 0;
}
static void inspect_disk(void) {
  if (!inspect_pending) return;
  static uint8_t candidate[PROGRAM_LIMIT];
  image_info_t info;
  image_result_t result = image_drive_load(disk, candidate, &info);
  // Mount timestamps, hidden files and unused FAT entries do not change the
  // selected firmware. Keep the committed image ready without saving metadata.
  bool same = (result == IMAGE_MISSING && drive_result == IMAGE_MISSING) ||
    (result == IMAGE_VALID && drive_result == IMAGE_VALID &&
     !strcmp(info.name, drive_info.name) && !memcmp(candidate, drive_image, PROGRAM_LIMIT));
  dirty = !same || store.current < 0;
  inspect_pending = false;
}
void firmware_drive_init(void) {
  locked = failed = inspect_pending = false;
  dirty = !drive_store_init(&store, (const uint8_t *)(XIP_BASE + STORE_BASE), disk);
  // Rename the previous default on restored snapshots without erasing the HEX.
  // These metadata changes persist with the next firmware save.
  if (!memcmp(disk + 43, "MACROPAD   ", 11))
    memcpy(disk + 43, DRIVE_VOLUME_LABEL, 11);
  for (unsigned i = 0; i < 128; i++) {
    uint8_t *entry = disk + DRIVE_ROOT * DRIVE_SECTOR + i * 32;
    if (!entry[0]) break;
    if (entry[11] == 8 && !memcmp(entry, "MACROPAD   ", 11))
      memcpy(entry, DRIVE_VOLUME_LABEL, 11);
  }
  last_write = to_ms_since_boot(get_absolute_time());
  validate();
}
bool firmware_drive_pending(void) { return dirty || store.saving || inspect_pending; }
void firmware_drive_poll(uint32_t now) {
  inspect_disk();
  if (locked || failed || !dirty || (uint32_t)(now - last_write) < 1500) return;
  if (!store.saving) drive_store_begin(&store);
  if (!drive_store_step(&store, store_write)) {
    failed = true; store.saving = false; drive_result = IMAGE_INVALID; drive_info.error = "storage_write_failed"; dirty = false;
  } else if (!store.saving) { dirty = false; validate(); }
}
bool firmware_drive_lock(void) {
  if (failed || firmware_drive_pending() || drive_result != IMAGE_VALID) return false;
  // No other core, all MSC callbacks run from the same main loop.
  locked = true; return true;
}
void tud_msc_inquiry_cb(uint8_t lun, uint8_t vendor[8], uint8_t product[16], uint8_t revision[4]) {
  (void)lun; memcpy(vendor, "MACROPAD", 8); memcpy(product, "CH552 FW UPDATER ", 16); memcpy(revision, "0300", 4);
}
bool tud_msc_test_unit_ready_cb(uint8_t lun) { (void)lun; return true; }
void tud_msc_capacity_cb(uint8_t lun, uint32_t *count, uint16_t *size) {
  (void)lun; *count = DRIVE_SECTORS; *size = DRIVE_SECTOR;
}
bool tud_msc_is_writable_cb(uint8_t lun) { (void)lun; return !locked && !failed; }
static bool bounds(uint32_t lba, uint32_t offset, uint32_t size) {
  return lba < DRIVE_SECTORS && offset < DRIVE_SECTOR && size <= DRIVE_BYTES - lba * DRIVE_SECTOR - offset;
}
int32_t tud_msc_read10_cb(uint8_t lun, uint32_t lba, uint32_t offset, void *buffer, uint32_t size) {
  if (!bounds(lba, offset, size)) { tud_msc_set_sense(lun, 5, 0x21, 0); return -1; }
  memcpy(buffer, disk + lba * DRIVE_SECTOR + offset, size); return size;
}
int32_t tud_msc_write10_cb(uint8_t lun, uint32_t lba, uint32_t offset, uint8_t *buffer, uint32_t size) {
  if (locked || failed) { tud_msc_set_sense(lun, 7, 0x27, 0); return -1; }
  if (!bounds(lba, offset, size)) { tud_msc_set_sense(lun, 5, 0x21, 0); return -1; }
  uint8_t *dest = disk + lba * DRIVE_SECTOR + offset;
  if (memcmp(dest, buffer, size)) {
    memcpy(dest, buffer, size); inspect_pending = true; store.saving = false;
    last_write = to_ms_since_boot(get_absolute_time());
  }
  return size;
}
// Flush/eject commands wait for durability rather than acknowledging a RAM-only copy.
// Do not reenter tud_task() here. BOT commands are serialized; the computer waits
// for this command's status while each flash operation briefly masks interrupts.
static bool sync_disk(uint8_t lun) {
  while (firmware_drive_pending()) {
    uint32_t now = to_ms_since_boot(get_absolute_time());
    last_write = now - 1500;
    firmware_drive_poll(now);
  }
  if (failed) { tud_msc_set_sense(lun, 3, 0x0c, 0); return false; }
  return true;
}
bool tud_msc_start_stop_cb(uint8_t lun, uint8_t power, bool start, bool eject) {
  (void)power; (void)start; (void)eject;
  return sync_disk(lun);
}
int32_t tud_msc_scsi_cb(uint8_t lun, const uint8_t command[16], void *buffer, uint16_t size) {
  (void)buffer; (void)size;
  if (command[0] == 0x35) return sync_disk(lun) ? 0 : -1; // SYNCHRONIZE CACHE
  tud_msc_set_sense(lun, 5, 0x20, 0); return -1;
}
