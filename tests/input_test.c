#include <assert.h>
#include <setjmp.h>
#include <stdint.h>
#include <string.h>
#include "stubs/Arduino.h"
#include "../src/config.h"
#include "../src/actions.h"
#include "config_fixture.h"

uint8_t P1 = 0xFF;
uint8_t P3 = 0xFF;
uint8_t testP1ModOc;
uint8_t testP1DirPu;
uint8_t testP3ModOc;
uint8_t testP3DirPu;
volatile uint8_t USB_CTRL;
volatile uint8_t UsbConfig = 1;
uint8_t TMOD;
volatile uint8_t EA;
static uint32_t currentMs;
static jmp_buf bootloaderJump;
static uint8_t expectBootloader;
// A held input reads low even when setup writes high to its pull-up latch.
static uint8_t encoderHeldAtStartup;
#undef P3_3
#define P3_3 (encoderHeldAtStartup ? 0 : ((P3 >> 3) & 1))
static uint8_t frames[32][9];
static uint8_t frameCount;
static uint8_t bytesWritten;
static uint8_t indicatorRisingEdges;
static uint8_t indicatorWasLit;
static uint8_t resetPending;
static uint8_t flash[CONFIG_SIZE];
uint8_t activeConfigValid;

uint32_t millis(void) { return currentMs; }
void delayMicroseconds(uint16_t us) {
    (void)us;
    if (expectBootloader) {
        assert(USB_CTRL == 0 && EA == 0 && TMOD == 0);
        longjmp(bootloaderJump, 1);
    }
}
void neopixel_show_P3_4(uint8_t *data, uint8_t length) {
    uint8_t lit = data[0] || data[1] || data[2];
    if (lit && !indicatorWasLit) indicatorRisingEdges++;
    indicatorWasLit = lit;
    bytesWritten = length;
}
void set_pixel_for_GRB_LED(uint8_t *data, uint8_t index,
                           uint8_t red, uint8_t green, uint8_t blue) {
    data[3 * index] = green;
    data[3 * index + 1] = red;
    data[3 * index + 2] = blue;
}
uint8_t eeprom_read_byte(uint8_t offset) { return flash[offset]; }
uint8_t USB_queueKeyboard(const uint8_t *keys) {
    assert(frameCount < 32);
    frames[frameCount][0] = 1;
    memcpy(frames[frameCount++] + 1, keys, 8);
    return 1;
}
uint8_t USB_queueMouse(uint8_t buttons, int8_t x, int8_t y, int8_t wheel) {
    assert(frameCount < 32);
    frames[frameCount][0] = 2;
    frames[frameCount][1] = buttons;
    frames[frameCount][2] = x;
    frames[frameCount][3] = y;
    frames[frameCount][4] = wheel;
    frameCount++;
    return 1;
}
uint8_t USB_queueConsumer(uint16_t usage) {
    assert(frameCount < 32);
    frames[frameCount][0] = 5;
    frames[frameCount][1] = usage;
    frames[frameCount][2] = usage >> 8;
    frameCount++;
    return 1;
}
void USB_discardReports(void) { frameCount = 0; }
uint8_t USB_reportGeneration(void) { return 0; }
uint8_t USB_reportsPending(void) { return 0; }
uint8_t USB_asciiUsage(uint8_t c) { return c == 'A' ? 0x84 : c; }
void USB_reportPoll(uint16_t now) { (void)now; }
void USBInit(void) {}
void USB_EP1_reset(void) {}
void USB_EP1_receiveReady(void) {}
void USB_setKeyboardLedStatus(uint8_t leds) { (void)leds; }
uint8_t USB_EP1_sendConfig(const uint8_t *reply) { (void)reply; return 1; }
void protocolReset(void) { resetPending = 1; }
void protocolInit(void) {
    memcpy(activeConfig, flash, CONFIG_SIZE);
    activeConfigValid = configValid(activeConfig, PHYSICAL_VARIANT);
    resetPending = 0;
}
void firmwareApplyConfig(void);
void protocolPoll(uint16_t now) {
    (void)now;
    if (resetPending) {
        firmwareApplyConfig();
        resetPending = 0;
    }
}
uint8_t protocolReceive(const uint8_t *packet) { (void)packet; return 0; }

#include "../CH552_Universal_Macropad.ino"

static void tick(uint16_t now) {
    currentMs = now;
    loop();
}

