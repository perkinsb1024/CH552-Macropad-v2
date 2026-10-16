#ifndef MACROPAD_TEST_CONFIG_FIXTURE_H
#define MACROPAD_TEST_CONFIG_FIXTURE_H

#include <stdint.h>
#include "../src/config.h"

/* Canonical target-header setters; unrelated fields are retained. */
static inline void testSetVariant(uint8_t variant) {
    activeConfig[CONFIG_HEADER_LAYERS] = (activeConfig[CONFIG_HEADER_LAYERS] & ~1) | variant;
}
static inline void testSetTimedCount(uint8_t count) {
    activeConfig[CONFIG_HEADER_COUNTS] = (activeConfig[CONFIG_HEADER_COUNTS] & ~7) | count;
}
// Empty v16 fixtures use a uniform Red source, not the zero custom-palette sentinel.
static inline void testUniformLayers(void) {
    uint8_t size = (activeConfig[CONFIG_HEADER_LAYERS] & 1) ? 15 : 22;
    uint8_t layers = ((activeConfig[CONFIG_HEADER_LAYERS] >> 1) & 7) + 1;
    for (uint8_t layer = 0; layer < layers; layer++) {
        uint16_t options = 9 + (uint16_t)size * (layer + 1) - 1;
        if (options < CONFIG_SIZE && !(activeConfig[options] & 0xF0)) activeConfig[options] |= 0x10;
    }
}
static inline void testSetLayout(uint8_t layers, uint8_t startup, uint8_t timers) {
    activeConfig[CONFIG_HEADER_LAYERS] = (activeConfig[CONFIG_HEADER_LAYERS] & 1) |
        ((layers - 1) << 1) | (startup << 4);
    testSetTimedCount(timers);
    testUniformLayers();
}
static inline void testSetChordCount(uint8_t count) {
    activeConfig[CONFIG_HEADER_COUNTS] = (activeConfig[CONFIG_HEADER_COUNTS] & 7) | (count << 3);
}
static inline void testSetStringLength(uint8_t length) {
    activeConfig[CONFIG_HEADER_POOL] = length << 1;
}

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
    activeConfig[0] = CONFIG_MARKER;

    activeConfig[CONFIG_HEADER_VERSION] = CONFIG_VERSION;
    activeConfig[CONFIG_HEADER_SLEEP] = CONFIG_SLEEP_DEFAULT;
    testSetVariant(variant);
    activeConfig[CONFIG_HEADER_LED] = 2 | (2 << CONFIG_HEADER_RAINBOW_PHASE_SHIFT) |
        (1 << CONFIG_HEADER_RAINBOW_SPEED_SHIFT);
    for (i = 0; i < keys; i++) {
        activeConfig[offset + 2 * i] = (modifiers[i] << 4) | CONFIG_ACTION_KEY_TAP;
        activeConfig[offset + 2 * i + 1] = usages[i];
        activeConfig[offset + 2 * (keys + 3) + (i >> 1)] |=
            (i & 1) ? (i+1) << 4 : i+1;
    }
    activeConfig[offset + 2 * keys] = CONFIG_ACTION_MOUSE_CLICK;
    activeConfig[offset + 2 * keys + 1] = 4;
    activeConfig[offset + 2 * (keys + 1)] = CONFIG_ACTION_SCROLL;
    activeConfig[offset + 2 * (keys + 1) + 1] = (uint8_t)-1;
    activeConfig[offset + 2 * (keys + 2)] = CONFIG_ACTION_SCROLL;
    activeConfig[offset + 2 * (keys + 2) + 1] = 1;
    activeConfig[offset + size - 1] = 0x10;
    crc = configCrc(activeConfig);
    activeConfig[CONFIG_HEADER_CRC] = (uint8_t)crc;
    activeConfig[CONFIG_HEADER_CRC + 1] = (uint8_t)(crc >> 8);
}

#endif
