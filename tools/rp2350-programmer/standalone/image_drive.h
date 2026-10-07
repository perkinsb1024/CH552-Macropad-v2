#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "programmer.h"

#define DRIVE_VOLUME_LABEL "CH552 FWUP "

enum { DRIVE_SECTOR = 512, DRIVE_SECTORS = 512, DRIVE_BYTES = DRIVE_SECTOR * DRIVE_SECTORS,
       DRIVE_FAT_SECTORS = 2, DRIVE_ROOT = 5, DRIVE_DATA = 13 };
typedef enum { IMAGE_MISSING, IMAGE_INVALID, IMAGE_VALID } image_result_t;
typedef struct { char name[13]; uint8_t keys, format; const char *error; } image_info_t;
void image_drive_format(uint8_t *disk);
image_result_t image_drive_load(const uint8_t *disk, uint8_t image[PROGRAM_LIMIT], image_info_t *info);
