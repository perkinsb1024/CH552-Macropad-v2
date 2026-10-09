// Reduced investigation firmware must reject unsupported text, without
// rejecting other action types or damaging stored profiles.
#include <assert.h>
#include <stdio.h>
#include "../src/config.h"
#include "config_fixture.h"

static void seal(void) {
    uint16_t crc = configCrc(activeConfig);
    activeConfig[6] = crc;
    activeConfig[7] = crc >> 8;
}

int main(int argc, char **argv) {
    assert(!CONFIG_TYPE_TEXT);
    for (uint8_t variant = 0; variant < 2; variant++) {
        testLoadStarterProfile(variant);
        assert(configValid(activeConfig, variant));
        // A valid, terminated pool still cannot enable a disabled action.
        uint8_t pool = configTimedOffset();
        activeConfig[4] = 2;
        activeConfig[pool] = 'A';
        activeConfig[pool + 1] = 0;
        seal();
        assert(configValid(activeConfig, variant));
        activeConfig[9] = CONFIG_ACTION_STRING;
        activeConfig[10] = 0;
        seal();
        assert(!configValid(activeConfig, variant));
        activeConfig[9] = CONFIG_ACTION_PAUSE;
        seal();
        assert(configValid(activeConfig, variant));
        // Also reject text hidden inside macro storage.
        activeConfig[9] = activeConfig[10] = 0;
        activeConfig[pool + 2] = CONFIG_ACTION_STRING;
        activeConfig[pool + 3] = 0;
        seal();
        assert(!configValid(activeConfig, variant));
    }
    if (argc == 2) {
        FILE *file = fopen(argv[1], "rb");
        assert(file && fread(activeConfig, 1, CONFIG_SIZE, file) == CONFIG_SIZE);
        assert(fgetc(file) == EOF);
        fclose(file);
        assert(configValid(activeConfig, CONFIG_SIX_KEYS));
        assert(!configValid(activeConfig, CONFIG_THREE_KEYS));
    }
    return 0;
}
