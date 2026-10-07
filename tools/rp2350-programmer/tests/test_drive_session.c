#include "firmware_drive.h"
#include "drive_store.h"
#include "tusb.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
uint8_t fake_flash[2 * STORE_SLOT];
uint32_t fake_now;
static unsigned writes;
static bool fail_flash;
static uint8_t disk[DRIVE_BYTES];
void flash_range_erase(uint32_t offset, size_t size) {
  assert(offset >= STORE_BASE && offset + size <= STORE_BASE + sizeof(fake_flash));
  memset(fake_flash + (offset - STORE_BASE), 255, size); writes++;
}
void flash_range_program(uint32_t offset, const uint8_t *data, size_t size) {
  assert(offset >= STORE_BASE && offset + size <= STORE_BASE + sizeof(fake_flash));
  for (size_t i = 0; i < size; i++) fake_flash[offset - STORE_BASE + i] &= data[i];
  writes++;
}
int flash_safe_execute(void (*callback)(void *), void *arg, uint32_t timeout) {
  (void)timeout;
  if (fail_flash) return -1;
  callback(arg); return 0;
}
void tud_msc_set_sense(uint8_t lun, uint8_t key, uint8_t asc, uint8_t ascq) {
  (void)lun; (void)key; (void)asc; (void)ascq;
}
static void read_disk(void) {
  assert(tud_msc_read10_cb(0, 0, 0, disk, DRIVE_BYTES) == DRIVE_BYTES);
}
static void write_sector(unsigned sector) {
  assert(tud_msc_write10_cb(0, sector, 0, disk + sector * 512, 512) == 512);
  firmware_drive_poll(fake_now);
}
static void finish_save(void) {
  fake_now += 2000;
  for (unsigned i = 0; i < 1200 && firmware_drive_pending(); i++) firmware_drive_poll(fake_now);
  assert(!firmware_drive_pending());
}
static void prepare_hex(void) {
  const char good[] = ":03000000020100FA\n:07002000554D4143010A01A7\n:00000001FF\n";
  read_disk();
  uint8_t *entry = disk + DRIVE_ROOT * 512 + 32;
  memcpy(entry, "FIRMWAREHEX", 11); entry[11] = 0x20; entry[26] = 2; entry[28] = strlen(good);
  disk[512 + 3] = disk[3 * 512 + 3] = 0xff;
  disk[512 + 4] = disk[3 * 512 + 4] = 0x0f;
  memcpy(disk + DRIVE_DATA * 512, good, strlen(good));
  // Simulate directory/FAT arriving ahead of the file data.
  write_sector(DRIVE_ROOT); write_sector(1); write_sector(3);
  assert(!firmware_drive_lock());
  write_sector(DRIVE_DATA);
  assert(firmware_drive_pending() && !firmware_drive_lock());
  finish_save();
  assert(drive_result == IMAGE_VALID && drive_info.keys == 3);
}
int main(void) {
  memset(fake_flash, 255, sizeof(fake_flash));
  firmware_drive_init(); finish_save();
  // Simulate a snapshot saved by the previous firmware, including its HEX.
  read_disk();
  memcpy(disk + 43, "MACROPAD   ", 11); write_sector(0);
  memcpy(disk + DRIVE_ROOT * 512, "MACROPAD   ", 11); write_sector(DRIVE_ROOT);
  prepare_hex();
  firmware_drive_init(); assert(!firmware_drive_pending() && drive_result == IMAGE_VALID);
  read_disk();
  assert(!memcmp(disk + 43, DRIVE_VOLUME_LABEL, 11));
  assert(!memcmp(disk + DRIVE_ROOT * 512, DRIVE_VOLUME_LABEL, 11));
  unsigned before = writes;
  read_disk(); disk[39] ^= 1; write_sector(0); // Mount-related boot metadata.
  assert(!firmware_drive_pending());
  disk[DRIVE_ROOT * 512 + 32 + 22] ^= 1; write_sector(DRIVE_ROOT); // HEX timestamp only.
  assert(!firmware_drive_pending());
  // An unrelated hidden file allocation changes one FAT copy before the other.
  disk[512 + 15] = 0xff; disk[512 + 16] = 0x0f; write_sector(1);
  assert(!firmware_drive_pending());
  disk[3 * 512 + 15] = 0xff; disk[3 * 512 + 16] = 0x0f; write_sector(3);
  assert(!firmware_drive_pending());
  uint8_t *hidden = disk + DRIVE_ROOT * 512 + 64;
  memcpy(hidden, "SPOTLIGH   ", 11); hidden[11] = 0x12; hidden[26] = 10;
  write_sector(DRIVE_ROOT); assert(!firmware_drive_pending());
  finish_save(); assert(writes == before); // No extra flash wear for metadata.
  assert(firmware_drive_lock() && !tud_msc_is_writable_cb(0));
  assert(tud_msc_write10_cb(0, 0, 0, disk, 512) < 0);
  firmware_drive_init(); read_disk(); assert(drive_info.keys == 3);
  // A real firmware replacement becomes pending immediately and cannot arm.
  char *variant = strstr((char *)disk + DRIVE_DATA * 512, "0A01A7"); assert(variant);
  memcpy(variant, "0A00A8", 6); write_sector(DRIVE_DATA);
  assert(firmware_drive_pending() && !firmware_drive_lock());
  const uint8_t sync[16] = {0x35};
  assert(tud_msc_scsi_cb(0, sync, NULL, 0) == 0);
  assert(!firmware_drive_pending() && drive_result == IMAGE_VALID && drive_info.keys == 6);
  firmware_drive_init(); assert(drive_info.keys == 6 && firmware_drive_lock());
  firmware_drive_init(); read_disk();
  disk[DRIVE_DATA * 512 + 1] = 'f'; write_sector(DRIVE_DATA);
  assert(firmware_drive_pending() && !firmware_drive_lock()); finish_save();
  assert(drive_result == IMAGE_INVALID && !firmware_drive_lock());
  firmware_drive_init(); prepare_hex();
  read_disk(); disk[DRIVE_DATA * 512 + 1] = 'f'; write_sector(DRIVE_DATA);
  fail_flash = true; finish_save();
  assert(drive_result == IMAGE_INVALID && !firmware_drive_lock() && !tud_msc_is_writable_cb(0));
  puts("Drive session tests passed: metadata stays ready, firmware changes block arming, flush persists, failures stop");
}
