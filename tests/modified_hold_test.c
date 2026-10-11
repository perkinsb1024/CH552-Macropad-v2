#define main existingMacroMain
#include "macros_test.c"
#undef main

static void holdBinding(uint8_t input, uint8_t mask, uint8_t usage) {
    activeConfig[9 + 2 * input] = CONFIG_ACTION_CONSUMER_MODIFIED_HOLD | (mask << 4);
    activeConfig[10 + 2 * input] = usage;
}

static void testHoldEncoding(void) {
    for (uint8_t mask = 0; mask < 16; mask++) {
        for (unsigned usage = 0; usage < 256; usage++) {
            reset(); holdBinding(0, mask, usage); seal();
            assert(!!configValid(activeConfig, PHYSICAL_VARIANT) == !!usage);
        }
    }
    reset(); holdBinding(configKeyCount(), 6, 0x6f); seal();
    assert(configValid(activeConfig, PHYSICAL_VARIANT)); // Encoder press.
    reset(); holdBinding(configKeyCount() + 1, 6, 0x6f); seal();
    assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    reset(); activeConfig[3] = 1 << 6;
    activeConfig[start + 1] = (0x60 | CONFIG_ACTION_CONSUMER_MODIFIED_HOLD); activeConfig[start + 2] = 0x6f; seal();
    assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    activeConfig[start + 1] = activeConfig[start + 2] = 0;
    activeConfig[start + 3] = (0x60 | CONFIG_ACTION_CONSUMER_MODIFIED_HOLD); activeConfig[start + 4] = 0x6f; seal();
    assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    reset(); const uint8_t held[] = {(0x60 | CONFIG_ACTION_CONSUMER_MODIFIED_HOLD), 0x6f};
    define(start, held, 1); bind(0, start, 1); seal();
    assert(!configValid(activeConfig, PHYSICAL_VARIANT));
}

static void testHoldLifecycle(void) {
    for (uint8_t mask = 0; mask < 16; mask++) {
        reset(); holdBinding(0, mask, 0xff);
        actionsPress(0, 0); pump(0, 100);
        assert(count == (mask ? 2 : 1));
        if (mask) assertModifiers(0, mask);
        assertConsumer(count - 1, 0xff);
        actionsRelease(0); pump(100, 110);
        assertConsumer(count - (mask ? 2 : 1), 0);
        assert(!latestModifiers());
    }
    // A short press gets both edges through backpressure at every boundary.
    for (unsigned limit = 0; limit <= 4; limit++) {
        reset(); holdBinding(0, 6, 0x6f); reportLimit = limit;
        actionsPress(0, 0); actionsRelease(0); pump(0, 10);
        assert(count == limit);
        reportLimit = 1024; pump(10, 20); assert(count == 4);
        assertModifiers(0, 6); assertConsumer(1, 0x6f);
        assertConsumer(2, 0); assertModifiers(3, 0);
    }
    // Consumer cleanup preserves ordinary keys and modifiers from another hold.
    reset(); activeConfig[9] = 0x12; activeConfig[10] = 4;
    holdBinding(1, 6, 0x6f); actionsPress(0, 0); actionsPoll(0);
    actionsPress(1, 1); actionsPoll(1); assertModifiers(1, 7);
    actionsRelease(1); pump(2, 10); assertConsumer(3, 0);
    assertModifiers(4, 1); assert(reports[4][3] == 4);
    // Holds retain their original binding across a layer change.
    reset(); activeConfig[3] = 1; holdBinding(0, 6, 0x6f);
    activeConfig[11] = CONFIG_ACTION_SET_LAYER; activeConfig[12] = 1;
    actionsPress(0, 0); actionsPoll(0); press(1, 1); pump(1, 10);
    assert(count == 2 && latestModifiers() == 6);
    actionsRelease(0); pump(10, 20); assert(count == 4 && !latestModifiers());
    // Either chord member releases the composite output.
    reset(); activeConfig[5] |= 2;
    activeConfig[start] = 0; activeConfig[start + 1] = (0x60 | CONFIG_ACTION_CONSUMER_MODIFIED_HOLD); activeConfig[start + 2] = 0x6f;
    actionsPress(0, 0); actionsPress(1, 1); pump(1, 10);
    assert(count == 2); actionsRelease(1); pump(10, 20);
    assert(count == 4 && !latestModifiers());
    // A report-generation change reasserts the winning modified hold.
    reset(); holdBinding(0, 6, 0x6f); actionsPress(0, 0); actionsPoll(0);
    generation++; actionsPoll(1); assertModifiers(2, 6); assertConsumer(4, 0x6f);
    blocked = 1; actionsClear(); pump(2, 10); assert(count == 5);
    blocked = 0; pump(10, 20); assertConsumer(5, 0); assertModifiers(6, 0);
}

static void testHoldReplacement(void) {
    // Includes an unmodified hold followed by a modified hold: release first.
    reset(); activeConfig[9] = CONFIG_ACTION_CONSUMER_HOLD; activeConfig[10] = 0xe9;
    holdBinding(1, 6, 0x6f); actionsPress(0, 0); actionsPoll(0);
    actionsPress(1, 1); actionsPoll(1);
    assertConsumer(0, 0xe9); assertConsumer(1, 0);
    assertModifiers(2, 6); assertConsumer(3, 0x6f);
    actionsRelease(0); pump(2, 10); assert(count == 4);
    actionsRelease(1); pump(10, 20); assertConsumer(4, 0); assertModifiers(5, 0);
    // Keep an unmodified tap's pending release before applying hold modifiers.
    reset(); activeConfig[9] = CONFIG_ACTION_CONSUMER; activeConfig[10] = 0x6f;
    holdBinding(1, 6, 0x6f); actionsPress(0, 0); actionsPoll(0);
    actionsPress(1, 1); actionsPoll(1);
    assertConsumer(0, 0x6f); assertConsumer(1, 0);
    assertModifiers(2, 6); assertConsumer(3, 0x6f);
    // Holds, taps, modified/unmodified replacements, without restoring old holds.
    const uint8_t replacements[] = {CONFIG_ACTION_CONSUMER, CONFIG_ACTION_CONSUMER_HOLD,
                                    0x90 | CONFIG_ACTION_CONSUMER_MODIFIED,
                                    0x90 | CONFIG_ACTION_CONSUMER_MODIFIED_HOLD};
    for (unsigned k = 0; k < sizeof replacements; k++) {
        reset(); holdBinding(0, 6, 0x6f);
        activeConfig[11] = replacements[k]; activeConfig[12] = 0x70;
        actionsPress(0, 0); actionsPoll(0);
        blocked = 1; actionsPress(1, 1); pump(1, 10); assert(count == 2);
        blocked = 0; actionsPoll(10); assertConsumer(2, 0);
        assertModifiers(3, k >= 2 ? 9 : 0); assertConsumer(4, 0x70);
        actionsRelease(0); actionsRelease(1); pump(11, 30);
        assert(!latestModifiers()); unsigned before = count;
        pump(30, 100); assert(count == before);
    }
}

int main(void) {
    testHoldEncoding(); testHoldLifecycle(); testHoldReplacement();
    return 0;
}
