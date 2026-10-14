/* Differential checks against the untouched renderer, plus input regressions.
 * The Python driver supplies rainbow-reference.inc from its baseline snapshot.
 */
#include <stdio.h>
#define main input_regression_main
#include "tests/input_test.c"
#undef main

static uint8_t referenceDrift[NUM_LEDS];
#include "rainbow-reference.inc"
static unsigned long comparisons;

static void setFrame(uint16_t frame) {
#ifdef PROBE_DERIVED
    rainbowFrame.frames = frame;
#else
    rainbowHue = frame;
    const uint8_t slots[6] = {0, 3, 1, 4, 2, 5};
    const uint8_t smallSlots[3] = {0, 2, 1};
    for (uint8_t i = 0; i < NUM_LEDS; i++) {
        uint8_t slot = i;
#ifdef PROBE_PHYSICAL
        slot = PHYSICAL_VARIANT ? smallSlots[i] : slots[i];
#else
        (void)slots; (void)smallSlots;
#endif
        rainbowDrift[i] = frame >> (slot + 2);
    }
#endif
    for (uint8_t i = 0; i < NUM_LEDS; i++) referenceDrift[i] = frame >> (i + 2);
}

static void compareRender(void) {
    uint8_t actual[NUM_BYTES];
    updateLeds();
    memcpy(actual, ledData, NUM_BYTES);
    referenceUpdateLeds();
    assert(memcmp(actual, ledData, NUM_BYTES) == 0);
    comparisons++;
}

static void initialize(void) {
    currentMs = 0;
    testLoadStarterProfile(PHYSICAL_VARIANT);
    activeConfigValid = 1;
    P1 = P3 = 0xFF;
    previewOptions = 0;
    colorPreviewActive = startupWaiting = startupWarning = 0;
    resetPending = 0;
    frameCount = 0;
    firmwareApplyConfig(1);
    layerIndicatorPhasesLeft = 0;
}

static void fullDriftPeriod(void) {
    initialize();
    uint8_t optionsOffset = 9 + (PHYSICAL_VARIANT ? 15 : 22) - 1;
    for (uint8_t phase = 0; phase < 4; phase++) {
        ledSettings[0] = phase;
        for (uint8_t full = 0; full < 2; full++) {
            activeConfig[optionsOffset] = 0xFC | full;
            for (uint32_t frame = 0; frame < 65536UL; frame++) {
                setFrame(frame);
                compareRender();
            }
        }
    }
}

static void policies(void) {
    initialize();
    uint8_t optionsOffset = 9 + (PHYSICAL_VARIANT ? 15 : 22) - 1;
    const uint8_t phases[] = {0, 1, 2, 6, 14};
    /* All option bytes, brightness policies, key masks, transparency settings,
     * and representative odd/even indication phases in normal/preview/effect.
     * Hue, phase and drift vary deterministically; fullDriftPeriod exhausts them.
     */
    for (uint16_t options = 0; options < 256; options++) {
        activeConfig[optionsOffset] = options;
        for (uint8_t policy = 0; policy < 16; policy++) {
            ledSettings[2] = policy & 3;
            ledSettings[3] = policy >> 2;
            for (uint8_t p = 0; p < sizeof(phases); p++) {
                layerIndicatorPhasesLeft = phases[p];
                for (uint8_t mask = 0; mask < (1 << NUM_LEDS); mask++) {
                    for (uint8_t i = 0; i < NUM_LEDS; i++) stableState[i] = (mask >> i) & 1;
                    for (uint8_t transparent = 0; transparent < 2; transparent++) {
                        activeConfig[5] = (activeConfig[5] & ~CONFIG_HEADER_TRANSPARENT_BLACK) |
                            (transparent ? CONFIG_HEADER_TRANSPARENT_BLACK : 0);
                        for (uint8_t mode = 0; mode < 3; mode++) {
                            if (!ENABLE_COLOR_PREVIEW && mode == 1) continue;
                            previewOptions = mode == 0 ? 0 : options;
                            colorPreviewActive = mode == 1 && options != 0;
                            ledSettings[0] = (mask + policy) & 3;
                            activeConfig[8] = (activeConfig[8] & 15) | (((options + p) & 3) << 4);
                            setFrame((uint16_t)(options * 251U + policy * 997U + mask * 313U + p));
                            compareRender();
                        }
                    }
                }
            }
        }
    }
}

static void animationGates(void) {
    initialize();
    uint8_t optionsOffset = 9 + (PHYSICAL_VARIANT ? 15 : 22) - 1;
    for (uint8_t valid = 0; valid < 2; valid++) {
        for (uint16_t options = 0; options < 256; options++) {
            for (uint16_t preview = 0; preview < 256; preview++) {
                activeConfigValid = valid;
                activeConfig[optionsOffset] = options;
                previewOptions = preview;
                colorPreviewActive = 0;
                layerIndicatorPhasesLeft = 0;
                setFrame(0);
                rainbowChanged = (uint8_t)currentMs;
                currentMs += 18;
                uint8_t eligible = preview ? ((preview & 8) ? preview : 0) : (valid ? options : 0);
                uint8_t expected = (eligible & 0xFC) > 0xF0;
                loop();
                assert(rainbowHue == expected);
            }
        }
    }
}

static void sequentialFrames(void) {
    const uint8_t intervals[4] = {4, 6, 10, 18};
    for (uint8_t speed = 0; speed < 4; speed++) {
        initialize();
        activeConfig[8] = (speed << 6) | (3 << 4);
        activeConfig[9 + (PHYSICAL_VARIANT ? 15 : 22) - 1] = 0xFD;
        currentMs = 65520;
        firmwareApplyConfig(1);
        for (uint32_t frame = 1; frame <= 65536UL; frame++) {
            currentMs = 65520UL + frame * intervals[speed] - 1;
            loop();
            assert(rainbowHue == (uint8_t)(frame - 1));
            currentMs++;
            loop();
            assert(rainbowHue == (uint8_t)frame);
            for (uint8_t i = 0; i < NUM_LEDS; i++) referenceDrift[i] = frame >> (i + 2);
            compareRender();
            if (frame == 32768) {
                protocolReset(); loop(); /* USB reset preserves full drift state. */
                assert(rainbowHue == 0);
                compareRender();
            }
        }
    }
}

int main(void) {
    assert(input_regression_main() == 0);
    fullDriftPeriod();
    policies();
    animationGates();
    sequentialFrames();
    printf("Passed input regressions, %lu exact renderer comparisons, 131072 gate cases, "
           "and 262144 sequential frames (variant=%d, preview=%d).\n",
           comparisons, PHYSICAL_VARIANT, ENABLE_COLOR_PREVIEW);
    return 0;
}
