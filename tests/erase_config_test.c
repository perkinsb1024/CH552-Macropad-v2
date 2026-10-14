#include <assert.h>
#include <setjmp.h>
#include <stdint.h>
#include <string.h>
/* Arduino.h supplies the register stubs used by this erase routine. */
#define __CH554_H__
#define __bit uint8_t
#include "../pio-platform/erase_config.c"

volatile uint8_t EA, USB_CTRL;
uint8_t TMOD;
static uint8_t flash[128];
static unsigned writes;
static jmp_buf finished;
uint8_t eeprom_read_byte(uint8_t offset) {
    assert(offset == 0);
    return flash[offset];
}
void eeprom_write_byte(uint8_t offset, uint8_t value) {
    assert(offset == 0 && value == 0 && !EA);
    flash[offset] = value; writes++;
}
void delayMicroseconds(uint16_t duration) {
    assert(duration == 50000 && flash[0] == 0);
    longjmp(finished, 1); // Stop before the hardware bootloader handoff.
}
int main(void) {
    const uint8_t markers[] = {'M', 'B', 0};
    for (unsigned i = 0; i < sizeof(markers); i++) {
        memset(flash, 0xA7, sizeof(flash));
        flash[0] = markers[i]; writes = 0; EA = 1;
        if (!setjmp(finished)) setup();
        assert(flash[0] == 0 && writes == (markers[i] != 0));
        for (unsigned offset = 1; offset < 128; offset++) assert(flash[offset] == 0xA7);
    }
    return 0;
}
