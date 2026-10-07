#pragma once
#include "image_drive.h"
enum { STORE_SECTOR = 4096, STORE_SLOT = DRIVE_BYTES + STORE_SECTOR,
       STORE_BASE = 2 * 1024 * 1024 - 2 * STORE_SLOT };
typedef bool (*store_write_t)(unsigned offset, const uint8_t *data, unsigned size);
typedef struct {
  const uint8_t *flash;
  uint8_t *disk;
  int current;
  uint32_t generation, crc;
  unsigned step;
  bool saving;
} drive_store_t;
// Flash pointer addresses the start of two slots. Write offsets are relative to it.
bool drive_store_init(drive_store_t *s, const uint8_t *flash, uint8_t *disk);
void drive_store_begin(drive_store_t *s);
// One erase sector or one program page per call; NULL data means erase.
// Returns false on flash failure. Completion is indicated by !saving.
bool drive_store_step(drive_store_t *s, store_write_t write);