static void assertIndicatorLeds(uint8_t full, uint8_t lit, uint8_t held) {
    for (uint8_t i = 0; i < NUM_LEDS; i++) {
        // Key zero is held with its red per-key color. The indicator is amber.
        assert(ledData[3*i] == (lit ? (full ? 66 : 5) : 0));
        assert(ledData[3*i+1] == (lit ? (full ? 255 : 15) : (i == 0 && held ? 255 : 0)));
        assert(ledData[3*i+2] == 0);
    }
}

static void testStartupIndicatorEnumeration(void) {
    uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
    for (uint8_t layer = 0; layer < CONFIG_MAX_LAYERS; layer++) {
        for (uint8_t behavior = CONFIG_LAYER_INDICATOR_TIMED_ON;
             behavior <= CONFIG_LAYER_INDICATOR_BLINK_BY_LAYER; behavior++) {
            testLoadStarterProfile(PHYSICAL_VARIANT);
            for (uint8_t i = 1; i < CONFIG_MAX_LAYERS; i++) {
                memcpy(activeConfig + 9 + size * i, activeConfig + 9, size);
            }
            activeConfig[3] = (CONFIG_MAX_LAYERS - 1) | (layer << 3);
            activeConfig[9 + size * (layer + 1) - 1] =
                (3 << CONFIG_LAYER_OPT_COLOR_SHIFT) |
                (behavior << CONFIG_LAYER_OPT_INDICATOR_SHIFT);
            uint16_t crc = configCrc(activeConfig);
            activeConfig[6] = crc;
            activeConfig[7] = crc >> 8;
            memcpy(flash, activeConfig, CONFIG_SIZE);
            P1 = P3 = 0xFF;
            previewOptions = 0;
            UsbConfig = 0;
            currentMs = 0;
            indicatorRisingEdges = indicatorWasLit = 0;
            setup();
            assert(activeConfigValid && actionsLayer() == layer);
            assert(!layerIndicatorPhasesLeft && !indicatorRisingEdges);
            assertIndicatorLeds(0, 0, 0);

            // Bus resets before configuration must not flash the indicator.
            protocolReset(); tick(100);
            protocolReset(); tick(350);
            assert(!layerIndicatorPhasesLeft && !indicatorRisingEdges);
            assertIndicatorLeds(0, 0, 0);

            // SET_CONFIGURATION schedules the same main-loop config application.
            UsbConfig = 1;
            protocolReset(); tick(600);
            uint8_t timed = behavior == CONFIG_LAYER_INDICATOR_TIMED_ON;
            uint8_t phases = timed ? 6 : 2 * (layer + 1);
            assert(layerIndicatorPhasesLeft == phases);
            assertIndicatorLeds(0, 1, 0);
            for (uint8_t phase = 1; phase <= phases; phase++) {
                uint16_t deadline = 600 + 250 * phase;
                tick(deadline - 1);
                assert(layerIndicatorPhasesLeft == phases - phase + 1);
                tick(deadline);
                assertIndicatorLeds(0, (timed || !(phase & 1)) && phase < phases, 0);
            }
            tick(600 + 250 * (phases + 1));
            assert(!layerIndicatorPhasesLeft);
            assertIndicatorLeds(0, 0, 0);
            assert(indicatorRisingEdges == (timed ? 1 : layer + 1));
        }
    }
}

