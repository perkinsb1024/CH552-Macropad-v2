#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
enum { RESULT_SECTOR = 512, RESULT_SECTORS = 128, RESULT_BYTES = 65536 };
void result_disk_init(void);
bool result_disk_add(const char name[11], const void *data, size_t len);
bool result_disk_read(uint32_t lba, uint32_t offset, void *out, uint32_t len);
void result_drive_publish(void);
bool result_drive_ready(void);
