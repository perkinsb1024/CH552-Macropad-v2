#ifndef MACROPAD_STORAGE_H
#define MACROPAD_STORAGE_H

#include <stdint.h>

uint8_t storageRead(uint8_t offset);
uint8_t storageSave(const __xdata uint8_t *image);

#endif
