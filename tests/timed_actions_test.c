#define PROBE_SHARED 0
#define PROBE_SCOPED 1
#define PROBE_WIDE 1
#define PROBE_RESET 1
#define PROBE_KEEP_RESUME 1
#define PROBE_CACHED_SCOPE 0
/* Production v10 timer regression suite, using the common USB/LED stubs. */
#define main existingActionsMain
#include "actions_test.c"
#include "../src/led_control.h"
#undef main
#undef actionsTimedReset
#undef actionsTimedPoll

static uint8_t fine;

static void advanceFine(uint32_t ticks) {
    while (ticks) {
        uint8_t step = ticks > 128 ? 128 : ticks;
        fine += step;
        actionsTimedPoll(fine);
        ticks -= step;
    }
}

static void probeLayer(uint8_t layer) {
    uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
    uint8_t keys = PHYSICAL_VARIANT ? 3 : 6;
    uint8_t offset = 9 + size * actionsLayer() + 2 * (keys + 2);
    activeConfig[offset] = CONFIG_ACTION_SET_LAYER;
    activeConfig[offset + 1] = layer;
    actionsRotate(0);
}

static void setScope(uint8_t index, uint8_t scope) {
#if PROBE_SHARED
    uint8_t offset = configTimedOffset() - 2 + (index >> 1);
    uint8_t shift = (index & 1) ? 4 : 0;
    activeConfig[offset] &= ~(7 << shift);
    activeConfig[offset] |= scope << shift;
#elif PROBE_SCOPED
    uint8_t offset = configTimedOffset() + index * CONFIG_TIMED_SIZE + 5;
    activeConfig[offset] = (activeConfig[offset] & ~7) | scope;
#else
    (void)index; (void)scope;
#endif
#if PROBE_CACHED_SCOPE
    // Direct test edits stand in for applying a new complete configuration.
    actionsTimedReset(fine);
#endif
}

static void setFlags(uint8_t index, uint8_t flags) {
    uint8_t offset = configTimedOffset() + index * CONFIG_TIMED_SIZE;
#if PROBE_WIDE
    offset += 5;
#endif
    activeConfig[offset] = (activeConfig[offset] & 63) | flags;
}

static void probeInit(uint8_t timers) {
    memset(activeConfig, 0, CONFIG_SIZE);
    activeConfig[0] = CONFIG_MARKER;
    activeConfig[CONFIG_HEADER_VERSION] = CONFIG_VERSION;
    testSetVariant(PHYSICAL_VARIANT);
    testSetLayout(3, 0, timers); // Three layers.
    testSetStringLength(0);
    activeConfig[CONFIG_HEADER_SLEEP] = CONFIG_SLEEP_DEFAULT;
    testSetVariant(PHYSICAL_VARIANT);
    for (uint8_t i = 0; i < timers; i++) {
        uint8_t offset = configTimedOffset() + i * CONFIG_TIMED_SIZE;
        activeConfig[offset + 1] = CONFIG_ACTION_LED_CONTROL;
        activeConfig[offset + 2] = CONFIG_LED_KEY_SET;
        activeConfig[offset + 3] = CONFIG_ACTION_LED_CONTROL;
        activeConfig[offset + 4] = CONFIG_LED_INDICATOR_SET;
    }
    actionsInit(); fine = 0; actionsTimedReset(fine); ledCalls = 0;
}

static void probeSeal(void) {
    uint16_t crc = configCrc(activeConfig);
    activeConfig[CONFIG_HEADER_CRC] = crc; activeConfig[CONFIG_HEADER_CRC + 1] = crc >> 8;
}

static void crcReference(void) {
    // Independent bit-at-a-time polynomial reference, also exercising the two
    // excluded CRC bytes. Useful when measuring alternate CRC implementations.
    uint32_t state = 0xB6A4D103;
    for (uint16_t sample = 0; sample < 1000; sample++) {
        for (uint8_t i = 0; i < CONFIG_SIZE; i++) {
            state ^= state << 13; state ^= state >> 17; state ^= state << 5;
            activeConfig[i] = state;
        }
        uint16_t expected = 0xFFFF;
        for (uint8_t i = 0; i < CONFIG_SIZE; i++) {
            if (i == CONFIG_HEADER_CRC || i == CONFIG_HEADER_CRC + 1) continue;
            expected ^= (uint16_t)activeConfig[i] << 8;
            for (uint8_t bit = 0; bit < 8; bit++)
                expected = (expected & 0x8000) ? (expected << 1) ^ 0x1021 : expected << 1;
        }
        assert(configCrc(activeConfig) == expected);
        activeConfig[CONFIG_HEADER_CRC] ^= 0xFF; activeConfig[CONFIG_HEADER_CRC + 1] ^= 0xFF;
        assert(configCrc(activeConfig) == expected);
    }
}

