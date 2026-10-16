// Reuse the real sketch's host hardware/USB harness, but run this format's tests.
// The old entry point is intentionally not called: its raw images use v15 colors
// and zero layer-color fields, which now announce additional palettes.
#define main originalV15InputMain
#include "input_test.c"
#undef main
#include <stdio.h>
#include <stdlib.h>

static unsigned long comparedFrames;
static const uint8_t expectedPalette[16][3] = {
    {0,0,0}, {255,0,0}, {255,22,7}, {255,16,0}, {255,66,0},
    {255,124,0}, {60,255,0}, {100,200,20}, {0,255,200}, {0,91,255},
    {0,0,255}, {115,0,180}, {255,0,194}, {255,0,72}, {255,255,255}, {29,123,67}
};

static void sealImage(void) {
    uint16_t crc = configCrc(activeConfig);
    activeConfig[CONFIG_HEADER_CRC] = crc;
    activeConfig[CONFIG_HEADER_CRC + 1] = crc >> 8;
}

static void packedColor(uint8_t offset, uint8_t key, uint8_t color) {
    uint8_t *byte = activeConfig + offset + key/2;
    *byte = key & 1 ? (*byte & 15) | (color << 4) : (*byte & 240) | color;
}

static uint16_t fresh(uint8_t layers, uint8_t mask) {
    const uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
    memset(activeConfig, 0, CONFIG_ACTIVE_SIZE);
    activeConfig[0] = CONFIG_MARKER;
    activeConfig[1] = CONFIG_VERSION;
    testSetVariant(PHYSICAL_VARIANT);
    testSetLayout(layers, 0, 0);
    activeConfig[CONFIG_HEADER_SLEEP] = CONFIG_SLEEP_DEFAULT;
    activeConfig[CONFIG_HEADER_LED] = (2 << 4) | (1 << 6);
    uint16_t end = 9 + layers * size;
    for (uint8_t layer = 0; layer < layers; layer++) {
        activeConfig[9 + (layer+1)*size - 1] = (mask & (1 << layer)) ? 13 : 29;
        for (uint8_t key = 0; key < NUM_LEDS; key++)
            packedColor(configLedColorOffset(layer), key, 1);
        if (mask & (1 << layer)) {
            for (uint8_t key = 0; key < NUM_LEDS; key++) {
                if (end + key/2 < CONFIG_SIZE) packedColor(end, key, 6);
            }
            end += (NUM_LEDS+1)/2;
        }
    }
    sealImage();
    return end;
}

static void activate(void) {
    assert(configValid(activeConfig, PHYSICAL_VARIANT));
    activeConfigValid = 1;
    P1 = P3 = 255;
    startupWaiting = startupWarning = 0;
    previewOptions = 0;
    colorPreviewActive = 0;
    frameCount = 0;
    currentMs = 200;
    firmwareApplyConfig(1);
}

