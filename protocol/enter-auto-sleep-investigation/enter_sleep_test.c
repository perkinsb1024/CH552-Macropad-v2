/* Real sketch/actions integration; run separately on each candidate and board. */
#define main existingInputMain
#include "input_test.c"
#undef main
#include "../src/live_state.h"

#ifndef ENTER_SLEEP_ENABLED_ONLY
#define ENTER_SLEEP_ENABLED_ONLY 0
#endif

static uint8_t layerSize(void) { return PHYSICAL_VARIANT ? 15 : 22; }

static void sealEntryProfile(void) {
    uint16_t crc = configCrc(activeConfig);
    activeConfig[CONFIG_HEADER_CRC] = crc;
    activeConfig[CONFIG_HEADER_CRC + 1] = crc >> 8;
    assert(configValid(activeConfig, PHYSICAL_VARIANT));
}

static void entryInit(uint8_t enabled, uint8_t settings, uint8_t timers, uint8_t layers) {
    initAutoSleep();
    memset(activeConfig + 9, 0, CONFIG_SIZE - 9);
    testSetLayout(layers, 0, timers);
    activeConfig[CONFIG_HEADER_SLEEP] = settings;
    for (uint8_t i = 0; i < layers; i++) {
        activeConfig[9 + (i + 1) * layerSize() - 1] =
            (4 << CONFIG_LAYER_OPT_COLOR_SHIFT) | CONFIG_LAYER_OPT_FULL_BRIGHTNESS |
            (CONFIG_LAYER_INDICATOR_ALWAYS_ON << CONFIG_LAYER_OPT_INDICATOR_SHIFT) |
            (enabled ? CONFIG_LAYER_OPT_AUTO_SLEEP : 0);
    }
    sealEntryProfile();
    firmwareApplyConfig(1);
    actionsPoll(currentMs);
    actionsTakeLayerSelection();
    frameCount = 0;
}

static uint8_t sleeping(void) {
    actionsWriteTimers();
    return liveReply[6 + configTimedCount()] & 1;
}

static void enter(uint8_t value) {
    uint8_t offset = 9 + actionsLayer() * layerSize() + 2 * (NUM_LEDS + 1);
    uint8_t first = activeConfig[offset], second = activeConfig[offset + 1];
    activeConfig[offset] = (value << 4) | CONFIG_ACTION_LED_CONTROL;
    activeConfig[offset + 1] = CONFIG_LED_ENTER_SLEEP;
    actionsRotate(1);
    assert(liveBindings[10] == ((value << 4) | CONFIG_ACTION_LED_CONTROL));
    assert(liveBindings[11] == CONFIG_LED_ENTER_SLEEP);
    activeConfig[offset] = first; activeConfig[offset + 1] = second;
}

static void selectEntryLayer(uint8_t target, uint8_t relative) {
    uint8_t offset = 9 + actionsLayer() * layerSize() + 2 * (NUM_LEDS + 1);
    activeConfig[offset] = CONFIG_ACTION_SET_LAYER | (relative ? CONFIG_LAYER_RELATIVE : 0);
    activeConfig[offset + 1] = target;
    actionsRotate(1);
}

static void testEntrySettingsAndWake(void) {
    unsigned cases = 0;
    for (uint8_t enabled = 0; enabled < 2; enabled++)
      for (uint8_t settings = 0; settings < 32; settings++)
        for (uint8_t policies = 0; policies < 16; policies++)
          for (uint8_t input = 0; input < 4; input++) {
            entryInit(enabled, settings, 0, 1);
            firmwareLedAction(CONFIG_LED_INDICATOR_SET, policies & 3);
            firmwareLedAction(CONFIG_LED_KEY_SET, policies >> 2);
            uint8_t slot = input ? NUM_LEDS + input - 1 : 0;
            activeConfig[9 + 2 * slot] = 0x10 | CONFIG_ACTION_LED_CONTROL;
            activeConfig[10 + 2 * slot] = CONFIG_LED_KEY_SET;
            enter(cases++ & 15);
            if (!enabled && ENTER_SLEEP_ENABLED_ONLY) {
                assert(!sleeping());
                assert(ledSettings[2] == (policies & 3) && ledSettings[3] == (policies >> 2));
                continue;
            }
            assert(sleeping());
            assert(ledSettings[2] == ((settings & CONFIG_SLEEP_DIM) ? 1 : 0));
            assert(ledSettings[3] == ledSettings[2]);
            if (!(settings & CONFIG_SLEEP_DIM)) assertBlack();
            // Re-entry must retain the original captured policies, even after
            // another LED command has changed the current sleeping policies.
            firmwareLedAction(CONFIG_LED_BOTH_SET, 2);
            enter(15);
            assert(sleeping());
            wakeSleepInput(input);
            assert(!sleeping());
            assert(ledSettings[2] == (policies & 3));
            assert(ledSettings[3] == ((settings & CONFIG_SLEEP_CONSUME) ? policies >> 2 : 1));
            assert(!!actionsTakeLayerSelection() == !!(settings & CONFIG_SLEEP_INDICATOR));
          }
    assert(cases == 4096);
}

