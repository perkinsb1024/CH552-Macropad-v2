/* Real scanner, renderer, actions, protocol and storage; only hardware is stubbed. */
#include <stdio.h>
#define TEST_REAL_PROTOCOL 1
#include "../src/protocol_firmware.h"
#define main inputRegressionMain
#include "input_test.c"
#undef main
extern uint8_t buttonFirst[], buttonSecond[], buttonPressed[], liveBindings[];
extern uint8_t timedHigh[], timedAge[], timedFraction[], baseLayer;
static unsigned cases, flashWrites;
static const uint8_t stride = PHYSICAL_VARIANT ? 15 : 22;
static uint8_t pair;
void eeprom_write_byte(uint8_t offset, uint8_t value) { flash[offset] = value; flashWrites++; }

static void initTap(uint8_t timers) {
    initAutoSleep();
    memset(activeConfig + 9, 0, CONFIG_SIZE - 9);
    testSetLayout(2, 0, timers); testSetChordCount(0); testSetStringLength(0);
    activeConfig[CONFIG_HEADER_SLEEP] = CONFIG_SLEEP_CONSUME;
    for (uint8_t layer = 0; layer < 2; layer++) activeConfig[9 + stride * (layer + 1) - 1] = 0x1F;
    uint8_t block = configTimedOffset() + timers * 6;
    pair = block + 1; activeConfig[block] = 0x0F;
    activeConfig[9] = activeConfig[9 + 2 * NUM_LEDS] = 0x0F;
    activeConfig[10] = activeConfig[10 + 2 * NUM_LEDS] = pair;
    activeConfig[pair] = 0x1D; activeConfig[pair + 1] = CONFIG_LED_PHASE_SET;
    activeConfig[pair + 2] = CONFIG_ACTION_MOMENTARY_LAYER; activeConfig[pair + 3] = 1;
    // Layer 1 key 1 provides a visible test of scan ordering after the deadline.
    activeConfig[9 + stride + 2] = 0x2D; activeConfig[10 + stride + 2] = CONFIG_LED_PHASE_SET;
    uint16_t crc = configCrc(activeConfig); activeConfig[7] = crc; activeConfig[8] = crc >> 8;
    assert(configValid(activeConfig, PHYSICAL_VARIANT));
    memcpy(flash, activeConfig, CONFIG_SIZE); protocolInit(); firmwareApplyConfig(1);
    frameCount = flashWrites = 0; memset(liveBindings, 0, 13);
}
static void pin(uint8_t input, uint8_t down) {
    if (input == NUM_LEDS) { if (down) P3 &= ~8; else P3 |= 8; }
    else if (input == 5) { if (down) P3 &= ~4; else P3 |= 4; }
    else { if (down) P1 &= ~KEY_MASK[input]; else P1 |= KEY_MASK[input]; }
}
static uint16_t edge(uint8_t input, uint8_t down, uint16_t start) {
    currentMs = start; pin(input, down); scanButton(input, currentMs);
    currentMs += DEBOUNCE_MS; scanButton(input, currentMs); return currentMs;
}
static void testScanner(void) {
    for (uint8_t input = 0; input <= NUM_LEDS; input++) {
        initTap(0);
        activeConfig[9 + 2 * input] = 0x0F; activeConfig[10 + 2 * input] = pair;
        uint16_t origin = edge(input, 1, 65520);
        assert(!liveBindings[12] && actionsLayer() == 0);
        edge(input, 0, origin + 1); // 11ms accepted duration, below 32ms.
        assert(ledSettings[0] == 1 && liveBindings[12] == 1 && actionsLayer() == 0);
        cases++;
        initTap(0); activeConfig[9 + 2 * input] = 0x0F; activeConfig[10 + 2 * input] = pair;
        origin = edge(input, 1, 65520);
        // No intervening output poll; the accepted release still chooses Hold at exactly 32ms.
        actionsTakeLayerSelection();
        edge(input, 0, origin + 32 - DEBOUNCE_MS);
        assert(actionsTakeLayerSelection());
        assert(liveBindings[12] == 1 && liveBindings[10] == CONFIG_ACTION_MOMENTARY_LAYER);
        assert(actionsLayer() == 0); // Momentary branch is activated and then released.
        cases++;
    }
    initTap(0);
    uint16_t origin = edge(0, 1, 100);
    // Stage another key's accepted press for exactly the hold deadline.
    currentMs = origin + 32 - DEBOUNCE_MS; pin(1, 1); loop();
    currentMs = origin + 32; loop();
    assert(actionsLayer() == 1 && ledSettings[0] == 2);
    edge(0, 0, currentMs + 1); assert(actionsLayer() == 0);
    assert(!flashWrites);
    cases++;
}
static void testWakeAndTimers(void) {
    for (uint8_t settings = 0; settings < 32; settings++)
        for (uint8_t input = 0; input < 2; input++) {
            initTap(0); uint8_t key = input ? NUM_LEDS : 0;
            activeConfig[CONFIG_HEADER_SLEEP] = settings;
            actionsTimedReset(0);
            // Exercise the actual shared sleep pending/restoration path without a long idle loop.
            firmwareLedAction(LED_SLEEP_CAPTURE, activeConfig[CONFIG_SIZE + 1] >> 4);
            timedHigh[0] = 1;
            uint16_t origin = edge(key, 1, 10);
            assert(!sleepBrightnessPending);
            unsigned before = liveBindings[12]; // Wake restoration itself is an accepted timer action.
            currentMs = origin + 32; loop();
            edge(key, 0, currentMs + 1);
            if (settings & CONFIG_SLEEP_CONSUME) assert(liveBindings[12] == before);
            else assert(liveBindings[12] == before + 1 && liveBindings[10] == CONFIG_ACTION_MOMENTARY_LAYER);
            assert(actionsLayer() == 0 && !flashWrites);
            cases++;
        }
    for (uint8_t mask = 0; mask < 32; mask++) {
        initTap(5);
        uint8_t timer = configTimedOffset();
        for (uint8_t i = 0; i < 5; i++, timer += 6) {
            activeConfig[timer + 3] = 0x1D; activeConfig[timer + 4] = CONFIG_LED_SPEED_RELATIVE;
            activeConfig[timer + 5] = 128 | ((mask & (1 << i)) ? 64 : 0);
            timedHigh[i] = 1;
        }
        uint16_t origin = edge(0, 1, 10);
        assert(liveBindings[12] == 5);
        currentMs = origin + 32; actionsPoll(currentMs);
        edge(0, 0, currentMs + 1);
        assert(liveBindings[12] == (mask ? 5 : 6));
        assert(actionsLayer() == 0 && !flashWrites);
        cases++;
    }
    initTap(0); uint16_t origin = edge(0, 1, 10);
    // A reset/profile reapplication cancels pending decisions and their later releases.
    protocolReset(); currentMs = origin + 1; protocolPoll(currentMs);
    unsigned before = liveBindings[12];
    currentMs = origin + 100; loop(); edge(0, 0, currentMs + 1);
    assert(liveBindings[12] == before && actionsLayer() == 0 && !flashWrites);
    cases++;
}
#ifdef TAP_HOLD_COMBINED
static void hostLayer(uint8_t options) {
    uint8_t packet[32] = {3, 'U', 'M', 1, 13, 42};
    packet[6] = options; assert(protocolReceive(packet)); protocolPoll(currentMs);
    assert(protocolReply[8] == 0 && !protocolState);
}
static void testHostLayer(void) {
    initTap(0); uint16_t origin = edge(0, 1, 10);
    hostLayer(1); assert(actionsLayer() == 1);
    edge(0, 0, origin + 1); // Pair captured on layer 0 survives host selection.
    assert(ledSettings[0] == 1 && actionsLayer() == 1);
    initTap(0); origin = edge(0, 1, 10);
    currentMs = origin + 32; loop(); assert(actionsLayer() == 1);
    hostLayer(0); assert(actionsLayer() == 1); // Physical momentary hold wins.
    edge(0, 0, currentMs + 1); assert(actionsLayer() == 0);
    initTap(0); origin = edge(0, 1, 10);
    currentMs = origin + 32; loop(); hostLayer(1);
    edge(0, 0, currentMs + 1); assert(actionsLayer() == 1);
    assert(!flashWrites); cases += 3;
}
#endif
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

int main(void) {
    testChordHoldScan();
    testScanner(); testWakeAndTimers();
#ifdef TAP_HOLD_COMBINED
    testHostLayer();
#endif
    printf("Tap-hold real scanner %u: %u cases passed\n", PHYSICAL_VARIANT, cases);
    return 0;
}