static void testLayoutAndValidation(void) {
    uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
    uint8_t width = (NUM_LEDS+1)/2;
    for (uint8_t layers = 1; layers <= CONFIG_MAX_LAYERS; layers++) {
        for (uint16_t mask = 0; mask < (1u << layers); mask++) {
            uint16_t expected = fresh(layers, mask);
            assert(!!configValid(activeConfig, PHYSICAL_VARIANT) == (expected <= CONFIG_SIZE));
            if (expected > CONFIG_SIZE) continue;
            uint16_t cursor = 9 + layers * size;
            for (uint8_t layer = 0; layer < layers; layer++) {
                assert(configLayerPaletteOffset(layer) == cursor);
                if (mask & (1 << layer)) cursor += width;
            }
            assert(cursor == expected);
            assert(configLayerPaletteOffset(layers) == expected);
            assert(configTimedOffset() == expected);
            if (NUM_LEDS == 3 && mask) {
                uint8_t first = 9 + layers*size;
                activeConfig[first+1] |= 0x10;
                sealImage();
                assert(!configValid(activeConfig, PHYSICAL_VARIANT));
                activeConfig[first+1] &= 15;
            }
            testSetStringLength(CONFIG_SIZE-expected);
            memset(activeConfig+expected, 0, CONFIG_SIZE-expected);
            sealImage();
            assert(configValid(activeConfig, PHYSICAL_VARIANT));
            if (CONFIG_SIZE-expected < 127) {
                testSetStringLength(CONFIG_SIZE-expected+1);
                sealImage();
                assert(!configValid(activeConfig, PHYSICAL_VARIANT));
            }
        }
    }
    fresh(1, 1);
    activeConfig[1] = 15;
    sealImage();
    assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    activeConfig[1] = CONFIG_VERSION == 16 ? 17 : 16;
    sealImage();
    assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    fresh(1, 1);
    activeConfig[CONFIG_HEADER_CRC] ^= 1;
    assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    for (uint8_t c = 0; c < 15; c++)
        assert(memcmp(configPalette[c], expectedPalette[c], 3) == 0);
#if !CONFIG_PER_KEY_RAINBOW
    assert(memcmp(configPalette[15], expectedPalette[15], 3) == 0);
#endif
}

static void testMovedSections(void) {
    uint8_t start = fresh(2, 2);
    testSetChordCount(1);
    testSetTimedCount(1);
    testSetStringLength(2);
    activeConfig[start] = 0;
    activeConfig[start+1] = CONFIG_ACTION_KEY_TAP;
    activeConfig[start+2] = 4;
    uint8_t timer = start+3;
    activeConfig[timer] = 0;
    activeConfig[timer+1] = 0x4D; // Both Off preset on expiry.
    activeConfig[timer+2] = CONFIG_LED_PRESET_SET;
    activeConfig[timer+3] = 0x0D;
    activeConfig[timer+4] = CONFIG_LED_PRESET_SET;
    activeConfig[timer+5] = 128;
    activeConfig[timer+6] = 'A';
    activeConfig[timer+7] = 0;
    uint8_t macro = timer+8;
    activeConfig[9+2*NUM_LEDS] = CONFIG_ACTION_MACRO;
    activeConfig[10+2*NUM_LEDS] = macro;
    activeConfig[9+2*(NUM_LEDS+1)] = CONFIG_ACTION_STRING;
    activeConfig[10+2*(NUM_LEDS+1)] = 0;
    activeConfig[macro] = CONFIG_ACTION_KEY_TAP;
    activeConfig[macro+1] = 5;
    activeConfig[macro+2] = 0;
    sealImage();
    assert(configValid(activeConfig, PHYSICAL_VARIANT));
    uint8_t first, second;
    assert(configChord(0, 0, 1, &first, &second));
    assert(first == CONFIG_ACTION_KEY_TAP && second == 4);
    assert(configTimedOffset() == timer);
    assert(configStringChar(0, 0) == 'A' && configStringChar(0, 1) == 0);
    activate();
    actionsPress(NUM_LEDS, currentMs); // Encoder press avoids the chord window.
    for (uint8_t elapsed = 0; elapsed < 8; elapsed++) actionsPoll(currentMs+elapsed);
    uint8_t found = 0;
    for (uint8_t i = 0; i < frameCount; i++)
        if (frames[i][0] == 1 && frames[i][3] == 5) found = 1;
    assert(found);
    actionsRelease(NUM_LEDS);
    actionsClear();
    actionsTimedReset(0);
    actionsTimedPoll(255);
    actionsTimedPoll(0);
    assert(ledSettings[2] == 0 && ledSettings[3] == 0);
    actionsTimedInput();
    assert(ledSettings[2] == 3 && ledSettings[3] == 3);
    // Macro pointer must track the moved pool boundary, not the old v15 tail.
    activeConfig[10+2*NUM_LEDS] = start;
    sealImage();
    assert(!configValid(activeConfig, PHYSICAL_VARIANT));
}

