#include <assert.h>
#include <stdint.h>
#include <string.h>
#include "../src/actions.h"
#include "config_fixture.h"
#include "../src/config.h"

static uint8_t reports[64][9];
static uint16_t reportNow, reportTimes[64];
static uint8_t count;
static uint8_t blocked;
static uint8_t reportLimit;
static uint8_t generation;

uint8_t USB_queueKeyboard(const uint8_t *keys) {
    if (blocked || count == reportLimit) {
        return 0;
    }
    assert(count < 64);
    reports[count][0] = 1;
    memcpy(reports[count] + 1, keys, 8);
    count++;
    return 1;
}

uint8_t USB_queueMouse(uint8_t buttons, int8_t x, int8_t y, int8_t wheel) {
    if (blocked || count == reportLimit) {
        return 0;
    }
    assert(count < 64);
    reports[count][0] = 2;
    reports[count][1] = buttons;
    reports[count][2] = x;
    reports[count][3] = y;
    reports[count][4] = wheel;
    reportTimes[count] = reportNow;
    count++;
    return 1;
}

uint8_t USB_queueConsumer(uint16_t usage) {
    if (blocked || count == reportLimit) {
        return 0;
    }
    assert(count < 64);
    reports[count][0] = 5;
    reports[count][1] = usage;
    reports[count][2] = usage >> 8;
    count++;
    return 1;
}

uint8_t USB_reportsPending(void) { return 0; }
void USB_discardReports(void) {}
uint8_t USB_reportGeneration(void) { return generation; }
uint8_t USB_asciiUsage(uint8_t c) { return c == 'A' ? 0x84 : 0x04; }

static uint16_t ledCalls;
static uint8_t ledCommand, ledValue, ledLayer;
void firmwareLedAction(uint8_t command, uint8_t value) {
    ledCalls++; ledCommand = command; ledValue = value; ledLayer = actionsLayer();
}

static void reset(void) {
    testLoadStarterProfile(CONFIG_SIX_KEYS);
    actionsInit();
    count = 0;
    blocked = 0;
    reportLimit = 64;
    ledCalls = 0;
}

// Existing timer regressions describe coarse intervals. Drive the real fine
// clock twice by 128 ticks for every requested coarse tick, including wraps.
static uint8_t testCoarseClock, testFineClock;
static void resetCoarse(uint8_t tick) {
    testCoarseClock = tick;
    testFineClock = 0;
    actionsTimedReset(0);
}
static void pollCoarse(uint8_t tick) {
    uint8_t elapsed = tick - testCoarseClock;
    testCoarseClock = tick;
    while (elapsed--) {
        testFineClock += 128; actionsTimedPoll(testFineClock);
        testFineClock += 128; actionsTimedPoll(testFineClock);
    }
}

static void testTimedPrecision(void) {
    reset();
    uint8_t timer = configTimedOffset();
    activeConfig[3] = 2 << 6;
    activeConfig[timer] = 0; // Periodic, independent of physical input.
    activeConfig[timer + 1] = CONFIG_ACTION_LED_CONTROL;
    activeConfig[timer + 2] = CONFIG_LED_INDICATOR_SET;
    activeConfig[timer + CONFIG_TIMED_SIZE] = 128; // Restart on input.
    activeConfig[timer + CONFIG_TIMED_SIZE + 1] = CONFIG_ACTION_LED_CONTROL;
    activeConfig[timer + CONFIG_TIMED_SIZE + 2] = CONFIG_LED_KEY_SET;
    actionsTimedReset(250);
    actionsTimedPoll(249); // 255 ticks elapsed across wrap: no early carry.
    assert(ledCalls == 0);
    actionsTimedInput(); // Reset only the inactivity timer's fractional phase.
    actionsTimedPoll(250);
    assert(ledCalls == (CONFIG_TIMED_ALL_RESET ? 0 : 1));
    actionsTimedPoll(249); // 255 more ticks, only timer 1 carries here.
    assert(ledCommand == CONFIG_LED_KEY_SET);
    assert(ledCalls == 2);
    // Same fine tick is idempotent; a configuration reset clears both fractions.
    actionsTimedPoll(249); assert(ledCalls == 2);
    actionsTimedReset(249);
    actionsTimedPoll(248); assert(ledCalls == 2);
    actionsTimedPoll(249); assert(ledCalls == 4);
}

#define actionsTimedReset resetCoarse
#define actionsTimedPoll pollCoarse

static uint16_t lastConsumer(void) {
    for (uint8_t i = count; i; i--) {
        if (reports[i - 1][0] == 5)
            return reports[i - 1][1] | ((uint16_t)reports[i - 1][2] << 8);
    }
    assert(0); return 0;
}

static void testConsumerHolds(void) {
    reset();
    activeConfig[9] = 0xF0 | CONFIG_ACTION_CONSUMER_HOLD;
    activeConfig[10] = 0xFF;
    activeConfig[11] = CONFIG_ACTION_CONSUMER_HOLD; activeConfig[12] = 0xEA;
    actionsPress(0, 0); actionsPoll(0); assert(lastConsumer() == 0xFFF);
    actionsPress(1, 1); actionsPoll(1); assert(lastConsumer() == 0xEA);
    uint8_t before = count;
    actionsRelease(0); actionsPoll(2); assert(count == before);
    actionsRelease(1); actionsPoll(3); actionsPoll(4); assert(lastConsumer() == 0);

    // Authorized compact policy: no restoration, equally for hold/tap winners.
    reset(); activeConfig[9] = activeConfig[11] = CONFIG_ACTION_CONSUMER_HOLD;
    activeConfig[10] = 0xE9; activeConfig[12] = 0xEA;
    actionsPress(0, 0); actionsPoll(0);
    actionsPress(1, 1); actionsPoll(1);
    actionsRelease(1); actionsPoll(2); actionsPoll(3); assert(lastConsumer() == 0);
    before = count; actionsPoll(100); assert(count == before);
    actionsRelease(0); actionsPoll(101); assert(count == before);

    reset(); activeConfig[9] = CONFIG_ACTION_CONSUMER_HOLD; activeConfig[10] = 0xE9;
    activeConfig[11] = CONFIG_ACTION_CONSUMER; activeConfig[12] = 0xE9;
    actionsPress(0, 0); actionsPoll(0);
    actionsPress(1, 1); actionsRelease(1); actionsPoll(1);
    assert(reports[count - 2][1] == 0 && lastConsumer() == 0xE9);
    actionsPoll(2); assert(lastConsumer() == 0);
    actionsRelease(0); actionsPoll(3); assert(lastConsumer() == 0);
    // Repeated same-usage taps each contain a release/press edge.
    actionsPress(1, 4); actionsRelease(1); actionsPoll(4);
    assert(lastConsumer() == 0xE9); actionsPoll(5); assert(lastConsumer() == 0);

    // An older pending tap cannot override a newer physical hold under pressure.
    reset(); activeConfig[9] = CONFIG_ACTION_CONSUMER; activeConfig[10] = 0xE9;
    activeConfig[11] = CONFIG_ACTION_CONSUMER_HOLD; activeConfig[12] = 0xEA;
    blocked = 1; actionsPress(0, 0); actionsPoll(0);
    actionsPress(1, 1); actionsPoll(1); assert(!count);
    blocked = 0; actionsPoll(2); assert(lastConsumer() == 0xEA);
    actionsPoll(3); assert(lastConsumer() == 0xEA);

    // A brief hold preserves its press and release through rejected reports.
    reset(); activeConfig[9] = CONFIG_ACTION_CONSUMER_HOLD; activeConfig[10] = 0xE9;
    blocked = 1; actionsPress(0, 0); actionsRelease(0); actionsPoll(0);
    assert(!count); blocked = 0; actionsPoll(1); assert(lastConsumer() == 0xE9);
    blocked = 1; actionsPoll(2); assert(lastConsumer() == 0xE9);
    blocked = 0; actionsPoll(3); assert(lastConsumer() == 0);

    // Binding remains owned across a layer change, like keyboard holds.
    reset(); activeConfig[3] = 1;
    activeConfig[9] = CONFIG_ACTION_CONSUMER_HOLD; activeConfig[10] = 0xE9;
    activeConfig[11] = CONFIG_ACTION_SET_LAYER; activeConfig[12] = 1;
    actionsPress(0, 0); actionsPoll(0);
    actionsPress(1, 1); actionsPoll(1); assert(lastConsumer() == 0xE9);
    actionsRelease(0); actionsPoll(2); actionsPoll(3); assert(lastConsumer() == 0);

    reset(); activeConfig[9] = CONFIG_ACTION_CONSUMER_HOLD; activeConfig[10] = 0xE9;
    actionsPress(0, 0); actionsPoll(0);
    count = 0; generation++; actionsPoll(1); assert(lastConsumer() == 0xE9);
    actionsRelease(0); actionsPoll(2); actionsPoll(3); assert(lastConsumer() == 0);

    // Either chord member releases the hold; reset clears all output.
    reset(); activeConfig[5] = 2;
    activeConfig[31] = 0; activeConfig[32] = CONFIG_ACTION_CONSUMER_HOLD;
    activeConfig[33] = 0xE9;
    actionsPress(0, 0); actionsPress(1, 1); actionsPoll(1);
    assert(lastConsumer() == 0xE9);
    actionsRelease(1); actionsPoll(2); actionsPoll(3); assert(lastConsumer() == 0);
    actionsClear(); assert(lastConsumer() == 0);
}

