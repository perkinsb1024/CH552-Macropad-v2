/* Isolated encoding/dispatch regression; actual config.c/actions.c, hardware stubs only. */
#include <assert.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include "../src/actions.h"
#include "config_fixture.h"

static uint8_t reports[2048][9];
static unsigned count, ledCalls, cases;
static uint8_t blocked, generation, ledValue;
extern uint8_t buttonFirst[], buttonSecond[], buttonPressed[], pendingInput;
extern uint8_t liveBindings[], baseLayer, oneShotReturnLayer;
static const uint8_t stride = PHYSICAL_VARIANT ? 15 : 22;
static uint8_t block, pair;
uint8_t USB_queueKeyboard(const uint8_t *keys) {
    if (blocked) return 0;
    assert(count < 2048); reports[count][0] = 1;
    memcpy(reports[count++] + 1, keys, 8); return 1;
}
uint8_t USB_queueMousePacked(uint8_t buttons, int8_t x, int8_t y, uint8_t scroll) {
    if (blocked) return 0;
    assert(count < 2048); uint8_t *r = reports[count++];
    r[0] = 2; r[1] = buttons; r[2] = x; r[3] = y; r[4] = scroll; return 1;
}
uint8_t USB_queueConsumer(uint16_t usage) {
    if (blocked) return 0;
    assert(count < 2048); reports[count][0] = 5;
    reports[count][1] = usage; reports[count++][2] = usage >> 8; return 1;
}
uint8_t USB_reportsPending(void) { return 0; }
void USB_discardReports(void) {}
uint8_t USB_reportGeneration(void) { return generation; }
uint8_t USB_asciiUsage(uint8_t c) { return c & 127; }
void firmwareLedAction(uint8_t command, uint8_t value) {
    (void)command; ledCalls++; ledValue = value;
}
static void seal(void) {
    uint16_t crc = configCrc(activeConfig); activeConfig[7] = crc; activeConfig[8] = crc >> 8;
}
static uint8_t valid(void) { seal(); cases++; return !!configValid(activeConfig, PHYSICAL_VARIANT); }
static void reset(uint8_t layers, uint8_t timers, uint8_t chords, uint8_t pairs) {
    memset(activeConfig, 0, CONFIG_ACTIVE_SIZE);
    activeConfig[0] = CONFIG_MARKER; activeConfig[1] = CONFIG_VERSION;
    testSetVariant(PHYSICAL_VARIANT); testSetLayout(layers, 0, timers);
    testSetChordCount(chords);
    activeConfig[CONFIG_HEADER_LED] = 2; // 40ms chord window.
    block = configTimedOffset() + timers * 6;
    pair = block + 1;
    if (pairs) activeConfig[block] = ((pairs - 1) << 4) | 15;
    count = ledCalls = blocked = 0;
    memset(liveBindings, 0, 13);
    actionsInit(); actionsTimedReset(0);
}
static void bind(uint8_t input, uint8_t selector) {
    activeConfig[9 + 2 * input] = (selector << 4) | 15;
    activeConfig[10 + 2 * input] = pair;
}
static void define(uint8_t tf, uint8_t ts, uint8_t hf, uint8_t hs) {
    activeConfig[pair] = tf; activeConfig[pair + 1] = ts;
    activeConfig[pair + 2] = hf; activeConfig[pair + 3] = hs;
}
static void ledPair(void) { define(0x1D, CONFIG_LED_PHASE_SET, 0x2D, CONFIG_LED_PHASE_SET); }
static void poll(uint16_t now) { actionsPoll(now); }
static void pump(uint16_t now, unsigned duration) {
    for (unsigned i = 0; i < duration; i++) poll(now + i);
}
static unsigned usageReports(uint8_t kind, uint16_t usage) {
    unsigned found = 0;
    for (unsigned i = 0; i < count; i++) {
        uint16_t value = kind == 1 ? reports[i][3] : reports[i][1] | ((uint16_t)reports[i][2] << 8);
        if (reports[i][0] == kind && value == usage) found++;
    }
    return found;
}