static void expectedRgb(uint8_t color, uint8_t rainbow, uint8_t level, uint8_t key, uint8_t *grb) {
    uint8_t rgb[3];
    if (rainbow) {
        static const uint8_t positions[6] = {0,1,2,5,4,3};
        static const uint8_t steps[4] = {0,21,42,109};
        uint8_t hue = rainbowHue + positions[key]*steps[ledSettings[0]];
        if (ledSettings[0] == 3) hue += rainbowDrift[key];
        if (hue < 85) { rgb[0] = 255-3*hue; rgb[1] = 0; rgb[2] = 3*hue; }
        else if (hue < 170) { rgb[0] = 0; rgb[1] = 3*(hue-85); rgb[2] = 255-3*(hue-85); }
        else { rgb[0] = 3*(hue-170); rgb[1] = 255-3*(hue-170); rgb[2] = 0; }
    } else memcpy(rgb, expectedPalette[color], 3);
    for (uint8_t c = 0; c < 3; c++) {
        if (!level) rgb[c] = 0;
        else if (level == 1 && rgb[c]) rgb[c] = (rgb[c]/16) | 1;
    }
    grb[0] = rgb[1]; grb[1] = rgb[0]; grb[2] = rgb[2];
}

static void testRendererMatrix(void) {
    const uint8_t option = 9 + (PHYSICAL_VARIANT ? 15 : 22) - 1;
    for (uint8_t custom = 0; custom < 2; custom++) {
        fresh(1, custom);
        activate();
        rainbowHue = 171;
        ledSettings[0] = 3;
        for (uint8_t k = 0; k < NUM_LEDS; k++) rainbowDrift[k] = k*19;
        for (uint8_t bg = custom ? 0 : 1; bg < 16; bg++)
        for (uint8_t press = 0; press < 16; press++) {
            for (uint8_t k = 0; k < NUM_LEDS; k++) {
                packedColor(configLedColorOffset(0), k, press);
                if (custom) packedColor(configLayerPaletteOffset(0), k, bg);
            }
            for (uint8_t mode = 0; mode < 4; mode++)
            for (uint8_t full = 0; full < 2; full++)
            for (uint8_t ind = 0; ind < 4; ind++)
            for (uint8_t key = 0; key < 4; key++)
            for (uint8_t held = 0; held < 2; held++)
            for (uint8_t transparent = 0; transparent < 2; transparent++)
            for (uint8_t dark = 0; dark < 2; dark++) {
                activeConfig[option] = (custom ? 0 : bg << 4) | (mode << 2) | full;
                activeConfig[CONFIG_HEADER_LED] = transparent ? 8 : 0;
                ledSettings[2] = ind; ledSettings[3] = key;
                layerIndicatorPhasesLeft = mode == 1 ? 6 : mode == 2 ? (dark ? 1 : 2) : 0;
                for (uint8_t k = 0; k < NUM_LEDS; k++) stableState[k] = held;
                updateLeds();
                uint8_t level = ind == 3 ? 1+full : ind;
                uint8_t color = bg;
                uint8_t rainbow = bg == 15 && (!custom || CONFIG_PER_KEY_RAINBOW);
                if (level && (mode == 1 || mode == 2)) {
                    if (mode == 2 && dark) level = 0;
                } else if (held && key && (press || !transparent)) {
                    level = key == 3 ? 2 : key;
                    color = press;
                    rainbow = CONFIG_PER_KEY_RAINBOW && press == 15;
                } else if (mode != 3) level = 0;
                for (uint8_t k = 0; k < NUM_LEDS; k++) {
                    uint8_t expected[3];
                    expectedRgb(color, rainbow, level, k, expected);
                    if (memcmp(ledData+3*k, expected, 3)) {
                        fprintf(stderr, "render mismatch custom=%u bg=%u press=%u mode=%u full=%u ind=%u key=%u held=%u transparent=%u dark=%u led=%u\n",
                            custom,bg,press,mode,full,ind,key,held,transparent,dark,k);
                        abort();
                    }
                }
                comparedFrames++;
            }
        }
    }
}

