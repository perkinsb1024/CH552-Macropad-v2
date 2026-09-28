#include <assert.h>
#include <stdint.h>
#include <string.h>
#include "../src/actions.h"
#include "../src/config.h"

static uint8_t reports[64][9];
static uint8_t count;

uint8_t USB_queueKeyboard(const uint8_t *keys) {
    assert(count < 64);
    reports[count][0] = 1;
    memcpy(reports[count] + 1, keys, 8);
    count++;
    return 1;
}

uint8_t USB_queueMouse(uint8_t buttons, int8_t x, int8_t y, int8_t wheel) {
    assert(count < 64);
    reports[count][0] = 2;
    reports[count][1] = buttons;
    reports[count][2] = x;
    reports[count][3] = y;
    reports[count][4] = wheel;
    count++;
    return 1;
}

uint8_t USB_queueConsumer(uint16_t usage) {
    assert(count < 64);
    reports[count][0] = 5;
    reports[count][1] = usage;
    reports[count][2] = usage >> 8;
    count++;
    return 1;
}

uint8_t USB_reportsPending(void) { return 0; }
void USB_discardReports(void) {}
uint8_t USB_reportGeneration(void) { return 0; }
uint8_t USB_asciiUsage(uint8_t c) { return c == 'A' ? 0x84 : 0x04; }

static void reset(void) {
    configDefaults(CONFIG_SIX_KEYS);
    actionsInit();
    count = 0;
}

static void testDefaults(void) {
    reset();
    actionsPress(0);
    actionsPoll(0);
    assert(count == 1 && reports[0][0] == 1 && reports[0][3] == 0x29);
    actionsPoll(10);
    assert(count == 2 && reports[1][3] == 0);
    actionsRelease(0);
    actionsPoll(11);
    actionsRotate(1);
    actionsPoll(20);
    assert(reports[count - 1][0] == 2 && reports[count - 1][4] == 0xFF);
    actionsPress(6);
    actionsPoll(30);
    assert(reports[count - 1][0] == 2 && reports[count - 1][1] == 4);
    assert(reports[count - 1][4] == 0); // A click does not replay scrolling.
    actionsPoll(40);
    assert(reports[count - 1][1] == 0);
}

static void testLayerAndOwnership(void) {
    reset();
    activeConfig[3] = 1; // Two layers
    activeConfig[9] = CONFIG_ACTION_MOMENTARY_LAYER;
    activeConfig[10] = 1;
    activeConfig[31 + 2] = CONFIG_ACTION_KEY_HOLD;
    activeConfig[31 + 3] = 0x04;
    activeConfig[31 + 4] = CONFIG_ACTION_KEY_HOLD;
    activeConfig[31 + 5] = 0x04;
    actionsInit();
    actionsPress(0);
    assert(actionsLayer() == 1);
    actionsPress(1);
    actionsPress(2);
    actionsPoll(0);
    assert(count == 1 && reports[0][3] == 0x04);
    actionsRelease(1);
    actionsPoll(1);
    assert(reports[count - 1][3] == 0x04); // The second owner retains A.
    actionsRelease(0);
    assert(actionsLayer() == 0);
    actionsPoll(2);
    assert(reports[count - 1][3] == 0x04); // Held key keeps its binding.
    actionsRelease(2);
    actionsPoll(3);
    assert(reports[count - 1][3] == 0);
}

