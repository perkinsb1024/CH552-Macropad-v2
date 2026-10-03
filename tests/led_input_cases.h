// Included after the real sketch to inspect runtime state and rendered GRB bytes.
static void testTimedLighting(void) {
    testLoadStarterProfile(PHYSICAL_VARIANT);
    uint8_t offset = configTimedOffset();
    activeConfig[3] = 1 << 6;
    activeConfig[9] = 0x1F; // The waking key explicitly selects dim key feedback.
    activeConfig[10] = CONFIG_LED_KEY_SET;
    activeConfig[9 + (PHYSICAL_VARIANT ? 15 : 22) - 1] = 0xED;
    activeConfig[offset] = 128; // Inactivity, one coarse tick.
    activeConfig[offset + 1] = 0x3F;
    activeConfig[offset + 2] = CONFIG_LED_PRESET_SET;
#if CONFIG_TIMED_RESUME
    activeConfig[offset + 3] = 0xFF;
    activeConfig[offset + 4] = CONFIG_LED_BOTH_SET;
#endif
    activeConfigValid = 1;
    P1 = P3 = 0xFF;
    previewOptions = 0;
    currentMs = 0;
    firmwareApplyConfig();
    assert(ledData[0] == 255);
    currentMs = 65536;
    loop();
    assert(ledSettings[2] == 0 && ledSettings[3] == 1 && ledData[0] == 0);
    P1 &= ~0x02;
    currentMs += 1;
    loop();
    currentMs += 10;
    loop();
#if CONFIG_TIMED_RESUME
    assert(ledSettings[2] == 3 && ledData[3] == 255); // Background wakes.
#endif
    assert(ledSettings[3] == 1); // Physical binding wins over resume restoration.
    assert(ledData[0] == 0 && ledData[1] == 15);
#if CONFIG_TIMED_RESUME
    P1 = P3 = 0xFF;
    currentMs = 0;
    firmwareApplyConfig();
    P1 &= ~0x02;
    currentMs = 65525;
    loop(); // Raw edge, not yet debounced.
    currentMs = 65536;
    loop(); // Deadline and debounced input in the same frame.
    assert(ledSettings[2] == 3 && ledSettings[3] == 1 && ledData[3] == 255);
#endif
    // Coarse ticks are aligned to uptime, not to the last save/input. Reproduce
    // a ~33-second first firing without changing the millisecond clock rate.
    const uint32_t starts[] = {0, 30000, 32000, 65000};
    for (uint8_t i = 0; i < sizeof(starts) / sizeof(starts[0]); i++) {
        P1 = P3 = 0xFF;
        currentMs = starts[i];
        firmwareApplyConfig();
        actionsTimedInput();
        currentMs = 65535;
        loop();
        assert(ledSettings[2] == 3);
        currentMs = 65536;
        loop();
        assert(ledSettings[2] == 0);
        // Subsequent firings remain one full 65.536-second tick apart.
        firmwareLedAction(CONFIG_LED_BOTH_SET, 15);
        currentMs = 131071;
        loop();
        assert(ledSettings[2] == 3);
        currentMs = 131072;
        loop();
        assert(ledSettings[2] == 0);
    }
}