static void testIndicatorBrightness(void) {
    uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
    testLoadStarterProfile(PHYSICAL_VARIANT);
    for (uint8_t layer = 1; layer < CONFIG_MAX_LAYERS; layer++) {
        memcpy(activeConfig + 9 + size * layer, activeConfig + 9, size);
    }
    activeConfigValid = 1;
    P1 = P3 = 0xFF;
    P1 &= ~0x02; // Hold key zero throughout the animation.
    for (uint8_t layer = 0; layer < CONFIG_MAX_LAYERS; layer++) {
        activeConfig[3] = (CONFIG_MAX_LAYERS - 1) | (layer << 3); // Select each startup layer.
        for (uint8_t behavior = CONFIG_LAYER_INDICATOR_NONE;
             behavior <= CONFIG_LAYER_INDICATOR_ALWAYS_ON; behavior++) {
            for (uint8_t full = 0; full < 2; full++) {
                activeConfig[9 + size * (layer + 1) - 1] =
                    (3 << CONFIG_LAYER_OPT_COLOR_SHIFT) |
                    (behavior << CONFIG_LAYER_OPT_INDICATOR_SHIFT) | full;
                currentMs = 65500;
                firmwareApplyConfig();
                startLayerIndicator(layer, currentMs);
                if (behavior == CONFIG_LAYER_INDICATOR_NONE ||
                    behavior == CONFIG_LAYER_INDICATOR_ALWAYS_ON) {
                    assert(layerIndicatorPhasesLeft == 0);
                    // Always-on indicators leave the held key at full brightness.
                    assert(ledData[0] == 0 && ledData[1] == 255 && ledData[2] == 0);
                    for (uint8_t i = 1; i < NUM_LEDS; i++) {
                        assert(ledData[3*i] == (behavior ? (full ? 66 : 5) : 0));
                        assert(ledData[3*i+1] == (behavior ? (full ? 255 : 15) : 0));
                        assert(ledData[3*i+2] == 0);
                    }
                    continue;
                }
                uint8_t timed = behavior == CONFIG_LAYER_INDICATOR_TIMED_ON;
                uint8_t phases = timed ? 6 : 2 * (layer + 1);
                assert(layerIndicatorPhasesLeft == phases);
                assertIndicatorLeds(full, 1, 0);
                for (uint8_t phase = 1; phase <= phases; phase++) {
                    uint16_t deadline = (uint16_t)(65500u + 250u * phase);
                    serviceLayerIndicator((uint16_t)(deadline - 1));
                    assert(layerIndicatorPhasesLeft == phases - phase + 1);
                    serviceLayerIndicator(deadline);
                    assert(layerIndicatorPhasesLeft == phases - phase);
                    assertIndicatorLeds(full, (timed || !(phase & 1)) && phase < phases, phase == phases);
                }
                serviceLayerIndicator((uint16_t)(65500u + 250u * (phases + 1)));
                assertIndicatorLeds(full, 0, 1);
            }
        }
    }
    P1 = P3 = 0xFF;
}

static void testRainbowSpeed(void) {
    const uint8_t intervals[4] = {4, 6, 10, 18};
    for (uint8_t speed = 0; speed < 4; speed++) {
        for (uint8_t phase = 0; phase < 4; phase++) {
            for (uint8_t preview = 0; preview <= ENABLE_COLOR_PREVIEW; preview++) {
                testLoadStarterProfile(PHYSICAL_VARIANT);
                activeConfig[8] = 15 | (phase << CONFIG_HEADER_RAINBOW_PHASE_SHIFT) |
                    (speed << CONFIG_HEADER_RAINBOW_SPEED_SHIFT);
                assert(configChordWindowMs() == 75);
                activeConfig[9 + (PHYSICAL_VARIANT ? 15 : 22) - 1] = 0xFD;
                activeConfigValid = 1;
                P1 = P3 = 0xFF;
#if ENABLE_COLOR_PREVIEW
                previewOptions = 0;
#endif
                currentMs = 65520; // Exercise both the 8-bit and 16-bit timer wraps.
                firmwareApplyConfig();
#if ENABLE_COLOR_PREVIEW
                if (preview) {
                    firmwareLedAction(CONFIG_LED_SPEED_SET, 3 - speed);
                    firmwareLedAction(CONFIG_LED_PHASE_SET, (phase + 1) & 3);
                    firmwareLedAction(CONFIG_LED_BOTH_SET, 0);
                    firmwarePreviewColor(0xFD);
                }
#endif
                for (uint16_t step = 1; step <= 256; step++) {
                    uint16_t deadline = 65520U + step * intervals[speed];
                    tick(deadline - 1);
                    assert(rainbowHue == (uint8_t)(step - 1));
                    tick(deadline);
                    assert(rainbowHue == (uint8_t)step);
                }
#if ENABLE_COLOR_PREVIEW
                firmwarePreviewColor(0);
#endif
            }
        }
    }
}