static void testRolloverAndSequence(void) {
    uint8_t i;
    reset();
    for (i = 0; i < 7; i++) {
        activeConfig[9 + 2 * i] = CONFIG_ACTION_KEY_HOLD;
        activeConfig[10 + 2 * i] = 0x04 + i;
    }
    actionsInit();
    for (i = 0; i < 7; i++) {
        actionsPress(i);
    }
    actionsPoll(0);
    assert(reports[0][8] == 0x09); // Six distinct usages fit.
    actionsRelease(0);
    actionsPoll(1);
    assert(reports[count - 1][8] == 0x0A); // Seventh enters the free slot.

    reset();
    activeConfig[9] = 0x18; // Consumer usage 0x1E9
    activeConfig[10] = 0xE9;
    actionsPress(0);
    actionsPoll(0);
    assert(reports[0][0] == 5 && reports[0][1] == 0xE9 && reports[0][2] == 1);
    actionsPoll(1);
    assert(reports[1][0] == 5 && reports[1][1] == 0 && reports[1][2] == 0);

    reset();
    activeConfig[9] = CONFIG_ACTION_STRING;
    activeConfig[10] = 0;
    activeConfig[4] = 2;
    activeConfig[31] = 'A';
    activeConfig[32] = 0;
    actionsPress(0);
    actionsPoll(0);
    assert(reports[0][0] == 1 && reports[0][1] == 2 && reports[0][3] == 4);
    actionsPoll(10);
    assert(reports[1][1] == 0 && reports[1][3] == 0);
}

static void testRotationOptions(void) {
    reset();
    activeConfig[30] |= 1; // Invert encoder scrolling on this layer.
    actionsRotate(1);
    actionsPoll(0);
    assert(reports[0][4] == 1);

    reset();
    activeConfig[23] = CONFIG_ACTION_MOUSE_TOGGLE;
    activeConfig[24] = 1;
    actionsRotate(1);
    actionsPoll(0);
    assert(reports[0][0] == 2 && reports[0][1] == 1);
    actionsRotate(1);
    actionsPoll(1);
    assert(reports[1][1] == 0);
}

static void testLayerCancelsConsumer(void) {
    reset();
    activeConfig[3] = 1;
    activeConfig[9] = CONFIG_ACTION_CONSUMER;
    activeConfig[10] = 0xE9;
    activeConfig[11] = CONFIG_ACTION_SET_LAYER;
    activeConfig[12] = 1;
    actionsInit();
    actionsPress(0);
    actionsPoll(0);
    assert(reports[0][0] == 5 && reports[0][1] == 0xE9);
    actionsPress(1);
    actionsPoll(1);
    assert(actionsLayer() == 1);
    assert(reports[count - 1][0] == 5 && reports[count - 1][1] == 0);
}

static void testMouseAndLayerOrder(void) {
    reset();
    activeConfig[9] = CONFIG_ACTION_MOUSE_HOLD;
    activeConfig[10] = 1;
    activeConfig[11] = CONFIG_ACTION_MOUSE_HOLD;
    activeConfig[12] = 1;
    actionsPress(0);
    actionsPress(1);
    actionsPoll(0);
    assert(reports[count - 1][1] == 1);
    actionsRelease(0);
    actionsPoll(1);
    assert(reports[count - 1][1] == 1);
    actionsRelease(1);
    actionsPoll(2);
    assert(reports[count - 1][1] == 0);

    reset();
    activeConfig[9] = CONFIG_ACTION_MOUSE_DOUBLE;
    activeConfig[10] = 1;
    actionsPress(0);
    actionsPoll(0);
    actionsPoll(10);
    actionsPoll(11);
    actionsPoll(211);
    actionsPoll(219);
    assert(count == 4);
    assert(reports[0][1] == 1 && reports[1][1] == 0);
    assert(reports[2][1] == 1 && reports[3][1] == 0);

    reset();
    activeConfig[3] = 2; // Three layers
    activeConfig[9] = CONFIG_ACTION_MOMENTARY_LAYER;
    activeConfig[10] = 1;
    activeConfig[31 + 2] = CONFIG_ACTION_MOMENTARY_LAYER;
    activeConfig[31 + 3] = 2;
    actionsInit();
    actionsPress(0);
    actionsPress(1);
    assert(actionsLayer() == 2);
    actionsRelease(0);
    assert(actionsLayer() == 2);
    actionsRelease(1);
    assert(actionsLayer() == 0);
}

int main(void) {
    testDefaults();
    testLayerAndOwnership();
    testRolloverAndSequence();
    testRotationOptions();
    testLayerCancelsConsumer();
    testMouseAndLayerOrder();
    return 0;
}