static void testConsumedPhysicalInput(void) {
    testLoadStarterProfile(PHYSICAL_VARIANT);
    activeConfig[3] = 1 << 6;
    uint8_t offset = configTimedOffset();
    activeConfig[offset] = 128;
#if CONFIG_TIMED_CONSUME_INLINE
    activeConfig[offset] |= CONFIG_TIMED_CONSUME;
#else
    activeConfig[127] = 1;
#endif
    activeConfig[offset + 1] = 0x3F;
    activeConfig[offset + 2] = CONFIG_LED_PRESET_SET;
    activeConfig[offset + 3] = 0xFF;
    activeConfig[offset + 4] = CONFIG_LED_BOTH_SET;
    activeConfig[9] = 0x1F; activeConfig[10] = CONFIG_LED_KEY_SET;
    uint8_t encoder = 9 + 2 * NUM_LEDS;
    activeConfig[encoder] = 0x1F; activeConfig[encoder + 1] = CONFIG_LED_KEY_SET;
    activeConfig[encoder + 2] = 0x1F; activeConfig[encoder + 3] = CONFIG_LED_KEY_SET;
    P1 = P3 = 0xFF;
    activeConfigValid = 1;
    previewOptions = 0;
    currentMs = 0;
    firmwareApplyConfig();
    currentMs = 65536; loop();
    P1 &= ~2; currentMs++; loop(); currentMs += 10; loop();
    assert(ledSettings[3] == 3); // Resume works; the key's Dim command did not.
    P1 |= 2; currentMs++; loop(); currentMs += 10; loop();
    P1 &= ~2; currentMs++; loop(); currentMs += 10; loop();
    assert(ledSettings[3] == 1); // The next distinct press is normal.
    P1 = P3 = 0xFF;
    currentMs = 0; firmwareApplyConfig();
    currentMs = 65536; loop();
    // One clockwise detent starting at 11; partial transitions do not wake.
    const uint8_t sequence[] = {2, 0, 1, 3};
    for (uint8_t i = 0; i < 4; i++) {
        P3 = (P3 & ~3) | sequence[i];
        currentMs++; loop();
        if (i < 3) assert(ledSettings[3] == 1);
    }
    assert(ledSettings[3] == 3); // Completed detent resumes and is consumed.
    for (uint8_t i = 0; i < 4; i++) { P3 = (P3 & ~3) | sequence[i]; currentMs++; loop(); }
    assert(ledSettings[3] == 1);
    // Encoder button may still enter the bootloader even when its binding is consumed.
    P1 = P3 = 0xFF; currentMs = 0; firmwareApplyConfig();
    currentMs = 65536; loop();
    P3 &= ~8; currentMs++; loop(); currentMs += 10; loop();
    assert(allowRunBootloader);
    expectBootloader = 1;
    if (!setjmp(bootloaderJump)) { currentMs += 3000; loop(); assert(0); }
    expectBootloader = 0;
}

