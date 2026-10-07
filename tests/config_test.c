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
    // Fixture CRC is checked by configValid; format 6 changes the covered version byte.
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
    assert(configValid(activeConfig, CONFIG_SIX_KEYS));
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
    assert(configValid(activeConfig, CONFIG_SIX_KEYS));
    testLoadStarterProfile(CONFIG_SIX_KEYS);
    activeConfig[6] ^= 1;
    assert(!configValid(activeConfig, CONFIG_SIX_KEYS));
}

static void testHeaderAndIgnoredFields(void) {
    for (uint8_t variant = 0; variant < 2; variant++) {
        testLoadStarterProfile(variant);
        activeConfig[5] |= CONFIG_HEADER_TRANSPARENT_BLACK;
        activeConfig[3] |= 0xC0;
        activeConfig[8] |= 0xC0;
        activeConfig[127] = 0;
        seal();
        assert(configValid(activeConfig, variant));
        assert(configLayerCount() == 1 && configStartupLayer() == 0);
        assert(configKeyCount() == (variant ? 3 : 6));
        assert(configChordWindowMs() == 40);
        // Header and tail bytes remain covered by CRC.
        activeConfig[127] ^= 1;
        assert(!configValid(activeConfig, variant));
        activeConfig[2] = 2;
        seal();
        assert(!configValid(activeConfig, variant));
    }
}

