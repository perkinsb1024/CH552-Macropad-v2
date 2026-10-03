#include "storage.h"
#include "config.h"
#ifdef __SDCC
#include "include/ch5xx.h"
#endif

uint8_t eeprom_read_byte(__data uint8_t addr);
void eeprom_write_byte(__data uint8_t addr, __xdata uint8_t value);

uint8_t storageRead(uint8_t offset) {
  return eeprom_read_byte(offset);
}

static FW_BIT writeByte(uint8_t offset, uint8_t value) {
  if (storageRead(offset) != value) {
#ifdef __SDCC
    __bit enabled = EA;
    EA = 0; // Protect the DataFlash registers and safe-mode unlock sequence.
#endif
    eeprom_write_byte(offset, value);
#ifdef __SDCC
    EA = enabled;
#endif
  }
  return storageRead(offset) == value;
}

static FW_BIT matches(const __xdata uint8_t *image) {
  uint8_t i;
  for (i = 0; i < CONFIG_SIZE; i++) {
    if (storageRead(i) != image[i]) return 0;
  }
  return 1;
}

FW_BIT storageSave(const __xdata uint8_t *image) {
  uint8_t i;
  if (matches(image)) {
    return 1; // A retry of an unchanged save does not consume flash writes.
  }
  if (!writeByte(0, 0) || !writeByte(1, 0)) {
    return 0;
  }
  for (i = 2; i < CONFIG_SIZE; i++) {
    if (!writeByte(i, image[i])) {
      return 0;
    }
  }
  // Restore validity last, only after the complete body has been verified.
  if (!writeByte(1, 'P') || !writeByte(0, 'M')) {
    return 0;
  }
  // The caller validated the image and its CRC before this byte-for-byte check.
  return matches(image);
}
