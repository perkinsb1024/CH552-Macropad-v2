/* Pending chord singles with tap-hold still resolve before the next binding. */
static void testChordHoldScan(void) {
    const uint16_t origins[] = {100, 65520};
    for (uint8_t window = 1; window <= 7; window++)
        for (unsigned o = 0; o < sizeof origins / sizeof origins[0]; o++) {
            initTap(0);
            uint8_t block = pair - 1;
            memmove(activeConfig + block + 3, activeConfig + block, 5);
            pair += 3;
            testSetChordCount(1); activeConfig[CONFIG_HEADER_LED] = window;
            activeConfig[block] = 0x70;
            activeConfig[block + 1] = activeConfig[block + 2] = 0;
            activeConfig[10] = activeConfig[10 + 2 * NUM_LEDS] = pair;
            activeConfig[9 + stride + 2 * NUM_LEDS] = 0x2D;
            activeConfig[10 + stride + 2 * NUM_LEDS] = CONFIG_LED_PHASE_SET;
            uint16_t crc = configCrc(activeConfig); activeConfig[7] = crc; activeConfig[8] = crc >> 8;
            assert(configValid(activeConfig, PHYSICAL_VARIANT));
            firmwareApplyConfig(1);
            uint16_t origin = edge(0, 1, origins[o]);
            uint8_t due = configChordWindowMs(); if (due < 32) due = 32;
            currentMs = (uint16_t)(origin + due - DEBOUNCE_MS); pin(NUM_LEDS, 1); loop();
            currentMs = (uint16_t)(origin + due); loop();
            assert(actionsLayer() == 1 && ledSettings[0] == 2);
            assert(buttonFirst[NUM_LEDS] == 0x2D && !flashWrites);
            cases++;
        }
}