static void testCapacityAndStrings(uint8_t variant) {
    uint8_t size = variant ? 15 : 22;
    uint8_t layers;
    uint8_t pool;
    uint8_t remaining;
    for (layers = 1; layers <= (variant ? 7 : 5); layers++) {
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
    assert(configStringChar(2, 0) == 'B');
    assert(configStringChar(255, 3) == 0); // Must reject an 8-bit address wrap.
    assert(configStringChar(2, 255) == 0);
    activeConfig[10] = 1;
    seal();
    assert(!configValid(activeConfig, variant));
    activeConfig[10] = 2;
    seal();
    assert(configValid(activeConfig, variant));
}

// Exhaust all boundaries in a small pool, including adjacent empty strings.
static void testStringBoundaries(void) {
    for (uint8_t variant = 0; variant < 2; variant++) {
        testLoadStarterProfile(variant);
        uint8_t pool = 9 + (variant ? 15 : 22);
        activeConfig[4] = 8;
        activeConfig[9] = CONFIG_ACTION_STRING;
        for (uint8_t mask = 0; mask < 128; mask++) {
            for (uint8_t i = 0; i < 7; i++)
                activeConfig[pool + i] = mask & (1 << i) ? 'A' : 0;
            activeConfig[pool + 7] = 0;
            for (uint8_t position = 0; position <= 8; position++) {
                activeConfig[10] = position;
                seal();
                uint8_t expected = position < 8 &&
                    (!position || activeConfig[pool + position - 1] == 0);
                assert(!!configValid(activeConfig, variant) == expected);
            }
        }
    }
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

static void testMouseButtonMasks(void) {
    const uint8_t types[] = {CONFIG_ACTION_MOUSE_CLICK, CONFIG_ACTION_MOUSE_HOLD, CONFIG_ACTION_MOUSE_TOGGLE};
    for (uint8_t variant = 0; variant < 2; variant++) {
        for (uint8_t action = 0; action < sizeof(types); action++) {
            for (uint16_t buttons = 0; buttons < 256; buttons++) {
                testLoadStarterProfile(variant);
                activeConfig[9] = types[action];
                activeConfig[10] = buttons;
                seal();
                assert(configValid(activeConfig, variant) == (buttons >= 1 && buttons <= 7));
            }
        }
    }
}

static void testMultiClick(void) {
    for (uint8_t variant = 0; variant < 2; variant++) {
        uint8_t rotation = 9 + (variant ? 8 : 14);
        for (uint8_t aux = 0; aux < 16; aux++) {
            for (uint8_t buttons = 0; buttons < 9; buttons++) {
                // Key, encoder rotation, chord, expiry and next-input slots.
                for (uint8_t slot = 0; slot < 5; slot++) {
                    testLoadStarterProfile(variant);
                    uint8_t offset = 9;
                    if (slot == 1) offset = rotation;
                    if (slot == 2) {
                        activeConfig[5] |= 2;
                        offset = configTimedOffset() - 2;
                        activeConfig[offset - 1] = 0;
                    }
                    if (slot >= 3) {
                        activeConfig[3] |= 1 << 6;
                        offset = configTimedOffset() + (slot == 3 ? 1 : 3);
                    }
                    activeConfig[offset] = (aux << 4) | CONFIG_ACTION_MOUSE_CLICK;
                    activeConfig[offset + 1] = buttons;
                    seal();
                    assert(configValid(activeConfig, variant) == (buttons >= 1 && buttons <= 7));
                    activeConfig[offset] = (aux << 4) | 0x4;
                    seal();
                    assert(!configValid(activeConfig, variant));
                }
            }
        }
    }
}

static void testActions(void) {
    uint8_t type;
    uint8_t param;
    uint8_t aux;
    for (type = CONFIG_ACTION_MOUSE_X; type <= CONFIG_ACTION_MOUSE_Y; type++) {
        for (aux = 0; aux < 16; aux++) {
            testLoadStarterProfile(CONFIG_SIX_KEYS);
            activeConfig[9] = (aux << 4) | type;
            activeConfig[10] = 1;
            seal();
            assert(configValid(activeConfig, CONFIG_SIX_KEYS) == (aux <= 1));
            activeConfig[9] = CONFIG_ACTION_NONE;
            activeConfig[10] = 0;
            activeConfig[23] = (aux << 4) | type;
            activeConfig[24] = 1;
            seal();
            assert(configValid(activeConfig, CONFIG_SIX_KEYS) == (aux == 0));
        }
    }
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
        } else if (type == CONFIG_ACTION_CONSUMER || type == CONFIG_ACTION_CONSUMER_HOLD) {
            param = 0xE9;
            activeConfig[9] = 0x08; // Volume up
        } else if (type == CONFIG_ACTION_STRING) {
            activeConfig[4] = 1;
        }
        if (type == CONFIG_ACTION_LED_CONTROL) { activeConfig[9] = 0; param = CONFIG_LED_PHASE_SET; }
        activeConfig[9] = (activeConfig[9] & 0xF0) | type;
        activeConfig[10] = param;
        seal();
        assert(configValid(activeConfig, CONFIG_SIX_KEYS) == (type != 0x4));
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
    testLoadStarterProfile(CONFIG_SIX_KEYS);
    activeConfig[9] = CONFIG_ACTION_RELATIVE_LAYER;
    activeConfig[10] = 6;
    seal();
    assert(configValid(activeConfig, CONFIG_SIX_KEYS));
    activeConfig[10] = 0xFA;
    seal();
    assert(configValid(activeConfig, CONFIG_SIX_KEYS));
    activeConfig[10] = 7;
    seal();
    assert(!configValid(activeConfig, CONFIG_SIX_KEYS));
    activeConfig[10] = 0xF9;
    seal();
    assert(!configValid(activeConfig, CONFIG_SIX_KEYS));
    activeConfig[9] = 0x10 | CONFIG_ACTION_RELATIVE_LAYER;
    activeConfig[10] = 0;
    seal();
    assert(configValid(activeConfig, CONFIG_SIX_KEYS));
    for (type = CONFIG_ACTION_SET_LAYER; type <= CONFIG_ACTION_RELATIVE_LAYER; type += 2) {
        for (aux = 0; aux < 16; aux++) {
            activeConfig[9] = (aux << 4) | type;
            activeConfig[23] = (aux << 4) | type; // Rotation accepts both modes too.
            activeConfig[24] = 0;
            seal();
            assert(configValid(activeConfig, CONFIG_SIX_KEYS) == (aux <= 1));
        }
    }
    activeConfig[9] = 0x10 | CONFIG_ACTION_MOMENTARY_LAYER;
    activeConfig[23] = CONFIG_ACTION_NONE;
    seal();
    assert(!configValid(activeConfig, CONFIG_SIX_KEYS));
    testLoadStarterProfile(CONFIG_THREE_KEYS);
    activeConfig[22] = 0xF2;
    seal();
    assert(configValid(activeConfig, CONFIG_THREE_KEYS));
}

static void testExpandedLayers(uint8_t variant) {
    uint8_t count = variant ? 7 : 5;
    uint8_t size = variant ? 15 : 22;
    uint8_t first, second;
    uint8_t chord = 9 + size * count;
    for (uint8_t startup = 0; startup < count; startup++) {
        testLoadStarterProfile(variant);
        activeConfig[3] = (count - 1) | (startup << 3);
        activeConfig[5] |= 4; // Two chords: local then global, on the highest layer.
        activeConfig[chord] = (count - 1) << 4;
        activeConfig[chord + 1] = CONFIG_ACTION_SET_LAYER;
        activeConfig[chord + 2] = count - 1;
        activeConfig[chord + 3] = 0x80 | ((count - 1) << 4);
        activeConfig[chord + 4] = CONFIG_ACTION_SET_LAYER;
        activeConfig[chord + 5] = 0;
        uint8_t base = 9 + size * (count - 1);
        activeConfig[base] = CONFIG_ACTION_MOMENTARY_LAYER;
        activeConfig[base + 1] = count - 1;
        activeConfig[base + size - 1] = 0xA9;
        seal();
        assert(configValid(activeConfig, variant));
        assert(configLayerCount() == count && configStartupLayer() == startup);
        assert(configLayerOptions(count - 1) == 0xA9);
        configBinding(count - 1, 0, &first, &second);
        assert(first == CONFIG_ACTION_MOMENTARY_LAYER && second == count - 1);
        assert(configChord(count - 1, 0, 1, &first, &second));
        assert(second == count - 1); // Local wins over global.
        assert(configChord(0, 0, 1, &first, &second) && second == 0);
        activeConfig[3] = (count - 1) | (count << 3);
        seal();
        assert(!configValid(activeConfig, variant));
        activeConfig[3] = count; // One more complete layer exceeds the image capacity.
        seal();
        assert(!configValid(activeConfig, variant));
    }
}

static void testLedPayloads(void) {
    for (uint8_t variant = 0; variant < 2; variant++) {
        testLoadStarterProfile(variant);
        unsigned accepted = 0;
        for (unsigned command = 0; command < 256; command++) {
            for (uint8_t value = 0; value < 16; value++) {
                uint8_t expected;
                if (command == 0 || command == 2) expected = value <= 3 || value == 15;
                else if (command == 4 || command == 6 || command == 8) expected = value <= 2 || value == 15;
                else if (command == 1 || command == 3 || command == 5 || command == 7 || command == 9 || command == 12) expected = value != 0 && value != 8;
                else if (command == 10) expected = value == 0;
                else if (command == 11) expected = value <= 4;
                else if (command == 13) expected = value >= 1 && value <= 4;
                else if (command == CONFIG_LED_EFFECT_RESTORE) expected = value == 0;
                else if (command >= CONFIG_LED_EFFECT_ON && command <= CONFIG_LED_EFFECT_BLINK_8) expected = 1;
                else if (command >= (CONFIG_LED_EFFECT_ON | CONFIG_LED_EFFECT_DIM) &&
                         command <= (CONFIG_LED_EFFECT_BLINK_8 | CONFIG_LED_EFFECT_DIM)) expected = 1;
                else expected = 0;
                activeConfig[9] = (value << 4) | CONFIG_ACTION_LED_CONTROL;
                activeConfig[10] = command;
                seal();
                assert(configValid(activeConfig, variant) == expected);
                accepted += expected;
                uint8_t rotation = 9 + 2 * ((variant ? 3 : 6) + 1);
                activeConfig[9] = 0; activeConfig[10] = 0;
                activeConfig[rotation] = (value << 4) | CONFIG_ACTION_LED_CONTROL;
                activeConfig[rotation + 1] = command;
                seal();
                assert(configValid(activeConfig, variant) == expected);
                activeConfig[rotation] = CONFIG_ACTION_SCROLL; activeConfig[rotation + 1] = 1;
            }
        }
        assert(accepted == 405);
    }
}

static void testPreviousLayerSentinel(void) {
    for (uint8_t variant = 0; variant <= 1; variant++) {
        for (uint8_t version = 6; version <= CONFIG_VERSION; version++) {
            testLoadStarterProfile(variant); activeConfig[2] = version;
            for (uint8_t aux = 0; aux < 3; aux++) {
                activeConfig[9] = CONFIG_ACTION_SET_LAYER | (aux << 4);
                for (uint16_t target = 0; target < 256; target++) {
                    activeConfig[10] = target; seal();
                    assert(configValid(activeConfig, variant) == (version == CONFIG_VERSION && aux <= 1 &&
                        (target < configLayerCount() || (version == CONFIG_VERSION && target == CONFIG_LAYER_PREVIOUS))));
                }
            }
            activeConfig[9] = CONFIG_ACTION_MOMENTARY_LAYER;
            activeConfig[10] = CONFIG_LAYER_PREVIOUS; seal();
            assert(!configValid(activeConfig, variant));
        }
    }
}

static void testConsumerHoldEncoding(void) {
    for (uint8_t variant = 0; variant < 2; variant++) {
        uint8_t rotation = 9 + 2 * ((variant ? 3 : 6) + 1);
        for (uint8_t type = CONFIG_ACTION_CONSUMER; type <= CONFIG_ACTION_CONSUMER_HOLD; type++) {
            testLoadStarterProfile(variant);
            for (uint16_t usage = 0; usage < 4096; usage++) {
                activeConfig[9] = type | ((usage >> 8) << 4);
                activeConfig[10] = usage;
                seal(); assert(!!configValid(activeConfig, variant) == !!usage);
                activeConfig[9] = activeConfig[10] = 0;
                activeConfig[rotation] = type | ((usage >> 8) << 4);
                activeConfig[rotation + 1] = usage;
                seal(); assert(!!configValid(activeConfig, variant) ==
                    (usage && type == CONFIG_ACTION_CONSUMER));
                activeConfig[rotation] = CONFIG_ACTION_SCROLL;
                activeConfig[rotation + 1] = 1;
            }
        }
        testLoadStarterProfile(variant);
        activeConfig[4] = 2;
        uint8_t pool = configTimedOffset();
        activeConfig[pool] = 'A'; activeConfig[pool + 1] = 0;
        for (uint8_t aux = 0; aux < 16; aux++) {
            activeConfig[9] = aux << 4; activeConfig[10] = 0;
            seal(); assert(!!configValid(activeConfig, variant) == (aux <= (CONFIG_MACRO_PAUSE ? 2 : 1)));
        }
        activeConfig[3] = 1 << 6;
        uint8_t timer = configTimedOffset();
        activeConfig[4] = 0;
        activeConfig[timer + 1] = CONFIG_ACTION_CONSUMER_HOLD;
        activeConfig[timer + 2] = 0xE9;
        seal(); assert(!configValid(activeConfig, variant));
        // Legacy bytes must never be interpreted using the v8 type allocation.
        testLoadStarterProfile(variant); activeConfig[2] = 7;
        activeConfig[9] = 9; activeConfig[10] = 0xE9;
        seal(); assert(!configValid(activeConfig, variant));
    }
}

static void testScrollHoldValidation(void) {
    for (uint8_t variant = 0; variant < 2; variant++) {
        testLoadStarterProfile(variant);
        activeConfig[9] = CONFIG_ACTION_SCROLL | CONFIG_SCROLL_HOLD;
        activeConfig[10] = 1; seal(); assert(configValid(activeConfig, variant));
        activeConfig[10] = 0x80; seal(); assert(!configValid(activeConfig, variant));
        activeConfig[9] = activeConfig[10] = 0;
        uint8_t rotation = 9 + 2 * ((variant ? 3 : 6) + 1);
        activeConfig[rotation] = CONFIG_ACTION_SCROLL | CONFIG_SCROLL_HOLD;
        activeConfig[rotation + 1] = 1;
        seal(); assert(!configValid(activeConfig, variant));
        testLoadStarterProfile(variant); activeConfig[3] = 1 << 6;
        uint8_t timer = configTimedOffset();
        activeConfig[timer + 1] = CONFIG_ACTION_SCROLL | CONFIG_SCROLL_HOLD;
        activeConfig[timer + 2] = 1;
        seal(); assert(!configValid(activeConfig, variant));
        testLoadStarterProfile(variant); activeConfig[5] = variant | 2;
        uint8_t chord = configTimedOffset() - 3;
        activeConfig[chord] = 0;
        activeConfig[chord + 1] = CONFIG_ACTION_SCROLL | CONFIG_SCROLL_HOLD;
        activeConfig[chord + 2] = 1;
        seal(); assert(configValid(activeConfig, variant));
#if CONFIG_SCROLL_ACCELERATION
        testLoadStarterProfile(variant);
        for (uint8_t aux = 0; aux < 16; aux++) {
            activeConfig[9] = CONFIG_ACTION_SCROLL | (aux << 4);
            activeConfig[10] = 1;
            seal(); assert(!!configValid(activeConfig, variant) == (aux < 7 && (aux & 3) != 3));
            activeConfig[9] = activeConfig[10] = 0;
            activeConfig[rotation] = CONFIG_ACTION_SCROLL | (aux << 4);
            activeConfig[rotation + 1] = 1;
            seal(); assert(!!configValid(activeConfig, variant) == (aux < 3));
            activeConfig[rotation] = CONFIG_ACTION_SCROLL; activeConfig[rotation + 1] = 1;
        }
#endif
    }
}

static void testScrollAxisValidation(void) {
    for (uint8_t variant = 0; variant < 2; variant++) {
        for (uint8_t aux = 0; aux < 16; aux++) {
            for (uint8_t rotation = 0; rotation < 2; rotation++) {
                testLoadStarterProfile(variant);
                uint8_t offset = rotation ? 9 + 2 * ((variant ? 3 : 6) + 1) : 9;
                activeConfig[offset] = CONFIG_ACTION_SCROLL | (aux << 4);
                activeConfig[offset + 1] = 1;
                seal();
                assert(!!configValid(activeConfig, variant) == (!(aux & 3) && !(rotation && (aux & 4))));
            }
        }
        testLoadStarterProfile(variant);
        activeConfig[3] |= 0x40;
        uint8_t timer = configTimedOffset();
        activeConfig[timer + 1] = CONFIG_ACTION_SCROLL | CONFIG_SCROLL_HORIZONTAL;
        activeConfig[timer + 2] = -127;
        seal(); assert(configValid(activeConfig, variant));
        activeConfig[timer + 1] |= CONFIG_SCROLL_HOLD;
        seal(); assert(!configValid(activeConfig, variant));
        testLoadStarterProfile(variant); activeConfig[2] = 8;
        seal(); assert(!configValid(activeConfig, variant));
    }
}

int main(void) {
    testConsumerHoldEncoding();
    testScrollHoldValidation();
    for (uint8_t variant = 0; variant < 2; variant++) {
        for (uint8_t timers = 0; timers < 8; timers++) {
            testLoadStarterProfile(variant);
            activeConfig[3] = (timers & 3) << 6;
            activeConfig[4] = (timers >> 2) << 7;
            seal();
            assert(configValid(activeConfig, variant) == (timers <= CONFIG_TIMED_MAX));
            if (timers <= CONFIG_TIMED_MAX) assert(configTimedCount() == timers);
        }
        testLoadStarterProfile(variant);
        uint8_t offset = configTimedOffset();
        activeConfig[3] = 1 << 6;
        activeConfig[offset] = 255; // Longest interval, reset on input.
        activeConfig[offset + 1] = CONFIG_ACTION_STRING;
        activeConfig[offset + 2] = 0;
        activeConfig[4] = 2;
        activeConfig[offset + CONFIG_TIMED_SIZE] = 'A';
        activeConfig[offset + CONFIG_TIMED_SIZE + 1] = 0;
        seal();
        assert(configValid(activeConfig, variant)); // v7 bit 6 is consume, not interval.
        activeConfig[offset] = 128;
        seal();
        assert(configValid(activeConfig, variant));
        assert(configStringChar(0, 0) == 'A' && configStringChar(0, 1) == 0);
        for (uint8_t type = 0; type < 16; type++) {
            activeConfig[offset + 1] = type;
            activeConfig[offset + 2] = 0;
            if (type == CONFIG_ACTION_KEY_HOLD || type == CONFIG_ACTION_MOUSE_HOLD ||
                type == CONFIG_ACTION_MOMENTARY_LAYER) {
                seal();
                assert(!configValid(activeConfig, variant));
            }
        }
        testLoadStarterProfile(variant);
        activeConfig[2] = 6;
        activeConfig[3] |= 0xC0; // Old reserved bits are not timer counts.
        seal();
        assert(!configValid(activeConfig, variant)); // Legacy requires host migration.
        testLoadStarterProfile(variant);
        activeConfig[2] = CONFIG_VERSION;
        activeConfig[3] = 1 << 6;
        activeConfig[configTimedOffset()] = 255;
        seal();
        assert(configValid(activeConfig, variant) && configTimedCount() == 1);
        testLoadStarterProfile(variant);
        activeConfig[2] = CONFIG_VERSION;
        activeConfig[4] = CONFIG_SIZE - (9 + (variant ? 15 : 22));
        seal();
        assert(configValid(activeConfig, variant)); // Full string-pool budget.
        for (uint8_t version = CONFIG_VERSION + 1; version <= CONFIG_VERSION + 2; version++) {
            activeConfig[2] = version;
            seal();
            assert(!configValid(activeConfig, variant)); // Superseded local experiments.
        }
    }
    testPreviousLayerSentinel();
    testLedPayloads();
    testExpandedLayers(0);
    testExpandedLayers(1);
    testStarterFixture(CONFIG_SIX_KEYS);
    testStarterFixture(CONFIG_THREE_KEYS);
    testInvalid();
    testHeaderAndIgnoredFields();
    testCapacityAndStrings(CONFIG_SIX_KEYS);
    testCapacityAndStrings(CONFIG_THREE_KEYS);
    testStringBoundaries();
    testChords();
    testMouseButtonMasks();
    testMultiClick();
    testActions();
    testScrollAxisValidation();
    return 0;
}
