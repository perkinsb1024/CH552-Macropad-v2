/* Independent CRC and reclaimed-settings checks for isolated candidate trees.
 * Compile this file from the generated source root; it reuses the EEPROM/HID
 * stubs and complete protocol regressions without adding production code.
 */
#define main originalProtocolTests
#include "../tests/protocol_test.c"
#undef main
#include "../tests/crc_probe_reference.h"
#include <stdio.h>

static void testReferenceAndCoverage(void) {
    static const uint8_t vector[] = "123456789";
    uint16_t check = PROBE_WIDTH == 16 ? 0x29B1 : PROBE_WIDTH == 10 ? 0x199 : 0xF4;
    assert(probeReference(vector, 9, 0) == check);
    uint32_t state = 0x82A145E3;
    uint8_t image[CONFIG_SIZE];
    for (unsigned sample = 0; sample < 1000; sample++) {
        for (unsigned i = 0; i < CONFIG_SIZE; i++) {
            state ^= state << 13; state ^= state >> 17; state ^= state << 5;
            image[i] = state;
        }
        assert(configCrc(image) == probeReference(image, CONFIG_SIZE, 1));
    }
    /* Every individual image bit must be detected, including stored CRC and
     * settings sharing its former byte. Structural validation remains active.
     */
    for (uint8_t variant = 0; variant < 2; variant++) {
        testLoadStarterProfile(variant);
        for (unsigned byte = 0; byte < CONFIG_SIZE; byte++) {
            for (unsigned bit = 0; bit < 8; bit++) {
                activeConfig[byte] ^= 1u << bit;
                assert(!configValid(activeConfig, variant));
                activeConfig[byte] ^= 1u << bit;
            }
        }
        for (unsigned settings = 0; settings < 256; settings++) {
            if (settings & ~PROBE_SETTINGS_MASK) continue;
            activeConfig[PROBE_SETTINGS_BYTE] = settings;
            seal(activeConfig);
            assert((activeConfig[PROBE_SETTINGS_BYTE] & PROBE_SETTINGS_MASK) == settings);
            assert(configValid(activeConfig, variant));
            for (unsigned bit = 0; bit < 8; bit++) {
                if (!(PROBE_SETTINGS_MASK & (1u << bit))) continue;
                activeConfig[PROBE_SETTINGS_BYTE] ^= 1u << bit;
                assert(!configValid(activeConfig, variant));
                activeConfig[PROBE_SETTINGS_BYTE] ^= 1u << bit;
            }
        }
    }
}

static void testSettingsUpload(void) {
    for (unsigned settings = 0; settings < 256; settings++) {
        if (settings & ~PROBE_SETTINGS_MASK) continue;
        reset();
        upload[PROBE_SETTINGS_BYTE] = settings;
        seal(upload);
        begin(); chunks(); request(7, 0, 0, 0);
        assert(sent[8] == 0);
        assert(memcmp(flash, upload, CONFIG_SIZE) == 0);
        protocolInit();
        assert(activeConfigValid);
        assert((activeConfig[PROBE_SETTINGS_BYTE] & PROBE_SETTINGS_MASK) == settings);
    }
#if PROBE_WIDTH == 8
    reset();
    uint8_t data[3] = {128, upload[6], 1};
    request(5, 0, 3, data);
    /* A narrow uploadCrc must reject nonzero high bits rather than silently
     * truncate them; the wide-interface core rejects them at commit instead.
     */
    if (sent[8] == 0) {
        chunks(); request(7, 0, 0, 0);
    }
    assert(sent[8] == 7 && writes == 0);
#endif
}

int main(void) {
    originalProtocolTests();
    testReferenceAndCoverage();
    testSettingsUpload();
    printf("CRC-%d integrity and settings checks passed, variant %d\n", PROBE_WIDTH, PHYSICAL_VARIANT);
    return 0;
}
