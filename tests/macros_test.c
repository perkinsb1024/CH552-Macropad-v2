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
uint8_t USB_queueMousePacked(uint8_t buttons, int8_t x, int8_t y, uint8_t scroll) {
    if (blocked) return 0;
    assert(count < 1024); uint8_t *r = reports[count++];
    r[0] = 2; r[1] = buttons; r[2] = x; r[3] = y;
    r[4] = (scroll & 15) == 15 ? -1 : scroll & 15; r[5] = (scroll >> 4) == 15 ? -1 : scroll >> 4;
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
    if (offset + 2 * steps < CONFIG_SIZE) activeConfig[offset + 2 * steps] = 0;
    return offset + 2 * steps + 1;
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
            expected = ref >= start && ref < CONFIG_SIZE &&
                       ref != start + 1 && ref != start + 3 &&
                       ref != second + 1 && ref != second + 3 &&
                       (CONFIG_MACRO_REPEAT || !aux);
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
    assert(!configValid(activeConfig, PHYSICAL_VARIANT));
}
static void testSingleByteTerminators(void) {
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
#if CONFIG_TYPE_TEXT
    reset();
    memcpy(activeConfig + start, "chrome", 7); activeConfig[4] = 7; start += 7;
    const uint8_t launch[] = {0x81, 0x2C, CONFIG_ACTION_STRING, 0, 1, 0x28};
    define(start, launch, 3); bind(0, start, 1); seal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    press(0, 0); pump(0, 400); assert(count == 16);
    assert(reports[0][1] == 8 && reports[0][3] == 0x2C);
    for (unsigned i = 0; i < 6; i++) assert(reports[2 + 2 * i][3] == (uint8_t)"chrome"[i]);
    assert(reports[14][3] == 0x28);
#endif
    reset();
    // More steps than the physical event queue: expansion streams one at a time.
    for (uint8_t i = 0; i < 40; i++) { activeConfig[start + 2 * i] = 1; activeConfig[start + 2 * i + 1] = 4 + i; }
    bind(0, start, 1); seal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    press(0, 0); pump(0, 1000); assert(count == 80 && !actionsDropped(0));
}
#if CONFIG_TYPE_TEXT
static void testTextCharacterPause(void) {
    // Include Enter, repeated characters, and a deadline across clock wrap.
    const uint8_t text[] = {'s', 's', '\n', 0};
    for (unsigned wrap = 0; wrap < 2; wrap++) {
        reset();
        memcpy(activeConfig + start, text, sizeof text);
        activeConfig[4] = sizeof text;
        activeConfig[9] = CONFIG_ACTION_STRING; activeConfig[10] = 0;
        seal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
        uint16_t origin = wrap ? 65520 : 0;
        unsigned presses = 0, lastRelease = 0;
        press(0, origin);
        for (unsigned elapsed = 0; elapsed < 200; elapsed++) {
            unsigned before = count;
            actionsPoll((uint16_t)(origin + elapsed));
            for (unsigned i = before; i < count; i++) {
                if (reports[i][0] != 1) continue;
                if (reports[i][3]) {
                    assert(presses < 3 && reports[i][3] == text[presses]);
                    if (presses) assert(elapsed - lastRelease >= 32);
                    presses++;
                } else lastRelease = elapsed;
            }
        }
        assert(presses == 3 && count == 6);
    }
}
#endif
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
    assert(reports[count - 1][1] == 3); // Different button bits combine in the shared toggle state.
    press(0, 80); pump(80, 160); assert(reports[count - 1][1] == 2);
    reset(); const uint8_t media[] = {CONFIG_ACTION_CONSUMER, 0xE9, 1, 4};
    define(start, media, 2); bind(0, start, 1); press(0, 0); pump(0, 100);
    assert(count == 4 && reports[0][0] == 5 && reports[0][1] == 0xE9);
    assert(reports[1][0] == 5 && reports[1][1] == 0 && reports[2][3] == 4);
}
static uint8_t latestMouse(void) {
    for (unsigned i = count; i > 0; i--)
        if (reports[i - 1][0] == 2) return reports[i - 1][1];
    return 0;
}
static void testGlobalToggle(void) {
    // The reported physical-key/macro case, in both directions.
    reset(); const uint8_t toggle[] = {CONFIG_ACTION_MOUSE_TOGGLE, 1};
    define(start, toggle, 1); bind(0, start, 1);
    activeConfig[11] = CONFIG_ACTION_MOUSE_TOGGLE; activeConfig[12] = 1;
    press(1, 0); pump(0, 50); assert(latestMouse() == 1);
    press(0, 50); pump(50, 100); assert(latestMouse() == 0);
    press(0, 100); pump(100, 150); assert(latestMouse() == 1);
    press(1, 150); pump(150, 200); assert(latestMouse() == 0);
    // Another physical binding shares the state too.
    activeConfig[9] = CONFIG_ACTION_MOUSE_TOGGLE; activeConfig[10] = 1;
    press(0, 200); pump(200, 250); assert(latestMouse() == 1);
    press(1, 250); pump(250, 300); assert(latestMouse() == 0);
    // Toggle-off must not release an independently held button.
    bind(0, start, 1);
    activeConfig[13] = CONFIG_ACTION_MOUSE_HOLD; activeConfig[14] = 1;
    actionsPress(2, 300); pump(300, 350); assert(latestMouse() == 1);
    press(1, 350); pump(350, 400); assert(latestMouse() == 1);
    press(0, 400); pump(400, 450); assert(latestMouse() == 1);
    actionsRelease(2); pump(450, 500); assert(latestMouse() == 0);
    // Clear/reset removes toggles.
    press(0, 500); pump(500, 550); assert(latestMouse() == 1);
    actionsClear(); pump(550, 600); assert(latestMouse() == 0);
    // Effective layer changes remove toggles.
    reset(); activeConfig[3] = 1; start = configTimedOffset();
    memset(activeConfig + 9 + (PHYSICAL_VARIANT ? 15 : 22), 0,
           PHYSICAL_VARIANT ? 15 : 22);
    define(start, toggle, 1); bind(0, start, 1);
    activeConfig[11] = CONFIG_ACTION_SET_LAYER; activeConfig[12] = 1;
    press(0, 0); pump(0, 50); assert(latestMouse() == 1);
    press(1, 50); pump(50, 100);
    assert(actionsLayer() == 1 && latestMouse() == 0);
}

