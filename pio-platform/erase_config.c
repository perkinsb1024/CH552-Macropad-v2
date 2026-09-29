#include <Arduino.h>
#include "include/ch5xx.h"

uint8_t eeprom_read_byte(__data uint8_t addr);
void eeprom_write_byte(__data uint8_t addr, __xdata uint8_t value);

void setup(void) {
  __bit interruptsEnabled = EA;
  EA = 0;
  if (eeprom_read_byte(0) != 0) eeprom_write_byte(0, 0);
  if (eeprom_read_byte(1) != 0) eeprom_write_byte(1, 0);
  if (eeprom_read_byte(0) != 0 || eeprom_read_byte(1) != 0) {
    while (1) {}
  }
  EA = interruptsEnabled;

  USB_CTRL = 0;
  EA = 0;
  TMOD = 0;
  delayMicroseconds(50000);
  delayMicroseconds(50000);
#ifdef __SDCC
  __asm__("lcall #0x3800");
#endif
  while (1) {}
}

void loop(void) {}
