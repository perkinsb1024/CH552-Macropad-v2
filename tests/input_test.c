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
static uint8_t bootloaderWaits;
static uint8_t bootloaderRedShown;
// A held input reads low even when setup writes high to its pull-up latch.
static uint8_t encoderHeldAtStartup;
static uint8_t encoderStartupProbeActive;
static uint8_t encoderStartupReleaseAt;
static uint8_t encoderStartupReleaseFor;
static uint32_t encoderStartupStart;
static uint32_t encoderStartupEntryAt;
static uint8_t encoderStartupPin(void) {
    if (!encoderStartupProbeActive) return encoderHeldAtStartup ? 0 : ((P3 >> 3) & 1);
    uint32_t elapsed = currentMs - encoderStartupStart;
    return elapsed >= encoderStartupReleaseAt &&
           elapsed - encoderStartupReleaseAt < encoderStartupReleaseFor;
}
#undef P3_3
#define P3_3 encoderStartupPin()
static uint8_t frames[32][9];
static uint8_t frameCount;
static uint8_t bytesWritten;
static uint8_t indicatorRisingEdges;
static uint8_t indicatorWasLit;
#ifndef TEST_REAL_PROTOCOL
static uint8_t resetPending;
#endif
static uint8_t flash[CONFIG_SIZE];
#ifndef TEST_REAL_PROTOCOL
uint8_t activeConfigValid;
volatile uint8_t protocolState;
#endif

