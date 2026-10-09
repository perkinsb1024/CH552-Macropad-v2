#ifndef MACROPAD_TEST_CONFIG_FIXTURE_H
#define MACROPAD_TEST_CONFIG_FIXTURE_H

#include <stdint.h>
#include "../src/config.h"

/* Test-only profile fixture; firmware has no built-in profile fallback. */
static void testLoadStarterProfile(uint8_t variant) {
    uint8_t keys = variant ? 3 : 6;
    uint8_t size = variant ? 15 : 22;
    static const uint8_t usages[6] = {0x29, 0x2C, 0x21, 0x50, 0x52, 0x4F};
    static const uint8_t modifiers[6] = {0, 4, 11, 1, 1, 1};
    uint8_t i;
    uint8_t offset = 9;
    uint16_t crc;

    for (i = 0; i < CONFIG_SIZE; i++) activeConfig[i] = 0;
    activeConfig[0] = 'M';
    activeConfig[1] = 'P';
    activeConfig[2] = CONFIG_VERSION;
    activeConfig[5] = variant;
    activeConfig[8] = 8 | (2 << CONFIG_HEADER_RAINBOW_PHASE_SHIFT) |
        (1 << CONFIG_HEADER_RAINBOW_SPEED_SHIFT);
    for (i = 0; i < keys; i++) {
        activeConfig[offset + 2 * i] = (modifiers[i] << 4) | CONFIG_ACTION_KEY_TAP;
        activeConfig[offset + 2 * i + 1] = usages[i];
        activeConfig[offset + 2 * (keys + 3) + (i >> 1)] |=
            (i & 1) ? i << 4 : i;
    }
    activeConfig[offset + 2 * keys] = CONFIG_ACTION_MOUSE_CLICK;
    activeConfig[offset + 2 * keys + 1] = 4;
    activeConfig[offset + 2 * (keys + 1)] = CONFIG_ACTION_SCROLL;
    activeConfig[offset + 2 * (keys + 1) + 1] = (uint8_t)-1;
    activeConfig[offset + 2 * (keys + 2)] = CONFIG_ACTION_SCROLL;
    activeConfig[offset + 2 * (keys + 2) + 1] = 1;
    activeConfig[offset + size - 1] = CONFIG_LAYER_OPT_UNUSED;
    crc = configCrc(activeConfig);
    activeConfig[6] = (uint8_t)crc;
    activeConfig[7] = (uint8_t)(crc >> 8);
}

#endif
