// Run with AddressSanitizer: image pointers intentionally have exactly 128 bytes.
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "../../src/config.h"

static void seal(uint8_t *image) {
    uint16_t crc = configCrc(image);
    image[CONFIG_HEADER_CRC] = crc;
    image[CONFIG_HEADER_CRC+1] = crc >> 8;
}

int main(void) {
    uint8_t image[128];
    unsigned checked = 0;
    for (uint8_t variant = 0; variant < 2; variant++) {
        uint8_t size = variant ? 15 : 22, width = variant ? 2 : 3;
        for (uint8_t layers = 1; layers <= (variant ? 7 : 5); layers++)
        for (uint8_t custom = 0; custom < 2; custom++)
        for (uint8_t chords = 0; chords < 32; chords++)
        for (uint8_t timers = 0; timers <= CONFIG_TIMED_MAX && timers < 8; timers++)
        for (uint8_t pool = 0; pool < 128; pool++) {
            memset(image, 0, sizeof image);
            image[0] = CONFIG_MARKER; image[1] = CONFIG_VERSION;
            image[2] = variant | ((layers-1) << 1);
            image[3] = pool << 1; image[4] = timers | (chords << 3);
            if (!custom) for (uint8_t l = 0; l < layers; l++) image[9+size*(l+1)-1] = 0x10;
            uint16_t metadata = 9 + size*layers + (custom ? width*layers : 0) + 3*chords + 6*timers;
            uint16_t end = metadata+pool;
            seal(image);
            uint8_t valid = configValid(image, variant);
            if (end > 128) assert(!valid);
            // Up to one zero-valued chord is well ordered; all actions are None.
            else if (chords <= 1) assert(valid);
            checked++;
        }
    }
    uint32_t state = 0xC552016;
    for (unsigned n = 0; n < 20000; n++) {
        uint8_t variant = n & 1;
        for (unsigned i = 0; i < sizeof image; i++) {
            state ^= state << 13; state ^= state >> 17; state ^= state << 5;
            image[i] = state;
        }
        image[0] = CONFIG_MARKER; image[1] = CONFIG_VERSION;
        image[2] = variant | ((n % (variant ? 7 : 5)) << 1);
        seal(image);
        (void)configValid(image, variant);
        checked++;
    }
    printf("Passed %u sealed-image bounds probes with exact 128-byte buffers.\n", checked);
    return 0;
}