static void testGlobalToggleSources(void) {
    // Overlapping masks toggle each selected button bit independently.
    reset();
    const uint8_t toggle[] = {CONFIG_ACTION_MOUSE_TOGGLE, 3};
    define(start, toggle, 1); bind(0, start, 1);
    activeConfig[11] = CONFIG_ACTION_MOUSE_TOGGLE; activeConfig[12] = 1;
    press(1, 0); pump(0, 50); assert(latestMouse() == 1);
    press(0, 50); pump(50, 100); assert(latestMouse() == 2);
    press(0, 100); pump(100, 150); assert(latestMouse() == 1);
    // Encoder rotation shares the physical key's state.
    reset();
    activeConfig[9] = CONFIG_ACTION_MOUSE_TOGGLE; activeConfig[10] = 1;
    uint8_t clockwise = 9 + 2 * (configKeyCount() + 1);
    activeConfig[clockwise] = CONFIG_ACTION_MOUSE_TOGGLE;
    activeConfig[clockwise + 1] = 1;
    press(0, 0); pump(0, 50); assert(latestMouse() == 1);
    actionsRotate(1); pump(50, 100); assert(latestMouse() == 0);
    // A chord can undo a key toggle.
    reset();
    uint8_t chord = start; activeConfig[5] |= 2;
    activeConfig[chord] = 0;
    activeConfig[chord + 1] = CONFIG_ACTION_MOUSE_TOGGLE;
    activeConfig[chord + 2] = 1;
    activeConfig[13] = CONFIG_ACTION_MOUSE_TOGGLE; activeConfig[14] = 1;
    press(2, 0); pump(0, 50); assert(latestMouse() == 1);
    actionsPress(0, 50); actionsPress(1, 55);
    actionsRelease(0); actionsRelease(1);
    pump(55, 100); assert(latestMouse() == 0);
    // Timer expiry and its follow-up share the macro's toggle state.
    reset();
    uint8_t timer = start; activeConfig[3] = 1 << 6;
    start += CONFIG_TIMED_SIZE;
    memset(activeConfig + timer, 0, CONFIG_TIMED_SIZE);
    activeConfig[timer + 1] = CONFIG_ACTION_MOUSE_TOGGLE;
    activeConfig[timer + 2] = 1;
    activeConfig[timer + 3] = CONFIG_ACTION_MOUSE_TOGGLE;
    activeConfig[timer + 4] = 1;
    const uint8_t left[] = {CONFIG_ACTION_MOUSE_TOGGLE, 1};
    define(start, left, 1); bind(0, start, 1);
    seal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    actionsTimedReset(0); actionsTimedPoll(128); actionsTimedPoll(0);
    pump(0, 50); assert(latestMouse() == 1);
    press(0, 50); pump(50, 100); assert(latestMouse() == 0);
    assert(!actionsTimedInput()); pump(100, 150); assert(latestMouse() == 1);
    press(0, 150); pump(150, 200); assert(latestMouse() == 0);
}

