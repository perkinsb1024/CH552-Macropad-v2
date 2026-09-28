#include <assert.h>
#include <stdint.h>
#include <string.h>
#include "../src/actions.h"
#include "../src/config.h"

static uint8_t reports[64][9];
static uint8_t count;
static uint8_t blocked;
static uint8_t reportLimit;

uint8_t USB_queueKeyboard(const uint8_t *keys) {
    if (blocked || count == reportLimit) {
        return 0;
    }
    assert(count < 64);
    reports[count][0] = 1;
    memcpy(reports[count] + 1, keys, 8);
    count++;
    return 1;
}

uint8_t USB_queueMouse(uint8_t buttons, int8_t x, int8_t y, int8_t wheel) {
    if (blocked || count == reportLimit) {
        return 0;
    }
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
    if (blocked || count == reportLimit) {
        return 0;
    }
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
    blocked = 0;
    reportLimit = 64;
}

static void testDefaults(void) {
    reset();
    actionsPress(0, 0);
    actionsPoll(0);
    assert(count == 1 && reports[0][0] == 1 && reports[0][3] == 0x29);
    actionsPoll(10);
    assert(count == 2 && reports[1][3] == 0);
    actionsRelease(0);
    actionsPoll(11);
    actionsRotate(1);
    actionsPoll(20);
    assert(reports[count - 1][0] == 2 && reports[count - 1][4] == 0xFF);
    actionsPress(6, 0);
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
    actionsPress(0, 0);
    assert(actionsLayer() == 1);
    actionsPress(1, 0);
    actionsPress(2, 0);
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
        actionsPress(i, 0);
    }
    actionsPoll(0);
    assert(reports[0][8] == 0x09); // Six distinct usages fit.
    actionsRelease(0);
    actionsPoll(1);
    assert(reports[count - 1][8] == 0x0A); // Seventh enters the free slot.

    reset();
    activeConfig[9] = 0x18; // Consumer usage 0x1E9
    activeConfig[10] = 0xE9;
    actionsPress(0, 0);
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
    actionsPress(0, 0);
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
    actionsPress(0, 0);
    actionsPoll(0);
    assert(reports[0][0] == 5 && reports[0][1] == 0xE9);
    actionsPress(1, 0);
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
    actionsPress(0, 0);
    actionsPress(1, 0);
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
    actionsPress(0, 0);
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
    actionsPress(0, 0);
    actionsPress(1, 0);
    assert(actionsLayer() == 2);
    actionsRelease(0);
    assert(actionsLayer() == 2);
    actionsRelease(1);
    assert(actionsLayer() == 0);
}

static void chordProfile(uint8_t variant, uint8_t action) {
    uint8_t offset = variant ? 24 : 31;
    uint16_t crc;
    reset();
    configDefaults(variant);
    activeConfig[5] |= 2; // One chord: keys 0 and 1 on layer 0.
    activeConfig[offset] = 0;
    activeConfig[offset + 1] = action;
    activeConfig[offset + 2] = action == CONFIG_ACTION_MOUSE_HOLD ? 1 : 0x04;
    crc = configCrc(activeConfig);
    activeConfig[6] = crc;
    activeConfig[7] = crc >> 8;
    assert(configValid(activeConfig, variant));
    actionsInit();
}

static void testChords(uint8_t variant) {
    uint8_t first;
    uint8_t released;
    for (first = 0; first < 2; first++) {
        for (released = 0; released < 2; released++) {
            chordProfile(variant, CONFIG_ACTION_KEY_HOLD);
            actionsPress(first, 100);
            actionsPoll(100);
            assert(count == 0);
            actionsPress(first ^ 1, 139);
            actionsPoll(139);
            assert(count == 1 && reports[0][3] == 4);
            actionsRelease(released);
            actionsPoll(140);
            assert(count == 2 && reports[1][3] == 0);
            actionsPress(released, 141);
            actionsPoll(141);
            assert(count == 2); // The other chord key is still down.
            actionsRelease(released ^ 1);
            actionsRelease(released);
            actionsPress(first, 150);
            actionsPress(first ^ 1, 160);
            actionsPoll(160);
            assert(count == 3 && reports[2][3] == 4);
        }
    }

    chordProfile(variant, CONFIG_ACTION_MOUSE_HOLD);
    actionsPress(0, 0);
    actionsPress(1, 1);
    actionsPoll(1);
    assert(reports[0][0] == 2 && reports[0][1] == 1);
    actionsRelease(1);
    actionsPoll(2);
    assert(reports[1][1] == 0);

    chordProfile(variant, CONFIG_ACTION_KEY_HOLD);
    actionsPress(0, 0);
    actionsPress(1, 1);
    actionsPress(2, 2); // A third key acts independently.
    actionsPoll(2);
    assert(count == 2 && reports[1][3] == 4 && reports[1][4] == 0x21);
    actionsPoll(10);
    assert(reports[count - 1][3] == 4 && reports[count - 1][4] == 0);
}