static void testSchedulerAndOverrides(void) {
    const uint8_t option = 9 + (PHYSICAL_VARIANT ? 15 : 22) - 1;
    for (uint8_t keySource = 0; keySource < 2; keySource++) {
        fresh(1, !keySource);
        activate();
        if (keySource) {
            activeConfig[option] = 0x10; // Solid layer with indication disabled.
            P1 &= ~2;
            stableState[0] = rawState[0] = 1;
            packedColor(configLedColorOffset(0), 0, 15);
        } else {
            packedColor(configLayerPaletteOffset(0), 0, 15);
        }
        updateLeds();
        uint8_t before[NUM_BYTES]; memcpy(before, ledData, NUM_BYTES);
        rainbowChanged = 200; rainbowHue = 0; currentMs = 220;
        loop();
        assert(rainbowHue == (CONFIG_PER_KEY_RAINBOW ? 1 : 0));
        assert((memcmp(before, ledData, NUM_BYTES) != 0) == !!CONFIG_PER_KEY_RAINBOW);
    }
    fresh(1, 1); activate();
    packedColor(configLayerPaletteOffset(0), 0, 15);
    activeConfig[option] = 9; // Blink, custom palette, full brightness.
    layerIndicatorPhasesLeft = 1;
    layerIndicatorDeadline = 255;
    updateLeds();
    assertBlack();
    rainbowChanged = 200; rainbowHue = 0; currentMs = 220;
    loop();
    assert(rainbowHue == (CONFIG_PER_KEY_RAINBOW ? 1 : 0));
    assertBlack();

    fresh(1, 1); activate();
    firmwareLedAction(CONFIG_LED_EFFECT_ON, 1);
    assert(ledData[1] == 255 && ledData[0] == 0 && ledData[2] == 0);
    firmwareLedAction(CONFIG_LED_EFFECT_BLINK_1, 6);
    assert(ledData[0] == 255 && ledData[1] == 60);
    layerIndicatorPhasesLeft = 1; updateLeds(); assertBlack();
    firmwareLedAction(CONFIG_LED_EFFECT_RESTORE, 0);
    assert(ledData[0] == 255 && ledData[1] == 60);
#if ENABLE_COLOR_PREVIEW
    firmwarePreviewColor(0x1D);
    assert(ledData[1] == 255 && ledData[0] == 0);
    firmwarePreviewColor(0x0D); assertBlack();
    firmwarePreviewColor(0xFD);
    assert(ledData[1] || ledData[0] || ledData[2]);
    firmwarePreviewColor(0);
    assert(ledData[0] == 255 && ledData[1] == 60);
#endif
    for (uint8_t dim = 0; dim < 2; dim++) {
        fresh(1, 1);
        activeConfig[option] |= CONFIG_LAYER_OPT_AUTO_SLEEP;
        activeConfig[CONFIG_HEADER_SLEEP] = CONFIG_SLEEP_CONSUME | (dim ? CONFIG_SLEEP_DIM : 0);
        sealImage(); activate(); actionsTimedReset(0);
        uint8_t clock = 0;
        for (uint16_t ticks = 0; ticks < 220; ticks++) {
            clock += 255; actionsTimedPoll(clock);
            clock++; actionsTimedPoll(clock);
        }
        assert(ledSettings[2] == (dim ? 1 : 0) && ledSettings[3] == (dim ? 1 : 0));
        assert(ledData[0] == (dim ? 15 : 0));
        assert(actionsTimedInput());
        assert(ledSettings[2] == 3 && ledSettings[3] == 3);
        assert(ledData[0] == 255);
    }
}