static void testRainbowPhaseSpacing(void) {
    // Expected order follows the physical perimeter, rather than buffer order.
    const uint8_t positions[6] = {0, 1, 2, 5, 4, 3};
    const uint8_t steps[4] = {0, 21, 42, 109};
    uint8_t samples[256][NUM_BYTES];
    testLoadStarterProfile(PHYSICAL_VARIANT);
    activeConfigValid = 1;
    P1 = P3 = 0xFF;
#if ENABLE_COLOR_PREVIEW
    previewOptions = 0;
#endif
    firmwareApplyConfig();
    for (uint8_t full = 0; full < 2; full++) {
        activeConfig[9 + (PHYSICAL_VARIANT ? 15 : 22) - 1] = 0xFC | full;
        for (uint8_t phase = 0; phase < 4; phase++) {
            // All chord-window bits set: they must not affect phase extraction.
            activeConfig[8] = 15 | (phase << CONFIG_HEADER_RAINBOW_PHASE_SHIFT);
            ledSettings[0] = phase;
            assert(configChordWindowMs() == 75);
            for (uint16_t hue = 0; hue < 256; hue++) {
                rainbowHue = hue;
                updateLeds();
                memcpy(samples[hue], ledData, NUM_BYTES);
            }
            for (uint16_t hue = 0; hue < 256; hue++) {
                for (uint8_t i = 0; i < NUM_LEDS; i++) {
                    uint8_t shifted = hue + positions[i] * steps[phase];
                    assert(memcmp(samples[hue] + 3*i, samples[shifted], 3) == 0);
                    for (uint8_t channel = 0; channel < 3; channel++) {
                        int delta = samples[(hue+1)&255][3*i+channel] - samples[hue][3*i+channel];
                        assert(delta >= -(full ? 3 : 2) && delta <= (full ? 3 : 2));
                    }
                }
            }
            if (full) {
                assert(samples[0][1] == 255 && samples[0][0] == 0 && samples[0][2] == 0);
                assert(samples[85][2] == 255 && samples[85][0] == 0 && samples[85][1] == 0);
                assert(samples[170][0] == 255 && samples[170][1] == 0 && samples[170][2] == 0);
            }
#if ENABLE_COLOR_PREVIEW
            rainbowHue = 42;
            firmwarePreviewColor(0xFC | full);
            assert(memcmp(ledData, samples[42], NUM_BYTES) == 0);
            firmwarePreviewColor(0);
#endif
        }
    }
}

static void testRainbowDrift(void) {
    for (uint8_t phase = 0; phase < 4; phase++) {
        testLoadStarterProfile(PHYSICAL_VARIANT);
        activeConfig[8] = (phase << 4) | 0x40; // Fast.
        activeConfig[9 + (PHYSICAL_VARIANT ? 15 : 22) - 1] = 0xFD;
        activeConfigValid = 1;
        P1 = P3 = 0xFF;
#if ENABLE_COLOR_PREVIEW
        previewOptions = 0;
#endif
        currentMs = 65520;
        firmwareApplyConfig();
        uint8_t initial[NUM_BYTES], previous[NUM_BYTES];
        memcpy(initial, ledData, NUM_BYTES);
        for (uint16_t frame = 1; frame <= 1024; frame++) {
            memcpy(previous, ledData, NUM_BYTES);
            tick((uint16_t)(65520U + frame * 6));
            for (uint8_t j = 0; j < NUM_BYTES; j++) {
                int delta = ledData[j] - previous[j];
                assert(delta >= -6 && delta <= 6); // At most two hue steps.
            }
        }
        assert(rainbowHue == 0); // Compare matching points in the base cycle.
        if (phase == 3) {
            // The fastest drift completes a full turn; the others have not.
            assert(memcmp(initial, ledData, 3) == 0);
            for (uint8_t i = 1; i < NUM_LEDS; i++)
                assert(memcmp(initial + 3*i, ledData + 3*i, 3) != 0);
            // Verify the visible fast/slow layout, independently of the drift-slot map.
            const uint8_t positions[6] = {0, 1, 2, 5, 4, 3};
#if PHYSICAL_VARIANT == CONFIG_SIX_KEYS
            const uint8_t intervals[6] = {4, 32, 8, 64, 16, 128};
#else
            const uint8_t intervals[3] = {4, 16, 8};
#endif
            memcpy(previous, ledData, NUM_BYTES);
            ledSettings[0] = 0; // Use the renderer's unshifted wheel as the color reference.
            for (uint8_t i = 0; i < NUM_LEDS; i++) {
                rainbowHue = positions[i] * 109 + 1024 / intervals[i];
                updateLeds();
                assert(memcmp(previous + 3*i, ledData, 3) == 0);
            }
            rainbowHue = 0;
            ledSettings[0] = 3;
            updateLeds();
#if ENABLE_COLOR_PREVIEW
            memcpy(previous, ledData, NUM_BYTES);
            firmwareLedAction(CONFIG_LED_PHASE_SET, 0);
            firmwarePreviewColor(0xFD); // Saved scattered preset includes drift.
            assert(memcmp(previous, ledData, NUM_BYTES) == 0);
            firmwarePreviewColor(0);
#endif
        } else {
            assert(memcmp(initial, ledData, NUM_BYTES) == 0);
        }
        firmwareApplyConfig();
        assert(memcmp(initial, ledData, NUM_BYTES) == 0); // Reset restores start.
    }
}