static void testChordWindow(void) {
    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    actionsPress(0, 100);
    actionsPoll(139);
    assert(count == 0);
    actionsPoll(140); // The window expires at exactly 40 ms.
    assert(count == 1 && reports[0][3] == 0x29);

    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    actionsPress(0, 100);
    actionsPress(1, 140);
    actionsPoll(140);
    assert(count == 1 && reports[0][3] == 0x29);
    actionsPoll(148);
    actionsPoll(149);
    actionsPoll(180);
    assert(reports[count - 1][3] == 0x2C); // The second key becomes a single too.

    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    actionsPress(0, 65520);
    actionsPress(1, 10); // Window arithmetic survives the timer wrapping.
    actionsPoll(10);
    assert(count == 1 && reports[0][3] == 4);

    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    activeConfig[8] = 0;
    actionsPress(0, 100);
    actionsPoll(100);
    assert(count == 1 && reports[0][3] == 0x29);

    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    actionsPress(0, 100);
    actionsPress(2, 101); // Unmapped pair resolves the first single immediately.
    actionsPoll(101);
    assert(count == 1 && reports[0][3] == 0x29);

    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    actionsPress(0, 100);
    actionsPress(6, 101); // Encoder button does not end the chord window.
    actionsPoll(101);
    assert(count == 1 && reports[0][0] == 2);
    actionsPress(1, 102);
    actionsPoll(102);
    assert(reports[count - 1][0] == 1 && reports[count - 1][3] == 4);
}

static void testBriefHolds(void) {
    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    actionsPress(0, 100);
    actionsRelease(0);
    actionsPoll(101);
    assert(count == 1 && reports[0][3] == 0x29);
    actionsPoll(110);
    assert(count == 2 && reports[1][3] == 0);

    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    activeConfig[9] = CONFIG_ACTION_KEY_HOLD;
    actionsPress(0, 100);
    actionsRelease(0);
    blocked = 1;
    actionsPoll(101);
    assert(count == 0);
    blocked = 0;
    actionsPoll(102);
    assert(count == 2 && reports[0][3] == 0x29 && reports[1][3] == 0);

    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    actionsPress(0, 100);
    actionsPress(1, 101);
    actionsRelease(1);
    actionsPoll(102);
    assert(count == 2 && reports[0][3] == 4 && reports[1][3] == 0);

    chordProfile(0, CONFIG_ACTION_MOUSE_HOLD);
    actionsPress(0, 100);
    actionsPress(1, 101);
    actionsRelease(0);
    reportLimit = 1; // Accept the press, then block its release.
    actionsPoll(102);
    assert(count == 1 && reports[0][0] == 2 && reports[0][1] == 1);
    reportLimit = 64;
    actionsPoll(103);
    assert(count == 2 && reports[1][1] == 0);
}

static void testChordLayers(void) {
    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    // Move the chord table past a second layer.
    activeConfig[3] = 1;
    activeConfig[31] = 0;
    activeConfig[32] = 0;
    activeConfig[33] = 0;
    activeConfig[53] = 0;
    activeConfig[54] = CONFIG_ACTION_MOMENTARY_LAYER;
    activeConfig[55] = 1;
    actionsPress(0, 100);
    actionsPress(1, 101);
    assert(actionsLayer() == 1);
    actionsRelease(1);
    assert(actionsLayer() == 0);
    actionsRelease(0);

    // An encoder layer action resolves the captured pending single.
    activeConfig[9] = CONFIG_ACTION_KEY_HOLD;
    activeConfig[23] = CONFIG_ACTION_SET_LAYER;
    activeConfig[24] = 1;
    actionsPress(0, 200);
    actionsRotate(1);
    assert(actionsLayer() == 1);
    actionsPoll(201);
    assert(count == 1 && reports[0][3] == 0x29);
    actionsRelease(0);
    actionsPoll(202);
    assert(reports[count - 1][3] == 0);
}