static void validation(void) {
    for (uint8_t layers = 1; layers <= (PHYSICAL_VARIANT ? 7 : 5); layers++) {
        for (uint8_t scope = 0; scope < 8; scope++) {
            probeInit(1);
            testSetLayout(layers, 0, 1);
            memset(activeConfig + 9, 0, CONFIG_SIZE - 9); testUniformLayers();
            setScope(0, scope); probeSeal();
            assert(!!configValid(activeConfig, PHYSICAL_VARIANT) ==
                   (!PROBE_SCOPED || scope <= layers));
        }
    }
    probeInit(4);
    for (uint8_t i = 0; i < 4; i++) setScope(i, i % 4);
    probeSeal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    // String addressing must account for shared metadata and record growth.
    testSetStringLength(2);
    uint8_t pool = configTimedOffset() + 4 * CONFIG_TIMED_SIZE;
    activeConfig[pool] = 'A'; activeConfig[pool + 1] = 0;
    probeSeal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    assert(configStringChar(0, 0) == 'A' && configStringChar(0, 1) == 0);
    // A full string pool fits exactly, then one extra byte is rejected.
    probeInit(1); testSetLayout(1, 0, 1);
    memset(activeConfig + 9, 0, CONFIG_SIZE - 9); testUniformLayers();
    pool = configTimedOffset() + CONFIG_TIMED_SIZE;
    testSetStringLength(CONFIG_SIZE - pool);
    probeSeal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    activeConfig[CONFIG_HEADER_POOL] += 2; probeSeal(); assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    // Every interval byte/flag combination is accepted for a valid scope.
    probeInit(1);
    for (uint16_t value = 0; value < 256; value++) {
        activeConfig[configTimedOffset()] = value;
        setFlags(0, 192); setScope(0, 1);
        probeSeal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    }
}

static void timing(void) {
    probeInit(1); setFlags(0, 192);
    advanceFine(255); assert(ledCalls == 0);
    advanceFine(1); assert(ledCalls == 1);
    advanceFine(256); assert(ledCalls == 2); // Repeated expiry coalesces resume.
    assert(actionsTimedInput() && ledCalls == 3);
    assert(!actionsTimedInput() && ledCalls == 3);
    advanceFine(255); assert(ledCalls == 3);
    advanceFine(1); assert(ledCalls == 4);
    probeInit(1);
    activeConfig[configTimedOffset()] = 255;
    activeConfig[configTimedOffset() + 5] = 56;
    uint32_t period = 2048UL * 256;
    advanceFine(period - 1); assert(ledCalls == 0);
    advanceFine(1); assert(ledCalls == 1);
    advanceFine(period); assert(ledCalls == 2);
    actionsTimedInput(); assert(ledCalls == 3);
}

static void highIntervals(void) {
    for (uint8_t high = 0; high < 8; high++) {
        for (uint8_t flags = 0; flags < 4; flags++) {
            probeInit(1);
            uint8_t offset = configTimedOffset();
            activeConfig[offset] = 173;
            activeConfig[offset + 5] = (high << 3) | (flags << 6) | 1;
            probeSeal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
            uint32_t period = (((uint16_t)high << 8) + 174UL) * 256;
            advanceFine(period - 1); assert(ledCalls == 0);
            advanceFine(1); assert(ledCalls == 1);
            assert(!!actionsTimedInput() == !!(flags & 1));
            assert(ledCalls == 2);
            advanceFine(256); assert(ledCalls == 2);
            actionsTimedInput(); // Restart only when flag bit 7 is set.
            advanceFine(period - 256 - 1);
            assert(ledCalls == 2);
            advanceFine(1); assert(ledCalls == ((flags & 2) ? 2 : 3));
            if (flags & 2) { advanceFine(256); assert(ledCalls == 3); }
        }
    }
}

