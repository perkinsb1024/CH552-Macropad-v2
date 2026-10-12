#include "result_disk.h"
#include <string.h>

// FAT12 superfloppy: boot sector, two one-sector FATs, four root sectors,
// then 121 one-sector clusters. Immutable once the medium is published.
enum { FAT1 = 1, FAT2 = 2, ROOT = 3, DATA = 7, CLUSTERS = 121 };
static uint8_t disk[RESULT_BYTES];
static unsigned next_cluster, next_entry;
static void put16(uint8_t *p, uint16_t v) { p[0] = v; p[1] = v >> 8; }
static void put32(uint8_t *p, uint32_t v) { put16(p, v); put16(p + 2, v >> 16); }
static void fat(unsigned cluster, unsigned value) {
  for (unsigned sector = FAT1; sector <= FAT2; sector++) {
    uint8_t *p = disk + sector * 512 + cluster * 3 / 2;
    if (cluster & 1) { p[0] = (p[0] & 15) | (value << 4); p[1] = value >> 4; }
    else { p[0] = value; p[1] = (p[1] & 0xf0) | (value >> 8); }
  }
}
void result_disk_init(void) {
  memset(disk, 0, sizeof(disk));
  disk[0] = 0xeb; disk[1] = 0x3c; disk[2] = 0x90;
  memcpy(disk + 3, "CH552RD ", 8);
  put16(disk + 11, 512); disk[13] = 1; put16(disk + 14, 1); disk[16] = 2;
  put16(disk + 17, 64); put16(disk + 19, RESULT_SECTORS); disk[21] = 0xf8;
  put16(disk + 22, 1); put16(disk + 24, 1); put16(disk + 26, 1);
  disk[36] = 0x80; disk[38] = 0x29; put32(disk + 39, 0x55223501);
  memcpy(disk + 43, "CH552READ  ", 11); memcpy(disk + 54, "FAT12   ", 8);
  disk[510] = 0x55; disk[511] = 0xaa;
  fat(0, 0xff8); fat(1, 0xfff);
  memcpy(disk + ROOT * 512, "CH552READ  ", 11); disk[ROOT * 512 + 11] = 8;
  next_cluster = 2; next_entry = 1;
}
bool result_disk_add(const char name[11], const void *data, size_t len) {
  const size_t clusters = (len + 511) / 512;
  if (!name || (!data && len) || len > RESULT_BYTES || next_entry >= 64 ||
      clusters > CLUSTERS + 2 - next_cluster) return false;
  uint8_t *entry = disk + ROOT * 512 + next_entry * 32;
  memcpy(entry, name, 11); entry[11] = 0x21; // Read-only, archive.
  put16(entry + 24, (46u << 9) | (10u << 5) | 11u); // No RTC: fixed build-era date.
  put16(entry + 26, clusters ? next_cluster : 0); put32(entry + 28, (uint32_t)len);
  if (len) memcpy(disk + (DATA + next_cluster - 2) * 512, data, len);
  for (size_t i = 0; i < clusters; i++)
    fat(next_cluster + i, i + 1 == clusters ? 0xfff : next_cluster + i + 1);
  next_cluster += (unsigned)clusters; next_entry++;
  return true;
}
bool result_disk_read(uint32_t lba, uint32_t offset, void *out, uint32_t len) {
  if (!out || lba >= RESULT_SECTORS || offset >= 512 ||
      len > RESULT_BYTES - lba * 512 - offset) return false;
  memcpy(out, disk + lba * 512 + offset, len);
  return true;
}