static void testTransparencyAndRainbow(void) {
    uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
    uint8_t colorOffset = 9 + 2 * (NUM_LEDS + 3);
    uint8_t optionsOffset = 9 + size - 1;
    uint8_t before[NUM_BYTES];
    testLoadStarterProfile(PHYSICAL_VARIANT);
    activeConfigValid = 1;
    activeConfig[colorOffset] |= 15; // Key zero has an Off pressed color.
    P1 = P3 = 0xFF;
    P1 &= ~0x02;
    for (uint8_t full = 0; full < 2; full++) {
        activeConfig[optionsOffset] = 0x3C | full; // Always-on amber.
        activeConfig[5] &= ~CONFIG_HEADER_TRANSPARENT_BLACK;
        firmwareApplyConfig();
        assert(ledData[0] == 0 && ledData[1] == 0 && ledData[2] == 0);
        activeConfig[5] |= CONFIG_HEADER_TRANSPARENT_BLACK;
        updateLeds();
        assertIndicatorLeds(full, 1, 0);
        activeConfig[colorOffset] &= 0xF0; // A nonblack pressed color remains full brightness.
        updateLeds();
        assert(ledData[0] == 0 && ledData[1] == 255 && ledData[2] == 0);
        activeConfig[colorOffset] |= 15;
        // Transparency has no background to reveal in None mode.
        activeConfig[optionsOffset] = 0;
        updateLeds();
        for (uint8_t i = 0; i < NUM_BYTES; i++) assert(ledData[i] == 0);
        // Rainbow is identical whether the transparent key is held or idle.
        activeConfig[optionsOffset] = 0xFC | full;
        updateLeds();
        memcpy(before, ledData, NUM_BYTES);
        stableState[0] = 0;
        updateLeds();
        assert(memcmp(before, ledData, NUM_BYTES) == 0);
        stableState[0] = 1;
        activeConfig[5] &= ~CONFIG_HEADER_TRANSPARENT_BLACK;
        updateLeds();
        assert(ledData[0] == 0 && ledData[1] == 0 && ledData[2] == 0);
        // Timed Rainbow overrides an opaque black pressed key, then expires.
        activeConfig[optionsOffset] = 0xF4 | full;
        currentMs = 6000;
        firmwareApplyConfig();
        startLayerIndicator(0, currentMs);
        memcpy(before, ledData, NUM_BYTES);
        tick(6006);
        assert(memcmp(before, ledData, NUM_BYTES) != 0);
        if (!full) for (uint8_t i = 0; i < NUM_BYTES; i++) assert(ledData[i] <= 15);
        tick(6250);
        tick(6500);
        tick(6750);
        tick(7000);
        tick(7250);
        tick(7499);
        assert(layerIndicatorPhasesLeft == 1);
        tick(7500);
        assert(layerIndicatorPhasesLeft == 0);
        for (uint8_t i = 0; i < NUM_BYTES; i++) assert(ledData[i] == 0);
        tick(7506); // Rainbow service must not relight an expired indication.
        for (uint8_t i = 0; i < NUM_BYTES; i++) assert(ledData[i] == 0);
        // Rainbow numbered blinks animate while lit and stay dark while off.
        activeConfig[5] |= CONFIG_HEADER_TRANSPARENT_BLACK;
        activeConfig[optionsOffset] = 0xF8 | full;
        currentMs = 8000;
        firmwareApplyConfig();
        startLayerIndicator(0, currentMs);
        memcpy(before, ledData, NUM_BYTES);
        assert(ledData[0] || ledData[1] || ledData[2]);
        tick(8006);
        assert(memcmp(before, ledData, NUM_BYTES) != 0);
        if (!full) for (uint8_t i = 0; i < NUM_BYTES; i++) assert(ledData[i] <= 15);
        tick(8249);
        assert(layerIndicatorPhasesLeft == 2);
        tick(8250);
        assert(layerIndicatorPhasesLeft == 1);
        for (uint8_t i = 0; i < NUM_BYTES; i++) assert(ledData[i] == 0);
        tick(8256); // Rainbow updates must not relight the dark phase.
        for (uint8_t i = 0; i < NUM_BYTES; i++) assert(ledData[i] == 0);
        tick(8499);
        assert(layerIndicatorPhasesLeft == 1);
        tick(8500);
        assert(layerIndicatorPhasesLeft == 0);
        for (uint8_t i = 0; i < NUM_BYTES; i++) assert(ledData[i] == 0);
    }
    P1 = P3 = 0xFF;
}

