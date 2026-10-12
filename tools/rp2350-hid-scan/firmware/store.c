#include "store.h"
#include <string.h>

static uint32_t get32(const uint8_t *p) {
  return p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24;
}
static void put32(uint8_t *p, uint32_t v) {
  for (unsigned i = 0; i < 4; i++) p[i] = v >> (8 * i);
}
static bool valid(const uint8_t *p) {
  return !memcmp(p, "HIDSCAN1", 8) && get32(p + 12) == STORE_DISK &&
    get32(p + 20) == scan_crc(p, 20) && get32(p + 16) == scan_crc(p + 4096, STORE_DISK) &&
    p[4096 + 510] == 0x55 && p[4096 + 511] == 0xaa;
}
bool store_load(store_t *s, const uint8_t *flash, uint8_t disk[STORE_DISK]) {
  *s = (store_t){.flash = flash, .current = -1};
  for (int i = 0; i < 2; i++) {
    const uint8_t *p = flash + i * STORE_SLOT;
    if (valid(p) && (s->current < 0 || (int32_t)(get32(p + 8) - s->generation) > 0)) {
      s->current = i; s->generation = get32(p + 8);
    }
  }
  if (s->current < 0) return false;
  memcpy(disk, flash + s->current * STORE_SLOT + 4096, STORE_DISK); return true;
}
bool store_save(store_t *s, const uint8_t disk[STORE_DISK], store_write_t write) {
  unsigned slot = s->current == 0 ? 1 : 0, base = slot * STORE_SLOT;
  uint8_t header[256]; memset(header, 0xff, sizeof(header));
  memcpy(header, "HIDSCAN1", 8); put32(header + 8, s->generation + 1);
  put32(header + 12, STORE_DISK); put32(header + 16, scan_crc(disk, STORE_DISK));
  put32(header + 20, scan_crc(header, 20));
  for (unsigned p = 0; p < STORE_SLOT; p += 4096)
    if (!write(base + p, NULL, 4096)) return false;
  for (unsigned p = 0; p < STORE_DISK; p += 256)
    if (!write(base + 4096 + p, disk + p, 256)) return false;
  if (memcmp(s->flash + base + 4096, disk, STORE_DISK) || !write(base, header, 256) ||
      !valid(s->flash + base)) return false;
  s->current = (int)slot; s->generation++; return true;
}
