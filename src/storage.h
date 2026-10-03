#ifndef MACROPAD_STORAGE_H
#define MACROPAD_STORAGE_H

#include <stdint.h>
#include "firmware_types.h"

uint8_t storageRead(uint8_t offset);
FW_BIT storageSave(const __xdata uint8_t *image);

#endif