static void testMomentaryIndicatorCancellation(void) {
    uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
    testLoadStarterProfile(PHYSICAL_VARIANT);
    memcpy(activeConfig + 9 + size, activeConfig + 9, size);
    activeConfig[3] = 1; // Two layers, starting on zero.
    activeConfig[9] = CONFIG_ACTION_MOMENTARY_LAYER;
    activeConfig[10] = 1;
    activeConfig[9 + size - 1] = 0x3C; // Always-on amber beneath the momentary layer.
    activeConfig[9 + 2 * size - 1] = 0xF4; // Timed Rainbow on the momentary layer.
    activeConfigValid = 1;
    P1 = P3 = 0xFF;
    currentMs = 8000;
    firmwareApplyConfig();
    assertIndicatorLeds(0, 1, 0);
    P1 &= ~0x02;
    rawState[0] = stableState[0] = 1;
    actionsPress(0, currentMs);
    tick(8000);
    assert(actionsLayer() == 1 && layerIndicatorPhasesLeft == 6);
    P1 |= 0x02;
    rawState[0] = stableState[0] = 0;
    actionsRelease(0);
    tick(8050);
    assert(actionsLayer() == 0 && layerIndicatorPhasesLeft == 0);
    assertIndicatorLeds(0, 1, 0);
    tick(8500); // The canceled Rainbow must not reappear at its former deadline.
    assertIndicatorLeds(0, 1, 0);
}

static void testSameLayerIndicator(void) {
    uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
    const uint8_t types[] = {CONFIG_ACTION_SET_LAYER, CONFIG_ACTION_RELATIVE_LAYER,
        CONFIG_ACTION_MOMENTARY_LAYER, 0x10 | CONFIG_ACTION_SET_LAYER,
        0x10 | CONFIG_ACTION_RELATIVE_LAYER};
    for (uint8_t i = 0; i < sizeof(types); i++) {
        testLoadStarterProfile(PHYSICAL_VARIANT);
        memset(activeConfig + 9, 0, CONFIG_SIZE - 9);
        activeConfig[9] = types[i];
        activeConfig[9 + size - 1] = 0x35; // Timed full-brightness amber.
        activeConfigValid = 1;
        P1 = P3 = 0xFF;
        currentMs = 10000;
        firmwareApplyConfig();
        actionsPress(0, currentMs);
        tick(10000);
        assert(actionsLayer() == 0 && layerIndicatorPhasesLeft == 6);
        assertIndicatorLeds(1, 1, 0);
        actionsRelease(0);
        tick(10250);
        tick(10500);
        tick(10750);
        tick(11000);
        tick(11250);
        tick(11500);
        assert(layerIndicatorPhasesLeft == 0);
        assertIndicatorLeds(1, 0, 0);
        actionsPress(0, 11600);
        tick(11600);
        assert(layerIndicatorPhasesLeft == 6);
        assertIndicatorLeds(1, 1, 0);
        actionsRelease(0);
    }
}

static void testOneShotChordIndicator(void) {
    uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
    uint8_t first = PHYSICAL_VARIANT ? 1 : 3;
    uint8_t second = first + 1;
    testLoadStarterProfile(PHYSICAL_VARIANT);
    memset(activeConfig + 9, 0, CONFIG_SIZE - 9);
    activeConfig[3] = 1;
    activeConfig[5] |= 2;
    activeConfig[8] = 10;
    activeConfig[9] = activeConfig[9 + size] = 0x10 | CONFIG_ACTION_SET_LAYER;
    activeConfig[10] = 1;
    activeConfig[9 + size - 1] = 0x87; // Timed cyan.
    activeConfig[9 + 2 * size - 1] = 0xD7; // Timed pink.
    activeConfig[9 + 2 * size] = PHYSICAL_VARIANT ? 0x82 : 0x8C;
    activeConfig[10 + 2 * size] = CONFIG_ACTION_RELATIVE_LAYER;
    activeConfig[11 + 2 * size] = 1;
    activeConfigValid = 1;
    P1 = P3 = 0xFF;
    currentMs = 20000;
    firmwareApplyConfig();
    actionsPress(0, 20000);
    actionsRelease(0);
    tick(20000);
    assert(actionsLayer() == 1 && layerIndicatorPhasesLeft == 6);
    assert(ledData[1] == 255 && ledData[2] == 72); // Pink.
    tick(20250);
    tick(20500);
    tick(20750);
    tick(21000);
    tick(21250);
    tick(21500);
    assert(layerIndicatorPhasesLeft == 0);
    actionsPress(first, 21600);
    tick(21600);
    assert(layerIndicatorPhasesLeft == 0);
    actionsPress(second, 21649);
    tick(21649);
    assert(actionsLayer() == 0 && layerIndicatorPhasesLeft == 6);
    assert(ledData[0] == 255 && ledData[1] == 0 && ledData[2] == 200); // Cyan.
    actionsRelease(first);
    actionsRelease(second);
}