static void testThresholds(void) {
    const uint16_t origins[] = {0, 31, 255, 65500, 65535};
    for (uint8_t input = 0; input <= (PHYSICAL_VARIANT ? 3 : 6); input++)
        for (uint8_t selector = 0; selector < 16; selector++)
            for (unsigned o = 0; o < sizeof origins / sizeof origins[0]; o++)
                for (int delta = -1; delta <= 1; delta++)
                    for (uint8_t polling = 0; polling < 2; polling++) {
                        reset(1, 0, 0, 1); bind(input, selector); ledPair(); assert(valid());
                        uint16_t origin = origins[o], threshold = (selector + 1) * 32;
                        actionsPress(input, origin); assert(!ledCalls && !liveBindings[12]);
                        actionsPress(input, origin + 1); // Duplicate press cannot restart the timer.
                        uint16_t release = origin + threshold + delta;
                        if (polling) { poll(origin + threshold - 1); assert(!ledCalls); poll(release); }
                        actionsRelease(input, release);
                        assert(ledCalls == 1 && ledValue == (delta < 0 ? 1 : 2));
                        assert(liveBindings[12] == 1 && liveBindings[10] == ((delta < 0 ? 1 : 2) << 4 | 13));
                        pump(release, 20); assert(ledCalls == 1);
                        actionsRelease(input, release + 50); assert(ledCalls == 1);
                    }
}

static void testConcurrentAndLayers(void) {
    reset(2, 0, 0, 2); bind(0, 5); bind(1, 0);
    ledPair();
    activeConfig[pair + 4] = 0x3D; activeConfig[pair + 5] = CONFIG_LED_PHASE_SET;
    activeConfig[pair + 6] = CONFIG_ACTION_MOMENTARY_LAYER; activeConfig[pair + 7] = 1;
    activeConfig[12] = pair + 4;
    assert(valid());
    actionsPress(0, 65000); actionsPress(1, 65010);
    poll(65042); assert(actionsLayer() == 1 && !ledCalls);
    // Pending key 0 retains its pair even though layer 1 has no binding for it.
    actionsRelease(0, 65060); assert(ledCalls == 1 && ledValue == 1);
    actionsRelease(1, 65061); assert(actionsLayer() == 0 && ledCalls == 1);
    reset(2, 0, 0, 1); bind(0, 0); define(0x1D, 0, CONFIG_ACTION_RELATIVE_LAYER | CONFIG_LAYER_HOLD, 1);
    assert(valid()); actionsPress(0, 0); poll(32); assert(actionsLayer() == 1);
    poll(64); assert(actionsLayer() == 1); actionsRelease(0, 65); assert(actionsLayer() == 0);
    // One-shot consumption is deferred until a branch executes.
    reset(2, 0, 0, 1); bind(0, 0); ledPair();
    activeConfig[11] = 0x1C; activeConfig[12] = 1;
    activeConfig[9 + stride] = 15; activeConfig[10 + stride] = pair;
    actionsPress(1, 0); actionsRelease(1, 1); assert(actionsLayer() == 1 && oneShotReturnLayer == 0);
    actionsPress(0, 2); assert(actionsLayer() == 1 && oneShotReturnLayer == 0);
    actionsRelease(0, 3); assert(actionsLayer() == 0 && oneShotReturnLayer == 255 && ledCalls == 1);
    // Every physical input may wait concurrently, with independent deadlines.
    reset(1, 0, 0, 1); ledPair();
    uint8_t inputs = (PHYSICAL_VARIANT ? 3 : 6) + 1;
    for (uint8_t i = 0; i < inputs; i++) { bind(i, i); actionsPress(i, 65500 + i); }
    for (uint8_t i = 0; i < inputs; i++) {
        poll(65500 + i + (i + 1) * 32); assert(ledCalls == i + 1);
    }
    for (uint8_t i = 0; i < inputs; i++) actionsRelease(i, 1000);
    assert(ledCalls == inputs);
}

static void testChords(void) {
    for (uint8_t chordRole = 0; chordRole < 2; chordRole++) {
        reset(2, 0, 1, 1); bind(0, 3); ledPair();
        uint8_t c = configLayerPaletteOffset(2);
        activeConfig[c] = 0x70; // Global keys 0+1.
        activeConfig[c + 1] = chordRole ? 0x0F : 0x3D;
        activeConfig[c + 2] = chordRole ? pair : CONFIG_LED_PHASE_SET;
        assert(valid());
        actionsPress(0, 0); assert(pendingInput == 1);
        actionsPress(1, 39); assert(!pendingInput);
        if (chordRole) {
            poll(70); assert(!ledCalls); poll(71); assert(ledCalls == 1 && ledValue == 2);
        } else assert(ledCalls == 1 && ledValue == 3);
        actionsRelease(1, 72); actionsRelease(0, 73); assert(ledCalls == 1);
    }
    // Chord window does not restart the single key's original threshold.
    reset(1, 0, 1, 1); bind(0, 0); ledPair();
    uint8_t c = configLayerPaletteOffset(1);
    activeConfig[c] = 0x70; activeConfig[c + 1] = 0x3D;
    poll(0); actionsPress(0, 0); poll(32); assert(!ledCalls); // Chord still has precedence.
    poll(40); assert(ledCalls == 1 && ledValue == 2);
    actionsRelease(0, 41); assert(ledCalls == 1);
    reset(1, 0, 1, 1); bind(0, 3); ledPair();
    c = configLayerPaletteOffset(1); activeConfig[c] = 0x70; activeConfig[c + 1] = 0x3D;
    actionsPress(0, 100); actionsRelease(0, 101); assert(ledCalls == 1 && ledValue == 1);
    // A chord's tap resolves on its first release and never runs a constituent tap.
    reset(1, 0, 1, 1); bind(0, 0); ledPair();
    c = configLayerPaletteOffset(1); activeConfig[c] = 0x70;
    activeConfig[c + 1] = 0x0F; activeConfig[c + 2] = pair;
    actionsPress(0, 0); actionsPress(1, 10); actionsRelease(1, 11);
    assert(ledCalls == 1 && ledValue == 1); actionsRelease(0, 40); assert(ledCalls == 1);
}

