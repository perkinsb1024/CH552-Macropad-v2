#pragma once
#include "image_drive.h"
void firmware_drive_init(void);
void firmware_drive_poll(uint32_t now);
bool firmware_drive_lock(void);
bool firmware_drive_pending(void);
extern image_result_t drive_result;
extern image_info_t drive_info;
extern uint8_t drive_image[PROGRAM_LIMIT];
extern uint32_t drive_crc;
