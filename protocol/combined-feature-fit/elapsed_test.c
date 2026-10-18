/* Exhaust the actual runtime predicate over the entire 16-bit elapsed range. */
static void testElapsedRange(void) {
    const uint16_t origins[] = {0, 65535};
    for (uint8_t selector = 0; selector < 16; selector++)
        for (unsigned o = 0; o < sizeof origins / sizeof origins[0]; o++) {
            reset(1, 0, 0, 1); bind(0, selector); ledPair(); assert(valid());
            actionsPress(0, origins[o]);
            for (uint32_t elapsed = 0; elapsed <= 65535; elapsed++) {
                buttonFirst[0] = (selector << 4) | CONFIG_ACTION_TAP_HOLD;
                buttonSecond[0] = pair; buttonPressed[0] = 1; ledCalls = 0;
                actionsResolveInputs((uint16_t)(origins[o] + elapsed));
                uint8_t expired = elapsed >= (uint16_t)(32 * (selector + 1));
                assert(ledCalls == expired);
                if (expired) assert(ledValue == 2);
                cases++;
            }
        }
}