static void testPersistentMouse(void) {
    for (unsigned mask = 1; mask < 256; mask++) {
        reset();
        activeConfig[9] = CONFIG_ACTION_MOUSE_DOWN; activeConfig[10] = mask;
        activeConfig[11] = CONFIG_ACTION_MOUSE_UP; activeConfig[12] = mask;
        activeConfig[13] = CONFIG_ACTION_MOUSE_TOGGLE; activeConfig[14] = mask;
        press(0, 0); pump(0, 10); assert(latestMouse() == mask && count == 1);
        press(0, 10); pump(10, 20); assert(count == 1); // Idempotent; no second edge.
        press(1, 20); pump(20, 30); assert(latestMouse() == 0 && count == 2);
        press(1, 30); pump(30, 40); assert(count == 2);
        press(2, 40); pump(40, 50); assert(latestMouse() == mask);
        press(0, 50); press(1, 51); pump(51, 60); assert(latestMouse() == 0);
        // Persistent up cannot release a physical hold.
        activeConfig[13] = CONFIG_ACTION_MOUSE_HOLD;
        actionsPress(2, 60); pump(60, 70); assert(latestMouse() == mask);
        press(0, 70); press(1, 71); pump(71, 80); assert(latestMouse() == mask);
        actionsRelease(2); pump(80, 90); assert(latestMouse() == 0);
        press(0, 90); pump(90, 100); actionsClear(); pump(100, 110); assert(latestMouse() == 0);
    }
    reset(); activeConfig[9] = CONFIG_ACTION_MOUSE_DOWN; activeConfig[10] = 0xFF;
    press(0, 0); pump(0, 10); count = 0; generation++;
    blocked = 1; pump(10, 20); assert(count == 0);
    blocked = 0; pump(20, 30); assert(latestMouse() == 0xFF); // Reassert all buttons after USB generation change.
    // Different selected bits remain independent, including button 8.
    reset();
    activeConfig[9] = CONFIG_ACTION_MOUSE_DOWN; activeConfig[10] = 0xFF;
    activeConfig[11] = CONFIG_ACTION_MOUSE_UP; activeConfig[12] = 0x55;
    press(0, 0); press(1, 1); pump(1, 10); assert(latestMouse() == 0xAA);
    // Clicks are independent from persistent state.
    activeConfig[13] = CONFIG_ACTION_MOUSE_CLICK; activeConfig[14] = 0x55;
    press(2, 10); pump(10, 30); assert(latestMouse() == 0xAA);
    assert(reports[count - 2][1] == 0xFF);
    // Effective-layer transition clears all eight bits.
    activeConfig[3] = 1;
    activeConfig[13] = CONFIG_ACTION_SET_LAYER; activeConfig[14] = 1;
    press(2, 30); pump(30, 40); assert(latestMouse() == 0);
}

