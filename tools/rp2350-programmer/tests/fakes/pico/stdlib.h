#pragma once
#include <stdint.h>
extern uint8_t fake_flash[];
extern uint32_t fake_now;
#define XIP_BASE ((uintptr_t)fake_flash - STORE_BASE)
#define PICO_OK 0
#define PICO_FLASH_SIZE_BYTES (2 * 1024 * 1024)
#define PROGRAMMER_APP_FLASH_BYTES 1564672
static inline uint32_t get_absolute_time(void) { return fake_now; }
static inline uint32_t to_ms_since_boot(uint32_t time) { return time; }