#if CONFIG_SCROLL_ACCELERATION
extern uint8_t currentFirst, eventUsed;
static int16_t drainScroll(uint16_t now) {
    int16_t total = 0;
    for (uint8_t t = 0; t < 128; t++) {
        count = 0; actionsPoll(now + t);
        for (uint8_t i = 0; i < count; i++) {
            if (reports[i][0] == 2) total += (int8_t)reports[i][4];
        }
        if (!currentFirst && !eventUsed) return total;
    }
    assert(0); return 0;
}
static int16_t scrollTap(uint16_t now) {
    actionsPress(0, now); actionsRelease(0);
    return drainScroll(now);
}
static void testScrollAcceleration(void) {
    reset(); activeConfig[9] = 0x10 | CONFIG_ACTION_SCROLL; activeConfig[10] = 2;
    assert(scrollTap(0) == 2);
    assert(scrollTap(150) == 2 + (1 / CONFIG_SCROLL_SLOW_Y) * CONFIG_SCROLL_SLOW_X);
    assert(scrollTap(300) == 2 + (2 / CONFIG_SCROLL_SLOW_Y) * CONFIG_SCROLL_SLOW_X);
    assert(scrollTap(500) == 2); // Exactly 200 ms resets.
    // Non-scroll no-op triggers and mode/base changes reset independently.
    activeConfig[11] = activeConfig[12] = 0;
    actionsPress(1, 501); actionsRelease(1); assert(scrollTap(502) == 2);
    activeConfig[9] = 0x20 | CONFIG_ACTION_SCROLL;
    assert(scrollTap(503) == 2);
    assert(scrollTap(650) == 2 + (1 / CONFIG_SCROLL_FAST_Y) * CONFIG_SCROLL_FAST_X);
    activeConfig[10] = (uint8_t)-2; assert(scrollTap(800) == -2);
    assert(scrollTap(950) == -(2 + (1 / CONFIG_SCROLL_FAST_Y) * CONFIG_SCROLL_FAST_X));
    // Counter and signed magnitude saturate, never wrap or produce -128.
    for (uint16_t n = 2; n < 1100; n++) {
        int16_t expected = 2 + (n / CONFIG_SCROLL_FAST_Y) * CONFIG_SCROLL_FAST_X;
        if (expected > 127) expected = 127;
        assert(scrollTap((uint16_t)(800 + n * 150)) == -expected);
    }
    // A fine timestamp wrap preserves a short continuous sequence.
    actionsInit(); activeConfig[10] = 2;
    assert(scrollTap(65520) == 2);
    assert(scrollTap(134) == 2 + (1 / CONFIG_SCROLL_FAST_Y) * CONFIG_SCROLL_FAST_X);
    actionsPoll(334); assert(scrollTap(335) == 2);
    // Opposite physical detents reset even if mapped to identical scroll signs.
    reset(); activeConfig[23] = activeConfig[25] = 0x20 | CONFIG_ACTION_SCROLL;
    activeConfig[24] = activeConfig[26] = 2;
    actionsInputNow = 0; actionsRotate(1); assert(drainScroll(0) == 2);
    actionsInputNow = 150; actionsRotate(1);
    assert(drainScroll(150) == 2 + (1 / CONFIG_SCROLL_FAST_Y) * CONFIG_SCROLL_FAST_X);
    actionsInputNow = 300; actionsRotate(0); assert(drainScroll(300) == 2);
    // Off terminates the stream. Dropped detents never add gain; reversal still
    // terminates it when a waiting keyboard action consumes rotation capacity.
    activeConfig[25] = CONFIG_ACTION_SCROLL; actionsInputNow = 450;
    actionsRotate(0); assert(drainScroll(450) == 2);
    actionsInputNow = 600; actionsRotate(1); assert(drainScroll(600) == 2);
    activeConfig[9] = CONFIG_ACTION_KEY_TAP; activeConfig[10] = 4;
    actionsPress(0, 601); actionsRelease(0);
    actionsInputNow = 602; actionsRotate(0); assert(actionsDropped(1) == 1);
    drainScroll(602);
    actionsInputNow = 750; actionsRotate(1); assert(drainScroll(750) == 2);
    // Timed scroll output is isolated from the physical stream.
    reset(); activeConfig[9] = 0x20 | CONFIG_ACTION_SCROLL; activeConfig[10] = 2;
    assert(scrollTap(0) == 2);
    activeConfig[3] = 1 << 6;
    uint8_t timer = configTimedOffset(); activeConfig[timer] = 0;
    activeConfig[timer + 1] = 0x20 | CONFIG_ACTION_SCROLL;
    activeConfig[timer + 2] = 2;
    actionsTimedReset(0); actionsInputNow = 50; actionsTimedPoll(1);
    assert(drainScroll(50) == 2);
    assert(scrollTap(150) == 2 + (1 / CONFIG_SCROLL_FAST_Y) * CONFIG_SCROLL_FAST_X);
    // Scroll-hold repeats accelerate, and either release stops future repeats.
    reset(); activeConfig[9] = CONFIG_SCROLL_HOLD | 0x20 | CONFIG_ACTION_SCROLL;
    activeConfig[10] = 1;
    actionsPress(0, 0); assert(drainScroll(0) == 1);
    assert(drainScroll(8) == 1 + (1 / CONFIG_SCROLL_FAST_Y) * CONFIG_SCROLL_FAST_X);
    actionsRelease(0); assert(drainScroll(30) == 0);
}
#endif

static void testScrollHold(void) {
    reset(); activeConfig[9] = CONFIG_SCROLL_HOLD | CONFIG_ACTION_SCROLL;
    activeConfig[10] = (uint8_t)-2;
    actionsPress(0, 0); actionsPoll(0); actionsPoll(1);
    assert(count == 2 && reports[0][4] == 255 && reports[1][4] == 255);
    for (uint16_t now = 2; now <= 100; now++) actionsPoll(now);
    assert(count == 2); // Delay starts after the complete two-report step.
    for (uint16_t now = 101; now <= 110; now++) actionsPoll(now);
    assert(count == 4);
    actionsRelease(0); actionsPoll(220); assert(count == 4);
    actionsPress(0, 221); actionsRelease(0); actionsPoll(221); actionsPoll(222);
    assert(count == 6); actionsPoll(330); assert(count == 6);

    // A chord scroll holds until either member releases.
    reset(); activeConfig[5] = 2;
    activeConfig[31] = 0; activeConfig[32] = CONFIG_SCROLL_HOLD | CONFIG_ACTION_SCROLL;
    activeConfig[33] = 1;
    actionsPress(0, 0); actionsPress(1, 1); actionsPoll(1);
    for (uint16_t now = 2; now <= 100; now++) actionsPoll(now);
    assert(count == 1);
    for (uint16_t now = 101; now <= 110; now++) actionsPoll(now);
    assert(count == 2);
    actionsRelease(1); actionsPoll(220); assert(count == 2);

    // A one-second hold produces about ten steps, without changing tap behavior.
    reset(); activeConfig[9] = CONFIG_SCROLL_HOLD | CONFIG_ACTION_SCROLL;
    activeConfig[10] = 1;
    actionsPress(0, 0);
    for (uint16_t now = 0; now < 1000; now++) actionsPoll(now);
    assert(count == 10);
    actionsRelease(0); actionsPoll(1100); assert(count == 10);

    // Completion times survive low-byte and 16-bit millisecond wrap.
    reset(); activeConfig[9] = CONFIG_SCROLL_HOLD | CONFIG_ACTION_SCROLL;
    activeConfig[10] = 1;
    actionsPress(0, 65520); actionsPoll(65520);
    for (uint16_t elapsed = 1; elapsed < 100; elapsed++) actionsPoll((uint16_t)(65520 + elapsed));
    assert(count == 1);
    for (uint16_t elapsed = 100; elapsed <= 110; elapsed++) actionsPoll((uint16_t)(65520 + elapsed));
    assert(count == 2);

    // Pointer movement still repeats on its original 8 ms clock.
    reset(); activeConfig[9] = CONFIG_SCROLL_HOLD | CONFIG_ACTION_SCROLL;
    activeConfig[10] = 1; activeConfig[11] = CONFIG_MOUSE_MOVE_HOLD | CONFIG_ACTION_MOUSE_X;
    activeConfig[12] = 1; activeConfig[8] &= 0xF0; // No chord window.
    actionsPress(0, 0); actionsPress(1, 0);
    for (uint16_t now = 0; now <= 9; now++) actionsPoll(now);
    assert(count == 3 && reports[0][4] == 1 && reports[1][2] == 1 && reports[2][2] == 1);

    // No catch-up burst after USB backpressure: one step, then a new delay.
    reset(); activeConfig[9] = CONFIG_SCROLL_HOLD | CONFIG_ACTION_SCROLL;
    activeConfig[10] = 1;
    actionsPress(0, 0); actionsPoll(0); assert(count == 1);
    blocked = 1;
    for (uint16_t now = 1; now < 500; now++) actionsPoll(now);
    assert(count == 1);
    blocked = 0; actionsPoll(500); assert(count == 2);
    for (uint16_t now = 501; now < 600; now++) actionsPoll(now);
    assert(count == 2);
    actionsClear(); uint8_t before = count; actionsPoll(700); assert(count == before);

    // Initial queued step survives a short release under transport pressure.
    reset(); activeConfig[9] = CONFIG_SCROLL_HOLD | CONFIG_ACTION_SCROLL;
    activeConfig[10] = 1; blocked = 1;
    actionsPress(0, 0); actionsRelease(0); actionsPoll(0); assert(!count);
    blocked = 0; actionsPoll(1); assert(count == 1 && reports[0][4] == 1);
    actionsPoll(100); assert(count == 1); actionsClear();
    before = count; actionsPoll(200); assert(count == before);
}