static void testOutputsAndReset(void) {
    const uint8_t holds[] = {CONFIG_ACTION_KEY_HOLD, CONFIG_ACTION_MOUSE_HOLD,
        CONFIG_ACTION_CONSUMER_HOLD, CONFIG_ACTION_CONSUMER_MODIFIED_HOLD | 0x60};
    for (unsigned h = 0; h < sizeof holds; h++) {
        reset(1, 0, 0, 1); bind(0, 0); define(1, 5, holds[h], 4); assert(valid());
        blocked = 1; actionsPress(0, 0); actionsRelease(0, 32); pump(32, 20); assert(!count);
        blocked = 0; pump(60, 100);
        assert(buttonPressed[0] == 0);
        uint8_t kind = h == 0 ? 1 : h == 1 ? 2 : 5;
        assert(usageReports(kind, 4) >= 1 && usageReports(kind, 0) >= 1);
        assert(!usageReports(1, 5));
    }
    reset(1, 0, 0, 1); bind(0, 0); define(1, 5, 0x62, 4);
    actionsPress(0, 0); poll(32); assert(usageReports(1, 4));
    unsigned before = count; generation++; poll(33); assert(count > before);
    actionsRelease(0, 34); pump(34, 20);
    reset(1, 0, 0, 1); bind(0, 15); ledPair(); actionsPress(0, 0);
    actionsClear(); poll(1000); actionsRelease(0, 1000); assert(!ledCalls);
    // Both tap and hold may invoke a macro; references start beyond the pair block.
    for (uint8_t held = 0; held < 2; held++) {
        reset(1, 0, 0, 1); bind(0, 0);
        uint8_t macro = pair + 4;
        define(CONFIG_ACTION_MACRO, macro, CONFIG_ACTION_MACRO, macro);
        activeConfig[macro] = 1; activeConfig[macro + 1] = 4;
        assert(valid()); actionsPress(0, 0); actionsRelease(0, held ? 32 : 1); pump(33, 100);
        assert(usageReports(1, 4) == 1);
    }
    // Pending wrappers do not interfere with ordinary output.
    reset(1, 0, 0, 1); bind(0, 3); ledPair();
    activeConfig[11] = 1; activeConfig[12] = 4;
    actionsPress(0, 0); actionsPress(1, 1); actionsRelease(1, 2); pump(2, 50);
    assert(usageReports(1, 4) == 1 && !ledCalls);
    actionsRelease(0, 52); assert(ledCalls == 1 && ledValue == 1);
}

static void testTraceModel(void) {
    uint32_t random = 0x12345678;
    uint8_t inputs = (PHYSICAL_VARIANT ? 3 : 6) + 1;
    for (unsigned trace = 0; trace < 2000; trace++) {
        reset(1, 0, 0, 1); ledPair();
        uint8_t down[7] = {0}, waiting[7] = {0}, selectors[7];
        uint16_t since[7] = {0}, now = (uint16_t)random;
        unsigned expected = 0;
        uint8_t last = 0;
        for (uint8_t i = 0; i < inputs; i++) { selectors[i] = (trace + i) & 15; bind(i, selectors[i]); }
        for (unsigned event = 0; event < 100; event++) {
            random = random * 1664525u + 1013904223u;
            now += (random >> 24) & 63;
            uint8_t key = (random >> 8) % inputs, op = (random >> 16) % 3;
            if (!op) {
                if (!down[key]) { down[key] = waiting[key] = 1; since[key] = now; }
                actionsPress(key, now);
            } else if (op == 1) {
                if (down[key] && waiting[key]) {
                    last = (uint16_t)(now - since[key]) >= (selectors[key] + 1) * 32 ? 2 : 1;
                    expected++; waiting[key] = 0;
                }
                down[key] = 0; actionsRelease(key, now);
            } else {
                for (uint8_t i = 0; i < inputs; i++) if (waiting[i] &&
                    (uint16_t)(now - since[i]) >= (selectors[i] + 1) * 32) {
                    last = 2; expected++; waiting[i] = 0;
                }
                poll(now);
            }
            assert(ledCalls == expected && (!expected || ledValue == last)); cases++;
        }
    }
}