static void testNoopAndIndependentTimers(void) {
    for (uint8_t enabled = 0; enabled < 2; enabled++)
      for (uint8_t count = 0; count <= CONFIG_TIMED_MAX; count++) {
        entryInit(enabled, CONFIG_SLEEP_DEFAULT, count, 1);
        for (uint8_t i = 0; i < count; i++) {
            uint8_t offset = configTimedOffset() + CONFIG_TIMED_SIZE * i;
            activeConfig[offset] = i + 5;
            activeConfig[offset + 5] = 0;
        }
        advanceSleep(257);
        actionsWriteTimers();
        uint8_t before[18]; memcpy(before, liveReply, sizeof(before));
        enter(0);
        actionsWriteTimers();
        for (uint8_t i = 0; i < count; i++) {
            assert(before[i] == liveReply[i]);
            assert(before[6 + i] == liveReply[6 + i]);
            assert(before[12 + i] == liveReply[12 + i]);
        }
        if (!enabled && ENTER_SLEEP_ENABLED_ONLY) {
            assert(memcmp(before, liveReply, sizeof(before)) == 0);
            assert(!sleepBrightnessPending);
        } else {
            assert(sleeping());
            assert(liveReply[count] == 0 && liveReply[12 + count] == 0);
        }
      }
}

static void testEntryFromPhysicalBindings(void) {
    for (uint8_t input = 0; input < 4; input++) {
        entryInit(1, CONFIG_SLEEP_DEFAULT, 0, 1);
        uint8_t slot = input ? NUM_LEDS + input - 1 : 0;
        activeConfig[9 + 2 * slot] = CONFIG_ACTION_LED_CONTROL;
        activeConfig[10 + 2 * slot] = CONFIG_LED_ENTER_SLEEP;
        sealEntryProfile();
        wakeSleepInput(input);
        assert(sleeping()); assertBlack();
        if (input < 2) {
            P1 = P3 = 0xFF;
            scanButton(input ? NUM_LEDS : 0, currentMs);
            currentMs += DEBOUNCE_MS;
            scanButton(input ? NUM_LEDS : 0, currentMs);
            assert(sleeping()); // Release is not a wake input.
        }
        wakeSleepInput(input);
        assert(!sleeping()); // Consumed wake cannot re-run the entry binding.
    }
}

static void testEntryLayersAndReset(void) {
    for (uint8_t enabled = 0; enabled < 2; enabled++) {
        entryInit(enabled, CONFIG_SLEEP_DEFAULT, 0, 2);
        enter(0);
        assert(sleeping() == (enabled || !ENTER_SLEEP_ENABLED_ONLY));
        selectEntryLayer(0, 1);
        // Same-layer selections retain existing behavior, as agreed with user.
        assert(sleeping() == (enabled || !ENTER_SLEEP_ENABLED_ONLY));
        selectEntryLayer(1, 0);
        assert(actionsLayer() == 1 && sleeping() == enabled);
        if (!enabled) assert(ledSettings[2] == 3 && ledSettings[3] == 3);
        if (enabled) {
            activeConfig[9 + layerSize() - 1] &= ~CONFIG_LAYER_OPT_AUTO_SLEEP;
            selectEntryLayer(0, 0);
            assert(!sleeping() && ledSettings[2] == 3 && ledSettings[3] == 3);
        }
        entryInit(enabled, CONFIG_SLEEP_DEFAULT, 0, 1);
        firmwareLedAction(CONFIG_LED_BOTH_SET, 1);
        enter(0);
        firmwareApplyConfig(1);
        assert(!sleeping() && !sleepBrightnessPending);
        assert(ledSettings[2] == 3 && ledSettings[3] == 3);
    }
}