static void testScrollReportSpacing(void) {
    // Exercise every low-byte start phase across full millisecond wrap, with
    // uneven loop polling and a blocked USB queue. Assert actual wheel-report
    // acceptance times, rather than only the number of reports produced.
    for (uint16_t phase = 0; phase < 256; phase++) {
        reset();
        activeConfig[9] = CONFIG_SCROLL_HOLD | CONFIG_ACTION_SCROLL;
        activeConfig[10] = phase & 1 ? (uint8_t)-1 : 1;
        uint16_t start = (uint16_t)(65500 + phase);
        actionsPress(0, start);
        for (uint16_t elapsed = 0; elapsed < 1100; elapsed += 1 + phase % 13) {
            blocked = elapsed >= 150 && elapsed < 270;
            reportNow = (uint16_t)(start + elapsed);
            actionsPoll(reportNow);
        }
        assert(count >= 6 && count <= 11);
        for (uint8_t i = 0; i < count; i++) {
            assert(reports[i][0] == 2 && reports[i][4] == activeConfig[10]);
            if (i) assert((uint16_t)(reportTimes[i] - reportTimes[i - 1]) >= 100);
        }
        actionsRelease(0);
    }
}

// Drive the real CCW binding path, preserving ordinary one-shot consumption.
static void selectLayer(uint8_t target, uint8_t oneShot) {
    uint8_t offset = 9 + 22 * actionsLayer() + 16;
    activeConfig[offset] = CONFIG_ACTION_SET_LAYER | (oneShot ? 0x10 : 0);
    activeConfig[offset + 1] = target;
    actionsRotate(0);
}
static void previous(void) { selectLayer(CONFIG_LAYER_PREVIOUS, 0); }
static void testPreviousLayer(void) {
    reset(); activeConfig[3] = 1;
    previous(); assert(actionsLayer() == 0); // No history after initialization.
    selectLayer(1, 0); selectLayer(1, 0); // Same-layer selection preserves history.
    previous(); assert(actionsLayer() == 0);
    previous(); assert(actionsLayer() == 1);
    previous(); assert(actionsLayer() == 0);
    // Relative persistent selection also populates history.
    activeConfig[25] = CONFIG_ACTION_RELATIVE_LAYER; activeConfig[26] = 1;
    actionsRotate(0); assert(actionsLayer() == 1);
    previous(); assert(actionsLayer() == 0);
    // Initialization/config application resets history to startup layer.
    activeConfig[3] = 1 | (1 << 3); actionsInit();
    previous(); assert(actionsLayer() == 1);
    reset(); activeConfig[3] = 1;
    selectLayer(1, 0);
    selectLayer(CONFIG_LAYER_PREVIOUS, 1); assert(actionsLayer() == 0);
    actionsPress(3, 0); actionsRelease(3); assert(actionsLayer() == 1);
    previous(); assert(actionsLayer() == 0);
    previous(); assert(actionsLayer() == 1);
    // Momentary layers overlay the base; visiting/releasing them is not history.
    reset(); activeConfig[3] = 1; activeConfig[3] = 2; // Three layers.
    selectLayer(1, 0); selectLayer(0, 0); // Previous persistent layer is 1.
    activeConfig[9] = CONFIG_ACTION_MOMENTARY_LAYER; activeConfig[10] = 2;
    actionsPress(0, 0); assert(actionsLayer() == 2);
    previous(); assert(actionsLayer() == 2); // Held momentary layer keeps priority.
    actionsRelease(0); assert(actionsLayer() == 1);
    previous(); assert(actionsLayer() == 0);
    // History is one entry, not a stack of every visited layer.
    reset(); activeConfig[3] = 2;
    selectLayer(1, 0); selectLayer(2, 0);
    previous(); assert(actionsLayer() == 1);
    previous(); assert(actionsLayer() == 2);
    // Ordinary one-shot visits and their automatic return do not enter history.
    reset(); activeConfig[3] = 2;
    selectLayer(1, 0); selectLayer(2, 1); assert(actionsLayer() == 2);
    actionsPress(3, 0); actionsRelease(3); assert(actionsLayer() == 1);
    previous(); assert(actionsLayer() == 0);
    // A timed reminder can revert to wherever the persistent user selection was.
    reset(); activeConfig[3] = 1;
    activeConfig[3] |= 1 << 6;
    uint8_t timer = configTimedOffset();
    activeConfig[timer] = 128 | CONFIG_TIMED_CONSUME;
    activeConfig[timer + 1] = CONFIG_ACTION_SET_LAYER; activeConfig[timer + 2] = 1;
    activeConfig[timer + 3] = CONFIG_ACTION_SET_LAYER; activeConfig[timer + 4] = CONFIG_LAYER_PREVIOUS;
    actionsTimedReset(0); actionsTimedPoll(1); assert(actionsLayer() == 1);
    actionsTimedPoll(2); assert(actionsLayer() == 1); // Repeat must preserve return target.
    assert(actionsTimedInput()); assert(actionsLayer() == 0);
    previous(); assert(actionsLayer() == 1);
    // Persistent timer actions during a one-shot visit remember the underlying
    // base, and retain the existing pending one-shot return behavior.
    reset(); activeConfig[3] = 1; activeConfig[3] = 2 | (1 << 6);
    selectLayer(1, 0); selectLayer(0, 1);
    timer = configTimedOffset();
    activeConfig[timer] = 0;
    activeConfig[timer + 1] = CONFIG_ACTION_SET_LAYER; activeConfig[timer + 2] = 2;
    actionsTimedReset(0); actionsTimedPoll(1); assert(actionsLayer() == 2);
    // A timer next-input action sees the remembered base (1), not visit (0).
    activeConfig[timer + 3] = CONFIG_ACTION_SET_LAYER; activeConfig[timer + 4] = CONFIG_LAYER_PREVIOUS;
    actionsTimedInput(); assert(actionsLayer() == 1);
    actionsPress(3, 0); actionsRelease(3); assert(actionsLayer() == 1);
}

static void testDefaults(void) {
    reset();
    actionsPress(0, 0);
    actionsPoll(0);
    assert(count == 1 && reports[0][0] == 1 && reports[0][3] == 0x29);
    actionsPoll(10);
    assert(count == 2 && reports[1][3] == 0);
    actionsRelease(0);
    actionsPoll(11);
    actionsRotate(1);
    actionsPoll(20);
    assert(reports[count - 1][0] == 2 && reports[count - 1][4] == 0xFF);
    actionsPress(6, 0);
    actionsPoll(30);
    assert(reports[count - 1][0] == 2 && reports[count - 1][1] == 4);
    assert(reports[count - 1][4] == 0); // A click does not replay scrolling.
    actionsPoll(40);
    assert(reports[count - 1][1] == 0);
}