static void testTemporaryEffects(void) {
    for (uint8_t color = 0; color < 16; color++) {
        for (uint8_t blinks = 0; blinks <= 8; blinks++) {
            testLoadStarterProfile(PHYSICAL_VARIANT);
            P1 = P3 = 0xFF; previewOptions = 0; activeConfigValid = 1;
            currentMs = 1000; firmwareApplyConfig();
            firmwareLedAction(CONFIG_LED_INDICATOR_SET, 0);
            uint8_t command = blinks ? CONFIG_LED_EFFECT_ON + blinks : CONFIG_LED_EFFECT_ON;
            firmwareLedAction(command, color);
            assert((previewOptions & LED_EFFECT_FLAG) && (previewOptions >> 4) == color);
            assert(layerIndicatorPhasesLeft == 2 * blinks);
            for (uint8_t i = 0; i < NUM_LEDS; i++) {
                if (color != 15) {
                    assert(ledData[3 * i] == configPalette[color][1]);
                    assert(ledData[3 * i + 1] == configPalette[color][0]);
                    assert(ledData[3 * i + 2] == configPalette[color][2]);
                }
            }
            if (color == 15) {
                uint8_t hue = rainbowHue;
                currentMs += 18; loop();
                assert(rainbowHue != hue); // Animates on a non-rainbow/disabled layer.
            }
            for (uint8_t phase = 1; phase <= 2 * blinks; phase++) {
                currentMs = 1000 + 250 * phase; loop();
                assert(layerIndicatorPhasesLeft == 2 * blinks - phase);
                if ((phase & 1) || phase == 2 * blinks) {
                    for (uint8_t i = 0; i < NUM_BYTES; i++) assert(ledData[i] == 0);
                } else if (color != 15) assert(ledData[0] == configPalette[color][1]);
            }
            if (blinks) assert(!previewOptions && ledSettings[2] == 0);
            else {
                currentMs += 2000; loop(); assert(previewOptions & LED_EFFECT_FLAG);
                firmwareLedAction(CONFIG_LED_EFFECT_RESTORE, 0);
                assert(!previewOptions && ledSettings[2] == 0);
            }
        }
    }
    // Pressed-key feedback overrides always-on, but not blinking effects.
    testLoadStarterProfile(PHYSICAL_VARIANT);
    activeConfig[9] = activeConfig[10] = 0;
    activeConfig[9 + 2 * (NUM_LEDS + 3)] = 10; // Key 0: blue.
    P1 = P3 = 0xFF; previewOptions = 0; currentMs = 0; firmwareApplyConfig();
    firmwareLedAction(CONFIG_LED_EFFECT_ON, 0); // Bright red.
    P1 &= ~2; currentMs = 1; loop(); currentMs = 11; loop();
    assert((previewOptions & LED_EFFECT_FLAG) && ledData[2] == 255 && ledData[1] == 0);
    firmwareLedAction(CONFIG_LED_EFFECT_BLINK_1, 0);
    assert(ledData[1] == 255 && ledData[2] == 0);
    currentMs = 260; loop(); assert(ledData[0] == 0 && ledData[1] == 0 && ledData[2] == 0);
    currentMs = 510; loop(); assert(!previewOptions && ledData[2] == 255);
    // Replacing a blink with always-on cancels the old deadline.
    firmwareLedAction(CONFIG_LED_EFFECT_BLINK_8, 15);
    firmwareLedAction(CONFIG_LED_EFFECT_ON, 4);
    currentMs += 500; loop(); assert((previewOptions >> 4) == 4 && !layerIndicatorPhasesLeft);
    // Config application cancels the overlay; UI preview also replaces it cleanly.
    firmwareApplyConfig(); assert(!previewOptions && !layerIndicatorPhasesLeft);
#if ENABLE_COLOR_PREVIEW
    firmwareLedAction(CONFIG_LED_EFFECT_BLINK_8, 15);
    firmwarePreviewColor(0xA5);
    assert(previewOptions == 0xA5 && !layerIndicatorPhasesLeft);
    firmwarePreviewColor(0); assert(!previewOptions);
#endif
    // Same-layer selection leaves the alert; actual switching clears it.
    testLoadStarterProfile(PHYSICAL_VARIANT);
    uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
    activeConfig[3] = 1;
    activeConfig[9] = CONFIG_ACTION_SET_LAYER; activeConfig[10] = 0;
    activeConfig[11] = CONFIG_ACTION_SET_LAYER; activeConfig[12] = 1;
    activeConfig[9 + 2 * size - 1] = 0xAD; // Bright blue, always-on.
    P1 = P3 = 0xFF; previewOptions = 0; currentMs = 0; firmwareApplyConfig();
    firmwareLedAction(CONFIG_LED_EFFECT_ON, 15);
    actionsPress(0, 0); loop(); assert(previewOptions & LED_EFFECT_FLAG);
    actionsRelease(0);
    actionsPress(1, 1); loop();
    assert(!previewOptions && actionsLayer() == 1 && ledData[2] == 255);
    actionsRelease(1);
    // A timer may start an alert; its resume restores the same layer, consuming wake.
    testLoadStarterProfile(PHYSICAL_VARIANT);
    activeConfig[3] = 1 << 6;
    uint8_t timer = configTimedOffset();
    activeConfig[timer] = 128;
#if CONFIG_TIMED_CONSUME_INLINE
    activeConfig[timer] |= CONFIG_TIMED_CONSUME;
#else
    activeConfig[127] = 1;
#endif
    activeConfig[timer + 1] = 0xFF; activeConfig[timer + 2] = CONFIG_LED_EFFECT_ON;
    activeConfig[timer + 3] = 0x0F; activeConfig[timer + 4] = CONFIG_LED_EFFECT_RESTORE;
    P1 = P3 = 0xFF; previewOptions = 0; currentMs = 0; firmwareApplyConfig();
    currentMs = 65536; loop(); assert(previewOptions == 0xFF);
    uint8_t before = frameCount;
    P1 &= ~2; currentMs++; loop(); currentMs += 10; loop();
    assert(!previewOptions && frameCount == before && actionsLayer() == 0);
}

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
    // Toggle matches policies, across every starting pair; phase/speed are preserved.
    for (uint8_t preset = 1; preset < 5; preset++) {
        for (uint8_t indicator = 0; indicator < 4; indicator++) {
            for (uint8_t key = 0; key < 4; key++) {
                ledSettings[0] = 0; ledSettings[1] = 3;
                ledSettings[2] = indicator; ledSettings[3] = key;
                uint8_t pair = indicator | (key << 2);
                uint8_t expected = pair == ledPresets[preset] ? 15 : ledPresets[preset];
                firmwareLedAction(CONFIG_LED_PRESET_TOGGLE, preset);
                assert((ledSettings[2] | (ledSettings[3] << 2)) == expected);
                assert(ledSettings[0] == 0 && ledSettings[1] == 3);
                firmwareLedAction(CONFIG_LED_PRESET_TOGGLE, preset);
                assert((ledSettings[2] | (ledSettings[3] << 2)) == (expected == 15 ? ledPresets[preset] : 15));
            }
        }
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