static void testMouseDragAndScroll(void) {
    reset();
    const uint8_t drag[] = {
        CONFIG_ACTION_MOUSE_DOWN, 0x80,
        CONFIG_ACTION_MOUSE_DOWN, 0x80,
        CONFIG_ACTION_MOUSE_X, 12,
        CONFIG_ACTION_SCROLL, 2,
        CONFIG_ACTION_SCROLL | CONFIG_SCROLL_HORIZONTAL, 0xFD,
        CONFIG_ACTION_PAUSE, 1,
        CONFIG_ACTION_MOUSE_UP, 0x80,
        CONFIG_ACTION_MOUSE_UP, 0x80,
    };
    define(start, drag, 8); bind(0, start, 1); seal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    press(0, 0); pump(0, 2); assert(count == 0);
    // Down is applied once while a full transport refuses the changed report.
    blocked = 1; pump(2, 10); assert(count == 0);
    blocked = 0; actionsPoll(10); assert(count == 1 && latestMouse() == 0x80);
    pending = 1; pump(11, 30); assert(count == 1); // No movement before down drains.
    pending = 0; pump(30, 200);
    assert(count == 8); // Down, X, two vertical, three horizontal, up.
    assert(reports[1][1] == 0x80 && reports[1][2] == 12);
    for (unsigned i = 2; i < 4; i++) assert(reports[i][1] == 0x80 && reports[i][4] == 1 && !reports[i][5]);
    for (unsigned i = 4; i < 7; i++) assert(reports[i][1] == 0x80 && !reports[i][4] && reports[i][5] == 255);
    assert(!reports[7][1]);
    // Cancellation removes persistent drag state and the queued release/movement.
    reset(); define(start, drag, 8); bind(0, start, 1);
    press(0, 0); pump(0, 3); assert(latestMouse() == 0x80);
    actionsClear(); count = 0; pump(3, 100); assert(!count);
    // Macro completion retains a persistent press for a separate input to clear.
    reset(); const uint8_t down[] = {CONFIG_ACTION_MOUSE_DOWN, 0xF8};
    define(start, down, 1); bind(0, start, 2);
    activeConfig[11] = CONFIG_ACTION_MOUSE_UP; activeConfig[12] = 0xF8;
    press(0, 0); pump(0, 30); assert(latestMouse() == 0xF8 && count == 1);
    press(1, 30); pump(30, 40); assert(latestMouse() == 0);
}

static void testMouseSources(void) {
    reset();
    activeConfig[9] = CONFIG_ACTION_MOUSE_DOWN; activeConfig[10] = 0x80;
    uint8_t cw = 9 + 2 * (configKeyCount() + 1);
    activeConfig[cw] = CONFIG_ACTION_MOUSE_UP; activeConfig[cw + 1] = 0x80;
    press(0, 0); pump(0, 10); actionsRotate(1); pump(10, 20); assert(latestMouse() == 0);
    reset(); uint8_t chord = start; activeConfig[5] |= 2;
    activeConfig[chord] = 0; activeConfig[chord + 1] = CONFIG_ACTION_MOUSE_DOWN; activeConfig[chord + 2] = 0xF8;
    actionsPress(0, 0); actionsPress(1, 5); actionsRelease(0); actionsRelease(1);
    pump(5, 20); assert(latestMouse() == 0xF8);
    reset(); uint8_t timer = start; activeConfig[3] = 1 << 6;
    memset(activeConfig + timer, 0, CONFIG_TIMED_SIZE);
    activeConfig[timer + 1] = CONFIG_ACTION_MOUSE_DOWN; activeConfig[timer + 2] = 0xFF;
    activeConfig[timer + 3] = CONFIG_ACTION_MOUSE_UP; activeConfig[timer + 4] = 0xFF;
    seal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    actionsTimedReset(0); actionsTimedPoll(128); actionsTimedPoll(0); pump(0, 10); assert(latestMouse() == 0xFF);
    assert(!actionsTimedInput()); pump(10, 20); assert(latestMouse() == 0);
}

int main(void) {
    testPersistentMouse(); testMouseDragAndScroll(); testMouseSources();
    testGlobalToggleSources();
    testGlobalToggle();
#if CONFIG_TYPE_TEXT
    testTextCharacterPause();
#endif
    testValidation(); testSingleByteTerminators(); testRepeatsAndOrdering(); testLongAndStrings();
    testTriggersAndCancellation(); testImmediateSteps(); testQueueAndChords(); testPause(); testHeldPointer();
    return 0;
}
