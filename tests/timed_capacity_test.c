/* Five user timers, built-in sleep and distinct macro telemetry sources. */

#define main originalActionsMain
#include "actions_test.c"
#undef main
#undef actionsTimedReset
#undef actionsTimedPoll
extern uint8_t liveBindings[];
static uint8_t fine;
static void advance(unsigned coarse) {
    for (unsigned i = 0; i < coarse * 2; i++) { fine += 128; actionsTimedPoll(fine); }
}
int main(void) {
    reset(); testLoadStarterProfile(PHYSICAL_VARIANT); testSetTimedCount(5);
    unsigned start = configTimedOffset();
    for (unsigned i = 0; i < 5; i++) {
        unsigned offset = start + 6 * i;
        activeConfig[offset] = i;
        activeConfig[offset + 1] = ((i % 3) << 4) | CONFIG_ACTION_LED_CONTROL;
        activeConfig[offset + 2] = CONFIG_LED_KEY_SET;
        activeConfig[offset + 3] = CONFIG_ACTION_LED_CONTROL;
        activeConfig[offset + 4] = CONFIG_LED_KEY_SET;
        activeConfig[offset + 5] = CONFIG_TIMED_CONSUME;
    }
    uint16_t crc = configCrc(activeConfig); activeConfig[7] = crc; activeConfig[8] = crc >> 8;
    assert(configValid(activeConfig, PHYSICAL_VARIANT));
    actionsInit(); actionsTimedReset(0); fine = 0; ledCalls = 0;
    advance(5); assert(ledCalls == 10 && liveBindings[9] == 0x8D);
    assert(actionsTimedInput()); assert(ledCalls == 15 && liveBindings[9] == 0x8D);
    assert(!actionsTimedInput());
    // Long user timers leave the sixth runtime slot available for Auto-Sleep.
    for (unsigned i = 0; i < 5; i++) { activeConfig[start + 6 * i] = 255; activeConfig[start + 6 * i + 5] = 56; }
    activeConfig[9 + (PHYSICAL_VARIANT ? 15 : 22) - 1] |= CONFIG_LAYER_OPT_AUTO_SLEEP;
    actionsTimedReset(0); fine = 0; ledCalls = 0;
    advance(440); assert(ledCalls == 1 && liveBindings[9] == 0x8E);
    assert(actionsTimedInput()); assert(ledCalls == 2 && liveBindings[9] == 0x8E);
    // Macro dispatch has a distinct source after moving the sleep slot to ID 14.
    unsigned macro = start + 30;
    activeConfig[9] = CONFIG_ACTION_MACRO; activeConfig[10] = macro;
    activeConfig[macro] = CONFIG_ACTION_LED_CONTROL; activeConfig[macro + 1] = CONFIG_LED_KEY_SET;
    activeConfig[macro + 2] = 0;
    actionsPress(0, 0); actionsRelease(0, 0);
    for (unsigned i = 0; i < 20; i++) actionsPoll(i);
    assert(liveBindings[9] == 0x8F);
    return 0;
}
