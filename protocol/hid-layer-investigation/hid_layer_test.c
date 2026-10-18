/* Real protocol, scanner, actions, sleep renderer and storage; hardware only is stubbed. */
#include <stdio.h>
#define TEST_REAL_PROTOCOL 1
#include "../src/protocol_firmware.h"
#define USB_EP1_sendConfig ignoredSendConfig
#define main inputRegressionMain
#include "input_test.c"
#undef main
#undef USB_EP1_sendConfig

static uint8_t replyBusy;
static unsigned flashWrites;
uint8_t USB_EP1_sendConfig(const uint8_t *reply) { (void)reply; return !replyBusy; }
void eeprom_write_byte(uint8_t offset, uint8_t value) { flash[offset] = value; flashWrites++; }
extern uint8_t baseLayer, previousLayer, oneShotReturnLayer;
extern uint8_t timedAge[], timedHigh[], timedFraction[], eventUsed;
extern uint8_t liveBindings[], liveBindingLayer;
extern uint8_t lastKeyboard[], lastMouse;

static const uint8_t layerSize = PHYSICAL_VARIANT ? 15 : 22;
static unsigned cases;
#ifndef HID_LAYER_OPTIONS_MASK
#define HID_LAYER_OPTIONS_MASK 127
#endif

static void initProfile(uint8_t layers, uint8_t timers) {
    initAutoSleep();
    memset(activeConfig + 9, 0, CONFIG_SIZE - 9);
    testSetLayout(layers, 0, timers);
    activeConfig[CONFIG_HEADER_SLEEP] = CONFIG_SLEEP_CONSUME | CONFIG_SLEEP_INDICATOR;
    for (uint8_t i = 0; i < layers; i++)
        activeConfig[9 + layerSize * (i + 1) - 1] = 0x1E;
    uint8_t offset = configTimedOffset();
    for (uint8_t i = 0; i < timers; i++, offset += 6) {
        activeConfig[offset] = 1;
        activeConfig[offset + 5] = 0xC0; // Global inactivity timer, consuming follow-up.
    }
    uint16_t crc = configCrc(activeConfig);
    activeConfig[7] = crc; activeConfig[8] = crc >> 8;
    assert(configValid(activeConfig, PHYSICAL_VARIANT));
    memcpy(flash, activeConfig, CONFIG_SIZE);
    protocolInit();
    firmwareApplyConfig(1);
    frameCount = replyBusy = flashWrites = 0;
    memset(liveBindings, 0, 13);
    actionsTakeLayerSelection();
}

static void packet(uint8_t options, uint8_t length, uint8_t padding, uint8_t expected) {
    uint8_t message[32] = {3, 'U', 'M', 1, 13, 42};
    message[6] = options; message[7] = length; message[31] = padding;
    assert(protocolReceive(message));
    protocolPoll(currentMs);
    assert(protocolReply[0] == 4 && protocolReply[4] == 13 && protocolReply[5] == 42);
    assert(protocolReply[6] == options && protocolReply[7] == 0 && protocolReply[8] == expected);
    for (uint8_t i = 9; i < 32; i++) assert(protocolReply[i] == 0);
    assert(protocolState == (replyBusy ? 2 : 0));
    cases++;
}

static void testBoundaries(void) {
    for (uint8_t layers = 1; layers <= CONFIG_MAX_LAYERS; layers++) {
        initProfile(layers, 0);
        for (unsigned options = 0; options < 256; options++) {
            for (unsigned length = 0; length < 256; length++) {
                uint8_t valid = !length && (options & HID_LAYER_OPTIONS_MASK) < layers;
                uint8_t old = baseLayer;
                packet(options, length, 0, valid ? 0 : 3);
                assert(baseLayer == (valid ? (options & HID_LAYER_OPTIONS_MASK) : old));
            }
        }
        assert(!memcmp(flash, activeConfig, CONFIG_SIZE) && !flashWrites);
    }
    initProfile(2, 0);
    for (unsigned options = 0; options < 256; options++) {
        uint8_t old = baseLayer;
        packet(options, 0, 1, 4);
        assert(baseLayer == old);
    }
    activeConfigValid = 0;
    packet(1, 0, 0, 6);
    assert(baseLayer == 0);
}

static void sleepState(uint8_t slot) {
    firmwareLedAction(LED_SLEEP_CAPTURE, activeConfig[CONFIG_SIZE + 1] >> 4);
    timedAge[slot] = 9; timedHigh[slot] = 9; timedFraction[slot] = 41;
}