static void testMultipleChords(void) {
    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    activeConfig[5] = 4;
    activeConfig[34] = 9; // Pair 2+3 follows pair 0+1.
    activeConfig[35] = CONFIG_ACTION_KEY_HOLD;
    activeConfig[36] = 5;
    actionsPress(0, 0);
    actionsPress(1, 1);
    actionsPress(2, 2);
    actionsPress(3, 3);
    actionsPoll(3);
    assert(count == 1 && reports[0][3] == 4 && reports[0][4] == 5);
    actionsRelease(1);
    actionsPoll(4);
    assert(reports[count - 1][3] == 5);
    actionsRelease(2);
    actionsPoll(5);
    assert(reports[count - 1][3] == 0);
}

static void testRotationPressure(void) {
    uint8_t i;
    reset();
    for (i = 0; i < 20; i++) {
        actionsRotate(1);
    }
    actionsPress(0, 0);
    actionsPoll(0);
    assert(count == 1 && reports[0][0] == 2 && reports[0][4] == 0xFF);
    actionsPoll(1);
    assert(count == 2 && reports[1][0] == 1 && reports[1][3] == 0x29);
    actionsPoll(10);
    assert(reports[count - 1][3] == 0);
}

static void testLongLivedMomentary(void) {
    uint32_t i;
    reset();
    activeConfig[3] = 2;
    activeConfig[9] = CONFIG_ACTION_MOMENTARY_LAYER;
    activeConfig[10] = 1;
    activeConfig[33] = CONFIG_ACTION_MOMENTARY_LAYER;
    activeConfig[34] = 2;
    actionsPress(0, 0);
    for (i = 0; i < 70000; i++) {
        actionsPress(1, 0);
        assert(actionsLayer() == 2);
        actionsRelease(1);
        assert(actionsLayer() == 1);
    }
    actionsRelease(0);
    assert(actionsLayer() == 0);
}

static void testRolloverBackpressure(void) {
    uint8_t i;
    reset();
    for (i = 0; i < 6; i++) {
        activeConfig[9 + 2 * i] = CONFIG_ACTION_KEY_HOLD;
        activeConfig[10 + 2 * i] = 4 + i;
        actionsPress(i, 0);
    }
    activeConfig[21] = CONFIG_ACTION_KEY_TAP;
    activeConfig[22] = 10;
    actionsPoll(0);
    actionsPress(6, 1);
    actionsRelease(6);
    actionsPoll(1);
    actionsPoll(100);
    assert(count == 1); // The tap waits while all six slots belong to holds.
    actionsRelease(0);
    actionsPoll(101);
    assert(reports[count - 1][8] == 10);
    actionsPoll(110);
    assert(reports[count - 1][8] == 0);

    reset();
    for (i = 0; i < 7; i++) {
        activeConfig[9 + 2 * i] = CONFIG_ACTION_KEY_HOLD;
        activeConfig[10 + 2 * i] = 4 + i;
        actionsPress(i, 0);
    }
    actionsRelease(6);
    actionsPoll(0);
    assert(count == 1 && reports[0][8] == 9);
    actionsRelease(0);
    actionsPoll(1);
    actionsPoll(2);
    assert(reports[1][8] == 10); // Even a released seventh hold gets a press.
    assert(reports[count - 1][8] == 0);
}

static void testClearAndOverflow(void) {
    unsigned i;
    reset();
    activeConfig[9] = CONFIG_ACTION_KEY_HOLD;
    activeConfig[10] = 4;
    actionsPress(0, 0);
    actionsPoll(0);
    blocked = 1;
    actionsClear();
    blocked = 0;
    actionsPoll(1);
    assert(reports[count - 1][0] == 2 && reports[count - 1][1] == 0);
    assert(reports[count - 2][0] == 1 && reports[count - 2][3] == 0);
    reset();
    for (i = 0; i < 300; i++) {
        actionsPress(0, 0);
        actionsRelease(0);
        actionsRotate(1);
    }
    assert(actionsDropped(0) == 255 && actionsDropped(1) == 255);
    actionsClear();
    assert(actionsDropped(0) == 0 && actionsDropped(1) == 0);
}

int main(void) {
    testRolloverBackpressure();
    testClearAndOverflow();
    testMultipleChords();
    testRotationPressure();
    testLongLivedMomentary();
    testChords(0);
    testChords(1);
    testChordWindow();
    testBriefHolds();
    testChordLayers();
    testDefaults();
    testLayerAndOwnership();
    testRolloverAndSequence();
    testRotationOptions();
    testLayerCancelsConsumer();
    testMouseAndLayerOrder();
    return 0;
}