static void boundariesAndPhase(void) {
    const uint16_t counts[] = {1, 255, 256, 257, 511, 512, 513, 1023, 1024, 1025, 2047, 2048};
    for (uint8_t i = 0; i < sizeof(counts) / sizeof(counts[0]); i++) {
        probeInit(1);
        uint16_t encoded = counts[i] - 1;
        uint8_t offset = configTimedOffset();
        activeConfig[offset] = encoded;
        activeConfig[offset + 5] = (encoded >> 8) << 3;
        uint32_t period = counts[i] * 256UL;
        advanceFine(period - 1); assert(ledCalls == 0);
        advanceFine(1); assert(ledCalls == 1);
        advanceFine(period); assert(ledCalls == 2);
    }
    // High interval bits never contaminate selector validation or the two flags.
    probeInit(1);
    for (uint16_t metadata = 0; metadata < 256; metadata++) {
        activeConfig[configTimedOffset() + 5] = metadata;
        probeSeal();
        assert(!!configValid(activeConfig, PHYSICAL_VARIANT) == ((metadata & 7) <= 3));
    }
    // A reset immediately before a fractional carry keeps its independent phase.
    probeInit(1); setFlags(0, 128);
    activeConfig[configTimedOffset()] = 1;
    advanceFine(511); assert(ledCalls == 0);
    assert(!actionsTimedInput());
    advanceFine(511); assert(ledCalls == 0);
    advanceFine(1); assert(ledCalls == 1);
    // Layer changes clear high ages but retain an already armed next-input action.
    probeInit(1); setScope(0, 1); setFlags(0, 192);
    uint8_t offset = configTimedOffset();
    activeConfig[offset] = 255; activeConfig[offset + 5] |= 56;
    advanceFine(2048UL * 256); assert(ledCalls == 1);
    probeLayer(1); assert(actionsTimedInput()); assert(ledCalls == 2);
    probeLayer(0);
    advanceFine(2048UL * 256 - 1); assert(ledCalls == 2);
    advanceFine(1); assert(ledCalls == 3);
}

static void layers(void) {
    if (!PROBE_SCOPED) return;
    probeInit(2); setScope(0, 2); // Timer zero belongs to Layer 2.
    advanceFine(256); assert(ledCalls == 1); // Global timer only.
    probeLayer(1); advanceFine(128); assert(ledCalls == 1);
    probeLayer(0); advanceFine(128); assert(ledCalls == 2);
    probeLayer(1); advanceFine(128);
    assert(ledCalls == (PROBE_RESET ? 2 : 3));
    advanceFine(128); assert(ledCalls == 4);
    // An inactive scoped timer cannot consume input or run its resume action.
    setFlags(0, 192); probeLayer(0);
    uint16_t before = ledCalls;
    assert(!!actionsTimedInput() == !!PROBE_KEEP_RESUME);
    assert(ledCalls == before + (PROBE_KEEP_RESUME ? 2 : 1)); // Global resume too.
    probeLayer(1);
    assert(!!actionsTimedInput() == (!PROBE_RESET && !PROBE_KEEP_RESUME));
    // A brief leave/return with no intervening poll still resets in reset mode.
    probeInit(1); setScope(0, 1); advanceFine(128);
    probeLayer(1); probeLayer(0); advanceFine(128);
    assert(ledCalls == (PROBE_RESET ? 0 : 1));
    // An expiry that changes layer is processed immediately. Reset cancels its
    // next-input action; pause retains it until the scoped layer returns.
    probeInit(1); setScope(0, 1); setFlags(0, 192);
    uint8_t offset = configTimedOffset();
    activeConfig[offset + 1] = CONFIG_ACTION_SET_LAYER;
    activeConfig[offset + 2] = 1;
    advanceFine(256); assert(actionsLayer() == 1);
    assert(!!actionsTimedInput() == !!PROBE_KEEP_RESUME); probeLayer(0);
    assert(!!actionsTimedInput() == !PROBE_RESET);
    // Held momentary layers use the effective layer as well.
    probeInit(1); setScope(0, 2);
    activeConfig[9] = CONFIG_ACTION_MOMENTARY_LAYER; activeConfig[10] = 1;
    actionsPress(0, 0); assert(actionsLayer() == 1);
    advanceFine(256); assert(ledCalls == 1);
    actionsRelease(0, 0); assert(actionsLayer() == 0);
    advanceFine(256); assert(ledCalls == 1);
    // Timers and a consumed wake input must preserve an armed one-shot layer.
    // The next ordinary physical binding consumes it and resets interval state.
    probeInit(1); setScope(0, 2); setFlags(0, 192);
    uint8_t keys = PHYSICAL_VARIANT ? 3 : 6;
    activeConfig[9 + 2 * (keys + 2)] = CONFIG_ACTION_SET_LAYER | 0x10;
    activeConfig[10 + 2 * (keys + 2)] = 1;
    actionsRotate(0); assert(actionsLayer() == 1);
    advanceFine(256); assert(ledCalls == 1 && actionsLayer() == 1);
    assert(actionsTimedInput()); assert(actionsLayer() == 1 && ledCalls == 2);
    assert(!actionsTimedInput()); actionsPress(0, 0); actionsRelease(0, 0);
    assert(actionsLayer() == 0);
    // All four selectors are decoded independently, including the second byte.
    probeInit(4);
    setScope(0, 0); setScope(1, 1); setScope(2, 2); setScope(3, 3);
    advanceFine(256); assert(ledCalls == 2);
    probeLayer(1); advanceFine(256); assert(ledCalls == 4);
    probeLayer(2); advanceFine(256); assert(ledCalls == 6);
}