static void testLayerAndOwnership(void) {
    reset();
    activeConfig[3] = 1; // Two layers
    activeConfig[9] = CONFIG_ACTION_MOMENTARY_LAYER;
    activeConfig[10] = 1;
    activeConfig[31 + 2] = CONFIG_ACTION_KEY_HOLD;
    activeConfig[31 + 3] = 0x04;
    activeConfig[31 + 4] = CONFIG_ACTION_KEY_HOLD;
    activeConfig[31 + 5] = 0x04;
    actionsInit();
    actionsPress(0, 0);
    assert(actionsLayer() == 1);
    actionsPress(1, 0);
    actionsPress(2, 0);
    actionsPoll(0);
    assert(count == 1 && reports[0][3] == 0x04);
    actionsRelease(1);
    actionsPoll(1);
    assert(reports[count - 1][3] == 0x04); // The second owner retains A.
    actionsRelease(0);
    assert(actionsLayer() == 0);
    actionsPoll(2);
    assert(reports[count - 1][3] == 0x04); // Held key keeps its binding.
    actionsRelease(2);
    actionsPoll(3);
    assert(reports[count - 1][3] == 0);
}

static void testRelativeLayer(void) {
    uint8_t layers;
    int8_t offset;
    int8_t target;
    reset();
    activeConfig[3] = 3; // Four layers, starting at layer 1.
    activeConfig[9] = CONFIG_ACTION_RELATIVE_LAYER;
    activeConfig[10] = 2;
    activeConfig[9 + 22 * 2 + 2] = CONFIG_ACTION_RELATIVE_LAYER;
    activeConfig[9 + 22 * 2 + 3] = 0xFF;
    actionsInit();
    actionsPress(0, 0);
    assert(actionsLayer() == 2); // Layer 1 + 2 = layer 3.
    actionsRelease(0);
    actionsPress(1, 1);
    assert(actionsLayer() == 1); // Layer 3 - 1 = layer 2.
    actionsRelease(1);

    reset();
    activeConfig[3] = 3;
    activeConfig[9] = CONFIG_ACTION_RELATIVE_LAYER;
    activeConfig[10] = 0xFF;
    actionsInit();
    actionsPress(0, 0);
    assert(actionsLayer() == 3); // Layer 1 - 1 wraps to layer 4.
    actionsRelease(0);

    reset();
    activeConfig[3] = 0; // One layer still accepts the full offset range.
    activeConfig[9] = CONFIG_ACTION_RELATIVE_LAYER;
    activeConfig[10] = 0xFD;
    actionsInit();
    actionsPress(0, 0);
    assert(actionsLayer() == 0);
    actionsRelease(0);
    activeConfig[10] = 0;
    actionsPress(0, 1);
    assert(actionsLayer() == 0); // Existing zero-byte records are no-ops.

    for (layers = 1; layers <= 7; layers++) {
        for (uint8_t start = 0; start < layers; start++) {
            for (offset = -6; offset <= 6; offset++) {
                reset();
                memset(activeConfig + 9, 0, CONFIG_SIZE - 9);
                activeConfig[5] = CONFIG_THREE_KEYS;
                activeConfig[3] = (layers - 1) | (start << 3);
                activeConfig[9 + 15 * start] = CONFIG_ACTION_RELATIVE_LAYER;
                activeConfig[10 + 15 * start] = (uint8_t)offset;
                actionsInit();
                assert(actionsLayer() == start);
                actionsPress(0, 0);
                target = start + offset;
                while (target < 0) target += layers;
                while (target >= layers) target -= layers;
                assert(actionsLayer() == target);
            }
        }
    }
}

static void testOneShot(void) {
    uint8_t type;
    for (type = CONFIG_ACTION_SET_LAYER; type <= CONFIG_ACTION_RELATIVE_LAYER; type += 3) {
        reset();
        activeConfig[3] = 1;
        activeConfig[9] = 0x10 | type;
        activeConfig[10] = 1;
        activeConfig[31 + 2] = CONFIG_ACTION_KEY_TAP;
        activeConfig[31 + 3] = 4;
        actionsInit();
        actionsPress(0, 0);
        actionsRelease(0);
        assert(actionsLayer() == 1);
        actionsPress(1, 1);
        assert(actionsLayer() == 0);
        actionsPoll(1);
        assert(count == 1 && reports[0][0] == 1 && reports[0][3] == 4);
        actionsPoll(10);
        assert(count == 2 && reports[1][3] == 0);

        reset();
        activeConfig[3] = 1;
        activeConfig[9] = 0x10 | type;
        activeConfig[10] = 1;
        activeConfig[31 + 14] = CONFIG_ACTION_SCROLL;
        activeConfig[31 + 15] = 2;
        actionsInit();
        actionsPress(0, 0);
        actionsRotate(1);
        assert(actionsLayer() == 0);
        actionsPoll(1);
        actionsPoll(2);
        assert(count == 2 && reports[0][0] == 2 && reports[0][4] == 1);
        assert(reports[1][4] == 1);
    }

    reset();
    activeConfig[3] = 1;
    activeConfig[5] = 2; // One chord on layer 1: keys 1 and 2.
    activeConfig[8] = 8; // 40 ms chord window.
    activeConfig[9] = 0x10 | CONFIG_ACTION_SET_LAYER;
    activeConfig[10] = 1;
    activeConfig[31 + 2] = CONFIG_ACTION_KEY_HOLD;
    activeConfig[31 + 3] = 4;
    activeConfig[53] = 0x15; // Pair (1, 2) on layer 1.
    activeConfig[54] = CONFIG_ACTION_KEY_TAP;
    activeConfig[55] = 7;
    actionsInit();
    actionsPress(0, 0);
    actionsRelease(0);
    actionsPress(1, 1);
    actionsPoll(1);
    assert(actionsLayer() == 1 && count == 0); // Keep waiting for the chord.
    actionsPress(2, 2);
    actionsPoll(2);
    assert(actionsLayer() == 0 && count == 1 && reports[0][3] == 7);

    // The same one-shot binding becomes a single held key on timeout.
    actionsPoll(11);
    actionsPoll(12);
    actionsRelease(1);
    actionsRelease(2);
    count = 0;
    actionsPress(0, 20);
    actionsRelease(0);
    actionsPress(1, 21);
    actionsPoll(61);
    assert(actionsLayer() == 0 && count == 1 && reports[0][3] == 4);
    actionsRelease(1);
    actionsPoll(62);
    assert(count == 2 && reports[1][3] == 0);

    // Encoder inputs resolve the earlier pending key first, then use the restored layer.
    for (type = 0; type < 2; type++) {
        actionsInit();
        count = 0;
        actionsPress(0, 0);
        actionsRelease(0);
        actionsPress(1, 1);
        if (type) actionsRotate(1);
        else actionsPress(6, 2);
        actionsPoll(2);
        assert(actionsLayer() == 0 && count == 2 && reports[0][3] == 4);
        assert(reports[1][0] == 2);
        assert(type ? reports[1][4] == 0xFF : reports[1][1] == 4);
    }
}

static void testOneShotGlobalLayerChord(void) {
    uint8_t start;
    uint8_t first;
    for (start = 0; start < 2; start++) {
        for (first = 3; first <= 4; first++) {
            reset();
            memset(activeConfig + 9, 0, CONFIG_SIZE - 9);
            activeConfig[3] = 1 | (start << 3);
            activeConfig[5] = 2;
            activeConfig[8] = 10; // 50 ms.
            activeConfig[9] = activeConfig[31] = 0x10 | CONFIG_ACTION_SET_LAYER;
            activeConfig[10] = 1;
            activeConfig[53] = 0x8C; // Global keys 3+4.
            activeConfig[54] = CONFIG_ACTION_RELATIVE_LAYER;
            activeConfig[55] = 1;
            actionsInit();
            actionsPress(3, 0);
            actionsPress(4, 1);
            assert(actionsLayer() == (start ^ 1));
            actionsRelease(3);
            actionsRelease(4);
            actionsPress(0, 10);
            actionsRelease(0);
            assert(actionsLayer() == start);
            actionsPress(first, 2000);
            assert(actionsLayer() == start); // Await the complete chord.
            actionsPress(first == 3 ? 4 : 3, 2049);
            assert(actionsLayer() == (start ^ 1));
            actionsRelease(3);
            actionsRelease(4);
            actionsPress(1, 2050); // The chord consumed the one-shot.
            assert(actionsLayer() == (start ^ 1));
            actionsRelease(1);
            actionsPress(3, 2060);
            actionsPress(4, 2061);
            assert(actionsLayer() == start);
        }
    }
}