uint32_t millis(void) { return currentMs; }
void delayMicroseconds(uint16_t us) {
    if (us == 300) return; // LED latch wait does not advance the bootloader sequence.
    if (us == 1000) { currentMs++; return; }
    if (expectBootloader) {
        assert(us == 50000);
        assert(USB_CTRL == 0 && EA == 0 && TMOD == 0);
        if (encoderStartupProbeActive && !bootloaderWaits) encoderStartupEntryAt = currentMs;
        if (++bootloaderWaits == 1) return;
        assert(bootloaderWaits == 2);
        assert(bootloaderRedShown);
        bootloaderWaits = 0;
        bootloaderRedShown = 0;
        longjmp(bootloaderJump, 1);
    }
}
void neopixel_show_P3_4(uint8_t *data, uint8_t length) {
    if (bootloaderWaits) {
        assert(bootloaderWaits == 1);
        for (uint8_t i = 0; i < length; i++) {
            assert(data[i] == (i % 3 == 1 ? 255 : 0));
        }
        // The second wait must follow a transmitted red frame.
        bootloaderRedShown = 1;
    }
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
    if (!UsbConfig) return 0;
    assert(frameCount < 32);
    frames[frameCount][0] = 1;
    memcpy(frames[frameCount++] + 1, keys, 8);
    return 1;
}
uint8_t USB_queueMousePacked(uint8_t buttons, int8_t x, int8_t y, uint8_t scroll) {
    if (!UsbConfig) return 0;
    assert(frameCount < 32);
    frames[frameCount][0] = 2;
    frames[frameCount][1] = buttons;
    frames[frameCount][2] = x;
    frames[frameCount][3] = y;
    frames[frameCount][4] = scroll;
    frameCount++;
    return 1;
}
uint8_t USB_queueConsumer(uint16_t usage) {
    if (!UsbConfig) return 0;
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
#ifndef TEST_REAL_PROTOCOL
void protocolReset(void) { resetPending = 1; }
void protocolInit(void) {
    memcpy(activeConfig, flash, CONFIG_SIZE);
    activeConfigValid = configValid(activeConfig, PHYSICAL_VARIANT);
    resetPending = 0;
    protocolState = 0;
}
void firmwareApplyConfig(uint8_t restartIndicator);
void protocolPoll(uint16_t now) {
    (void)now;
    if (resetPending) {
        firmwareApplyConfig(0);
        resetPending = 0;
    }
}
uint8_t protocolReceive(const uint8_t *packet) { (void)packet; return 0; }
#endif

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

static void assertBlack(void) {
    for (uint8_t i = 0; i < NUM_BYTES; i++) assert(ledData[i] == 0);
}

static void assertUsbWarning(uint8_t lit) {
    for (uint8_t i = 0; i < NUM_BYTES; i++) {
        assert(ledData[i] == (lit && i < 2 ? 255 : 0));
    }
}

static void saveStartupProfile(void) {
    uint16_t crc = configCrc(activeConfig);
    activeConfig[CONFIG_HEADER_CRC] = crc;
    activeConfig[CONFIG_HEADER_CRC + 1] = crc >> 8;
    memcpy(flash, activeConfig, CONFIG_SIZE);
    P1 = P3 = 0xFF;
    previewOptions = 0;
    UsbConfig = 0;
    currentMs = 0;
    frameCount = 0;
}

static void testStartupIndicatorEnumeration(void) {
    uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
    const uint16_t enumerationTimes[] = {1, 499, 500, 800, 999, 1000, 1100, 2100};
    for (uint8_t layer = 0; layer < CONFIG_MAX_LAYERS; layer++) {
        for (uint8_t behavior = CONFIG_LAYER_INDICATOR_TIMED_ON;
             behavior <= CONFIG_LAYER_INDICATOR_ALWAYS_ON; behavior++) {
            for (uint8_t e = 0; e < sizeof(enumerationTimes) / sizeof(enumerationTimes[0]); e++) {
                testLoadStarterProfile(PHYSICAL_VARIANT);
                for (uint8_t i = 1; i < CONFIG_MAX_LAYERS; i++) {
                    memcpy(activeConfig + 9 + size * i, activeConfig + 9, size);
                }
                testSetLayout(CONFIG_MAX_LAYERS, layer, 0);
                activeConfig[9 + size * (layer + 1) - 1] =
                    (4 << CONFIG_LAYER_OPT_COLOR_SHIFT) |
                    (behavior << CONFIG_LAYER_OPT_INDICATOR_SHIFT);
                saveStartupProfile();
                indicatorRisingEdges = indicatorWasLit = 0;
                setup();
                assert(activeConfigValid && actionsLayer() == layer && startupWaiting);
                assertBlack();
                uint16_t enumeration = enumerationTimes[e];
                for (uint16_t now = 1; now < enumeration; now++) {
                    if (now == 100 || now == 350) protocolReset();
                    tick(now);
                    assertUsbWarning(now >= 1000 && !((now / 500) & 1));
                }
                assert(indicatorRisingEdges == (enumeration - 1) / 1000);
                indicatorRisingEdges = indicatorWasLit = 0;
                UsbConfig = 1;
                protocolReset();
                tick(enumeration);
                assert(!startupWaiting && !startupWarning);
                uint8_t timed = behavior == CONFIG_LAYER_INDICATOR_TIMED_ON;
                uint8_t always = behavior == CONFIG_LAYER_INDICATOR_ALWAYS_ON;
                uint8_t phases = always ? 0 : timed ? 6 : 2 * (layer + 1);
                assert(layerIndicatorPhasesLeft == phases);
                assertIndicatorLeds(0, 1, 0);
                for (uint16_t elapsed = 1; elapsed <= 250 * (phases + 1); elapsed++) {
                    // Later USB resets do not restart startup or indicator timing.
                    if (elapsed == 100 || elapsed == 350) protocolReset();
                    tick(enumeration + elapsed);
                    uint8_t completed = (((enumeration + elapsed) >> 1) - (enumeration >> 1)) / LAYER_INDICATOR_PHASE_TICKS;
                    assert(layerIndicatorPhasesLeft == (completed < phases ? phases - completed : 0));
                    assertIndicatorLeds(0, always || (completed < phases && (timed || !(completed & 1))), 0);
                }
                UsbConfig = 0;
                protocolReset();
                tick(enumeration + 250 * (phases + 1) + 1);
                tick(enumeration + 250 * (phases + 1) + 1001);
                assert(!startupWaiting && !layerIndicatorPhasesLeft);
                assertIndicatorLeds(0, always, 0);
                assert(indicatorRisingEdges == (timed || always ? 1 : layer + 1));
            }
        }
    }
    UsbConfig = 1;
}

static void testStartupWarningDismissal(void) {
    // Dismissal works during either blink phase, across the clock wrap, and
    // without enumeration. No tap/release/chord action escapes the dismissal.
    for (uint8_t dark = 0; dark < 2; dark++) {
        testLoadStarterProfile(PHYSICAL_VARIANT);
        uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
        memcpy(activeConfig + 9 + size, activeConfig + 9, size);
        testSetLayout(2, 0, 0); // Two layers; key 1 selects the second layer.
        activeConfig[9] = CONFIG_ACTION_SET_LAYER;
        activeConfig[10] = 1;
        saveStartupProfile();
        currentMs = 65500;
        setup();
        assertBlack();
        tick(463); assertBlack();
        assert(!startupWarning);
        tick(464); assertBlack(); // Warning begins with a 500ms dark phase.
        assert(startupWarning);
        tick(963); assertBlack();
        tick(964); assertUsbWarning(1); // First yellow at 1000ms, across wrap.
        if (dark) {
            tick(1463); assertUsbWarning(1);
            tick(1464); assertUsbWarning(0);
        }
        uint16_t press = dark ? 1465 : 965;
        P1 &= ~0x02;
        tick(press); tick(press + 9);
        assert(startupWaiting && frameCount == 0);
        tick(press + 10);
        assert(!startupWaiting && !startupWarning && frameCount == 0);
        assertIndicatorLeds(0, 0, 1); // Consumed press still has normal key LED feedback.
        assert(actionsLayer() == 0);
        tick(press + 100);
        P1 |= 0x02;
        tick(press + 101); tick(press + 111);
        assert(frameCount == 0);
        // A fresh press operates normally even before USB enumeration.
        P1 &= ~0x02;
        tick(press + 112); tick(press + 122); tick(press + 162);
        assert(actionsLayer() == 1 && frameCount == 0);
        P1 |= 0x02;
        tick(press + 163); tick(press + 173); tick(press + 200);
        UsbConfig = 1;
        protocolReset(); tick(press + 201);
        frameCount = 0;
        assert(!startupWaiting && !startupWarning);
        UsbConfig = 0;
        protocolReset(); tick(press + 202); tick(press + 1202);
        assert(!startupWaiting && !startupWarning);
    }
    // Presses before the warning do not dismiss it; other inputs stay inactive.
    testLoadStarterProfile(PHYSICAL_VARIANT);
    saveStartupProfile(); setup();
    P1 &= ~0x82;
    tick(100); tick(110);
    assert(startupWaiting && !startupWarning && frameCount == 0);
    tick(499);
    assert(startupWaiting && !startupWarning && frameCount == 0);
    tick(500); tick(810);
    assert(startupWaiting && startupWarning && frameCount == 0);
    assertBlack(); // Key 1 can dismiss during the first dark warning phase.
    P1 |= 0x02;
    tick(811); tick(821);
    P1 &= ~0x02;
    tick(822); tick(832);
    assert(!startupWaiting && frameCount == 0);
    P1 = P3 = 0xFF;
    UsbConfig = 1;
}

static void testStartupRainbowEnumeration(void) {
    testLoadStarterProfile(PHYSICAL_VARIANT);
    activeConfig[9 + (PHYSICAL_VARIANT ? 15 : 22) - 1] = 0xFD;
    saveStartupProfile(); setup();
    assertBlack();
    tick(100); assertBlack();
    UsbConfig = 1;
    protocolReset(); tick(100);
    assert(ledData[1] && !layerIndicatorPhasesLeft);
    tick(110);
    uint8_t hue = rainbowHue;
    uint8_t drift[NUM_LEDS];
    memcpy(drift, rainbowDrift, NUM_LEDS);
    uint8_t rendered[NUM_BYTES];
    memcpy(rendered, ledData, NUM_BYTES);
    protocolReset(); tick(110);
    assert(rainbowHue == hue && memcmp(drift, rainbowDrift, NUM_LEDS) == 0);
    assert(memcmp(rendered, ledData, NUM_BYTES) == 0);
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
        testSetLayout(CONFIG_MAX_LAYERS, layer, 0); // Select each startup layer.
        for (uint8_t behavior = CONFIG_LAYER_INDICATOR_NONE;
             behavior <= CONFIG_LAYER_INDICATOR_ALWAYS_ON; behavior++) {
            for (uint8_t full = 0; full < 2; full++) {
                activeConfig[9 + size * (layer + 1) - 1] =
                    (4 << CONFIG_LAYER_OPT_COLOR_SHIFT) |
                    (behavior << CONFIG_LAYER_OPT_INDICATOR_SHIFT) | full;
                currentMs = 65500;
                firmwareApplyConfig(1);
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

static void testHeaderLedSettings(void) {
    for (uint8_t phase = 0; phase < 4; phase++)
        for (uint8_t speed = 0; speed < 4; speed++)
            for (uint8_t transparent = 0; transparent < 2; transparent++) {
                testLoadStarterProfile(PHYSICAL_VARIANT);
                activeConfig[CONFIG_HEADER_LED] = 7 | (transparent << 3) | (phase << 4) | (speed << 6);
                activeConfigValid = 1; P1 = P3 = 0xFF;
#if ENABLE_COLOR_PREVIEW
                previewOptions = 0;
#endif
                firmwareApplyConfig(1);
                assert(ledSettings[0] == phase && ledSettings[1] == speed);
                firmwareLedAction(CONFIG_LED_PHASE_SET, (phase + 1) & 3);
                firmwareLedAction(CONFIG_LED_SPEED_SET, (speed + 1) & 3);
                firmwareLedAction(CONFIG_LED_PHASE_SET, 15);
                firmwareLedAction(CONFIG_LED_SPEED_SET, 15);
                assert(ledSettings[0] == phase && ledSettings[1] == speed);
                firmwareLedAction(CONFIG_LED_RESTORE, 0);
                assert(ledSettings[0] == phase && ledSettings[1] == speed);
#if ENABLE_COLOR_PREVIEW
                firmwareLedAction(CONFIG_LED_PHASE_SET, (phase + 1) & 3);
                firmwarePreviewColor(0xFD);
                assert(previewOptions == 0xFD && colorPreviewActive);
                firmwarePreviewColor(0);
                assert(!colorPreviewActive);
#endif
            }
}

static void testRainbowSpeed(void) {
    const uint8_t intervals[4] = {4, 6, 10, 18};
    for (uint8_t speed = 0; speed < 4; speed++) {
        for (uint8_t phase = 0; phase < 4; phase++) {
            for (uint8_t preview = 0; preview <= ENABLE_COLOR_PREVIEW; preview++) {
                testLoadStarterProfile(PHYSICAL_VARIANT);
                activeConfig[CONFIG_HEADER_LED] = 7 | (phase << CONFIG_HEADER_RAINBOW_PHASE_SHIFT) |
                    (speed << CONFIG_HEADER_RAINBOW_SPEED_SHIFT);
                testSetChordCount(1);
                assert(configChordWindowMs() == 90);
                activeConfig[9 + (PHYSICAL_VARIANT ? 15 : 22) - 1] = 0xFD;
                activeConfigValid = 1;
                P1 = P3 = 0xFF;
#if ENABLE_COLOR_PREVIEW
                previewOptions = 0;
#endif
                currentMs = 65520; // Exercise both the 8-bit and 16-bit timer wraps.
                firmwareApplyConfig(1);
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
    firmwareApplyConfig(1);
    for (uint8_t full = 0; full < 2; full++) {
        activeConfig[9 + (PHYSICAL_VARIANT ? 15 : 22) - 1] = 0xFC | full;
        for (uint8_t phase = 0; phase < 4; phase++) {
            // All chord-window bits set: they must not affect phase extraction.
            activeConfig[CONFIG_HEADER_LED] = 7 | (phase << CONFIG_HEADER_RAINBOW_PHASE_SHIFT);
            ledSettings[0] = phase;
            testSetChordCount(1);
                assert(configChordWindowMs() == 90);
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
        activeConfig[CONFIG_HEADER_LED] = (phase << 4) | 0x40; // Fast.
        activeConfig[9 + (PHYSICAL_VARIANT ? 15 : 22) - 1] = 0xFD;
        activeConfigValid = 1;
        P1 = P3 = 0xFF;
#if ENABLE_COLOR_PREVIEW
        previewOptions = 0;
#endif
        currentMs = 65520;
        firmwareApplyConfig(1);
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
        firmwareApplyConfig(1);
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
    activeConfig[colorOffset] &= 0xF0; // Key zero has an Off pressed color.
    P1 = P3 = 0xFF;
    P1 &= ~0x02;
    for (uint8_t full = 0; full < 2; full++) {
        activeConfig[optionsOffset] = 0x4C | full; // Always-on amber.
        activeConfig[CONFIG_HEADER_LED] &= ~CONFIG_HEADER_TRANSPARENT_BLACK;
        firmwareApplyConfig(1);
        assert(ledData[0] == 0 && ledData[1] == 0 && ledData[2] == 0);
        activeConfig[CONFIG_HEADER_LED] |= CONFIG_HEADER_TRANSPARENT_BLACK;
        updateLeds();
        assertIndicatorLeds(full, 1, 0);
        activeConfig[colorOffset] = (activeConfig[colorOffset] & 0xF0) | 1; // A nonblack pressed color remains full brightness.
        updateLeds();
        assert(ledData[0] == 0 && ledData[1] == 255 && ledData[2] == 0);
        activeConfig[colorOffset] &= 0xF0;
        // Transparency has no background to reveal in None mode.
        activeConfig[optionsOffset] = 0x10;
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
        activeConfig[CONFIG_HEADER_LED] &= ~CONFIG_HEADER_TRANSPARENT_BLACK;
        updateLeds();
        assert(ledData[0] == 0 && ledData[1] == 0 && ledData[2] == 0);
        // Timed Rainbow overrides an opaque black pressed key, then expires.
        activeConfig[optionsOffset] = 0xF4 | full;
        currentMs = 6000;
        firmwareApplyConfig(1);
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
        activeConfig[CONFIG_HEADER_LED] |= CONFIG_HEADER_TRANSPARENT_BLACK;
        activeConfig[optionsOffset] = 0xF8 | full;
        currentMs = 8000;
        firmwareApplyConfig(1);
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
    testSetLayout(2, 0, 0); // Two layers, starting on zero.
    activeConfig[9] = CONFIG_ACTION_MOMENTARY_LAYER;
    activeConfig[10] = 1;
    activeConfig[9 + size - 1] = 0x4C; // Always-on amber beneath the momentary layer.
    activeConfig[9 + 2 * size - 1] = 0xF4; // Timed Rainbow on the momentary layer.
    activeConfigValid = 1;
    P1 = P3 = 0xFF;
    currentMs = 8000;
    firmwareApplyConfig(1);
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
        activeConfig[9 + size - 1] = 0x45; // Timed full-brightness amber.
        activeConfigValid = 1;
        P1 = P3 = 0xFF;
        currentMs = 10000;
        firmwareApplyConfig(1);
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
    testSetLayout(2, 0, 0);
    testSetChordCount(1);
    activeConfig[CONFIG_HEADER_LED] = 3;
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
    firmwareApplyConfig(1);
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

static void testRuntimeHoldDoesNotEnterBootloader(void) {
    const uint8_t optionsOffset = PHYSICAL_VARIANT ? 23 : 30;
    for (uint8_t mode = 0; mode < 5; mode++) {
        testLoadStarterProfile(PHYSICAL_VARIANT);
        activeConfig[optionsOffset] = (activeConfig[optionsOffset] & ~2) | (mode == 4 ? 2 : 0);
        uint16_t crc = configCrc(activeConfig);
        activeConfig[CONFIG_HEADER_CRC] = crc;
        activeConfig[CONFIG_HEADER_CRC + 1] = crc >> 8;
        if (mode == 0) memset(activeConfig, 0xFF, CONFIG_SIZE);
        if (mode == 1) activeConfig[CONFIG_HEADER_VERSION] = 11;
        if (mode == 2) activeConfig[0] = 0;
        activeConfigValid = configValid(activeConfig, PHYSICAL_VARIANT);
        assert(activeConfigValid == (mode >= 3));
        actionsClear();
        frameCount = 0;
        P1 = P3 = 0xFF;
        currentMs = 65000;
        firmwareApplyConfig(1);
        expectBootloader = 1;
        if (setjmp(bootloaderJump) != 0) assert(0 && "Runtime encoder hold must not enter bootloader");
        P3 &= ~8;
        tick(65010);
        tick(65020);
        assert(stableState[NUM_LEDS]);
        tick(2484); // Held 3,000ms, across the low-word clock wrap.
        tick(12484);
        assert(stableState[NUM_LEDS]);
        expectBootloader = 0;
        P3 |= 8;
        tick(12485);
        tick(12495);
        assert(!stableState[NUM_LEDS]);
    }
    P1 = P3 = 0xFF;
}

static void testHidBootloaderHandoff(void) {
    P1 = P3 = 0xFF;
    currentMs = 100;
    firmwareApplyConfig(1);
    protocolState = 3;
    expectBootloader = 1;
    USB_CTRL = EA = TMOD = 1;
    if (setjmp(bootloaderJump) == 0) {
        loop();
        assert(0 && "Acknowledged HID request must enter bootloader");
    }
    expectBootloader = 0;
    protocolState = 0;
    for (uint8_t i = 0; i < NUM_LEDS; i++) {
        assert(ledData[3*i] == 0 && ledData[3*i+1] == 255 && ledData[3*i+2] == 0);
    }
}

static void checkStartupDebounce(uint8_t invalid, uint32_t start,
                                 uint8_t releaseAt, uint8_t releaseFor) {
    testLoadStarterProfile(PHYSICAL_VARIANT);
    saveStartupProfile();
    if (invalid) memset(flash, 0xFF, sizeof(flash));
    currentMs = encoderStartupStart = start;
    encoderStartupReleaseAt = releaseAt;
    encoderStartupReleaseFor = releaseFor;
    encoderStartupProbeActive = expectBootloader = 1;
    encoderStartupEntryAt = UINT32_MAX;
    USB_CTRL = EA = TMOD = 1;
    if (setjmp(bootloaderJump) == 0) {
        setup();
        assert(releaseAt <= DEBOUNCE_MS);
        assert(encoderStartupEntryAt == UINT32_MAX);
        assert(currentMs - start == releaseAt);
        // Rejecting startup never arms bootloader entry on a later runtime hold.
        encoderStartupProbeActive = 0;
        UsbConfig = 1;
        tick((uint16_t)(start + 20));
        P3 &= ~8;
        tick((uint16_t)(start + 21));
        tick((uint16_t)(start + 31));
        tick((uint16_t)(start + 3031));
    } else {
        assert(releaseAt > DEBOUNCE_MS);
        assert(encoderStartupEntryAt - start == DEBOUNCE_MS);
    }
    assert(activeConfigValid == !invalid);
    expectBootloader = encoderStartupProbeActive = 0;
    encoderHeldAtStartup = 0;
    P1 = P3 = 0xFF;
}

static void testStartupDebounce(void) {
    const uint32_t starts[] = {0, 250, 65530, UINT32_MAX - 5};
    for (uint8_t invalid = 0; invalid < 2; invalid++) {
        for (uint8_t start = 0; start < sizeof(starts) / sizeof(starts[0]); start++) {
            for (uint8_t release = 0; release <= DEBOUNCE_MS; release++) {
                checkStartupDebounce(invalid, starts[start], release, 255);
                checkStartupDebounce(invalid, starts[start], release, 1);
            }
            checkStartupDebounce(invalid, starts[start], 255, 1);
        }
    }
}

static void advanceSleep(uint32_t fineTicks) {
    while (fineTicks) {
        uint8_t step = fineTicks > 128 ? 128 : fineTicks;
        currentMs += (uint32_t)step * 16;
        actionsTimedPoll((uint16_t)currentMs >> 4);
        fineTicks -= step;
    }
}

static void initAutoSleep(void) {
    testLoadStarterProfile(PHYSICAL_VARIANT);
    activeConfig[9 + (PHYSICAL_VARIANT ? 15 : 22) - 1] =
        CONFIG_LAYER_OPT_AUTO_SLEEP | CONFIG_LAYER_OPT_FULL_BRIGHTNESS |
        (CONFIG_LAYER_INDICATOR_ALWAYS_ON << CONFIG_LAYER_OPT_INDICATOR_SHIFT) |
        (4 << CONFIG_LAYER_OPT_COLOR_SHIFT);
    activeConfigValid = 1;
    P1 = P3 = 0xFF; UsbConfig = 1;
    startupWaiting = startupWarning = 0;
    currentMs = 0; previewOptions = 0; frameCount = 0;
    firmwareApplyConfig(1);
    actionsPoll(0); frameCount = 0;
}

static void testAutoSleepInput(void) {
    const uint32_t interval = 440UL * 256;
    for (uint8_t input = 0; input < 3; input++) {
        initAutoSleep();
        advanceSleep(interval - 1); assert(ledSettings[2] == 3);
        advanceSleep(1); assertBlack();
        assert(ledSettings[2] == 0 && ledSettings[3] == 0);
        if (input == 2) activeConfig[9] = activeConfig[10] = 0; // Unbound key wakes too.
        uint8_t index = input == 1 ? NUM_LEDS : 0;
        if (input == 1) P3 &= ~8; else P1 &= ~2;
        scanButton(index, currentMs);
        currentMs += DEBOUNCE_MS;
        scanButton(index, currentMs);
        actionsPoll(currentMs);
        assert(ledSettings[2] == 3 && ledSettings[3] == 3 && frameCount == 0);
        if (input == 1) P3 |= 8; else P1 |= 2;
        scanButton(index, currentMs);
        currentMs += DEBOUNCE_MS; scanButton(index, currentMs);
        actionsPoll(currentMs); assert(frameCount == 0); // Release is consumed.
        if (input != 2) {
            if (input == 1) P3 &= ~8; else P1 &= ~2;
            scanButton(index, currentMs); currentMs += DEBOUNCE_MS;
            scanButton(index, currentMs); actionsPoll(currentMs);
            assert(frameCount > 0); // Next ordinary press still works.
        }
    }
    for (uint8_t clockwise = 0; clockwise < 2; clockwise++) {
        initAutoSleep(); advanceSleep(interval);
        const uint8_t forward[] = {2, 0, 1, 3};
        const uint8_t backward[] = {1, 0, 2, 3};
        for (uint8_t step = 0; step < 4; step++) {
            P3 = (P3 & ~3) | (clockwise ? forward[step] : backward[step]);
            scanEncoder();
            if (step < 3) assert(ledSettings[2] == 0); // Partial turns don't wake.
        }
        assert(ledSettings[2] == 3 && ledSettings[3] == 3);
        actionsPoll(currentMs); assert(frameCount == 0);
        for (uint8_t step = 0; step < 4; step++) {
            P3 = (P3 & ~3) | (clockwise ? forward[step] : backward[step]);
            scanEncoder();
        }
        actionsPoll(currentMs); assert(frameCount > 0);
    }
    initAutoSleep();
    // A held no-op key and its release do not keep the timer awake.
    activeConfig[9] = activeConfig[10] = 0;
    P1 &= ~2; scanButton(0, 0); scanButton(0, DEBOUNCE_MS);
    advanceSleep(interval); assertBlack();
    P1 |= 2; scanButton(0, currentMs); scanButton(0, currentMs + DEBOUNCE_MS);
    assertBlack();
    firmwareApplyConfig(0); assert(ledSettings[2] == 3);
    assert(!actionsTimedInput());
}

static void testAutoSleepDisabledLayer(void) {
    const uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
    const uint32_t interval = 220UL * 256;
    for (uint8_t dim = 0; dim < 2; dim++) {
        for (uint8_t afterSleep = 0; afterSleep < 2; afterSleep++) {
            initAutoSleep();
            testSetLayout(2, 0, 1);
            activeConfig[CONFIG_HEADER_SLEEP] = CONFIG_SLEEP_CONSUME |
                CONFIG_SLEEP_INDICATOR | (dim ? CONFIG_SLEEP_DIM : 0);
            activeConfig[9 + 2 * size - 1] =
                activeConfig[9 + size - 1] & ~CONFIG_LAYER_OPT_AUTO_SLEEP;
            uint8_t timer = configTimedOffset();
            // Switch just before or just after the 15-minute sleep timeout.
            activeConfig[timer] = afterSleep ? 220 : 218;
            activeConfig[timer + 1] = CONFIG_ACTION_SET_LAYER;
            activeConfig[timer + 2] = 1;
            activeConfig[timer + 3] = activeConfig[timer + 4] = activeConfig[timer + 5] = 0;
            firmwareApplyConfig(1);
            if (afterSleep) {
                advanceSleep(interval);
                assert(ledSettings[2] == (dim ? 1 : 0));
                if (!dim) assertBlack();
                advanceSleep(256);
            } else advanceSleep(interval - 256);
            actionsPoll(currentMs);
            assert(actionsLayer() == 1);
            assert(ledSettings[2] == 3 && ledSettings[3] == 3);
            uint8_t lit = 0;
            for (uint8_t i = 0; i < NUM_BYTES; i++) lit |= ledData[i];
            assert(lit); // Always On indicator is visible in both cases.
            assert(!actionsTimedInput()); // Wake no longer consumes physical input.
            advanceSleep(interval * 2);
            assert(ledSettings[2] == 3 && ledSettings[3] == 3);
            // Return without physical input; a full fresh timeout must elapse.
            activeConfig[9 + size + 2 * (NUM_LEDS + 2)] = CONFIG_ACTION_SET_LAYER;
            activeConfig[10 + size + 2 * (NUM_LEDS + 2)] = 0;
            actionsRotate(0);
            assert(actionsLayer() == 0);
            activeConfig[timer + 1] = CONFIG_ACTION_NONE;
            activeConfig[timer + 2] = 0; // Stop selecting layer 2 again.
            advanceSleep(interval - 1); assert(ledSettings[2] == 3);
            advanceSleep(1); assert(ledSettings[2] == (dim ? 1 : 0));
        }
    }
}

static void testAutoSleepWakeIndicator(void) {
    const uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
    for (uint8_t layer = 0; layer < CONFIG_MAX_LAYERS; layer++) {
        for (uint8_t behavior = 0; behavior < 4; behavior++) {
            for (uint8_t full = 0; full < 2; full++) {
                for (uint8_t input = 0; input < 4; input++) {
                  for (uint8_t show = 0; show < 2; show++) {
                    initAutoSleep();
                    memset(activeConfig + 9, 0, CONFIG_SIZE - 9);
                    testSetLayout(CONFIG_MAX_LAYERS, layer, 0);
                    activeConfig[CONFIG_HEADER_LED] |= CONFIG_HEADER_TRANSPARENT_BLACK;
                    memset(activeConfig + 9 + size * layer + 2 * (NUM_LEDS + 3),
                           0, (NUM_LEDS + 1) / 2); // Suppress held-key feedback.
                    activeConfig[9 + size * (layer + 1) - 1] =
                        CONFIG_LAYER_OPT_AUTO_SLEEP | full |
                        (behavior << CONFIG_LAYER_OPT_INDICATOR_SHIFT) |
                        (4 << CONFIG_LAYER_OPT_COLOR_SHIFT);
                    if (!show) activeConfig[CONFIG_HEADER_SLEEP] &= ~CONFIG_SLEEP_INDICATOR;
                    firmwareApplyConfig(1);
                    // Finish the startup indication before sleeping.
                    for (uint16_t now = 0; now <= 4000; now++) tick(now);
                    assert(layerIndicatorPhasesLeft == 0);
                    frameCount = 0; // Discard configuration-apply neutral reports.
                    advanceSleep(440UL * 256);
                    assertBlack();
                    indicatorRisingEdges = indicatorWasLit = 0;
                    if (input < 2) {
                        if (input) P3 &= ~8; else P1 &= ~2;
                        tick((uint16_t)currentMs);
                        tick((uint16_t)(currentMs + DEBOUNCE_MS));
                    } else {
                        const uint8_t forward[] = {2, 0, 1, 3};
                        const uint8_t backward[] = {1, 0, 2, 3};
                        for (uint8_t step = 0; step < 4; step++) {
                            P3 = (P3 & ~3) | (input == 2 ? forward[step] : backward[step]);
                            tick((uint16_t)currentMs);
                            if (step < 3) assertBlack();
                        }
                    }
                    uint16_t wake = currentMs;
                    uint8_t timed = show && behavior == CONFIG_LAYER_INDICATOR_TIMED_ON;
                    uint8_t blink = show && behavior == CONFIG_LAYER_INDICATOR_BLINK_BY_LAYER;
                    uint8_t always = behavior == CONFIG_LAYER_INDICATOR_ALWAYS_ON;
                    uint8_t phases = timed ? 6 : blink ? 2 * (layer + 1) : 0;
                    assert(actionsLayer() == layer && frameCount == 0);
                    assert(layerIndicatorPhasesLeft == phases);
                    assertIndicatorLeds(full, timed || blink || always, 0);
                    for (uint16_t elapsed = 1; elapsed <= 250 * (phases + 1); elapsed++) {
                        // Release does not restart the reminder or execute a binding.
                        if (elapsed == 25) P1 = P3 = 0xFF;
                        tick(wake + elapsed);
                        uint8_t completed = (((wake + elapsed) >> 1) - (wake >> 1)) /
                                            LAYER_INDICATOR_PHASE_TICKS;
                        assert(layerIndicatorPhasesLeft == (completed < phases ? phases - completed : 0));
                        assertIndicatorLeds(full, always ||
                            (completed < phases && (timed || !(completed & 1))), 0);
                        assert(actionsLayer() == layer && frameCount == 0);
                    }
                    assert(indicatorRisingEdges == (timed || always ? 1 : blink ? layer + 1 : 0));
                    assert(!actionsTimedInput());
                    assert(!actionsTakeLayerSelection());
                  }
                }
            }
        }
    }
}

static void wakeSleepInput(uint8_t input) {
    if (input < 2) {
        uint8_t index = input ? NUM_LEDS : 0;
        if (input) P3 &= ~8; else P1 &= ~2;
        scanButton(index, currentMs);
        currentMs += DEBOUNCE_MS;
        scanButton(index, currentMs);
    } else {
        const uint8_t forward[] = {2, 0, 1, 3};
        const uint8_t backward[] = {1, 0, 2, 3};
        for (uint8_t step = 0; step < 4; step++) {
            P3 = (P3 & ~3) | (input == 2 ? forward[step] : backward[step]);
            scanEncoder();
        }
    }
    actionsPoll(currentMs);
}

static void testSleepSettingsInput(void) {
    static const uint16_t intervals[] = {220, 440, 879, 1758};
    for (uint8_t settings = 0; settings < 32; settings++) {
        for (uint8_t input = 0; input < 4; input++) {
            initAutoSleep();
            activeConfig[CONFIG_HEADER_SLEEP] = settings;
            // Every physical wake binding sets key feedback to Dim, proving
            // wake restores configured policies before executing the binding.
            uint8_t slot = input ? NUM_LEDS + input - 1 : 0;
            activeConfig[9 + 2 * slot] = 0x10 | CONFIG_ACTION_LED_CONTROL;
            activeConfig[10 + 2 * slot] = CONFIG_LED_KEY_SET;
            firmwareApplyConfig(1);
            advanceSleep((uint32_t)intervals[settings & 3] * 256);
            assert(ledSettings[2] == ((settings & CONFIG_SLEEP_DIM) ? 1 : 0));
            assert(ledSettings[3] == ledSettings[2]);
            if (settings & CONFIG_SLEEP_DIM) assertIndicatorLeds(0, 1, 0);
            else assertBlack();
            wakeSleepInput(input);
            assert(ledSettings[2] == 3);
            assert(ledSettings[3] == ((settings & CONFIG_SLEEP_CONSUME) ? 3 : 1));
            if (input < 2) {
                P1 = P3 = 0xFF;
                scanButton(input ? NUM_LEDS : 0, currentMs);
                currentMs += DEBOUNCE_MS;
                scanButton(input ? NUM_LEDS : 0, currentMs);
                actionsPoll(currentMs);
                // A consumed press and release leave the next binding intact.
                wakeSleepInput(input); assert(ledSettings[3] == 1);
            }
        }
    }
    // Executing a wake key uses and returns from the armed one-shot layer;
    // consuming it leaves the one-shot ready for the next ordinary input.
    for (uint8_t consume = 0; consume < 2; consume++) {
        initAutoSleep();
        uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
        testSetLayout(2, 0, 0);
        activeConfig[CONFIG_HEADER_SLEEP] = consume ? CONFIG_SLEEP_CONSUME : 0;
        activeConfig[9] = 0x10 | CONFIG_ACTION_SET_LAYER; activeConfig[10] = 1;
        activeConfig[9 + size] = CONFIG_ACTION_KEY_HOLD; activeConfig[10 + size] = 4;
        activeConfig[9 + 2 * size - 1] = 0x10 | CONFIG_LAYER_OPT_AUTO_SLEEP;
        firmwareApplyConfig(1);
        actionsPress(0, 0); actionsRelease(0); assert(actionsLayer() == 1);
        advanceSleep(220UL * 256); frameCount = 0;
        wakeSleepInput(0);
        assert(actionsLayer() == (consume ? 1 : 0));
        assert(!!frameCount == !consume);
        if (!consume) assert(frames[frameCount - 1][3] == 4);
        P1 = P3 = 0xFF; scanButton(0, currentMs);
        currentMs += DEBOUNCE_MS; scanButton(0, currentMs); actionsPoll(currentMs);
        if (!consume) assert(frames[frameCount - 1][3] == 0);
    }
}

int main(void) {
    testAutoSleepInput();
    testAutoSleepDisabledLayer();
    testSleepSettingsInput();
    testAutoSleepWakeIndicator();
    testStartupDebounce();
    testStartupIndicatorEnumeration();
    testStartupWarningDismissal();
    testStartupRainbowEnumeration();
    testConsumedPhysicalInput();
    testTemporaryEffects();
    testTimedLighting();
    testLedControls();
    testSynchronizedBrightness();
    testSameLayerIndicator();
    testOneShotChordIndicator();
    testIndicatorBrightness();
    testHeaderLedSettings();
    testRainbowSpeed();
    testRainbowPhaseSpacing();
    testRainbowDrift();
    testTransparencyAndRainbow();
    testMomentaryIndicatorCancellation();
    testRuntimeHoldDoesNotEnterBootloader();
    testHidBootloaderHandoff();
    currentMs = 0;
    frameCount = 0;
    // Invalid flash lights only the first key and leaves physical inputs inactive.
    memset(flash, 0xFF, sizeof(flash));
    UsbConfig = 0;
    setup();
    assert(!activeConfigValid && !startupWaiting);
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
    firmwareApplyConfig(1);
    tick(463);
    assert(ledData[1] == 255);
    tick(464);
    assert(ledData[1] == 0); // 500 ms, including the 16-bit timer wrap.

    UsbConfig = 1;
    // Applying a valid profile replaces the error light with normal layer LEDs.
    P1 = P3 = 0xFF;
    testLoadStarterProfile(PHYSICAL_VARIANT);
    activeConfigValid = 1;
    firmwareApplyConfig(1);
    for (uint8_t i = 0; i < NUM_BYTES; i++) {
        assert(ledData[i] == 0);
    }
    currentMs = 0;
    testLoadStarterProfile(PHYSICAL_VARIANT);
    memcpy(flash, activeConfig, CONFIG_SIZE);
    P1 = P3 = 0xFF;
    setup();
    tick(0); // Observe successful enumeration before normal input tests.
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
    firmwareApplyConfig(1);
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

    firmwareApplyConfig(1);
    P3 = (P3 & ~0x03) | 0x03; // Start encoder at 11.
    encoderState = readEncoder();
    scanEncoder(); // Same state does not count.
    P3 = (P3 & ~0x03) | 0x01;
    scanEncoder();
    P3 &= ~0x03;
    scanEncoder();
    assert(encoderMovement == -2);
    firmwareApplyConfig(1);
    assert(encoderMovement == 0 && lastLayer == 0);

#if ENABLE_COLOR_PREVIEW
    // Preview overrides held keys and restores the configured output on cancel.
    P1 = P3 = 0xFF;
    currentMs = 4000;
    firmwareApplyConfig(1);
    P1 &= ~0x02;
    firmwareApplyConfig(1);
    firmwarePreviewColor(0x85); // Full cyan on every LED.
    for (uint8_t i = 0; i < NUM_LEDS; i++) {
        assert(ledData[3*i] == 255 && ledData[3*i+1] == 0 && ledData[3*i+2] == 200);
    }
    tick(5000);
    assert(previewOptions == 0x85); // No timeout.
    firmwarePreviewColor(0);
    assert(ledData[1] == 255 && ledData[3] == 0);
    P1 |= 0x02;
    firmwareApplyConfig(1);
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
    firmwareApplyConfig(1);
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
            activeConfig[30] &= ~CONFIG_LAYER_OPT_AUTO_SLEEP;
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
