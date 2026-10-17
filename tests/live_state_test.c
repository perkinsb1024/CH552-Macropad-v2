/* Exercise real scanner/dispatch/protocol snapshots together; only USB hardware is stubbed. */
#define TEST_REAL_PROTOCOL 1
#include "../src/protocol_firmware.h"
#define main inputRegressionMain
#include "input_test.c"
#undef main

void eeprom_write_byte(uint8_t offset, uint8_t value) { flash[offset] = value; }
extern uint8_t liveBindingLayer;
extern uint8_t timedAge[], timedHigh[], timedFraction[];

static void snapshot(uint8_t opcode) {
    uint8_t packet[32] = {3, 'U', 'M', 1};
    packet[4] = opcode;
    assert(protocolReceive(packet));
    protocolPoll(currentMs);
    assert(!protocolState && protocolReply[8] == 0);
}
static void initLive(void) {
    initAutoSleep();
    uint16_t crc = configCrc(activeConfig);
    activeConfig[7] = crc; activeConfig[8] = crc >> 8;
    memcpy(flash, activeConfig, CONFIG_SIZE);
    protocolInit();
    firmwareApplyConfig(1);
    memset(liveBindings, 0, 13);
    liveRotations[0] = liveRotations[1] = 0;
    frameCount = 0;
}
static void button(uint8_t input, uint8_t down) {
    if (input == NUM_LEDS) { if (down) P3 &= ~8; else P3 |= 8; }
    else if (input == 5) { if (down) P3 &= ~4; else P3 |= 4; }
    else { if (down) P1 &= ~KEY_MASK[input]; else P1 |= KEY_MASK[input]; }
    scanButton(input, currentMs);
    currentMs += 10;
    scanButton(input, currentMs);
}
static void detent(uint8_t direction) {
    const uint8_t forward[] = {2, 0, 1, 3}, backward[] = {1, 0, 2, 3};
    for (uint8_t i = 0; i < 4; i++) { P3 = (P3 & ~3) | (direction ? forward[i] : backward[i]); scanEncoder(); }
}
static void testInputsAndBindings(void) {
    initLive();
    P1 &= ~2; scanButton(0, currentMs);
    currentMs += 9; scanButton(0, currentMs); snapshot(2);
    assert(protocolReply[16] == 0 && liveBindings[12] == 0); // No raw/bounce activity.
    currentMs++; scanButton(0, currentMs); snapshot(2);
    assert(protocolReply[16] == 1 && liveBindings[0] == 1);
    assert(protocolReply[19] == 1 && protocolReply[28] == 0); // Counter and Key 1 source.
    assert(protocolReply[29] == activeConfig[9] && protocolReply[30] == activeConfig[10]);
    button(0, 0); snapshot(2); assert(protocolReply[16] == 0 && liveBindings[0] == 1);
    button(NUM_LEDS, 1); snapshot(2); assert(protocolReply[16] == (1 << NUM_LEDS));
    button(NUM_LEDS, 0);
    snapshot(2); uint8_t saved[23]; memcpy(saved, protocolReply + 9, 23);
    snapshot(2); assert(!memcmp(saved, protocolReply + 9, 23)); // Reading never clears counters.

    // Counter wrap, both directions, skipped/partial movement, and consumed detents.
    actionsClear(); frameCount = 0; liveRotations[0] = 255;
    detent(1); snapshot(2); assert(protocolReply[17] == 0 && liveBindings[7] == 1);
    actionsClear(); frameCount = 0; detent(0); snapshot(2); assert(protocolReply[18] == 1 && liveBindings[8] == 1);
    uint8_t sequence = liveBindings[12];
    P3 = (P3 & ~3) | 0; scanEncoder(); // Invalid two-bit jump.
    P3 = (P3 & ~3) | 3; scanEncoder();
    assert(liveBindings[12] == sequence);
    advanceSleep(440UL * 256); frameCount = 0;
    sequence = liveBindings[7];
    detent(1); snapshot(2);
    assert(protocolReply[17] == 1 && liveBindings[7] == sequence); // Physical wake; no binding.
    assert(ledSettings[2] == 3 && ledSettings[3] == 3);
}
static void testRuntime(void) {
    initLive();
    firmwareLedAction(CONFIG_LED_INDICATOR_SET, 1);
    firmwareLedAction(CONFIG_LED_KEY_SET, 0);
    firmwareLedAction(CONFIG_LED_PHASE_SET, 3);
    firmwareLedAction(CONFIG_LED_SPEED_SET, 2);
    snapshot(11);
    assert(protocolReply[23] == 3 && protocolReply[24] == 2);
    assert(protocolReply[25] == 1 && protocolReply[26] == 0);
    uint8_t generation = protocolReply[30];
    firmwareApplyConfig(0); snapshot(11); assert(protocolReply[30] == (uint8_t)(generation + 1));
    firmwareLedAction(CONFIG_LED_EFFECT_BLINK_1, 15); snapshot(11);
    assert(protocolReply[27] & LED_EFFECT_FLAG); assert(protocolReply[28] == 2);
#if ENABLE_COLOR_PREVIEW
    firmwarePreviewColor(0xFD); snapshot(11); assert(protocolReply[27] == 0xFD);
#endif
    for (uint8_t i = 0; i < 5; i++) { timedAge[i] = 17 + i; timedHigh[i] = 9 + i; timedFraction[i] = 123 + i; }
    snapshot(12); assert(protocolReply[7] == 17);
    for (uint8_t i = 0; i < 5; i++) {
        assert(protocolReply[9 + i] == 17 + i);
        assert(protocolReply[14 + i] == 9 + i);
        assert(protocolReply[19 + i] == 123 + i);
    }
    assert(protocolReply[24] == activeConfig[7] && protocolReply[25] == activeConfig[8]);
}
static void testChordAndRejectedActions(void) {
    initLive();
    uint8_t offset = configLayerPaletteOffset(configLayerCount());
    testSetChordCount(1); activeConfig[CONFIG_HEADER_LED] &= ~3; // 20ms chord window.
    activeConfig[offset] = 0; // Keys 1 + 2, layer 1.
    activeConfig[offset + 1] = CONFIG_ACTION_KEY_TAP; activeConfig[offset + 2] = 4;
    actionsPress(0, 0); assert(liveBindings[12] == 0);
    actionsPress(1, 1); snapshot(2);
    assert(liveBindings[12] == 1 && liveBindings[9] == 0x20);
    assert(liveBindings[10] == CONFIG_ACTION_KEY_TAP && liveBindings[11] == 4);
    actionsRelease(0); actionsRelease(1); actionsClear(); frameCount = 0;
    // Fill the action queue without polling. Dropped bindings must not claim dispatch.
    uint8_t before = liveBindings[12];
    for (uint8_t i = 0; i < 12; i++) { actionsPress(2, i); actionsRelease(2); }
    assert((uint8_t)(liveBindings[12] - before) == 8);
    assert(actionsDropped(0) == 4);
    snapshot(11); assert(protocolReply[15] == 8); // Queue depth.
}
static void testLayerAndMouseState(void) {
    initLive();
    testSetLayout(3, 0, 0);
    const uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
    memset(activeConfig + 9, 0, size * 3);
    testUniformLayers();
    activeConfig[9] = (CONFIG_ACTION_SET_LAYER | 0x10); activeConfig[10] = 2;
    actionsClear(); frameCount = 0;
    actionsPress(0, 0); snapshot(11);
    assert(protocolReply[9] == 2 && protocolReply[10] == 2 && protocolReply[12] == 0);
    assert(liveBindingLayer == 0 && liveBindings[11] == 2); // Preserve original target bytes.
    actionsRelease(0); actionsPress(1, 1); snapshot(11);
    assert(protocolReply[9] == 0 && protocolReply[12] == 255);
    actionsRelease(1); actionsClear(); frameCount = 0;
    activeConfig[9] = CONFIG_ACTION_MOUSE_TOGGLE; activeConfig[10] = 5;
    actionsPress(0, 2); actionsRelease(0); snapshot(11);
    assert(protocolReply[22] == 5); // Persistent buttons survive physical release.
    uint8_t packet[32] = {3, 'U', 'M', 1, 11, 1, 1};
    assert(protocolReceive(packet)); protocolPoll(currentMs); assert(protocolReply[8] == 3);
    packet[6] = 0; packet[9] = 1;
    assert(protocolReceive(packet)); protocolPoll(currentMs); assert(protocolReply[8] == 4);
    packet[9] = 0; packet[4] = 12; packet[7] = 1;
    assert(protocolReceive(packet)); protocolPoll(currentMs); assert(protocolReply[8] == 3);
}
int main(void) {
    testInputsAndBindings();
    testRuntime();
    testChordAndRejectedActions();
    testLayerAndMouseState();
    return 0;
}
