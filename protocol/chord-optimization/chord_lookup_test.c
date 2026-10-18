/* Independently enumerate pair membership and local/global priority. */
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "config_fixture.h"

static uint8_t pairMask(uint8_t index, uint8_t keys) {
    uint8_t current = 0;
    for (uint8_t first = 0; first < keys; first++) {
        for (uint8_t second = first + 1; second < keys; second++, current++) {
            if (current == index) return (1u << first) | (1u << second);
        }
    }
    assert(0);
    return 0;
}

int main(void) {
    uint8_t keys = PHYSICAL_VARIANT ? 3 : 6;
    uint8_t stride = PHYSICAL_VARIANT ? 15 : 22;
    uint8_t pairs = keys * (keys - 1) / 2;
    unsigned cases = 0;
    for (uint8_t layers = 1; layers <= CONFIG_MAX_LAYERS; layers++) {
        for (uint8_t custom = 0; custom < 2; custom++) {
            for (uint8_t scope = 0; scope < layers; scope++) {
                for (uint8_t local = 0; local < pairs; local++) {
                    for (uint8_t global = 0; global < pairs; global++) {
                        memset(activeConfig, 0, CONFIG_ACTIVE_SIZE);
                        activeConfig[0] = CONFIG_MARKER;
                        activeConfig[1] = CONFIG_VERSION;
                        testSetVariant(PHYSICAL_VARIANT);
                        testSetLayout(layers, 0, 0);
                        if (custom) activeConfig[9 + stride - 1] &= 15;
                        uint8_t offset = configLayerPaletteOffset(layers);
                        testSetChordCount(2);
                        activeConfig[offset] = (scope << 4) | local;
                        activeConfig[offset + 1] = CONFIG_ACTION_KEY_TAP;
                        activeConfig[offset + 2] = 4;
                        activeConfig[offset + 3] = 0x70 | global;
                        activeConfig[offset + 4] = CONFIG_ACTION_KEY_TAP;
                        activeConfig[offset + 5] = 5;
                        uint16_t crc = configCrc(activeConfig);
                        activeConfig[7] = crc;
                        activeConfig[8] = crc >> 8;
                        assert(configValid(activeConfig, PHYSICAL_VARIANT));
                        for (uint8_t layer = 0; layer < layers; layer++) {
                            for (uint8_t inputs = 1; inputs < (1u << keys); inputs++) {
                                if (__builtin_popcount(inputs) > 2) continue;
                                uint8_t expected = 0;
                                if ((pairMask(global, keys) & inputs) == inputs) expected = offset + 4;
                                if (layer == scope && (pairMask(local, keys) & inputs) == inputs) expected = offset + 1;
                                assert(configChordOffset(layer, inputs) == expected);
                                cases++;
                            }
                        }
                    }
                }
            }
        }
    }
    testLoadStarterProfile(PHYSICAL_VARIANT);
    for (uint8_t key = 0; key < keys; key++) assert(!configChordOffset(0, 1u << key));
    printf("Chord lookup: board=%u cases=%u passed\n", PHYSICAL_VARIANT, cases);
    return 0;
}