static void testStringsAndPalettes(void) {
    reset(2, 0, 0, 0);
    activeConfig[9 + stride - 1] &= 15; // Optional per-key palette on layer 0.
    uint8_t pool = configTimedOffset();
    testSetStringLength(4); memcpy(activeConfig + pool, "A\0B", 4);
    block = pool + 4; pair = block + 1;
    activeConfig[block] = 15; bind(0, 0);
    define(CONFIG_ACTION_STRING, 0, CONFIG_ACTION_STRING, 2);
    assert(valid()); actionsPress(0, 0); actionsRelease(0, 1); pump(1, 40);
    assert(usageReports(1, 'A') == 1);
    actionsPress(0, 50); poll(82); actionsRelease(0, 83); pump(83, 40);
    assert(usageReports(1, 'B') == 1);
}

static void testValidation(void) {
    // All wrapper selectors/addresses across physical, rotation, chord, timers and macro.
    for (uint8_t context = 0; context < 7; context++) {
        reset(1, 1, 1, 2); ledPair();
        uint8_t chord = configLayerPaletteOffset(1), timer = configTimedOffset();
        uint8_t slot = context < 3 ? 9 + 2 * (context == 0 ? 0 : (PHYSICAL_VARIANT ? 3 : 6) + context - 1) :
            context == 3 ? chord + 1 : context == 4 ? timer + 1 : context == 5 ? timer + 3 : pair + 8;
        for (uint8_t t = 0; t < 16; t++) for (unsigned address = 0; address < 256; address++) {
            activeConfig[slot] = (t << 4) | 15; activeConfig[slot + 1] = address;
            uint8_t expected = context < 2 || context == 3;
            expected &= address == pair || address == pair + 4;
            assert(valid() == expected);
        }
    }
    // Every two-byte action is validated identically to its ordinary execution context.
    for (uint8_t branch = 0; branch < 2; branch++) {
        reset(2, 0, 0, 1);
        uint8_t ordinary = 9 + 2 * (branch ? 1 : (PHYSICAL_VARIANT ? 3 : 6) + 1);
        bind(0, 0);
        for (unsigned first = 0; first < 256; first++) for (unsigned second = 0; second < 256; second++) {
            memset(activeConfig + pair, 0, 4);
            activeConfig[ordinary] = first; activeConfig[ordinary + 1] = second;
            uint8_t expected = valid() && (first & 15) != 15;
            activeConfig[ordinary] = activeConfig[ordinary + 1] = 0;
            activeConfig[pair + 2 * branch] = first; activeConfig[pair + 2 * branch + 1] = second;
            assert(valid() == expected);
        }
    }
    // Section-count bounds, including a block exactly ending at byte 128.
    for (unsigned start = (PHYSICAL_VARIANT ? 24 : 31); start < 128; start++)
        for (uint8_t n = 1; n <= 16; n++) {
            reset(1, 0, 0, 0);
            testSetStringLength(start - block); // Empty strings are permitted.
            activeConfig[start] = ((n - 1) << 4) | 15;
            activeConfig[9] = 15; activeConfig[10] = start + 1;
            assert(valid() == (start + 1 + 4 * n <= 128));
        }
    reset(1, 0, 0, 1); bind(0, 0); ledPair();
    uint8_t macro = pair + 4;
    activeConfig[11] = CONFIG_ACTION_MACRO;
    for (unsigned address = 0; address < 256; address++) {
        activeConfig[12] = address; assert(valid() == (address >= macro && address < 128));
    }
    activeConfig[12] = macro; assert(valid()); activeConfig[7] ^= 1;
    assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    // An image with no optional tail bytes must not read beyond the saved image.
    reset(1, 0, 0, 0); testSetStringLength(128 - block); assert(valid());
}

int main(void) {
    testThresholds(); testConcurrentAndLayers(); testChords(); testOutputsAndReset(); testTraceModel(); testStringsAndPalettes(); testValidation();
    printf("Tap-hold %u: %u assertions/cases plus runtime matrices passed\n", PHYSICAL_VARIANT, cases);
    return 0;
}