#ifndef HID_LAYER_TEST_NO_MAIN
static void testWakeMatrix(void) {
    for (uint8_t settings = 0; settings < 32; settings++)
        for (uint8_t policies = 0; policies < 16; policies++)
            for (uint8_t target = 0; target < 2; target++)
                for (uint8_t enabled = 0; enabled < 2; enabled++)
                    for (uint8_t wake = 0; wake < 2; wake++) {
                        initProfile(2, 5);
                        activeConfig[CONFIG_HEADER_SLEEP] = settings;
                        activeConfig[9 + layerSize * 2 - 1] = 0x1C | (enabled ? 2 : 0);
                        actionsTimedReset(currentMs >> 4);
                        firmwareLedAction(CONFIG_LED_INDICATOR_SET, policies & 3);
                        firmwareLedAction(CONFIG_LED_KEY_SET, policies >> 2);
                        for (uint8_t i = 0; i < 5; i++) {
                            timedAge[i] = 12 + i; timedHigh[i] = 9; timedFraction[i] = 31 + i;
                        }
                        sleepState(5);
                        packet(target | (wake << 7), 0, 0, 0);
                        uint8_t restored = wake || (target && !enabled);
                        assert(ledSettings[2] == (restored ? (policies & 3) : ((settings & CONFIG_SLEEP_DIM) ? 1 : 0)));
                        assert(ledSettings[3] == (restored ? (policies >> 2) : ((settings & CONFIG_SLEEP_DIM) ? 1 : 0)));
                        assert(sleepBrightnessPending == !restored);
                        assert(timedHigh[5] == (restored ? 0 : 9));
                        assert(timedAge[5] == (restored ? 0 : 9));
                        assert(timedFraction[5] == (restored ? 0 : 41));
                        for (uint8_t i = 0; i < 5; i++) {
                            assert(timedAge[i] == 12 + i && timedHigh[i] == 9 && timedFraction[i] == 31 + i);
                        }
                        assert(liveBindings[12] == 0 && !flashWrites);
                    }
    // Awake commands must preserve the current brightness, even after an older sleep.
    initProfile(2, 0);
    sleepState(0); packet(128, 0, 0, 0);
    firmwareLedAction(CONFIG_LED_BOTH_SET, 1);
    timedAge[0] = 200; timedHigh[0] = 8; timedFraction[0] = 255;
    packet(128, 0, 0, 0);
    assert(ledSettings[2] == 1 && ledSettings[3] == 1);
    assert(!timedHigh[0] && !timedAge[0] && !timedFraction[0]);
    assert(!actionsTimedInput()); // Wake does not consume the next physical input.
}
#endif

static void testLayersAndHeldInputs(void) {
    initProfile(3, 0);
    activeConfig[9] = CONFIG_ACTION_SET_LAYER | 0x10; activeConfig[10] = 1;
    actionsPress(0, 0); actionsRelease(0);
    assert(baseLayer == 1 && oneShotReturnLayer == 0);
    uint8_t sequence = liveBindings[12];
    packet(2, 0, 0, 0);
    assert(baseLayer == 2 && previousLayer == 0 && oneShotReturnLayer == 255);
    assert(liveBindings[12] == sequence); // HID selection is not a physical/timer binding.
    packet(2, 0, 0, 0); assert(previousLayer == 0); // Retry is idempotent.
    assert(actionsTakeLayerSelection());

    initProfile(3, 0);
    activeConfig[9] = CONFIG_ACTION_MOMENTARY_LAYER; activeConfig[10] = 1;
    actionsPress(0, 0); assert(actionsLayer() == 1);
    packet(2, 0, 0, 0);
    assert(baseLayer == 2 && actionsLayer() == 1);
    actionsRelease(0); assert(actionsLayer() == 2);

    initProfile(2, 0);
    activeConfig[9] = CONFIG_ACTION_KEY_HOLD | 0x10; activeConfig[10] = 4;
    activeConfig[11] = CONFIG_ACTION_MOUSE_TOGGLE; activeConfig[12] = 1;
    activeConfig[13] = CONFIG_ACTION_KEY_TAP; activeConfig[14] = 5;
    actionsPress(0, 0);
    actionsPress(1, 0); actionsRelease(1);
    actionsPress(2, 0); actionsRelease(2);
    assert(eventUsed == 1);
    packet(0, 0, 0, 0); assert(eventUsed == 1);
    packet(1, 0, 0, 0); assert(eventUsed == 0);
    actionsPoll(0);
    assert(lastKeyboard[0] == 1 && lastKeyboard[2] == 4 && lastMouse == 0);
    actionsRelease(0); actionsPoll(10);
    assert(lastKeyboard[0] == 0 && lastKeyboard[2] == 0);
}

#ifndef HID_LAYER_TEST_NO_MAIN
static void testRetryAndReset(void) {
    initProfile(2, 0);
    sleepState(0);
    replyBusy = 1;
    packet(129, 0, 0, 0);
    assert(actionsLayer() == 1 && !timedHigh[0]);
    timedAge[0] = 5;
    for (uint8_t i = 0; i < 10; i++) protocolPoll(currentMs);
    assert(timedAge[0] == 5); // Reply backpressure does not execute the command again.
    replyBusy = 0; protocolPoll(currentMs); assert(!protocolState);
    packet(129, 0, 0, 0); assert(timedAge[0] == 0); // Explicit retry renews wake inactivity.
    protocolReset(); protocolPoll(currentMs);
    assert(actionsLayer() == 0 && !memcmp(flash, activeConfig, CONFIG_SIZE));
}
#endif

#ifndef HID_LAYER_TEST_NO_MAIN
int main(void) {
    testBoundaries();
    testWakeMatrix();
    testLayersAndHeldInputs();
    testRetryAndReset();
    printf("HID layer cases: %u\n", cases);
    return 0;
}
#endif
