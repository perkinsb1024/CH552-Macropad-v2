#pragma once
#include "scan.h"
enum { STORE_DISK = 65536, STORE_SLOT = STORE_DISK + 4096,
       STORE_BASE = 2 * 1024 * 1024 - 2 * STORE_SLOT };
typedef bool (*store_write_t)(unsigned offset, const uint8_t *data, size_t len);
typedef struct { const uint8_t *flash; int current; uint32_t generation; } store_t;
bool store_load(store_t *s, const uint8_t *flash, uint8_t disk[STORE_DISK]);
// NULL data means erase. Commit the header last; retain the prior slot on failure.
bool store_save(store_t *s, const uint8_t disk[STORE_DISK], store_write_t write);