static void testRolloverAndSequence(void) {
    uint8_t i;
    reset();
    for (i = 0; i < 7; i++) {
        activeConfig[9 + 2 * i] = CONFIG_ACTION_KEY_HOLD;
        activeConfig[10 + 2 * i] = 0x04 + i;
    }
    actionsInit();
    for (i = 0; i < 7; i++) {
        actionsPress(i, 0);
    }
    actionsPoll(0);
    assert(reports[0][8] == 0x09); // Six distinct usages fit.
    actionsRelease(0);
    actionsPoll(1);
    assert(reports[count - 1][8] == 0x0A); // Seventh enters the free slot.

    reset();
    activeConfig[9] = 0x18; // Consumer usage 0x1E9
    activeConfig[10] = 0xE9;
    actionsPress(0, 0);
    actionsPoll(0);
    assert(reports[0][0] == 5 && reports[0][1] == 0xE9 && reports[0][2] == 1);
    actionsPoll(1);
    assert(reports[1][0] == 5 && reports[1][1] == 0 && reports[1][2] == 0);

    reset();
    activeConfig[9] = CONFIG_ACTION_STRING;
    activeConfig[10] = 0;
    activeConfig[4] = 2;
    activeConfig[31] = 'A';
    activeConfig[32] = 0;
    actionsPress(0, 0);
    actionsPoll(0);
    assert(reports[0][0] == 1 && reports[0][1] == 2 && reports[0][3] == 4);
    actionsPoll(10);
    assert(reports[1][1] == 0 && reports[1][3] == 0);
}

static void testRotationOptions(void) {
    reset();
    activeConfig[30] |= 1; // Full LED brightness does not change scrolling.
    actionsRotate(1);
    actionsPoll(0);
    assert(reports[0][4] == 0xFF);

    reset();
    activeConfig[23] = CONFIG_ACTION_MOUSE_TOGGLE;
    activeConfig[24] = 1;
    actionsRotate(1);
    actionsPoll(0);
    assert(reports[0][0] == 2 && reports[0][1] == 1);
    actionsRotate(1);
    actionsPoll(1);
    assert(reports[1][1] == 0);
}

static void testPointerSteps(void) {
    const int8_t deltas[] = {-127, -1, 1, 127};
    uint8_t type;
    uint8_t i;
    for (type = CONFIG_ACTION_MOUSE_X; type <= CONFIG_ACTION_MOUSE_Y; type++) {
        for (i = 0; i < sizeof(deltas); i++) {
            reset();
            activeConfig[9] = type;
            activeConfig[10] = (uint8_t)deltas[i];
            actionsPress(0, 0);
            actionsPoll(0);
            assert(count == 1 && reports[0][0] == 2);
            assert((int8_t)reports[0][2] == (type == CONFIG_ACTION_MOUSE_X ? deltas[i] : 0));
            assert((int8_t)reports[0][3] == (type == CONFIG_ACTION_MOUSE_Y ? deltas[i] : 0));
            actionsPoll(1); // Holding the key must not repeat the step.
            assert(count == 1);
            actionsRelease(0);
            actionsPoll(2);
            assert(count == 1);
            actionsPress(0, 3);
            actionsRelease(0); // A quick tap still sends exactly one step.
            actionsPoll(3);
            actionsPoll(4);
            assert(count == 2);

            reset();
            activeConfig[23] = type; // Encoder clockwise binding.
            activeConfig[24] = (uint8_t)deltas[i];
            actionsRotate(1);
            blocked = 1;
            actionsPoll(0);
            assert(count == 0);
            blocked = 0;
            actionsPoll(1); // Retry a rejected report without losing the step.
            assert(count == 1 && reports[0][0] == 2);
            assert((int8_t)reports[0][2] == (type == CONFIG_ACTION_MOUSE_X ? deltas[i] : 0));
            assert((int8_t)reports[0][3] == (type == CONFIG_ACTION_MOUSE_Y ? deltas[i] : 0));
            actionsPress(0, 2); // A later action must not be stuck behind movement.
            actionsPoll(2);
            assert(count == 2 && reports[1][0] == 1 && reports[1][3] == 0x29);
        }
    }
}

static void testPointerHold(void) {
    uint8_t type;
    uint8_t released;
    for (type = CONFIG_ACTION_MOUSE_X; type <= CONFIG_ACTION_MOUSE_Y; type++) {
        reset();
        activeConfig[9] = type | CONFIG_MOUSE_MOVE_HOLD;
        activeConfig[10] = 0xFF;
        actionsPress(0, 0);
        actionsPoll(0);
        actionsPoll(7);
        assert(count == 1);
        actionsPoll(8);
        assert(count == 2 && reports[1][0] == 2);
        assert(reports[1][2] == (type == CONFIG_ACTION_MOUSE_X ? 0xFF : 0));
        assert(reports[1][3] == (type == CONFIG_ACTION_MOUSE_Y ? 0xFF : 0));
        actionsPoll(16);
        assert(count == 3);
        actionsRelease(0);
        actionsPoll(24);
        actionsPoll(100);
        assert(count == 3);

        actionsPress(0, 101);
        actionsRelease(0);
        actionsPoll(101);
        actionsPoll(109);
        assert(count == 4); // A quick hold-mode tap still moves once.

        actionsPress(0, 65532);
        actionsPoll(65532);
        actionsPoll(3);
        assert(count == 5);
        blocked = 1;
        actionsPoll(4);
        assert(count == 5);
        blocked = 0;
        actionsPoll(12);
        assert(count == 6); // Resume after backpressure across timer wrap.
        actionsRelease(0);
    }

    // Both axes repeat independently, and unrelated key taps can still finish.
    reset();
    activeConfig[9] = CONFIG_ACTION_MOUSE_X | CONFIG_MOUSE_MOVE_HOLD;
    activeConfig[10] = 1;
    activeConfig[11] = CONFIG_ACTION_MOUSE_Y | CONFIG_MOUSE_MOVE_HOLD;
    activeConfig[12] = 2;
    actionsPress(0, 0);
    actionsPress(1, 0);
    actionsPoll(0);
    actionsPoll(1);
    actionsPoll(9);
    assert(count == 4 && reports[2][2] == 1 && reports[3][3] == 2);
    actionsPress(2, 10);
    actionsRelease(2);
    actionsPoll(10);
    assert(count == 5 && reports[4][0] == 1 && reports[4][3] == 0x21);
    actionsPoll(18);
    actionsPoll(19);
    actionsRelease(0);
    actionsPoll(27);
    assert(reports[count - 1][2] == 0 && reports[count - 1][3] == 2);
    actionsRelease(1);

    // Either chord key ending its hold must stop repetition.
    for (released = 0; released < 2; released++) {
        reset();
        activeConfig[5] = 2;
        activeConfig[31] = 0;
        activeConfig[32] = CONFIG_ACTION_MOUSE_X | CONFIG_MOUSE_MOVE_HOLD;
        activeConfig[33] = 3;
        actionsPress(0, 100);
        actionsPress(1, 101);
        actionsPoll(101);
        actionsPoll(109);
        assert(count == 2 && reports[1][2] == 3);
        actionsRelease(released);
        actionsPoll(117);
        assert(count == 2);
    }
}

static void testLayerCancelsConsumer(void) {
    reset();
    activeConfig[3] = 1;
    activeConfig[9] = CONFIG_ACTION_CONSUMER;
    activeConfig[10] = 0xE9;
    activeConfig[11] = CONFIG_ACTION_SET_LAYER;
    activeConfig[12] = 1;
    actionsInit();
    actionsPress(0, 0);
    actionsPoll(0);
    assert(reports[0][0] == 5 && reports[0][1] == 0xE9);
    actionsPress(1, 0);
    actionsPoll(1);
    assert(actionsLayer() == 1);
    assert(reports[count - 1][0] == 5 && reports[count - 1][1] == 0);
}

static void testMultiClickPlayback(void) {
    for (uint8_t clicks = 1; clicks <= 16; clicks++) {
        for (uint8_t pressure = 0; pressure < 2; pressure++) {
            reset();
            activeConfig[9] = ((clicks - 1) << 4) | CONFIG_ACTION_MOUSE_CLICK;
            activeConfig[10] = 7;
            actionsPress(0, 0);
            actionsRelease(0); // Playback completes even after a brief physical press.
            for (uint16_t now = 0; now < 5000; now++) {
                blocked = pressure && now % 300 < 25;
                actionsPoll(now);
            }
            assert(count == clicks * 2);
            for (uint8_t i = 0; i < count; i++) {
                assert(reports[i][0] == 2);
                assert(reports[i][1] == (i % 2 ? 0 : 7));
                assert(reports[i][2] == 0 && reports[i][3] == 0 && reports[i][4] == 0);
            }
        }
    }
}

