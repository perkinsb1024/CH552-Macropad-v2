#include <assert.h>
#include <stdint.h>
#include <string.h>
#include "../src/config.h"
#include "config_fixture.h"

static void seal(void) {
    uint16_t crc = configCrc(activeConfig);
    activeConfig[6] = (uint8_t)crc;
    activeConfig[7] = (uint8_t)(crc >> 8);
}

static void testStarterFixture(uint8_t variant) {
    uint8_t first;
    uint8_t second;
    static const uint8_t usages[6] = {0x29, 0x2C, 0x21, 0x50, 0x52, 0x4F};
    static const uint8_t modifiers[6] = {0, 4, 11, 1, 1, 1};
    static const uint8_t colors[6][3] = {
        {255, 0, 0}, {255, 22, 7}, {255, 16, 0},
        {255, 66, 0}, {255, 124, 0}, {60, 255, 0},
    };
    uint8_t i;
    testLoadStarterProfile(variant);
    assert(configValid(activeConfig, variant));
    assert(configCrc(activeConfig) == (variant ? 0x8D02 : 0x57BD));
    assert(!configValid(activeConfig, variant ^ 1));
    assert(configLayerCount() == 1);
    assert(configStartupLayer() == 0);
    assert(configKeyCount() == (variant ? 3 : 6));
    assert(configChordWindowMs() == 40);
    assert(configLayerOptions(0) == CONFIG_LAYER_OPT_BOOTLOADER_RUN);
    activeConfig[9 + (variant ? 15 : 22) - 1] |= CONFIG_LAYER_OPT_FULL_BRIGHTNESS;
    seal();
    assert(configValid(activeConfig, variant));
    assert(configLayerOptions(0) & CONFIG_LAYER_OPT_FULL_BRIGHTNESS);
    for (i = 0; i < configKeyCount(); i++) {
        configBinding(0, i, &first, &second);
        assert((first & 15) == CONFIG_ACTION_KEY_TAP);
        assert((first >> 4) == modifiers[i]);
        assert(second == usages[i]);
        assert(configLedColor(0, i) == i);
        assert(configPalette[i][0] == colors[i][0]);
        assert(configPalette[i][1] == colors[i][1]);
        assert(configPalette[i][2] == colors[i][2]);
    }
    configBinding(0, configKeyCount(), &first, &second);
    assert(first == CONFIG_ACTION_MOUSE_CLICK && second == 4);
    assert(configLedColor(0, 0) == 0);
    assert(configLedColor(0, 2) == 2);
}

static void testInvalid(void) {
    testLoadStarterProfile(CONFIG_SIX_KEYS);
    activeConfig[8] = 0x18;
    seal();
    assert(!configValid(activeConfig, CONFIG_SIX_KEYS));
    activeConfig[8] = 8;
    activeConfig[9] = CONFIG_ACTION_KEY_HOLD;
    activeConfig[10] = 0xE0;
    seal();
    assert(!configValid(activeConfig, CONFIG_SIX_KEYS));
    testLoadStarterProfile(CONFIG_SIX_KEYS);
    activeConfig[23] = CONFIG_ACTION_MOUSE_HOLD; // Clockwise rotation
    seal();
    assert(!configValid(activeConfig, CONFIG_SIX_KEYS));
    testLoadStarterProfile(CONFIG_SIX_KEYS);
    activeConfig[31] = 1;
    seal();
    assert(!configValid(activeConfig, CONFIG_SIX_KEYS));
    testLoadStarterProfile(CONFIG_SIX_KEYS);
    activeConfig[6] ^= 1;
    assert(!configValid(activeConfig, CONFIG_SIX_KEYS));
}