#include "led_input_cases.h"

int main(void) {
    testStartupIndicatorEnumeration();
    testConsumedPhysicalInput();
    testTemporaryEffects();
    testTimedLighting();
    testLedControls();
    testSynchronizedBrightness();
    testSameLayerIndicator();
    testOneShotChordIndicator();
    testIndicatorBrightness();
    testRainbowSpeed();
    testRainbowPhaseSpacing();
    testRainbowDrift();
    testTransparencyAndRainbow();
    testMomentaryIndicatorCancellation();
    currentMs = 0;
    frameCount = 0;
    // Invalid flash lights only the first key and leaves physical inputs inactive.
    memset(flash, 0xFF, sizeof(flash));
    setup();
    assert(!activeConfigValid);
    assert(ledData[1] == 255);
    for (uint8_t i = 0; i < NUM_BYTES; i++) {
        assert(ledData[i] == (i == 1 ? 255 : 0));
    }
    P1 &= ~0x02;
    tick(499);
    assert(ledData[1] == 255 && frameCount == 0);
    tick(500);
    assert(ledData[1] == 0 && frameCount == 0);
    tick(1000);
    assert(ledData[1] == 255 && frameCount == 0);
    // A USB reset reapplies the error indicator and restarts its timer.
    currentMs = 65500;
    firmwareApplyConfig();
    tick(463);
    assert(ledData[1] == 255);
    tick(464);
    assert(ledData[1] == 0); // 500 ms, including the 16-bit timer wrap.

    // Applying a valid profile replaces the error light with normal layer LEDs.
    P1 = P3 = 0xFF;
    testLoadStarterProfile(PHYSICAL_VARIANT);
    activeConfigValid = 1;
    firmwareApplyConfig();
    for (uint8_t i = 0; i < NUM_BYTES; i++) {
        assert(ledData[i] == 0);
    }
    currentMs = 0;
    testLoadStarterProfile(PHYSICAL_VARIANT);
    memcpy(flash, activeConfig, CONFIG_SIZE);
    P1 = P3 = 0xFF;
    setup();
    assert(bytesWritten == (PHYSICAL_VARIANT ? 9 : 18));
    for (uint8_t i = 0; i < (PHYSICAL_VARIANT ? 9 : 18); i++) {
        assert(ledData[i] == 0);
    }
    frameCount = 0;
    assert((testP1ModOc & (PHYSICAL_VARIANT ? 0xC2 : 0xF2)) ==
           (PHYSICAL_VARIANT ? 0xC2 : 0xF2));

    P1 &= ~0x02;
    tick(0);
    tick(10);
    assert(frameCount == 1 && frames[0][0] == 1 && frames[0][3] == 0x29);
    assert(ledData[0] == 0 && ledData[1] == 255 && ledData[2] == 0);
    P1 |= 0x02;
    tick(11);
    tick(21);
    assert(frameCount == 2 && frames[1][3] == 0);
    assert(ledData[0] == 0 && ledData[1] == 0 && ledData[2] == 0);

    // An active profile change suppresses a key already held on the device.
    activeConfig[9] = CONFIG_ACTION_KEY_HOLD;
    activeConfig[10] = 0x04;
    P1 &= ~0x02;
    firmwareApplyConfig();
    tick(32);
    assert(frameCount >= 3);
    uint8_t releaseSeen = 0;
    for (uint8_t i = 0; i < frameCount; i++) {
        if (frames[i][0] == 1 && frames[i][3] == 0) {
            releaseSeen = 1;
        }
    }
    assert(releaseSeen);
    tick(3000); // Debounce does not turn a held-at-apply key into a press.
    assert(frames[frameCount - 1][3] == 0);
    P1 |= 0x02;
    tick(3010);
    tick(3020);
    assert(frames[frameCount - 1][3] == 0);

    firmwareApplyConfig();
    P3 = (P3 & ~0x03) | 0x03; // Start encoder at 11.
    encoderState = readEncoder();
    scanEncoder(); // Same state does not count.
    P3 = (P3 & ~0x03) | 0x01;
    scanEncoder();
    P3 &= ~0x03;
    scanEncoder();
    assert(encoderMovement == -2);
    firmwareApplyConfig();
    assert(encoderMovement == 0 && lastLayer == 0);

    activeConfig[30] = 2; // Bootloader hold is disabled on this layer.
    scanButton(configKeyCount(), 3100);
    assert(!allowRunBootloader);
#if ENABLE_COLOR_PREVIEW
    // Preview overrides held keys and restores the configured output on cancel.
    P1 = P3 = 0xFF;
    currentMs = 4000;
    firmwareApplyConfig();
    P1 &= ~0x02;
    firmwareApplyConfig();
    firmwarePreviewColor(0x85); // Full cyan on every LED.
    for (uint8_t i = 0; i < NUM_LEDS; i++) {
        assert(ledData[3*i] == 255 && ledData[3*i+1] == 0 && ledData[3*i+2] == 200);
    }
    tick(5000);
    assert(previewOptions == 0x85); // No timeout.
    firmwarePreviewColor(0);
    assert(ledData[1] == 255 && ledData[3] == 0);
    P1 |= 0x02;
    firmwareApplyConfig();
    firmwarePreviewColor(0x84); // Same dimming as an always-on layer indicator.
    assert(ledData[0] == 15 && ledData[2] == 13);
    firmwarePreviewColor(0xF5);
    for (uint8_t i = 0; i < NUM_BYTES; i++) assert(ledData[i] == 0);
    firmwarePreviewColor(0xFD);
    uint8_t prior[NUM_BYTES];
    memcpy(prior, ledData, NUM_BYTES);
    tick(5006);
    assert(memcmp(prior, ledData, NUM_BYTES) != 0 && previewOptions == 0xFD);
    firmwarePreviewColor(0xFC);
    for (uint8_t i = 0; i < NUM_BYTES; i++) assert(ledData[i] <= 15);
    // Even a debounced no-op press/release or a partial encoder turn cancels.
    activeConfig[9] = activeConfig[10] = 0;
    firmwarePreviewColor(5);
    P1 &= ~0x02;
    tick(5010);
    tick(5020);
    assert(previewOptions == 0);
    firmwarePreviewColor(5);
    P1 |= 0x02;
    tick(5021);
    tick(5031);
    assert(previewOptions == 0);
    firmwarePreviewColor(5);
    P3 &= ~1;
    tick(5032);
    assert(previewOptions == 0);
    firmwarePreviewColor(5);
    P3 &= ~8; // Encoder button.
    tick(5033);
    tick(5043);
    assert(previewOptions == 0);
    // Invalid flash still scans cancellation inputs, without emitting actions.
    activeConfigValid = 0;
    P1 = P3 = 0xFF;
    firmwareApplyConfig();
    firmwarePreviewColor(0xFD);
    tick(5050);
    assert(previewOptions == 0xFD);
    P1 &= ~0x02;
    tick(5051);
    tick(5061);
    assert(previewOptions == 0 && ledData[1] == 255);
    for (uint8_t i = 0; i < NUM_BYTES; i++) assert(ledData[i] == (i == 1 ? 255 : 0));
#endif
    // Startup recovery uses only the encoder, even with invalid flash or a
    // profile that disables runtime entry. Escape before the hardware jump.
    for (uint8_t valid = 0; valid < 2; valid++) {
        if (valid) {
            testLoadStarterProfile(PHYSICAL_VARIANT);
            activeConfig[30] &= ~CONFIG_LAYER_OPT_BOOTLOADER_RUN;
            memcpy(flash, activeConfig, CONFIG_SIZE);
        } else {
            memset(flash, 0xFF, sizeof(flash));
        }
        P1 = P3 = 0xFF;
        frameCount = 0;
        setup(); // Released encoder boots normally.
        encoderHeldAtStartup = 1;
        expectBootloader = 1;
        USB_CTRL = EA = TMOD = 1;
        if (setjmp(bootloaderJump) == 0) {
            setup();
            assert(0 && "Encoder held at startup must enter bootloader");
        }
        expectBootloader = 0;
        encoderHeldAtStartup = 0;
    }
    return 0;
}