static void autoSleep(void) {
    const uint32_t interval = 440UL * 256;
    uint8_t options = 9 + (PHYSICAL_VARIANT ? 15 : 22) - 1;
    probeInit(0);
    advanceFine(interval * 2); assert(ledCalls == 0);
    assert(!actionsTimedInput());
    assert(!actionsTakeLayerSelection());
    activeConfig[options] |= CONFIG_LAYER_OPT_AUTO_SLEEP;
    advanceFine(interval - 1); assert(ledCalls == 0);
    advanceFine(1); assert(ledCalls == 1);
    assert(ledCommand == LED_SLEEP_CAPTURE && ledValue == 4);
    advanceFine(interval * 10); assert(ledCalls == 11); // Repeated Off coalesces wake.
    assert(!actionsTakeLayerSelection()); // Expiry does not request an indication.
    ledCalls = 1;
    assert(actionsTimedInput());
    assert(actionsTakeLayerSelection());
    assert(!actionsTakeLayerSelection());
    assert(ledCommand == LED_SLEEP_RESTORE && ledValue == 0);
    assert(!actionsTimedInput());
    assert(!actionsTakeLayerSelection()); // Ordinary input does not retrigger it.
    advanceFine(interval - 1); assert(ledCalls == 2);
    actionsTimedInput(); // Restart independent phase immediately before expiry.
    advanceFine(interval - 1); assert(ledCalls == 2);
    advanceFine(1); assert(ledCalls == 3);
    probeLayer(1); // A disabled layer restores lighting without physical input.
    assert(actionsTakeLayerSelection());
    assert(ledCalls == 4 && ledValue == 0);
    assert(!actionsTimedInput()); // No pending sleep input remains to consume.
    assert(!actionsTakeLayerSelection());
    assert(actionsLayer() == 1);
    advanceFine(interval * 2); assert(ledCalls == 4);
    probeLayer(0); advanceFine(interval / 2);
    probeLayer(1); probeLayer(0);
    // Visiting a disabled layer clears elapsed sleep time.
    advanceFine(interval - 1); assert(ledCalls == 4);
    advanceFine(1); assert(ledCalls == 5);
    actionsTimedReset(fine); assert(!actionsTimedInput());
    // A global timer switching layers every 4.096 seconds must not prevent
    // sleep. The same-layer case must preserve the phase too.
    for (uint8_t target = 0; target < 2; target++) {
        probeInit(1);
        for (uint8_t layer = 0; layer < 3; layer++)
            activeConfig[options + layer * (PHYSICAL_VARIANT ? 15 : 22)] |= CONFIG_LAYER_OPT_AUTO_SLEEP;
        uint8_t offset = configTimedOffset();
        activeConfig[offset + 1] = CONFIG_ACTION_SET_LAYER | CONFIG_LAYER_RELATIVE;
        activeConfig[offset + 2] = target;
        activeConfig[offset + 3] = CONFIG_ACTION_NONE;
        activeConfig[offset + 4] = 0;
        advanceFine(interval - 1); assert(ledCalls == 0);
        advanceFine(1); assert(ledCalls == 1);
        assert(ledValue == 4);
        assert(actionsTimedInput()); assert(ledCalls == 2);
        advanceFine(interval / 2);
        assert(!actionsTimedInput()); // Physical input restarts sleep.
        advanceFine(interval - 1); assert(ledCalls == 2);
        advanceFine(1); assert(ledCalls == 3);
    }
    // All four user timers remain available alongside auto-sleep.
    probeInit(4); activeConfig[options] |= CONFIG_LAYER_OPT_AUTO_SLEEP;
    for (uint8_t i = 0; i < 4; i++) {
        uint8_t offset = configTimedOffset() + i * CONFIG_TIMED_SIZE;
        activeConfig[offset] = 255; activeConfig[offset + 5] = 56;
    }
    advanceFine(interval); assert(ledCalls == 1);
    assert(actionsTimedInput()); assert(ledCalls == 2);
    assert(actionsTakeLayerSelection());
    advanceFine(2048UL * 256 - interval);
    assert(ledCalls == 9); // Four user expiries and three additional Off periods.
    // Only the built-in pending wake requests an indication. Subsequent user
    // timer resumes with no built-in sleep pending leave it clear.
    assert(actionsTimedInput());
    assert(actionsTakeLayerSelection());
    activeConfig[options] &= ~CONFIG_LAYER_OPT_AUTO_SLEEP;
    advanceFine(2048UL * 256);
    actionsTimedInput();
    assert(!actionsTakeLayerSelection());
}

