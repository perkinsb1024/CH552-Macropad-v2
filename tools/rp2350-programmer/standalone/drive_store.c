#include "drive_store.h"
#include <string.h>
static bool valid(const uint8_t *slot, uint32_t *generation) {
  uint32_t h[8]; memcpy(h, slot, sizeof(h));
  if (h[0] != 0x43414d55 || h[1] != 1 || h[2] != DRIVE_BYTES || h[5] != ~h[3] ||
      h[6] != ~h[4] || h[7] != program_crc32(slot, 28) ||
      h[4] != program_crc32(slot + STORE_SECTOR, DRIVE_BYTES)) return false;
  *generation = h[3]; return true;
}
bool drive_store_init(drive_store_t *s, const uint8_t *flash, uint8_t *disk) {
  memset(s, 0, sizeof(*s)); s->flash = flash; s->disk = disk; s->current = -1;
  for (int i = 0; i < 2; i++) {
    uint32_t gen;
    if (valid(flash + i * STORE_SLOT, &gen) &&
        (s->current < 0 || (int32_t)(gen - s->generation) > 0)) { s->current = i; s->generation = gen; }
  }
  if (s->current < 0) { image_drive_format(disk); return false; }
  memcpy(disk, flash + s->current * STORE_SLOT + STORE_SECTOR, DRIVE_BYTES);
  return true;
}
void drive_store_begin(drive_store_t *s) {
  s->crc = program_crc32(s->disk, DRIVE_BYTES); s->step = 0; s->saving = true;
}
bool drive_store_step(drive_store_t *s, store_write_t write) {
  if (!s->saving) return true;
  unsigned base = (s->current == 0 ? 1 : 0) * STORE_SLOT;
  // Invalidate the destination first. The previous committed slot is untouched.
  if (s->step == 0) {
    if (!write(base, NULL, STORE_SECTOR)) return false;
  } else if (s->step <= DRIVE_BYTES / STORE_SECTOR * 17) {
    unsigned n = s->step - 1, sector = n / 17, page = n % 17;
    unsigned offset = sector * STORE_SECTOR;
    if (!page) { if (!write(base + STORE_SECTOR + offset, NULL, STORE_SECTOR)) return false; }
    else {
      offset += (page - 1) * 256;
      if (!write(base + STORE_SECTOR + offset, s->disk + offset, 256)) return false;
    }
  } else {
    if (program_crc32(s->flash + base + STORE_SECTOR, DRIVE_BYTES) != s->crc) return false;
    uint8_t header[256]; memset(header, 255, sizeof(header));
    uint32_t h[8] = {0x43414d55, 1, DRIVE_BYTES, s->generation + 1, s->crc,
                     ~(s->generation + 1), ~s->crc, 0};
    h[7] = program_crc32((const uint8_t *)h, 28); memcpy(header, h, sizeof(h));
    if (!write(base, header, sizeof(header))) return false;
    uint32_t gen;
    if (!valid(s->flash + base, &gen)) return false;
    s->current = base / STORE_SLOT; s->generation = gen; s->saving = false;
  }
  s->step++; return true;
}
