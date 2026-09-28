#include <assert.h>
#include <stdint.h>
#include <string.h>
#include "stubs/Arduino.h"
#include "../src/config.h"
#include "../src/actions.h"

uint8_t P1 = 0xFF;
uint8_t P3 = 0xFF;
uint8_t testP1ModOc;
uint8_t testP1DirPu;
uint8_t testP3ModOc;
uint8_t testP3DirPu;
volatile uint8_t USB_CTRL;
uint8_t TMOD;
volatile uint8_t EA;
static uint32_t currentMs;
static uint8_t frames[32][9];
static uint8_t frameCount;
static uint8_t bytesWritten;
static uint8_t flash[CONFIG_SIZE];

uint32_t millis(void) { return currentMs; }
void delayMicroseconds(uint16_t us) { (void)us; }
void neopixel_show_P3_4(uint8_t *data, uint8_t length) {
    (void)data;
    bytesWritten = length;
}
void set_pixel_for_GRB_LED(uint8_t *data, uint8_t index,
                           uint8_t green, uint8_t red, uint8_t blue) {
    data[3 * index] = green;
    data[3 * index + 1] = red;
    data[3 * index + 2] = blue;
}
uint8_t eeprom_read_byte(uint8_t offset) { return flash[offset]; }
uint8_t USB_queueKeyboard(const uint8_t *keys) {
    assert(frameCount < 32);
    frames[frameCount][0] = 1;
    memcpy(frames[frameCount++] + 1, keys, 8);
    return 1;
}
uint8_t USB_queueMouse(uint8_t buttons, int8_t x, int8_t y, int8_t wheel) {
    assert(frameCount < 32);
    frames[frameCount][0] = 2;
    frames[frameCount][1] = buttons;
    frames[frameCount][2] = x;
    frames[frameCount][3] = y;
    frames[frameCount][4] = wheel;
    frameCount++;
    return 1;
}
uint8_t USB_queueConsumer(uint16_t usage) {
    assert(frameCount < 32);
    frames[frameCount][0] = 5;
    frames[frameCount][1] = usage;
    frames[frameCount][2] = usage >> 8;
    frameCount++;
    return 1;
}
void USB_discardReports(void) { frameCount = 0; }
uint8_t USB_reportGeneration(void) { return 0; }
uint8_t USB_reportsPending(void) { return 0; }
uint8_t USB_asciiUsage(uint8_t c) { return c == 'A' ? 0x84 : c; }
void USB_reportPoll(uint16_t now) { (void)now; }
void USBInit(void) {}
void USB_EP1_reset(void) {}
void USB_EP1_receiveReady(void) {}
void USB_setKeyboardLedStatus(uint8_t leds) { (void)leds; }
uint8_t USB_EP1_sendConfig(const uint8_t *reply) { (void)reply; return 1; }
void protocolReset(void) {}
void protocolInit(void) {
    memcpy(activeConfig, flash, CONFIG_SIZE);
    if (!configValid(activeConfig, PHYSICAL_VARIANT)) {
        configDefaults(PHYSICAL_VARIANT);
    }
}
void protocolPoll(uint16_t now) { (void)now; }
uint8_t protocolReceive(const uint8_t *packet) { (void)packet; return 0; }

#include "../CH552_Universal_Macropad.ino"

static void tick(uint16_t now) {
    currentMs = now;
    loop();
}

int main(void) {
    configDefaults(PHYSICAL_VARIANT);
    memcpy(flash, activeConfig, CONFIG_SIZE);
    P1 = P3 = 0xFF;
    setup();
    assert(bytesWritten == (PHYSICAL_VARIANT ? 9 : 18));
    frameCount = 0;
    assert((testP1ModOc & (PHYSICAL_VARIANT ? 0xC2 : 0xF2)) ==
           (PHYSICAL_VARIANT ? 0xC2 : 0xF2));

    P1 &= ~0x02;
    tick(0);
    tick(10);
    assert(frameCount == 1 && frames[0][0] == 1 && frames[0][3] == 0x29);
    P1 |= 0x02;
    tick(11);
    tick(21);
    assert(frameCount == 2 && frames[1][3] == 0);

    // An active profile change suppresses a key already held on the device.
    activeConfig[9] = CONFIG_ACTION_KEY_HOLD;
    activeConfig[10] = 0x04;
    P1 &= ~0x02;
    firmwareApplyConfig();
    tick(32);
    assert(frameCount >= 3);
    uint8_t releaseSeen = 0;
    for (uint8_t i = 0; i < frameCount; i++) {
        if (frames[i][0] == 1 && frames[i][3] == 0) {
            releaseSeen = 1;
        }
    }
    assert(releaseSeen);
    tick(3000); // Debounce does not turn a held-at-apply key into a press.
    assert(frames[frameCount - 1][3] == 0);
    P1 |= 0x02;
    tick(3010);
    tick(3020);
    assert(frames[frameCount - 1][3] == 0);

    firmwareApplyConfig();
    P3 = (P3 & ~0x03) | 0x03; // Start encoder at 11.
    encoderState = readEncoder();
    scanEncoder(); // Same state does not count.
    P3 = (P3 & ~0x03) | 0x01;
    scanEncoder();
    P3 &= ~0x03;
    scanEncoder();
    assert(encoderMovement == -2);
    firmwareApplyConfig();
    assert(encoderMovement == 0 && lastLayer == 0);

    activeConfig[30] = 2; // Bootloader hold is disabled on this layer.
    scanButton(configKeyCount(), 3100);
    assert(!allowRunBootloader);
    return 0;
}