static void disabledLayerUserResumes(void) {
    uint8_t options = 9 + (PHYSICAL_VARIANT ? 15 : 22) - 1;
    for (uint8_t count = 0; count <= CONFIG_TIMED_MAX; count++) {
        probeInit(count);
        activeConfig[options] |= CONFIG_LAYER_OPT_AUTO_SLEEP;
        for (uint8_t i = 0; i < count; i++) {
            uint8_t offset = configTimedOffset() + i * CONFIG_TIMED_SIZE;
            activeConfig[offset + 1] = CONFIG_ACTION_NONE;
            activeConfig[offset + 2] = 0;
            setFlags(i, CONFIG_TIMED_CONSUME);
        }
        advanceFine(440UL * 256); assert(ledCalls == 1);
        probeLayer(1); // Wakes sleep but preserves every armed user follow-up.
        assert(ledCalls == 2 && ledValue == 0);
        assert(actionsTakeLayerSelection());
        assert(!!actionsTimedInput() == !!count);
        assert(ledCalls == 2 + count);
        assert(!actionsTakeLayerSelection()); // No built-in physical wake remains.
    }
}

static void sleepSettings(void) {
    static const uint16_t ticks[] = {220, 440, 879, 1758};
    uint8_t options = 9 + (PHYSICAL_VARIANT ? 15 : 22) - 1;
    for (uint8_t settings = 0; settings < 32; settings++) {
        probeInit(0);
        activeConfig[CONFIG_HEADER_SLEEP] = settings;
        activeConfig[options] |= CONFIG_LAYER_OPT_AUTO_SLEEP;
        actionsTimedReset(fine);
        uint32_t interval = (uint32_t)ticks[settings & 3] * 256;
        advanceFine(interval - 1); assert(ledCalls == 0);
        advanceFine(1); assert(ledCalls == 1);
        assert(ledCommand == LED_SLEEP_CAPTURE);
        assert(ledValue == ((settings & CONFIG_SLEEP_DIM) ? 2 : 4));
        assert(!actionsTakeLayerSelection());
        assert(!!actionsTimedInput() == !!(settings & CONFIG_SLEEP_CONSUME));
        assert(ledCalls == 2 && ledValue == 0);
        assert(!!actionsTakeLayerSelection() == !!(settings & CONFIG_SLEEP_INDICATOR));
        assert(!actionsTimedInput() && !actionsTakeLayerSelection());
        advanceFine(interval - 1); assert(ledCalls == 2);
        actionsTimedInput(); // Each preset resets its fractional phase on input.
        advanceFine(interval - 1); assert(ledCalls == 2);
        advanceFine(1); assert(ledCalls == 3);
        probeLayer(1); assert(actionsTakeLayerSelection());
        assert(ledCalls == 4 && ledValue == 0); // Disabled layer wakes immediately.
        assert(!actionsTimedInput());
        assert(!actionsTakeLayerSelection());
        advanceFine(interval); assert(ledCalls == 4); // Opt-out remains awake.
        probeLayer(0); assert(actionsTakeLayerSelection());
        advanceFine(interval); assert(ledCalls == 5);
        actionsTimedReset(fine); assert(!actionsTimedInput()); // Apply cancels pending wake.
    }
    // A consuming user timer still consumes input when sleep itself passes it.
    probeInit(4);
    activeConfig[CONFIG_HEADER_SLEEP] = CONFIG_SLEEP_INDICATOR;
    activeConfig[options] |= CONFIG_LAYER_OPT_AUTO_SLEEP;
    setFlags(3, CONFIG_TIMED_CONSUME);
    actionsTimedReset(fine);
    advanceFine(220UL * 256);
    assert(actionsTimedInput());
    assert(actionsTakeLayerSelection());
}

int main(void) {
    crcReference(); validation(); timing(); highIntervals(); boundariesAndPhase(); layers(); autoSleep(); disabledLayerUserResumes(); sleepSettings();
    return 0;
}
