/* Input-style command: exercise wake/consume and user timer follow-ups together. */
#ifndef HID_LAYER_OPTIONAL
#define HID_LAYER_OPTIONAL 1
#endif
#if !HID_LAYER_OPTIONAL
#define HID_LAYER_OPTIONS_MASK 255
#endif
#define HID_LAYER_TEST_NO_MAIN 1
#include "hid_layer_test.c"

static uint8_t inputOptions(uint8_t layer) {
    return layer | (HID_LAYER_OPTIONAL ? 128 : 0);
}

static void testInputWake(void) {
    for (uint8_t settings = 0; settings < 32; settings++)
        for (uint8_t policies = 0; policies < 16; policies++)
            for (uint8_t target = 0; target < 2; target++) {
                initProfile(2, 0);
                activeConfig[CONFIG_HEADER_SLEEP] = settings;
                actionsTimedReset(currentMs >> 4);
                firmwareLedAction(CONFIG_LED_INDICATOR_SET, policies & 3);
                firmwareLedAction(CONFIG_LED_KEY_SET, policies >> 2);
                sleepState(0);
                packet(inputOptions(target), 0, 0, 0);
                assert(baseLayer == ((settings & CONFIG_SLEEP_CONSUME) ? 0 : target));
                assert(ledSettings[2] == (policies & 3) && ledSettings[3] == policies >> 2);
                assert(!sleepBrightnessPending && !timedHigh[0] && !timedAge[0] && !timedFraction[0]);
                packet(inputOptions(target), 0, 0, 0);
                assert(baseLayer == target && actionsLayer() == target);
                assert(!actionsTimedInput());
                assert(!memcmp(flash, activeConfig, CONFIG_HEADER_SLEEP));
                assert(!flashWrites);
            }
    initProfile(2, 0);
    advanceSleep(220UL * 256); // Real timer expiry, rather than a synthetic pending bit.
    assert(sleepBrightnessPending && (timedHigh[0] & 1));
    packet(inputOptions(1), 0, 0, 0);
    assert(baseLayer == 0 && !sleepBrightnessPending);
    packet(inputOptions(1), 0, 0, 0); assert(baseLayer == 1);
}

static void testFollowUps(void) {
    for (uint8_t count = 1; count <= 5; count++)
        for (uint8_t consumeMask = 0; consumeMask < (1 << count); consumeMask++) {
            initProfile(2, count);
            uint8_t offset = configTimedOffset();
            for (uint8_t i = 0; i < count; i++, offset += 6) {
                activeConfig[offset + 3] = 0x1D; // LED Control, value +1.
                activeConfig[offset + 4] = CONFIG_LED_PHASE_RELATIVE;
                activeConfig[offset + 5] = 128 | ((consumeMask & (1 << i)) ? 64 : 0);
                timedHigh[i] = 1;
            }
            uint8_t phaseBefore = ledSettings[0];
            packet(inputOptions(1), 0, 0, 0);
            assert(baseLayer == (consumeMask ? 0 : 1));
            assert(ledSettings[0] == ((phaseBefore + count) & 3));
            assert(liveBindings[12] == count); // Exactly the timer actions, no fake host binding.
            for (uint8_t i = 0; i < count; i++) assert(!timedHigh[i] && !timedAge[i] && !timedFraction[i]);
            packet(inputOptions(1), 0, 0, 0); assert(baseLayer == 1);
            assert(ledSettings[0] == ((phaseBefore + count) & 3) && liveBindings[12] == count);
            assert(!flashWrites);
        }
    // A timer may change the layer before the requested absolute selection.
    initProfile(3, 1);
    uint8_t offset = configTimedOffset();
    activeConfig[offset + 3] = CONFIG_ACTION_SET_LAYER;
    activeConfig[offset + 4] = 2;
    activeConfig[offset + 5] = 128;
    timedHigh[0] = 1;
    packet(inputOptions(1), 0, 0, 0);
    assert(baseLayer == 1 && previousLayer == 2);
}

