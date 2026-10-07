#pragma once
#include <stdint.h>
#include <stdbool.h>
void tud_msc_set_sense(uint8_t lun, uint8_t key, uint8_t asc, uint8_t ascq);
int32_t tud_msc_read10_cb(uint8_t lun, uint32_t lba, uint32_t offset, void *buffer, uint32_t size);
int32_t tud_msc_write10_cb(uint8_t lun, uint32_t lba, uint32_t offset, uint8_t *buffer, uint32_t size);
int32_t tud_msc_scsi_cb(uint8_t lun, const uint8_t command[16], void *buffer, uint16_t size);
bool tud_msc_is_writable_cb(uint8_t lun);
