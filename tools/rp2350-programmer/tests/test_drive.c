#include "image_drive.h"
#include "drive_store.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static uint8_t disk[DRIVE_BYTES], restored[DRIVE_BYTES], flash[2 * STORE_SLOT], image[PROGRAM_LIMIT];
static image_info_t info;
static void put16(uint8_t *p, unsigned n) { p[0] = n; p[1] = n >> 8; }
static void put32(uint8_t *p, unsigned n) { put16(p, n); put16(p + 2, n >> 16); }
static void fat(unsigned c, unsigned next) {
  for (unsigned copy = 0; copy < 2; copy++) {
    uint8_t *p = disk + (1 + copy * 2) * 512 + c + c / 2;
    unsigned n = p[0] | (unsigned)p[1] << 8;
    n = c & 1 ? (n & 15) | next << 4 : (n & 0xf000) | next;
    put16(p, n);
  }
}
static void file(unsigned entry, const char *name, const uint8_t *data, unsigned size) {
  uint8_t *e = disk + DRIVE_ROOT * 512 + entry * 32;
  memcpy(e, name, 11); e[11] = 0x20; put16(e + 26, 2); put32(e + 28, size);
  unsigned count = (size + 511) / 512;
  // Allocate backwards to exercise fragmented/nonascending chains.
  put16(e + 26, 2 + count - 1);
  for (unsigned i = 0; i < count; i++) {
    unsigned c = 2 + count - 1 - i, n = size - i * 512;
    if (n > 512) n = 512;
    memcpy(disk + (DRIVE_DATA + c - 2) * 512, data + i * 512, n);
    fat(c, i + 1 == count ? 0xfff : c - 1);
  }
}
static const char good[] = ":03000000020100FA\n:07002000554D4143010A01A7\n:00000001FF\n";
static bool write_flash(unsigned offset, const uint8_t *data, unsigned size) {
  assert(offset + size <= sizeof(flash));
  if (!data) { assert(!(offset % 4096) && size == 4096); memset(flash + offset, 255, size); }
  else {
    assert(!(offset % 256) && size == 256);
    for (unsigned i = 0; i < size; i++) { assert((flash[offset + i] & data[i]) == data[i]); flash[offset + i] &= data[i]; }
  }
  return true;
}
static void parser_tests(int argc, char **argv) {
  image_drive_format(disk);
  assert(image_drive_load(disk, image, &info) == IMAGE_MISSING);
  file(1, "FIRMWAREHEX", (const uint8_t *)good, strlen(good));
  assert(image_drive_load(disk, image, &info) == IMAGE_VALID);
  assert(info.keys == 3 && info.format == 10 && image[0] == 2 && image[39] == 255);
  // Accept six-key identity with a corrected checksum.
  uint8_t *text = disk + DRIVE_DATA * 512;
  char *variant = strstr((char *)text, "0A01A7"); assert(variant);
  memcpy(variant, "0A00A8", 6);
  assert(image_drive_load(disk, image, &info) == IMAGE_VALID && info.keys == 6);
  text[1] = 'f'; assert(image_drive_load(disk, image, &info) == IMAGE_INVALID);
  file(1, "FIRMWAREHEX", (const uint8_t *)good, strlen(good));
  memcpy(disk + DRIVE_ROOT * 512 + 64, disk + DRIVE_ROOT * 512 + 32, 32);
  assert(image_drive_load(disk, image, &info) == IMAGE_INVALID && !strcmp(info.error, "multiple_hex_files"));
  disk[DRIVE_ROOT * 512 + 64 + 11] = 2; // Hidden metadata is ignored.
  assert(image_drive_load(disk, image, &info) == IMAGE_VALID);
  // AppleDouble LFN metadata is ignored even if its short alias ends in HEX.
  uint8_t *lfn = disk + DRIVE_ROOT * 512 + 64;
  memset(lfn, 0, 64); lfn[0] = 0x41; lfn[11] = 0x0f; put16(lfn + 1, '.'); put16(lfn + 3, '_');
  memcpy(lfn + 32, disk + DRIVE_ROOT * 512 + 32, 32);
  assert(image_drive_load(disk, image, &info) == IMAGE_VALID);
  memset(lfn, 0, 64);
  disk[DRIVE_ROOT * 512 + 32] = '_';
  assert(image_drive_load(disk, image, &info) == IMAGE_VALID);
  fat(2, 2); assert(image_drive_load(disk, image, &info) == IMAGE_INVALID);
  fat(2, 0xfff); disk[3 * 512 + 3] ^= 1;
  assert(image_drive_load(disk, image, &info) == IMAGE_INVALID);
  const char *bad[] = {
    ":0100000000FF\n:0100000000FF\n:00000001FF\n", // overlaps
    ":0138000000C7\n:00000001FF\n", // bootloader address
    ":02000004FFFFFC\n:01FFFF000002\n:00000001FF\n", // high address
    ":0100000000FF\n", // missing EOF
    ":00000001FF\n:0100000000FF\n", // data after EOF
    ":0100000000FF\n:00000001FF\n" // no identity
  };
  for (unsigned i = 0; i < sizeof(bad) / sizeof(bad[0]); i++) {
    image_drive_format(disk); file(1, "BAD     HEX", (const uint8_t *)bad[i], strlen(bad[i]));
    assert(image_drive_load(disk, image, &info) == IMAGE_INVALID);
  }
  for (int i = 1; i < argc; i++) {
    FILE *f = fopen(argv[i], "rb"); assert(f);
    uint8_t bytes[DRIVE_BYTES]; size_t n = fread(bytes, 1, sizeof(bytes), f); assert(n && feof(f)); fclose(f);
    image_drive_format(disk); file(1, "RELEASE HEX", bytes, n);
    assert(image_drive_load(disk, image, &info) == IMAGE_VALID);
    printf("Validated %s: %u keys, format %u\n", argv[i], info.keys, info.format);
    // Truncated files and cyclic chains must never arm.
    put32(disk + DRIVE_ROOT * 512 + 32 + 28, n - 8);
    assert(image_drive_load(disk, image, &info) == IMAGE_INVALID);
    put32(disk + DRIVE_ROOT * 512 + 32 + 28, n);
    unsigned c = 2 + (n + 511) / 512 - 1; fat(c, c);
    assert(image_drive_load(disk, image, &info) == IMAGE_INVALID);
  }
}
static void journal_tests(void) {
  drive_store_t s, reboot;
  memset(flash, 255, sizeof(flash));
  assert(!drive_store_init(&s, flash, disk));
  drive_store_begin(&s);
  while (s.saving) assert(drive_store_step(&s, write_flash));
  assert(drive_store_init(&reboot, flash, restored) && !memcmp(disk, restored, DRIVE_BYTES));
  disk[DRIVE_DATA * 512] = 42;
  drive_store_begin(&s);
  while (s.saving) {
    assert(drive_store_step(&s, write_flash));
    // Simulate power loss after every erase/page/commit: only complete snapshots recover.
    assert(drive_store_init(&reboot, flash, restored));
    assert(restored[DRIVE_DATA * 512] == (s.saving ? 0 : 42));
  }
  // New writes during a save abandon that snapshot without losing the committed one.
  disk[DRIVE_DATA * 512] = 43; drive_store_begin(&s);
  for (unsigned i = 0; i < 30; i++) assert(drive_store_step(&s, write_flash));
  disk[DRIVE_DATA * 512] = 44; drive_store_begin(&s);
  while (s.saving) assert(drive_store_step(&s, write_flash));
  assert(drive_store_init(&reboot, flash, restored) && restored[DRIVE_DATA * 512] == 44);
  // Corruption in the newest committed slot falls back to the previous snapshot.
  flash[s.current * STORE_SLOT + STORE_SECTOR + DRIVE_DATA * 512] ^= 1;
  assert(drive_store_init(&reboot, flash, restored) && restored[DRIVE_DATA * 512] == 42);
}
int main(int argc, char **argv) {
  parser_tests(argc, argv); journal_tests(); puts("Drive parser and power-loss journal tests passed"); return 0;
}