static void testMouseAndLayerOrder(void) {
    reset();
    activeConfig[9] = CONFIG_ACTION_MOUSE_HOLD;
    activeConfig[10] = 1;
    activeConfig[11] = CONFIG_ACTION_MOUSE_HOLD;
    activeConfig[12] = 1;
    actionsPress(0, 0);
    actionsPress(1, 0);
    actionsPoll(0);
    assert(reports[count - 1][1] == 1);
    actionsRelease(0);
    actionsPoll(1);
    assert(reports[count - 1][1] == 1);
    actionsRelease(1);
    actionsPoll(2);
    assert(reports[count - 1][1] == 0);

    reset();
    activeConfig[9] = 0x10 | CONFIG_ACTION_MOUSE_CLICK;
    activeConfig[10] = 1;
    actionsPress(0, 0);
    actionsPoll(0);
    actionsPoll(10);
    actionsPoll(11);
    actionsPoll(211);
    actionsPoll(219);
    assert(count == 4);
    assert(reports[0][1] == 1 && reports[1][1] == 0);
    assert(reports[2][1] == 1 && reports[3][1] == 0);

    reset();
    activeConfig[3] = 2; // Three layers
    activeConfig[9] = CONFIG_ACTION_MOMENTARY_LAYER;
    activeConfig[10] = 1;
    activeConfig[31 + 2] = CONFIG_ACTION_MOMENTARY_LAYER;
    activeConfig[31 + 3] = 2;
    actionsInit();
    actionsPress(0, 0);
    actionsPress(1, 0);
    assert(actionsLayer() == 2);
    actionsRelease(0);
    assert(actionsLayer() == 2);
    actionsRelease(1);
    assert(actionsLayer() == 0);
}

static void chordProfile(uint8_t variant, uint8_t action) {
    uint8_t offset = variant ? 24 : 31;
    uint16_t crc;
    reset();
    testLoadStarterProfile(variant);
    activeConfig[5] |= 2; // One chord: keys 0 and 1 on layer 0.
    activeConfig[offset] = 0;
    activeConfig[offset + 1] = action;
    activeConfig[offset + 2] = action == CONFIG_ACTION_MOUSE_HOLD ? 1 : 0x04;
    crc = configCrc(activeConfig);
    activeConfig[6] = crc;
    activeConfig[7] = crc >> 8;
    assert(configValid(activeConfig, variant));
    actionsInit();
}

static void testChords(uint8_t variant) {
    uint8_t first;
    uint8_t released;
    for (first = 0; first < 2; first++) {
        for (released = 0; released < 2; released++) {
            chordProfile(variant, CONFIG_ACTION_KEY_HOLD);
            actionsPress(first, 100);
            actionsPoll(100);
            assert(count == 0);
            actionsPress(first ^ 1, 139);
            actionsPoll(139);
            assert(count == 1 && reports[0][3] == 4);
            actionsRelease(released);
            actionsPoll(140);
            assert(count == 2 && reports[1][3] == 0);
            actionsPress(released, 141);
            actionsPoll(141);
            assert(count == 2); // The other chord key is still down.
            actionsRelease(released ^ 1);
            actionsRelease(released);
            actionsPress(first, 150);
            actionsPress(first ^ 1, 160);
            actionsPoll(160);
            assert(count == 3 && reports[2][3] == 4);
        }
    }

    chordProfile(variant, CONFIG_ACTION_MOUSE_HOLD);
    actionsPress(0, 0);
    actionsPress(1, 1);
    actionsPoll(1);
    assert(reports[0][0] == 2 && reports[0][1] == 1);
    actionsRelease(1);
    actionsPoll(2);
    assert(reports[1][1] == 0);

    chordProfile(variant, CONFIG_ACTION_KEY_HOLD);
    actionsPress(0, 0);
    actionsPress(1, 1);
    actionsPress(2, 2); // A third key acts independently.
    actionsPoll(2);
    assert(count == 2 && reports[1][3] == 4 && reports[1][4] == 0x21);
    actionsPoll(10);
    assert(reports[count - 1][3] == 4 && reports[count - 1][4] == 0);
}

static void testChordWindow(void) {
    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    actionsPress(0, 100);
    actionsPoll(139);
    assert(count == 0);
    actionsPoll(140); // The window expires at exactly 40 ms.
    assert(count == 1 && reports[0][3] == 0x29);

    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    actionsPress(0, 100);
    actionsPress(1, 140);
    actionsPoll(140);
    assert(count == 1 && reports[0][3] == 0x29);
    actionsPoll(148);
    actionsPoll(149);
    actionsPoll(180);
    assert(reports[count - 1][3] == 0x2C); // The second key becomes a single too.

    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    actionsPress(0, 65520);
    actionsPress(1, 10); // Window arithmetic survives the timer wrapping.
    actionsPoll(10);
    assert(count == 1 && reports[0][3] == 4);

    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    activeConfig[8] = 0;
    actionsPress(0, 100);
    actionsPoll(100);
    assert(count == 1 && reports[0][3] == 0x29);

    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    actionsPress(0, 100);
    actionsPress(2, 101); // Unmapped pair resolves the first single immediately.
    actionsPoll(101);
    assert(count == 1 && reports[0][3] == 0x29);

    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    actionsPress(0, 100);
    actionsPress(6, 101); // Encoder button does not end the chord window.
    actionsPoll(101);
    assert(count == 1 && reports[0][0] == 2);
    actionsPress(1, 102);
    actionsPoll(102);
    assert(reports[count - 1][0] == 1 && reports[count - 1][3] == 4);
}

static void testBriefHolds(void) {
    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    actionsPress(0, 100);
    actionsRelease(0);
    actionsPoll(101);
    assert(count == 1 && reports[0][3] == 0x29);
    actionsPoll(110);
    assert(count == 2 && reports[1][3] == 0);

    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    activeConfig[9] = CONFIG_ACTION_KEY_HOLD;
    actionsPress(0, 100);
    actionsRelease(0);
    blocked = 1;
    actionsPoll(101);
    assert(count == 0);
    blocked = 0;
    actionsPoll(102);
    assert(count == 2 && reports[0][3] == 0x29 && reports[1][3] == 0);

    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    actionsPress(0, 100);
    actionsPress(1, 101);
    actionsRelease(1);
    actionsPoll(102);
    assert(count == 2 && reports[0][3] == 4 && reports[1][3] == 0);

    chordProfile(0, CONFIG_ACTION_MOUSE_HOLD);
    actionsPress(0, 100);
    actionsPress(1, 101);
    actionsRelease(0);
    reportLimit = 1; // Accept the press, then block its release.
    actionsPoll(102);
    assert(count == 1 && reports[0][0] == 2 && reports[0][1] == 1);
    reportLimit = 64;
    ledCalls = 0;
    actionsPoll(103);
    assert(count == 2 && reports[1][1] == 0);
}

static void testChordLayers(void) {
    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    // Move the chord table past a second layer.
    activeConfig[3] = 1;
    activeConfig[31] = 0;
    activeConfig[32] = 0;
    activeConfig[33] = 0;
    activeConfig[53] = 0;
    activeConfig[54] = CONFIG_ACTION_MOMENTARY_LAYER;
    activeConfig[55] = 1;
    actionsPress(0, 100);
    actionsPress(1, 101);
    assert(actionsLayer() == 1);
    actionsRelease(1);
    assert(actionsLayer() == 0);
    actionsRelease(0);

    // An encoder layer action resolves the captured pending single.
    activeConfig[9] = CONFIG_ACTION_KEY_HOLD;
    activeConfig[23] = CONFIG_ACTION_SET_LAYER;
    activeConfig[24] = 1;
    actionsPress(0, 200);
    actionsRotate(1);
    assert(actionsLayer() == 1);
    actionsPoll(201);
    assert(count == 1 && reports[0][3] == 0x29);
    actionsRelease(0);
    actionsPoll(202);
    assert(reports[count - 1][3] == 0);
}