static void testIndependentColorsAndLayerChanges(void) {
    static const uint8_t idle[6] = {6,0,15,8,10,14};
    static const uint8_t next[6] = {8,6,0,15,2,3};
    fresh(2, 3);
    for (uint8_t k = 0; k < NUM_LEDS; k++) {
        packedColor(configLayerPaletteOffset(0), k, idle[k]);
        packedColor(configLayerPaletteOffset(1), k, next[k]);
    }
    packedColor(configLedColorOffset(0), 0, 0);
    packedColor(configLedColorOffset(1), 0, 0);
    activeConfig[9+2*NUM_LEDS] = CONFIG_ACTION_SET_LAYER;
    activeConfig[10+2*NUM_LEDS] = 1;
    sealImage(); activate();
    for (uint8_t k = 0; k < NUM_LEDS; k++) {
        uint8_t expected[3];
        expectedRgb(idle[k], CONFIG_PER_KEY_RAINBOW && idle[k] == 15, 2, k, expected);
        assert(memcmp(ledData+3*k, expected, 3) == 0);
    }
    P1 &= ~2;
    currentMs = 201; loop();
    currentMs = 211; loop(); // Real debounced press, not a renderer-only state edit.
    assert(!ledData[0] && !ledData[1] && !ledData[2]);
    activeConfig[CONFIG_HEADER_LED] |= CONFIG_HEADER_TRANSPARENT_BLACK;
    updateLeds();
    assert(ledData[0] == 255 && ledData[1] == 60);
    activeConfig[CONFIG_HEADER_LED] &= ~CONFIG_HEADER_TRANSPARENT_BLACK;
    firmwareLedAction(CONFIG_LED_KEY_SET, 0); // Runtime Off reveals the background.
    assert(ledData[0] == 255 && ledData[1] == 60);
    firmwareLedAction(CONFIG_LED_KEY_SET, 15);
    assert(!ledData[0] && !ledData[1] && !ledData[2]);
    actionsPress(NUM_LEDS, currentMs);
    assert(actionsLayer() == 1);
    updateLeds();
    for (uint8_t k = 0; k < NUM_LEDS; k++) {
        uint8_t expected[3];
        expectedRgb(k ? next[k] : 0, k && CONFIG_PER_KEY_RAINBOW && next[k] == 15, 2, k, expected);
        assert(memcmp(ledData+3*k, expected, 3) == 0);
    }
}

static void testRainbowBoundaries(void) {
    static const uint8_t hues[] = {0,1,84,85,86,169,170,171,254,255};
    fresh(1, 1); activate();
    for (uint8_t k = 0; k < NUM_LEDS; k++) {
        packedColor(configLayerPaletteOffset(0), k, 15);
        packedColor(configLedColorOffset(0), k, 15);
        rainbowDrift[k] = 255-k*17;
    }
    for (uint8_t spacing = 0; spacing < 4; spacing++)
    for (uint8_t h = 0; h < sizeof hues; h++)
    for (uint8_t held = 0; held < 2; held++)
    for (uint8_t brightness = 1; brightness < 3; brightness++) {
        rainbowHue = hues[h]; ledSettings[0] = spacing;
        ledSettings[2] = ledSettings[3] = brightness;
        for (uint8_t k = 0; k < NUM_LEDS; k++) stableState[k] = held;
        updateLeds();
        for (uint8_t k = 0; k < NUM_LEDS; k++) {
            uint8_t expected[3];
            expectedRgb(15, CONFIG_PER_KEY_RAINBOW, brightness, k, expected);
            assert(memcmp(ledData+3*k, expected, 3) == 0);
        }
        comparedFrames++;
    }
}

int main(void) {
    testLayoutAndValidation();
    testMovedSections();
    testRendererMatrix();
    testSchedulerAndOverrides();
    testIndependentColorsAndLayerChanges();
    testRainbowBoundaries();
    printf("Passed palette probe: variant=%u rainbow=%u preview=%u compared_frames=%lu\n",
        PHYSICAL_VARIANT, CONFIG_PER_KEY_RAINBOW, ENABLE_COLOR_PREVIEW, comparedFrames);
    return 0;
}
