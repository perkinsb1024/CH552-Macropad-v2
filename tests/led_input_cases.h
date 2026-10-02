// Included after the real sketch to inspect runtime state and rendered GRB bytes.
static uint8_t expectedDim(uint8_t v) { return (v >> 4) | (v != 0); }
static uint8_t stepModel(uint8_t n, int8_t d, uint8_t count) {
    int value = n + d;
    return (value % count + count) % count;
}
static void testLedControls(void) {
    uint8_t image[CONFIG_SIZE];
    testLoadStarterProfile(PHYSICAL_VARIANT);
    activeConfigValid = 1;
    P1 = P3 = 0xFF;
    previewOptions = 0;
    currentMs = 200;
    firmwareApplyConfig();
    memcpy(image, activeConfig, CONFIG_SIZE);
    assert(ledSettings[0] == 2 && ledSettings[1] == 1 && ledSettings[2] == 3 && ledSettings[3] == 3);
    for (uint8_t kind = 0; kind < 2; kind++) {
        for (uint8_t value = 0; value < 4; value++) {
            rainbowHue = 42;
            firmwareLedAction(kind * 2, value);
            assert(ledSettings[kind] == value && rainbowHue == 42);
            for (int8_t delta = -7; delta <= 7; delta++) {
                if (!delta) continue;
                ledSettings[kind] = value;
                firmwareLedAction(kind * 2 + 1, delta & 15);
                assert(ledSettings[kind] == stepModel(value, kind ? -delta : delta, 4));
            }
        }
        firmwareLedAction(kind * 2, 15);
        assert(ledSettings[kind] == (kind ? 1 : 2));
    }
    for (uint8_t indicator = 0; indicator < 4; indicator++) {
        for (uint8_t key = 0; key < 4; key++) {
            for (int8_t delta = -7; delta <= 7; delta++) {
                if (!delta) continue;
                ledSettings[2] = indicator; ledSettings[3] = key;
                firmwareLedAction(CONFIG_LED_BOTH_RELATIVE, delta & 15);
                assert(ledSettings[2] == stepModel(indicator == 3 ? 1 : indicator, delta, 3));
                assert(ledSettings[3] == stepModel(key == 3 ? 2 : key, delta, 3));
                ledSettings[2] = indicator; ledSettings[3] = key;
                uint8_t pair = indicator | key << 2;
                uint8_t index;
                for (index = 0; index < 5; index++) if (ledPresets[index] == pair) break;
                uint8_t expected = index < 5 ? stepModel(index, delta, 5) : stepModel(delta > 0 ? 4 : 0, delta, 5);
                firmwareLedAction(CONFIG_LED_PRESET_RELATIVE, delta & 15);
                assert((ledSettings[2] | ledSettings[3] << 2) == ledPresets[expected]);
            }
        }
    }
    for (uint8_t preset = 0; preset < 5; preset++) {
        firmwareLedAction(CONFIG_LED_PRESET_SET, preset);
        assert((ledSettings[2] | ledSettings[3] << 2) == ledPresets[preset]);
    }
    assert(memcmp(image, activeConfig, CONFIG_SIZE) == 0);
    // Matrix: every visibility mode, brightness policy, held-key state and blink phase.
    for (uint8_t mode = 0; mode < 4; mode++) for (uint8_t full = 0; full < 2; full++) {
        activeConfig[9 + (PHYSICAL_VARIANT ? 15 : 22) - 1] = 0xE0 | mode << 2 | full;
        for (uint8_t ind = 0; ind < 4; ind++) for (uint8_t key = 0; key < 4; key++) {
            ledSettings[2] = ind; ledSettings[3] = key;
            for (uint8_t held = 0; held < 2; held++) for (uint8_t dark = 0; dark < 2; dark++) {
                stableState[0] = held;
                layerIndicatorPhasesLeft = mode == 1 ? 6 : mode == 2 ? (dark ? 1 : 2) : 0;
                updateLeds();
                uint8_t level = ind == 3 ? 1 + full : ind;
                uint8_t isKey = 0;
                if (level && (mode == 1 || mode == 2)) {
                    if (mode == 2 && dark) level = 0;
                } else if (held && key) { level = key == 3 ? 2 : key; isKey = 1; }
                else if (mode != 3) level = 0;
                uint8_t red = level ? (level == 1 ? expectedDim(255) : 255) : 0;
                uint8_t other = isKey ? 0 : red;
                assert(ledData[1] == red && ledData[0] == other && ledData[2] == other);
            }
        }
    }
    // Key-off permits the idle background; indicator-off permits the key overlay.
    layerIndicatorPhasesLeft = 0;
    stableState[0] = 1;
    activeConfig[9 + (PHYSICAL_VARIANT ? 15 : 22) - 1] = 0xED;
    firmwareLedAction(CONFIG_LED_KEY_SET, 0);
    firmwareLedAction(CONFIG_LED_INDICATOR_SET, 2);
    assert(ledData[0] == 255 && ledData[1] == 255);
    firmwareLedAction(CONFIG_LED_BOTH_SET, 0);
    for (uint8_t i = 0; i < NUM_BYTES; i++) assert(ledData[i] == 0);
    firmwarePreviewColor(0xED);
    assert(ledData[0] == 255 && ledData[1] == 255);
    firmwarePreviewColor(0);
    for (uint8_t i = 0; i < NUM_BYTES; i++) assert(ledData[i] == 0);
    // Rainbow preview uses saved phase even after a runtime phase override.
    rainbowHue = 42;
    firmwarePreviewColor(0xFD);
    uint8_t previewFrame[NUM_BYTES];
    memcpy(previewFrame, ledData, NUM_BYTES);
    firmwareLedAction(CONFIG_LED_PHASE_SET, 0);
    assert(memcmp(previewFrame, ledData, NUM_BYTES) == 0);
    firmwarePreviewColor(0);
    firmwareLedAction(CONFIG_LED_RESTORE, 0);
    assert(ledSettings[0] == 2 && ledSettings[1] == 1 && ledSettings[2] == 3 && ledSettings[3] == 3);
    firmwareLedAction(CONFIG_LED_BOTH_SET, 0);
    firmwareApplyConfig();
    assert(ledSettings[2] == 3 && ledSettings[3] == 3);
    P1 = P3 = 0xFF;
    stableState[0] = 0;
}