static void testEntryFromTimersAndMacro(void) {
    for (uint8_t enabled = 0; enabled < 2; enabled++)
      for (uint8_t resume = 0; resume < 2; resume++) {
        entryInit(enabled, CONFIG_SLEEP_DEFAULT, 1, 1);
        uint8_t offset = configTimedOffset();
        activeConfig[offset + (resume ? 3 : 1)] = CONFIG_ACTION_LED_CONTROL;
        activeConfig[offset + (resume ? 4 : 2)] = CONFIG_LED_ENTER_SLEEP;
        sealEntryProfile();
        advanceSleep(256);
        if (resume) {
            assert(!sleeping());
            assert(!actionsTimedInput()); // User timer does not consume input.
        }
        assert(sleeping() == (enabled || !ENTER_SLEEP_ENABLED_ONLY));
        if (enabled || !ENTER_SLEEP_ENABLED_ONLY) {
            assert(actionsTimedInput()); // Newly requested sleep wakes on NEXT input.
            assert(!sleeping() && ledSettings[2] == 3 && ledSettings[3] == 3);
        }
      }
    for (uint8_t enabled = 0; enabled < 2; enabled++) {
        entryInit(enabled, CONFIG_SLEEP_DEFAULT, 0, 1);
        uint8_t macro = configTimedOffset();
        activeConfig[9] = CONFIG_ACTION_MACRO;
        activeConfig[10] = macro;
        activeConfig[macro] = CONFIG_ACTION_LED_CONTROL;
        activeConfig[macro + 1] = CONFIG_LED_ENTER_SLEEP;
        sealEntryProfile();
        actionsPress(0, currentMs); actionsRelease(0);
        for (uint8_t i = 0; i < 32; i++) actionsPoll(++currentMs);
        assert(sleeping() == (enabled || !ENTER_SLEEP_ENABLED_ONLY));
    }
}

static void testEntryEffectsChordsAndOneShot(void) {
    entryInit(1, CONFIG_SLEEP_DEFAULT, 0, 1);
    firmwareLedAction(CONFIG_LED_EFFECT_BLINK_1, 15);
    uint8_t effect = previewOptions;
    enter(0);
    assert(sleeping() && previewOptions == effect);
    assert(ledData[0] || ledData[1] || ledData[2]);
    tick(250); tick(500); // Finishing the effect reveals the sleeping policies.
    assertBlack();
    assert(actionsTimedInput());
    assert(!sleeping() && ledSettings[2] == 3 && ledSettings[3] == 3);

    entryInit(1, CONFIG_SLEEP_DEFAULT, 0, 1);
    testSetChordCount(1);
    uint8_t chord = 9 + layerSize();
    activeConfig[chord] = 0; // Layer 1, pair Key 1 + Key 2.
    activeConfig[chord + 1] = CONFIG_ACTION_LED_CONTROL;
    activeConfig[chord + 2] = CONFIG_LED_ENTER_SLEEP;
    sealEntryProfile();
    actionsPress(0, currentMs);
    assert(!sleeping());
    actionsPress(1, ++currentMs);
    assert(sleeping()); assertBlack();
    actionsRelease(0); actionsRelease(1);
    assert(sleeping());
    assert(actionsTimedInput());

    for (uint8_t enabled = 0; enabled < 2; enabled++) {
        entryInit(enabled, CONFIG_SLEEP_DEFAULT, 0, 2);
        activeConfig[9] = CONFIG_ACTION_SET_LAYER | 0x10;
        activeConfig[10] = 1;
        activeConfig[9 + layerSize() + 2] = CONFIG_ACTION_LED_CONTROL;
        activeConfig[10 + layerSize() + 2] = CONFIG_LED_ENTER_SLEEP;
        sealEntryProfile();
        actionsPress(0, currentMs); actionsRelease(0);
        assert(actionsLayer() == 1);
        actionsPress(1, ++currentMs); actionsRelease(1);
        assert(actionsLayer() == 0);
        assert(sleeping() == (enabled || !ENTER_SLEEP_ENABLED_ONLY));
    }
}

int main(void) {
    testEntrySettingsAndWake();
    testNoopAndIndependentTimers();
    testEntryFromPhysicalBindings();
    testEntryLayersAndReset();
    testEntryFromTimersAndMacro();
    testEntryEffectsChordsAndOneShot();
    return 0;
}