static void testMultipleChords(void) {
    chordProfile(0, CONFIG_ACTION_KEY_HOLD);
    activeConfig[5] = 4;
    activeConfig[34] = 9; // Pair 2+3 follows pair 0+1.
    activeConfig[35] = CONFIG_ACTION_KEY_HOLD;
    activeConfig[36] = 5;
    actionsPress(0, 0);
    actionsPress(1, 1);
    actionsPress(2, 2);
    actionsPress(3, 3);
    actionsPoll(3);
    assert(count == 1 && reports[0][3] == 4 && reports[0][4] == 5);
    actionsRelease(1);
    actionsPoll(4);
    assert(reports[count - 1][3] == 5);
    actionsRelease(2);
    actionsPoll(5);
    assert(reports[count - 1][3] == 0);
}

static void testRotationPressure(void) {
    uint8_t i;
    reset();
    for (i = 0; i < 20; i++) {
        actionsRotate(1);
    }
    actionsPress(0, 0);
    actionsPoll(0);
    assert(count == 1 && reports[0][0] == 2 && reports[0][4] == 0xFF);
    actionsPoll(1);
    assert(count == 2 && reports[1][0] == 1 && reports[1][3] == 0x29);
    actionsPoll(10);
    assert(reports[count - 1][3] == 0);
}

static void testLongLivedMomentary(void) {
    uint32_t i;
    reset();
    activeConfig[3] = 2;
    activeConfig[9] = CONFIG_ACTION_MOMENTARY_LAYER;
    activeConfig[10] = 1;
    activeConfig[33] = CONFIG_ACTION_MOMENTARY_LAYER;
    activeConfig[34] = 2;
    actionsPress(0, 0);
    for (i = 0; i < 70000; i++) {
        actionsPress(1, 0);
        assert(actionsLayer() == 2);
        actionsRelease(1);
        assert(actionsLayer() == 1);
    }
    actionsRelease(0);
    assert(actionsLayer() == 0);
}

static void testRolloverBackpressure(void) {
    uint8_t i;
    reset();
    for (i = 0; i < 6; i++) {
        activeConfig[9 + 2 * i] = CONFIG_ACTION_KEY_HOLD;
        activeConfig[10 + 2 * i] = 4 + i;
        actionsPress(i, 0);
    }
    activeConfig[21] = CONFIG_ACTION_KEY_TAP;
    activeConfig[22] = 10;
    actionsPoll(0);
    actionsPress(6, 1);
    actionsRelease(6);
    actionsPoll(1);
    actionsPoll(100);
    assert(count == 1); // The tap waits while all six slots belong to holds.
    actionsRelease(0);
    actionsPoll(101);
    assert(reports[count - 1][8] == 10);
    actionsPoll(110);
    assert(reports[count - 1][8] == 0);

    reset();
    for (i = 0; i < 7; i++) {
        activeConfig[9 + 2 * i] = CONFIG_ACTION_KEY_HOLD;
        activeConfig[10 + 2 * i] = 4 + i;
        actionsPress(i, 0);
    }
    actionsRelease(6);
    actionsPoll(0);
    assert(count == 1 && reports[0][8] == 9);
    actionsRelease(0);
    actionsPoll(1);
    actionsPoll(2);
    assert(reports[1][8] == 10); // Even a released seventh hold gets a press.
    assert(reports[count - 1][8] == 0);
}

static void testClearAndOverflow(void) {
    unsigned i;
    reset();
    activeConfig[9] = CONFIG_ACTION_KEY_HOLD;
    activeConfig[10] = 4;
    actionsPress(0, 0);
    actionsPoll(0);
    blocked = 1;
    actionsClear();
    blocked = 0;
    actionsPoll(1);
    assert(reports[count - 1][0] == 2 && reports[count - 1][1] == 0);
    assert(reports[count - 2][0] == 1 && reports[count - 2][3] == 0);
    reset();
    for (i = 0; i < 300; i++) {
        actionsPress(0, 0);
        actionsRelease(0);
        actionsRotate(1);
    }
    assert(actionsDropped(0) == 255 && actionsDropped(1) == 255);
    actionsClear();
    assert(actionsDropped(0) == 0 && actionsDropped(1) == 0);
}

static void testHighLayerActions(void) {
    for (uint8_t variant = 0; variant < 2; variant++) {
        uint8_t count = variant ? 7 : 5;
        uint8_t size = variant ? 15 : 22;
        for (uint8_t mode = 0; mode < 3; mode++) {
            reset();
            memset(activeConfig + 9, 0, CONFIG_SIZE - 9);
            activeConfig[5] = variant;
            activeConfig[3] = count - 1;
            activeConfig[9] = mode == 2 ? CONFIG_ACTION_MOMENTARY_LAYER :
                CONFIG_ACTION_SET_LAYER | (mode ? 0x10 : 0);
            activeConfig[10] = count - 1;
            activeConfig[9 + size * (count - 1) + 2] = CONFIG_ACTION_KEY_TAP;
            activeConfig[9 + size * (count - 1) + 3] = 4;
            actionsInit();
            actionsPress(0, 0);
            assert(actionsLayer() == count - 1);
            actionsPress(1, 1);
            assert(actionsLayer() == (mode == 1 ? 0 : count - 1));
            actionsPoll(1);
            assert(reports[0][3] == 4); // Selected high-layer binding executed.
            actionsRelease(1);
            actionsRelease(0);
            assert(actionsLayer() == (mode ? 0 : count - 1));
        }
    }
}

static void testLedDispatch(void) {
    reset();
    activeConfig[9] = 0x1F; activeConfig[10] = CONFIG_LED_PRESET_RELATIVE;
    activeConfig[23] = 0x9F; activeConfig[24] = CONFIG_LED_PHASE_RELATIVE;
    activeConfig[25] = 0x7F; activeConfig[26] = CONFIG_LED_SPEED_RELATIVE;
    blocked = 1;
    actionsPress(0, 0);
    assert(ledCalls == 1 && ledCommand == CONFIG_LED_PRESET_RELATIVE && ledValue == 1 && count == 0);
    actionsPress(0, 1); // A held key does not retrigger.
    actionsPoll(100);
    assert(ledCalls == 1 && count == 0);
    actionsRelease(0);
    for (uint8_t i = 0; i < 100; i++) actionsRotate(i & 1);
    assert(ledCalls == 101 && count == 0 && actionsDropped(1) == 0);
    assert(ledCommand == CONFIG_LED_PHASE_RELATIVE && ledValue == 9);

    // A chord on the selected one-shot layer consumes it before applying policy.
    reset();
    memset(activeConfig + 9, 0, CONFIG_SIZE - 9);
    activeConfig[3] = 1; activeConfig[5] = 2; activeConfig[8] = 8;
    activeConfig[9] = 0x10 | CONFIG_ACTION_SET_LAYER; activeConfig[10] = 1;
    activeConfig[53] = 0x15; // Keys 1+2, layer 1.
    activeConfig[54] = 0xFF; activeConfig[55] = CONFIG_LED_BOTH_SET;
    actionsInit();
    blocked = 1;
    actionsPress(0, 0); actionsRelease(0);
    assert(actionsLayer() == 1);
    actionsPress(1, 1);
    assert(ledCalls == 0 && actionsLayer() == 1);
    actionsPress(2, 2);
    assert(ledCalls == 1 && ledValue == 15 && ledCommand == CONFIG_LED_BOTH_SET && ledLayer == 0);
    actionsRelease(1); actionsRelease(2); actionsPoll(100);
    assert(ledCalls == 1 && count == 0 && actionsLayer() == 0);
}