static void testOptionalAndRetry(void) {
    initProfile(2, 0);
#if HID_LAYER_OPTIONAL
    sleepState(0);
    packet(1, 0, 0, 0); // Clear flag preserves sleep across enabled layers.
    assert(baseLayer == 1 && sleepBrightnessPending && timedHigh[0] == 9);
    packet(inputOptions(1), 0, 0, 0); assert(!sleepBrightnessPending);
#endif
    replyBusy = 1;
    packet(inputOptions(1), 0, 0, 0);
    timedAge[0] = 5;
    for (uint8_t i = 0; i < 10; i++) protocolPoll(currentMs);
    assert(timedAge[0] == 5);
    replyBusy = 0; protocolPoll(currentMs); assert(!protocolState);
    packet(inputOptions(1), 0, 0, 0); assert(!timedAge[0]);
    protocolReset(); protocolPoll(currentMs);
    assert(baseLayer == 0 && !memcmp(flash, activeConfig, CONFIG_SIZE));
}

static void testPendingAndInvalidRequests(void) {
    initProfile(2, 0);
    sleepState(0);
    packet(inputOptions(2), 0, 0, 3);
    packet(inputOptions(1), 1, 0, 3);
    packet(inputOptions(1), 0, 1, 4);
    assert(sleepBrightnessPending && timedAge[0] == 9 && timedHigh[0] == 9);

    initProfile(2, 1);
    activeConfig[9] = CONFIG_ACTION_SET_LAYER | 0x10; activeConfig[10] = 1;
    actionsPress(0, 0); actionsRelease(0);
    assert(baseLayer == 1 && oneShotReturnLayer == 0);
    timedHigh[0] = 1; // A consuming user follow-up leaves the one-shot untouched.
    packet(inputOptions(0), 0, 0, 0);
    assert(baseLayer == 1 && oneShotReturnLayer == 0);
    packet(inputOptions(0), 0, 0, 0);
    assert(baseLayer == 0 && oneShotReturnLayer == 255);

    initProfile(2, 0);
    testSetChordCount(1);
    uint8_t offset = configLayerPaletteOffset(configLayerCount());
    activeConfig[offset] = 0x70;
    activeConfig[offset + 1] = CONFIG_ACTION_KEY_TAP; activeConfig[offset + 2] = 5;
    activeConfig[9] = CONFIG_ACTION_KEY_TAP; activeConfig[10] = 4;
    actionsPress(0, 0);
    assert(!liveBindings[12]); // Single waits in the chord window.
    packet(inputOptions(1), 0, 0, 0);
    assert(baseLayer == 1 && liveBindings[12] == 1 && liveBindings[11] == 4);
    actionsRelease(0);

#if HID_LAYER_OPTIONAL
    initProfile(2, 1);
    offset = configTimedOffset();
    activeConfig[offset + 5] = 1; // Scoped repeating timer, pending follow-up retained on transition.
    timedAge[0] = 7; timedHigh[0] = 9; timedFraction[0] = 30;
    packet(1, 0, 0, 0);
    assert(!timedAge[0] && timedHigh[0] == 1 && !timedFraction[0]);
#endif
}

static void testRepeatingTimerBoundary(void) {
    initProfile(2, 1);
    uint8_t offset = configTimedOffset();
    activeConfig[offset + 5] = 64; // Consuming repeating timer, without restart on input.
    timedAge[0] = activeConfig[offset]; timedHigh[0] = 1; timedFraction[0] = 255;
    packet(inputOptions(1), 0, 0, 0);
    assert(baseLayer == 0 && !(timedHigh[0] & 1));
    actionsTimedPoll((uint8_t)((currentMs >> 4) + 1)); // Another expiry between requests.
    assert(timedHigh[0] & 1);
    packet(inputOptions(1), 0, 0, 0);
    assert(baseLayer == 0); // Two input-style requests are not an unconditional guarantee.
    packet(inputOptions(1), 0, 0, 0); assert(baseLayer == 1);
#if HID_LAYER_OPTIONAL
    initProfile(2, 1);
    offset = configTimedOffset(); activeConfig[offset + 5] = 64;
    timedHigh[0] = 1;
    packet(inputOptions(1), 0, 0, 0); assert(baseLayer == 0);
    timedHigh[0] = 1;
    packet(1, 0, 0, 0); // A quiet second command bypasses a newly consuming timer.
    assert(baseLayer == 1 && (timedHigh[0] & 1));
#endif
}

int main(void) {
    testBoundaries();
    testInputWake();
    testFollowUps();
    testLayersAndHeldInputs();
    testOptionalAndRetry();
    testPendingAndInvalidRequests();
    testRepeatingTimerBoundary();
    printf("Input-style HID layer cases: %u\n", cases);
    return 0;
}
