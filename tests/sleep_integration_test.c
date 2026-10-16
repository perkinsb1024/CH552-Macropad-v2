/* Real sketch, timer dispatcher, protocol and storage; only hardware is stubbed. */
#define TEST_REAL_PROTOCOL 1
#include "../src/protocol_firmware.h"
#define main inputRegressionMain
#include "input_test.c"
#undef main

void eeprom_write_byte(uint8_t offset, uint8_t value) { flash[offset] = value; }

static void sleepRequest(uint8_t opcode, uint8_t offset) {
    uint8_t packet[32] = {3, 'U', 'M', 1};
    packet[4] = opcode;
    packet[5] = 42;
    packet[6] = offset;
    if (opcode == 4) packet[7] = 23;
    assert(protocolReceive(packet));
}

static void checkSleepReply(void) {
    assert(!protocolState);
    extern uint8_t protocolReply[32];
    assert(protocolReply[0] == 4 && protocolReply[5] == 42);
    assert(protocolReply[8] == 0);
}

static void initSleepProfile(uint8_t layer, uint8_t timeout, uint32_t start) {
    const uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
    initAutoSleep();
    // Match the reported profile's sleep and lighting on both layers:
    // Off key colors, always-on Rainbow/solid color, full brightness, no user timers.
    testSetLayout(2, layer, 0);
    activeConfig[CONFIG_HEADER_SLEEP] = timeout | CONFIG_SLEEP_CONSUME | CONFIG_SLEEP_INDICATOR;
    for (uint8_t i = 0; i < 2; i++) {
        uint8_t base = 9 + i * size;
        memset(activeConfig + base, 0, size);
#if CONFIG_VERSION == 15
        // V15 uses palette index 15 for Off in pressed-key colors.
        for (uint8_t key = 0; key < NUM_LEDS; key++)
            activeConfig[base + 2 * (NUM_LEDS + 3) + (key >> 1)] |= 15 << ((key & 1) * 4);
#endif
        activeConfig[base + 2 * NUM_LEDS] = CONFIG_ACTION_RELATIVE_LAYER;
        activeConfig[base + 2 * NUM_LEDS + 1] = 1;
        activeConfig[base + size - 1] = CONFIG_LAYER_OPT_AUTO_SLEEP |
            CONFIG_LAYER_OPT_FULL_BRIGHTNESS |
            (CONFIG_LAYER_INDICATOR_ALWAYS_ON << CONFIG_LAYER_OPT_INDICATOR_SHIFT) |
            ((i ? 1 : 15) << CONFIG_LAYER_OPT_COLOR_SHIFT);
    }
    uint16_t crc = configCrc(activeConfig);
    activeConfig[CONFIG_HEADER_CRC] = crc;
    activeConfig[CONFIG_HEADER_CRC + 1] = crc >> 8;
    assert(configValid(activeConfig, PHYSICAL_VARIANT));
    memcpy(flash, activeConfig, CONFIG_SIZE);
    currentMs = start;
    colorPreviewActive = 0;
    protocolInit();
    firmwareApplyConfig(1);
    actionsPoll((uint16_t)currentMs);
    frameCount = 0; // Ignore the release reports sent when applying a profile.
    assert(actionsLayer() == layer);
    assert(ledData[0] || ledData[1] || ledData[2]);
}

static void idleLoop(uint32_t duration, uint8_t traffic, uint8_t expectDark) {
    for (uint32_t elapsed = 0; elapsed < duration; elapsed++) {
        uint8_t request = traffic && elapsed % 997 == 0;
        if (request) {
            static const uint8_t opcodes[] = {1, 2, 4}; // Info, status, active image.
            sleepRequest(opcodes[(elapsed / 997) % 3], 0);
        }
        currentMs++;
        loop();
        if (request) checkSleepReply();
        if (expectDark) assertBlack();
    }
}

static void testSleepThroughMainLoop(void) {
    static const uint16_t intervals[] = {220, 440, 879, 1758};
    for (uint8_t timeout = 0; timeout < 4; timeout++) {
        for (uint8_t layer = 0; layer < 2; layer++) {
            // Cross both 16-bit millis and 32-bit millis wrap during idle.
            uint32_t start = timeout & 1 ? UINT32_MAX - 24 : 65527;
            initSleepProfile(layer, timeout, start);
            uint32_t duration = (uint32_t)intervals[timeout] * 4096;
            uint8_t hue = rainbowHue;
            idleLoop(16, 1, 0);
            if (!layer) assert(rainbowHue != hue);
            idleLoop(duration - 32, 1, 0);
            assert(ledSettings[2] == 3 && ledSettings[3] == 3);
            assert(ledData[0] || ledData[1] || ledData[2]);
            // At most 15ms early quantization from the clock's initial phase.
            idleLoop(16, 1, 0);
            assert(ledSettings[2] == 0 && ledSettings[3] == 0);
            assertBlack();
            idleLoop(4096, 1, 1); // Subsequent animation/poll frames stay black.
            assert(frameCount == 0);
        }
    }
}

static void testIdleInputRestart(void) {
    const uint32_t duration = 220UL * 4096;
    initSleepProfile(0, 0, 0);
    idleLoop(duration - 32, 0, 0);
    P1 &= ~2; // Even an unbound physical press restarts inactivity.
    idleLoop(DEBOUNCE_MS + 1, 1, 0);
    uint32_t pressedAt = currentMs;
    P1 |= 2;
    idleLoop(DEBOUNCE_MS + 1, 1, 0);
    idleLoop(duration - 17 - (currentMs - pressedAt), 1, 0);
    assert(ledSettings[2] == 3);
    idleLoop(17, 1, 0);
    assertBlack();
}

static void testUsbResetRestartsSleep(void) {
    const uint32_t duration = 220UL * 4096;
    initSleepProfile(0, 0, 0);
    idleLoop(duration - 32, 1, 0);
    protocolReset(); // Unlike ordinary WebHID reads, reset reapplies the profile.
    loop();
    frameCount = 0;
    idleLoop(duration - 16, 1, 0);
    assert(ledSettings[2] == 3);
    idleLoop(16, 1, 0);
    assertBlack();
}

#if ENABLE_COLOR_PREVIEW
static void testPreviewCancelAfterSleep(void) {
    initSleepProfile(0, 0, 0);
    sleepRequest(9, 0xFD); // Full-brightness always-on Rainbow preview.
    loop(); checkSleepReply();
    assert(colorPreviewActive);
    idleLoop(220UL * 4096, 1, 0);
    assert(ledSettings[2] == 0 && ledSettings[3] == 0);
    assert(ledData[0] || ledData[1] || ledData[2]); // Preview hides expired sleep.
    sleepRequest(9, 0); // The actual Cancel Preview protocol request.
    loop(); checkSleepReply();
    assert(!colorPreviewActive);
    assertBlack();
    idleLoop(4096, 1, 1);
}
#endif

int main(void) {
    testSleepThroughMainLoop();
    testIdleInputRestart();
    testUsbResetRestartsSleep();
#if ENABLE_COLOR_PREVIEW
    testPreviewCancelAfterSleep();
#endif
    return 0;
}