static void testConsumeWake(void) {
    reset();
    activeConfig[3] = 1 << 6;
    uint8_t timer = configTimedOffset();
    activeConfig[timer] = 128;
    activeConfig[timer] |= CONFIG_TIMED_CONSUME;
    activeConfig[timer + 1] = CONFIG_ACTION_LED_CONTROL;
    activeConfig[timer + 2] = CONFIG_LED_RESTORE;
    // Consume even with a None resume action; no state should be created for a hold.
    activeConfig[9] = CONFIG_ACTION_KEY_HOLD; activeConfig[10] = 4;
    actionsTimedReset(0);
    actionsTimedPoll(1);
    assert(actionsTimedInput());
    actionsRelease(0);
    actionsPoll(0);
    assert(count == 0);
    assert(!actionsTimedInput());
    actionsPress(0, 1); actionsPoll(1);
    assert(count == 1 && reports[0][3] == 4);
    actionsRelease(0); actionsPoll(2);
    assert(reports[count - 1][3] == 0);
    // One completed encoder detent is consumed, subsequent detents work normally.
    actionsTimedPoll(2);
    uint8_t before = count;
    assert(actionsTimedInput()); // scanEncoder would skip actionsRotate here.
    actionsPoll(10);
    assert(count == before);
    assert(!actionsTimedInput());
    actionsRotate(1); actionsPoll(11);
    assert(count > before && reports[count - 1][0] == 2);
    // A consumed chord partner does not complete the pending chord.
    reset();
    activeConfig[5] = 2;
    timer = configTimedOffset();
    activeConfig[31] = 0; activeConfig[32] = CONFIG_ACTION_KEY_TAP; activeConfig[33] = 6;
    activeConfig[3] = 1 << 6;
    activeConfig[timer] = 128;
    activeConfig[timer] |= CONFIG_TIMED_CONSUME;
    activeConfig[timer + 1] = CONFIG_ACTION_LED_CONTROL;
    activeConfig[timer + 2] = CONFIG_LED_RESTORE;
    actionsTimedReset(0);
    actionsPress(1, 0); // Pending single, awaiting key 0.
    actionsTimedPoll(1);
    assert(actionsTimedInput());
    actionsRelease(0);
    actionsPoll(100);
    assert(count && reports[0][3] == 0x2C); // Single key, not chord usage 6.
    actionsRelease(1);
    // All armed timers resume once; any one may request consuming the event.
    reset();
    activeConfig[3] = 2 << 6;
    timer = configTimedOffset();
    for (uint8_t i = 0; i < 2; i++) {
        activeConfig[timer + 5 * i + 3] = CONFIG_ACTION_LED_CONTROL;
        activeConfig[timer + 5 * i + 4] = CONFIG_LED_RESTORE;
    }
    activeConfig[timer + 5] |= CONFIG_TIMED_CONSUME;
    actionsTimedReset(0); actionsTimedPoll(1);
    assert(actionsTimedInput() && ledCalls == 2);
    assert(!actionsTimedInput() && ledCalls == 2);
    // Consuming the wake binding must not consume an already-armed one-shot layer.
    reset();
    activeConfig[3] = 1 | (1 << 6);
    activeConfig[9] = 0x1A; activeConfig[10] = 1;
    activeConfig[33] = CONFIG_ACTION_KEY_TAP; activeConfig[34] = 4;
    timer = configTimedOffset();
    activeConfig[timer] = CONFIG_TIMED_CONSUME;
    actionsInit(); actionsTimedReset(0);
    actionsPress(0, 0); actionsRelease(0);
    assert(actionsLayer() == 1);
    actionsTimedPoll(1);
    assert(actionsTimedInput());
    actionsRelease(1); // The consumed press created no action state.
    assert(actionsLayer() == 1);
    assert(!actionsTimedInput());
    actionsPress(1, 1);
    assert(actionsLayer() == 0);
    actionsPoll(1);
    assert(count && reports[0][3] == 4);
}

int main(void) {
    testTimedPrecision();
    testConsumerHolds();
#if CONFIG_SCROLL_ACCELERATION
    testScrollAcceleration();
#endif
    testScrollHold();
    testScrollReportSpacing();
    testConsumeWake();
    reset();
    uint8_t timer = configTimedOffset();
    activeConfig[3] = 2 << 6;
    activeConfig[timer] = 0; // Every tick, no reset on physical input.
    activeConfig[timer + 1] = CONFIG_ACTION_LED_CONTROL;
    activeConfig[timer + 2] = CONFIG_LED_INDICATOR_SET;
#if CONFIG_TIMED_RESUME
    activeConfig[timer + 3] = 0xFF;
    activeConfig[timer + 4] = CONFIG_LED_INDICATOR_SET;
#endif
    activeConfig[timer + CONFIG_TIMED_SIZE] = 129; // Every two ticks, reset on input.
    activeConfig[timer + CONFIG_TIMED_SIZE + 1] = 0x1F;
    activeConfig[timer + CONFIG_TIMED_SIZE + 2] = CONFIG_LED_KEY_SET;
    actionsTimedReset(254);
    actionsTimedPoll(254);
    assert(ledCalls == 0);
    actionsTimedPoll(255);
    assert(ledCalls == 1 && ledCommand == CONFIG_LED_INDICATOR_SET);
    actionsTimedPoll(255);
    assert(ledCalls == 1);
    actionsTimedInput(); // Resume exactly once; reset timer 1 before its deadline.
    assert(ledCalls == (CONFIG_TIMED_RESUME ? 2 : 1));
    actionsTimedInput();
    assert(ledCalls == (CONFIG_TIMED_RESUME ? 2 : 1));
    actionsTimedPoll(0); // Wrap of the shared 8-bit coarse clock.
    assert(ledCommand == CONFIG_LED_INDICATOR_SET);
    actionsTimedPoll(1);
    assert(ledCommand == CONFIG_LED_KEY_SET && ledValue == 1);
    // Endpoint 64, and resume does not disturb a non-reset periodic phase.
    reset();
    timer = configTimedOffset();
    activeConfig[3] = 1 << 6;
    activeConfig[timer] = CONFIG_TIMED_INTERVAL_MASK;
    activeConfig[timer + 1] = CONFIG_ACTION_LED_CONTROL;
    activeConfig[timer + 2] = CONFIG_LED_RESTORE;
    actionsTimedReset(0);
    for (uint8_t tick = 1; tick <= CONFIG_TIMED_INTERVAL_MASK; tick++) {
        actionsTimedPoll(tick);
        assert(ledCalls == 0);
    }
    actionsTimedPoll(CONFIG_TIMED_INTERVAL_MASK + 1);
    assert(ledCalls == 1);
    actionsTimedReset(7);
    actionsTimedPoll(7);
    assert(ledCalls == 1);
    // Timer execution must not consume an armed one-shot layer.
    reset();
    activeConfig[3] = 1 | (1 << 6); // Two layers, one timer.
    memset(activeConfig + 31, 0, 22);
    activeConfig[9] = 0x1A;
    activeConfig[10] = 1;
    activeConfig[33] = CONFIG_ACTION_KEY_TAP;
    activeConfig[34] = 4;
    timer = configTimedOffset();
    activeConfig[timer] = 0;
    activeConfig[timer + 1] = CONFIG_ACTION_LED_CONTROL;
    activeConfig[timer + 2] = CONFIG_LED_RESTORE;
    actionsInit();
    actionsTimedReset(0);
    actionsPress(0, 0);
    assert(actionsLayer() == 1);
    actionsTimedPoll(1);
    assert(ledCalls == 1 && actionsLayer() == 1);
    actionsTimedInput();
    actionsPress(1, 1);
    assert(actionsLayer() == 0);
    // Repeated timer HID actions use the existing bounded queue/drop accounting.
    reset();
    timer = configTimedOffset();
    activeConfig[3] = 1 << 6;
    activeConfig[timer] = 0;
    activeConfig[timer + 1] = CONFIG_ACTION_KEY_TAP;
    activeConfig[timer + 2] = 4;
    blocked = 1;
    actionsTimedReset(0);
    for (uint8_t tick = 1; tick < 32; tick++) actionsTimedPoll(tick);
    assert(count == 0 && actionsDropped(0) > 0);
    // Independent reset flags retain periodic phase while restarting inactivity.
    reset();
    timer = configTimedOffset();
    activeConfig[3] = 2 << 6;
    activeConfig[timer] = 2;
    activeConfig[timer + 1] = CONFIG_ACTION_LED_CONTROL;
    activeConfig[timer + 2] = CONFIG_LED_INDICATOR_SET;
    activeConfig[timer + CONFIG_TIMED_SIZE] = 130;
    activeConfig[timer + CONFIG_TIMED_SIZE + 1] = 0x1F;
    activeConfig[timer + CONFIG_TIMED_SIZE + 2] = CONFIG_LED_KEY_SET;
    actionsTimedReset(0);
    actionsTimedPoll(1);
    actionsTimedInput();
    actionsTimedPoll(2);
    assert(ledCalls == 0);
    actionsTimedPoll(3);
    assert(ledCalls == (CONFIG_TIMED_ALL_RESET ? 0 : 1));
    actionsTimedPoll(4);
    assert(ledCalls == 2 && ledCommand == CONFIG_LED_KEY_SET);
    testLedDispatch();
    testHighLayerActions();
    testPointerHold();
    testPointerSteps();
    testPreviousLayer();
    testOneShot();
    testOneShotGlobalLayerChord();
    testRelativeLayer();
    testRolloverBackpressure();
    testClearAndOverflow();
    testMultipleChords();
    testRotationPressure();
    testLongLivedMomentary();
    testChords(0);
    testChords(1);
    testChordWindow();
    testBriefHolds();
    testChordLayers();
    testDefaults();
    testLayerAndOwnership();
    testRolloverAndSequence();
    testRotationOptions();
    testLayerCancelsConsumer();
    testMultiClickPlayback();
    testMouseAndLayerOrder();
    return 0;
}
