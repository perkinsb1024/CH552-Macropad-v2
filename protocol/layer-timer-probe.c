/* Included only in temporary experiments, using the existing USB/LED stubs. */
#define main existingActionsMain
#include "tests/actions_test.c"
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
    activeConfig[0] = 'M'; activeConfig[1] = 'P';
    activeConfig[2] = CONFIG_VERSION;
    activeConfig[3] = 2 | ((timers & 3) << 6); // Three layers.
    activeConfig[4] = (timers >> 2) << 7;
    activeConfig[5] = PHYSICAL_VARIANT;
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
    activeConfig[6] = crc; activeConfig[7] = crc >> 8;
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
            if (i == 6 || i == 7) continue;
            expected ^= (uint16_t)activeConfig[i] << 8;
            for (uint8_t bit = 0; bit < 8; bit++)
                expected = (expected & 0x8000) ? (expected << 1) ^ 0x1021 : expected << 1;
        }
        assert(configCrc(activeConfig) == expected);
        activeConfig[6] ^= 0xFF; activeConfig[7] ^= 0xFF;
        assert(configCrc(activeConfig) == expected);
    }
}

static void validation(void) {
    for (uint8_t layers = 1; layers <= (PHYSICAL_VARIANT ? 7 : 5); layers++) {
        for (uint8_t scope = 0; scope < 8; scope++) {
            probeInit(1);
            activeConfig[3] = (layers - 1) | 64;
            memset(activeConfig + 9, 0, CONFIG_SIZE - 9);
            setScope(0, scope); probeSeal();
            assert(!!configValid(activeConfig, PHYSICAL_VARIANT) ==
                   (!PROBE_SCOPED || scope <= layers));
        }
    }
    probeInit(4);
    for (uint8_t i = 0; i < 4; i++) setScope(i, i % 4);
    probeSeal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    // String addressing must account for shared metadata and record growth.
    activeConfig[4] |= 2;
    uint8_t pool = configTimedOffset() + 4 * CONFIG_TIMED_SIZE;
    activeConfig[pool] = 'A'; activeConfig[pool + 1] = 0;
    probeSeal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    assert(configStringChar(0, 0) == 'A' && configStringChar(0, 1) == 0);
    // A full string pool fits exactly, then one extra byte is rejected.
    probeInit(1); activeConfig[3] = 64;
    memset(activeConfig + 9, 0, CONFIG_SIZE - 9);
    pool = configTimedOffset() + CONFIG_TIMED_SIZE;
    activeConfig[4] = CONFIG_SIZE - pool;
    probeSeal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    activeConfig[4]++; probeSeal(); assert(!configValid(activeConfig, PHYSICAL_VARIANT));
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
    activeConfig[configTimedOffset()] = PROBE_WIDE ? 255 : 63;
    uint32_t period = (PROBE_WIDE ? 256UL : 64UL) * 256;
    advanceFine(period - 1); assert(ledCalls == 0);
    advanceFine(1); assert(ledCalls == 1);
    advanceFine(period); assert(ledCalls == 2);
    actionsTimedInput(); assert(ledCalls == 3);
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
    actionsRelease(0); assert(actionsLayer() == 0);
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
    assert(!actionsTimedInput()); actionsPress(0, 0); actionsRelease(0);
    assert(actionsLayer() == 0);
    // All four selectors are decoded independently, including the second byte.
    probeInit(4);
    setScope(0, 0); setScope(1, 1); setScope(2, 2); setScope(3, 3);
    advanceFine(256); assert(ledCalls == 2);
    probeLayer(1); advanceFine(256); assert(ledCalls == 4);
    probeLayer(2); advanceFine(256); assert(ledCalls == 6);
}

int main(void) {
    crcReference(); validation(); timing(); layers();
    return 0;
}
