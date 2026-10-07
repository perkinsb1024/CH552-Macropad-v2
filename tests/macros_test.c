#include <assert.h>
#include <stdint.h>
#include <string.h>
#include "../src/actions.h"
#include "config_fixture.h"

static uint8_t reports[1024][9];
static unsigned count, ledCalls;
static uint8_t blocked, pending, generation, ledCommand, ledValue;
uint8_t USB_queueKeyboard(const uint8_t *keys) {
    if (blocked) return 0;
    assert(count < 1024); reports[count][0] = 1;
    memcpy(reports[count++] + 1, keys, 8); return 1;
}
uint8_t USB_queueMouse(uint8_t buttons, int8_t x, int8_t y, int8_t wheel) {
    if (blocked) return 0;
    assert(count < 1024); uint8_t *r = reports[count++];
    r[0] = 2; r[1] = buttons & 7; r[2] = x; r[3] = y;
    r[4] = buttons & 128 ? 0 : wheel; r[5] = buttons & 128 ? wheel : 0;
    return 1;
}
uint8_t USB_queueConsumer(uint16_t usage) {
    if (blocked) return 0;
    assert(count < 1024); reports[count][0] = 5;
    reports[count][1] = usage; reports[count++][2] = usage >> 8; return 1;
}
uint8_t USB_reportsPending(void) { return pending; }
void USB_discardReports(void) { pending = 0; }
uint8_t USB_reportGeneration(void) { return generation; }
uint8_t USB_asciiUsage(uint8_t c) { return c & 127; }
void firmwareLedAction(uint8_t command, uint8_t value) {
    ledCalls++; ledCommand = command; ledValue = value;
}
static void seal(void) {
    uint16_t crc = configCrc(activeConfig); activeConfig[6] = crc; activeConfig[7] = crc >> 8;
}
static uint8_t start;
static void reset(void) {
    testLoadStarterProfile(PHYSICAL_VARIANT);
    start = configTimedOffset();
    blocked = pending = 0; count = ledCalls = 0;
    actionsInit(); actionsTimedReset(0);
}
static void bind(uint8_t input, uint8_t macro, uint8_t repeat) {
    activeConfig[9 + 2 * input] = CONFIG_ACTION_MACRO | ((repeat - 1) << 4);
    activeConfig[10 + 2 * input] = macro;
}
static uint8_t define(uint8_t offset, const uint8_t *bytes, uint8_t steps) {
    memcpy(activeConfig + offset, bytes, 2 * steps);
#if CONFIG_MACRO_STYLE == 1
    assert(steps <= 2); return offset + 4;
#else
    if (offset + 2 * steps < CONFIG_SIZE) activeConfig[offset + 2 * steps] = 0;
    return offset + 2 * steps + 1;
#endif
}
static void press(uint8_t key, uint16_t now) { actionsPress(key, now); actionsRelease(key); }
static void pump(uint16_t first, uint16_t end) {
    for (uint16_t now = first; now < end; now++) actionsPoll(now);
}
static unsigned keyPresses(uint8_t usage) {
    unsigned found = 0;
    for (unsigned i = 0; i < count; i++) if (reports[i][0] == 1 && reports[i][3] == usage) found++;
    return found;
}
static void testValidation(void) {
    reset(); const uint8_t pair[] = {1, 4, 1, 5};
    uint8_t second = define(start, pair, 2); define(second, pair, 2);
    activeConfig[5] |= CONFIG_HEADER_TRANSPARENT_BLACK;
    for (unsigned ref = 0; ref < 256; ref++) {
        for (uint8_t aux = 0; aux < 16; aux++) {
            activeConfig[9] = CONFIG_ACTION_MACRO | (aux << 4); activeConfig[10] = ref; seal();
            uint8_t expected;
#if CONFIG_MACRO_STYLE == 1
            expected = ref >= start && ref <= 124 && !((ref - start) & 3) && (CONFIG_MACRO_REPEAT || !aux);
#else
            expected = ref >= start && ref < CONFIG_SIZE &&
                       ref != start + 1 && ref != start + 3 &&
                       ref != second + 1 && ref != second + 3 &&
                       (CONFIG_MACRO_REPEAT || !aux);
#endif
            assert(!!configValid(activeConfig, PHYSICAL_VARIANT) == expected);
        }
    }
    bind(0, start, 1);
    for (unsigned first = 0; first < 256; first++) {
        // Every flavor of a nested macro is invalid, even in an unreachable record.
        activeConfig[start] = (first & 0xF0) | CONFIG_ACTION_MACRO;
        activeConfig[start + 1] = second; seal(); assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    }
    const uint8_t holds[] = {CONFIG_ACTION_KEY_HOLD, CONFIG_ACTION_MOUSE_HOLD, CONFIG_ACTION_CONSUMER_HOLD, CONFIG_ACTION_MOMENTARY_LAYER, CONFIG_SCROLL_HOLD | CONFIG_ACTION_SCROLL, CONFIG_MOUSE_MOVE_HOLD | CONFIG_ACTION_MOUSE_X, CONFIG_MOUSE_MOVE_HOLD | CONFIG_ACTION_MOUSE_Y};
    for (unsigned i = 0; i < sizeof holds; i++) {
        activeConfig[start] = holds[i]; activeConfig[start + 1] = 1;
        seal(); assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    }
    activeConfig[start] = 1; activeConfig[start + 1] = 4;
    seal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    activeConfig[6] ^= 1; assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    // Align the start at 124: the last pair must remain inside the image.
    reset(); activeConfig[4] = 124 - start; start = 124;
    activeConfig[124] = 1; activeConfig[125] = 4;
    activeConfig[126] = 1; activeConfig[127] = 5;
    bind(0, start, 1); seal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    press(0, 0); pump(0, 80); assert(keyPresses(4) == 1 && keyPresses(5) == 1);
    // Padding cannot hide an unpaired opcode, regardless of tail alignment.
    reset(); activeConfig[127] = 1; seal();
#if CONFIG_MACRO_STYLE == 1
    if ((start & 1) != 0) assert(!configValid(activeConfig, PHYSICAL_VARIANT));
#else
    assert(!configValid(activeConfig, PHYSICAL_VARIANT));
#endif
}
static void testSingleByteTerminators(void) {
#if CONFIG_MACRO_STYLE == 2
    reset();
    const uint8_t first[] = {CONFIG_ACTION_KEY_TAP, 4};
    // A zero parameter and an opcode-looking parameter are still action data.
    const uint8_t next[] = {0x11, 0, CONFIG_ACTION_CONSUMER, 0xF0, CONFIG_ACTION_KEY_TAP, 5};
    uint8_t second = define(start, first, 1);
    define(second, next, 3);
    bind(0, start, 1); bind(1, second, 2); seal();
    assert(configValid(activeConfig, PHYSICAL_VARIANT));
    press(0, 0); press(1, 1); pump(0, 250);
    assert(keyPresses(4) == 1 && keyPresses(5) == 2);
    // Suffixes work after parity changes, but neither parameter is a start.
    bind(0, second + 4, 1); seal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    bind(0, second + 1, 1); seal(); assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    bind(0, second + 3, 1); seal(); assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    // The last byte can hold a referenced empty sequence, including repeats.
    reset(); bind(0, 127, CONFIG_MACRO_REPEAT ? 16 : 1); seal();
    assert(configValid(activeConfig, PHYSICAL_VARIANT));
    press(0, 0); pump(0, 100); assert(count == 0);
    // A final action can end at 126 with its sole terminator at 127.
    reset(); activeConfig[125] = CONFIG_ACTION_KEY_TAP; activeConfig[126] = 4;
    bind(0, 125, CONFIG_MACRO_REPEAT ? 2 : 1); seal();
    assert(configValid(activeConfig, PHYSICAL_VARIANT));
    press(0, 0); pump(0, 100); assert(keyPresses(4) == (CONFIG_MACRO_REPEAT ? 2 : 1));
#endif
}
static void testRepeatsAndOrdering(void) {
    for (uint8_t repeat = 1; repeat <= (CONFIG_MACRO_REPEAT ? 16 : 1); repeat++) {
        reset(); const uint8_t pair[] = {0x81, 0x2C, 1, 0x28};
        define(start, pair, 2); bind(0, start, repeat);
        activeConfig[11] = 1; activeConfig[12] = 6;
        press(0, 0); press(1, 1);
        pending = 1; pump(0, 50); assert(count == 0);
        pending = 0; blocked = 1; pump(50, 100); assert(count == 0);
        blocked = 0; pump(100, 1000);
        assert(count == (unsigned)(repeat * 4 + 2));
        for (unsigned i = 0; i < (unsigned)repeat * 4; i += 4) {
            assert(reports[i][1] == 8 && reports[i][3] == 0x2C);
            assert(reports[i + 1][1] == 0 && reports[i + 1][3] == 0);
            assert(reports[i + 2][3] == 0x28 && reports[i + 3][3] == 0);
        }
        assert(reports[count - 2][3] == 6 && reports[count - 1][3] == 0);
        assert(!actionsDropped(0));
    }
}
static void testLongAndStrings(void) {
#if CONFIG_MACRO_STYLE == 2
    reset();
    memcpy(activeConfig + start, "chrome", 7); activeConfig[4] = 7; start += 7;
    const uint8_t launch[] = {0x81, 0x2C, CONFIG_ACTION_STRING, 0, 1, 0x28};
    define(start, launch, 3); bind(0, start, 1); seal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    press(0, 0); pump(0, 200); assert(count == 16);
    assert(reports[0][1] == 8 && reports[0][3] == 0x2C);
    for (unsigned i = 0; i < 6; i++) assert(reports[2 + 2 * i][3] == (uint8_t)"chrome"[i]);
    assert(reports[14][3] == 0x28);
    reset();
    // More steps than the physical event queue: expansion streams one at a time.
    for (uint8_t i = 0; i < 40; i++) { activeConfig[start + 2 * i] = 1; activeConfig[start + 2 * i + 1] = 4 + i; }
    bind(0, start, 1); seal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    press(0, 0); pump(0, 1000); assert(count == 80 && !actionsDropped(0));
#endif
}
static void testTriggersAndCancellation(void) {
    reset(); const uint8_t pair[] = {1, 4, 1, 5}; define(start, pair, 2);
    bind(configKeyCount() + 1, start, 1); actionsRotate(1); pump(0, 100);
    assert(keyPresses(4) == 1 && keyPresses(5) == 1);
    reset();
    // Timer data precedes strings/macros. A timer can invoke the same sequence.
    uint8_t timer = start; activeConfig[3] = 1 << 6; start += CONFIG_TIMED_SIZE;
    memset(activeConfig + timer, 0, CONFIG_TIMED_SIZE);
    activeConfig[timer + 1] = CONFIG_ACTION_MACRO; activeConfig[timer + 2] = start;
    define(start, pair, 2); seal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    actionsTimedReset(0); actionsTimedPoll(128); actionsTimedPoll(0); pump(0, 100);
    assert(keyPresses(4) == 1 && keyPresses(5) == 1);
    reset(); define(start, pair, 2); bind(0, start, 1);
    press(0, 0); pump(0, 2); actionsClear(); count = 0; pump(2, 100); assert(!keyPresses(5));
    reset();
    // Actual layer transitions abort playback and queued macro invocations.
    activeConfig[3] = 1; start = configTimedOffset();
    memset(activeConfig + 9 + (PHYSICAL_VARIANT ? 15 : 22), 0, PHYSICAL_VARIANT ? 15 : 22);
    define(start, pair, 2); bind(0, start, 1);
    activeConfig[11] = CONFIG_ACTION_SET_LAYER; activeConfig[12] = 1;
    press(0, 0); pump(0, 2); press(1, 2); pump(2, 100);
    assert(actionsLayer() == 1 && !keyPresses(5));
}
static void testQueueAndChords(void) {
    reset(); const uint8_t pair[] = {1, 4, 1, 5}; define(start, pair, 2); bind(0, start, 1);
    blocked = 1;
    for (uint8_t i = 0; i < 9; i++) press(0, i);
    assert(actionsDropped(0) == 1); blocked = 0; pump(10, 500);
    assert(keyPresses(4) == 8 && keyPresses(5) == 8);
    reset();
    // A chord's macro reference is resolved at the physical trigger, like taps.
    uint8_t chord = start; activeConfig[5] |= 2; start += 3;
    activeConfig[chord] = 0; activeConfig[chord + 1] = CONFIG_ACTION_MACRO;
    activeConfig[chord + 2] = start; define(start, pair, 2);
    seal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    actionsPress(0, 0); actionsPress(1, 5); actionsRelease(0); actionsRelease(1);
    pump(5, 100); assert(keyPresses(4) == 1 && keyPresses(5) == 1);
}
static void testHeldPointer(void) {
    reset(); const uint8_t pair[] = {1, 4, 1, 5}; define(start, pair, 2); bind(0, start, 1);
    activeConfig[11] = CONFIG_MOUSE_MOVE_HOLD | CONFIG_ACTION_MOUSE_X;
    activeConfig[12] = 1;
    actionsPress(1, 0); actionsPoll(0); press(0, 1); pump(1, 20);
    unsigned moves = 0;
    for (unsigned i = 0; i < count; i++) if (reports[i][0] == 2 && reports[i][2]) moves++;
    assert(moves == 1 && keyPresses(4) == 1 && keyPresses(5) == 1);
    actionsRelease(1); pump(20, 100);
}
static void testPause(void) {
#if CONFIG_MACRO_PAUSE
    const uint8_t ticks[] = {0, 1, 2, 16, 127, 255};
    for (unsigned i = 0; i < sizeof ticks; i++) {
        reset(); const uint8_t pair[] = {CONFIG_ACTION_PAUSE, ticks[i], 1, 4};
        define(start, pair, 2); bind(0, start, 1); seal();
        assert(configValid(activeConfig, PHYSICAL_VARIANT));
        uint16_t origin = 65520, duration = (uint16_t)ticks[i] * 16;
        press(0, origin);
        for (uint32_t elapsed = 0; elapsed < duration + 2u; elapsed++)
            actionsPoll(origin + elapsed);
        assert(!keyPresses(4));
        for (uint32_t elapsed = duration + 2u; elapsed < duration + 50u; elapsed++)
            actionsPoll(origin + elapsed);
        assert(keyPresses(4) == 1);
    }
#endif
}
static void testImmediateSteps(void) {
    reset(); const uint8_t toggle[] = {CONFIG_ACTION_MOUSE_TOGGLE, 1, CONFIG_ACTION_LED_CONTROL, CONFIG_LED_RESTORE};
    define(start, toggle, 2); bind(0, start, 1);
    activeConfig[11] = CONFIG_ACTION_MOUSE_TOGGLE; activeConfig[12] = 2;
    press(1, 0); press(0, 1); pump(0, 80);
    assert(ledCalls == 1 && ledCommand == CONFIG_LED_RESTORE && ledValue == 0);
    assert(reports[count - 1][1] == 3); // Independent owners combine.
    press(0, 80); pump(80, 160); assert(reports[count - 1][1] == 2);
    reset(); const uint8_t media[] = {CONFIG_ACTION_CONSUMER, 0xE9, 1, 4};
    define(start, media, 2); bind(0, start, 1); press(0, 0); pump(0, 100);
    assert(count == 4 && reports[0][0] == 5 && reports[0][1] == 0xE9);
    assert(reports[1][0] == 5 && reports[1][1] == 0 && reports[2][3] == 4);
}
int main(void) {
    testValidation(); testSingleByteTerminators(); testRepeatsAndOrdering(); testLongAndStrings();
    testTriggersAndCancellation(); testImmediateSteps(); testQueueAndChords(); testPause(); testHeldPointer();
    return 0;
}
