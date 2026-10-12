#pragma once
#include <stddef.h>
#include <stdint.h>
#define PICO_FLASH_SIZE_BYTES (2 * 1024 * 1024)
#define SCANNER_APP_FLASH_BYTES (2 * 1024 * 1024 - 2 * (65536 + 4096))
#define XIP_BASE 0x10000000
void flash_range_program(unsigned offset, const uint8_t *data, size_t len);
void flash_range_erase(unsigned offset, size_t len);
