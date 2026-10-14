/* Exercise the real validator, storage and USB upload paths on each geometry. */
#define main existingProtocolMain
#include "protocol_test.c"
#undef main
#include "../src/storage.h"

static uint16_t referenceCrc(const uint8_t *image) {
    uint16_t remainder = 0xFFFF;
    for (unsigned i = 0; i < 128; i++) {
        if (i == 7 || i == 8) continue;
        for (unsigned mask = 128; mask; mask >>= 1) {
            unsigned feedback = ((remainder >> 15) ^ !!(image[i] & mask)) & 1;
            remainder <<= 1;
            if (feedback) remainder ^= 0x1021;
        }
    }
    return remainder;
}

static void integrity(void) {
    uint32_t random = 0xACE12345;
    for (unsigned sample = 0; sample < 1000; sample++) {
        for (unsigned i = 0; i < 128; i++) {
            random ^= random << 13; random ^= random >> 17; random ^= random << 5;
            activeConfig[i] = random;
        }
        assert(configCrc(activeConfig) == referenceCrc(activeConfig));
    }
    testLoadStarterProfile(PHYSICAL_VARIANT);
    seal(activeConfig);
    assert(configCrc(activeConfig) == referenceCrc(activeConfig));
    for (unsigned bit = 0; bit < 1024; bit++) {
        activeConfig[bit / 8] ^= 1 << (bit % 8);
        assert(!configValid(activeConfig, PHYSICAL_VARIANT));
        activeConfig[bit / 8] ^= 1 << (bit % 8);
    }
    for (unsigned value = 1; value < 256; value++) {
        activeConfig[6] = value; seal(activeConfig);
        assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    }
    testLoadStarterProfile(PHYSICAL_VARIANT);
    activeConfig[2] |= 128; seal(activeConfig);
    assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    testLoadStarterProfile(PHYSICAL_VARIANT);
    activeConfig[3] |= 1; seal(activeConfig);
    assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    for (unsigned marker = 0; marker < 256; marker++) {
        testLoadStarterProfile(PHYSICAL_VARIANT);
        activeConfig[0] = marker; seal(activeConfig);
        assert(!!configValid(activeConfig, PHYSICAL_VARIANT) == (marker == 'B'));
    }
}

static void capacities(void) {
    const unsigned size = PHYSICAL_VARIANT ? 15 : 22;
    const unsigned pairs = PHYSICAL_VARIANT ? 3 : 15;
    for (unsigned layers = 1; layers <= CONFIG_MAX_LAYERS; layers++) {
        unsigned capacity = (119 - size * layers) / 3;
        if (capacity > pairs * (layers + 1)) capacity = pairs * (layers + 1);
        assert(capacity <= 30);
        for (unsigned count = 0; count <= 31; count++) {
            testLoadStarterProfile(PHYSICAL_VARIANT);
            memset(activeConfig + 9, 0, 119);
            testSetLayout(layers, layers - 1, 0);
            testSetChordCount(count);
            unsigned offset = 9 + size * layers;
            for (unsigned c = 0; c < count && offset + 3 <= 128; c++, offset += 3) {
                activeConfig[offset] = c < pairs * layers ?
                    ((c / pairs) << 4) | (c % pairs) : 128 | (c % pairs);
            }
            seal(activeConfig);
            assert(!!configValid(activeConfig, PHYSICAL_VARIANT) == (count <= capacity));
        }
        for (unsigned timers = 0; timers <= 4; timers++) {
            unsigned pool = 9 + size * layers + 6 * timers;
            if (pool > 128) continue;
            testLoadStarterProfile(PHYSICAL_VARIANT);
            memset(activeConfig + 9, 0, 119);
            testSetLayout(layers, 0, timers);
            testSetStringLength(128 - pool);
            seal(activeConfig);
            assert(configValid(activeConfig, PHYSICAL_VARIANT));
            assert(configTimedOffset() == 9 + size * layers);
            assert(configTimedCount() == timers);
            activeConfig[3] += 2; seal(activeConfig);
            assert(!configValid(activeConfig, PHYSICAL_VARIANT));
        }
    }
    for (unsigned phase = 0; phase < 4; phase++)
        for (unsigned speed = 0; speed < 4; speed++)
            for (unsigned transparent = 0; transparent < 2; transparent++)
                for (unsigned window = 0; window < 8; window++) {
                    testLoadStarterProfile(PHYSICAL_VARIANT);
                    activeConfig[5] = window | (transparent << 3) | (phase << 4) | (speed << 6);
                    assert(configChordWindowMs() == 0);
                    testSetChordCount(1); seal(activeConfig);
                    assert(configValid(activeConfig, PHYSICAL_VARIANT));
                    assert(configChordWindowMs() == 20 + window * 10);
                }
}

static void completeSaves(void) {
    reset();
    /* Every body byte differs, including version and both CRC bytes. The
       invalid old bytes are still available through READ_FLASH unchanged. */
    for (unsigned i = 0; i < 128; i++) flash[i] = upload[i] ^ 0xFF;
    flash[0] = 'M'; flash[1] = 'P'; flash[2] = 15;
    protocolInit(); assert(!activeConfigValid);
    for (unsigned offset = 0; offset < 128; offset += 16) {
        request(3, offset, 16, 0);
        assert(memcmp(sent + 9, flash + offset, 16) == 0);
    }
    assert(storageSave(upload));
    unsigned total = writes;
    assert(total == 129); // Invalidate, 127 body bytes, restore.
    for (unsigned cut = 0; cut < total; cut++) {
        for (unsigned i = 0; i < 128; i++) flash[i] = upload[i] ^ 0xFF;
        flash[0] = 'M'; flash[1] = 'P'; flash[2] = 15;
        writes = 0; failAfter = cut;
        assert(!storageSave(upload));
        if (cut) assert(flash[0] == 0);
        protocolInit(); assert(!activeConfigValid);
        failAfter = -1; writes = 0;
        assert(storageSave(upload));
        assert(memcmp(flash, upload, 128) == 0);
        unsigned before = writes;
        assert(storageSave(upload) && writes == before);
    }
}

int main(void) {
    existingProtocolMain();
    integrity();
    capacities();
    completeSaves();
    return 0;
}