static void testCapacityAndStrings(uint8_t variant) {
    uint8_t size = variant ? 15 : 22;
    uint8_t layers;
    uint8_t pool;
    uint8_t remaining;
    for (layers = 1; layers <= 4; layers++) {
        testLoadStarterProfile(variant);
        activeConfig[3] = layers - 1;
        pool = 9 + size * layers;
        remaining = CONFIG_SIZE - pool;
        assert(remaining == (variant ? 119 - 15 * layers : 119 - 22 * layers));
        // Extra layers contain canonical empty actions and LED colors.
        activeConfig[4] = remaining;
        activeConfig[pool + remaining - 1] = 0;
        seal();
        assert(configValid(activeConfig, variant));
        activeConfig[4]++;
        seal();
        assert(!configValid(activeConfig, variant));
    }
    testLoadStarterProfile(variant);
    pool = 9 + size;
    activeConfig[4] = 4;
    activeConfig[9] = CONFIG_ACTION_STRING;
    activeConfig[10] = 0;
    activeConfig[pool] = 'A';
    activeConfig[pool + 1] = 0;
    activeConfig[pool + 2] = 'B';
    activeConfig[pool + 3] = 0;
    seal();
    assert(configValid(activeConfig, variant));
    activeConfig[10] = 1;
    seal();
    assert(!configValid(activeConfig, variant));
    activeConfig[10] = 2;
    seal();
    assert(configValid(activeConfig, variant));
}

static void testChords(void) {
    uint8_t first;
    uint8_t second;
    testLoadStarterProfile(CONFIG_THREE_KEYS);
    activeConfig[5] = 1 | (2 << 1);
    activeConfig[24] = 0;
    activeConfig[25] = CONFIG_ACTION_KEY_TAP;
    activeConfig[26] = 0x04;
    activeConfig[27] = 2;
    activeConfig[28] = CONFIG_ACTION_KEY_TAP;
    activeConfig[29] = 0x05;
    seal();
    assert(configValid(activeConfig, CONFIG_THREE_KEYS));
    assert(configChord(0, 1, 0, &first, &second));
    assert(first == CONFIG_ACTION_KEY_TAP && second == 0x04);
    assert(!configChord(0, 0, 2, &first, &second));
    activeConfig[27] = 0;
    seal();
    assert(!configValid(activeConfig, CONFIG_THREE_KEYS));
    activeConfig[27] = 3;
    seal();
    assert(!configValid(activeConfig, CONFIG_THREE_KEYS));
}

static void testActions(void) {
    uint8_t type;
    uint8_t param;
    for (type = 0; type < 16; type++) {
        testLoadStarterProfile(CONFIG_SIX_KEYS);
        param = 0;
        if (type == CONFIG_ACTION_KEY_TAP || type == CONFIG_ACTION_KEY_HOLD) {
            param = 0x04;
        } else if (type >= CONFIG_ACTION_MOUSE_CLICK &&
                   type <= CONFIG_ACTION_MOUSE_TOGGLE) {
            param = 1;
        } else if (type == CONFIG_ACTION_SCROLL ||
                   type == CONFIG_ACTION_MOUSE_X ||
                   type == CONFIG_ACTION_MOUSE_Y) {
            param = 1;
        } else if (type == CONFIG_ACTION_CONSUMER) {
            param = 0xE9;
            activeConfig[9] = 0x08; // Volume up
        } else if (type == CONFIG_ACTION_STRING) {
            activeConfig[4] = 1;
        }
        if (type == 0xC) continue; // Reserved action code.
        activeConfig[9] = (activeConfig[9] & 0xF0) | type;
        activeConfig[10] = param;
        seal();
        assert(configValid(activeConfig, CONFIG_SIX_KEYS));
    }
        testLoadStarterProfile(CONFIG_SIX_KEYS);
    activeConfig[23] = CONFIG_ACTION_MOMENTARY_LAYER;
    seal();
    assert(!configValid(activeConfig, CONFIG_SIX_KEYS));
    testLoadStarterProfile(CONFIG_SIX_KEYS);
    activeConfig[9] = CONFIG_ACTION_SCROLL;
    activeConfig[10] = 0x80;
    seal();
    assert(!configValid(activeConfig, CONFIG_SIX_KEYS));
    testLoadStarterProfile(CONFIG_THREE_KEYS);
    activeConfig[22] = 0xF2;
    seal();
    assert(!configValid(activeConfig, CONFIG_THREE_KEYS));
}

int main(void) {
    testStarterFixture(CONFIG_SIX_KEYS);
    testStarterFixture(CONFIG_THREE_KEYS);
    testInvalid();
    testCapacityAndStrings(CONFIG_SIX_KEYS);
    testCapacityAndStrings(CONFIG_THREE_KEYS);
    testChords();
    testActions();
    return 0;
}
