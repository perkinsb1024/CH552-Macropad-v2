/* Ordinary chords retain their pre-tap-hold scanner ordering at the deadline. */
#include <stdio.h>
#define main inputRegressionMain
#include "input_test.c"
#undef main
extern uint8_t buttonFirst[];

int main(void) {
    unsigned cases = 0;
    const uint16_t origins[] = {100, 65520};
    const uint8_t stride = PHYSICAL_VARIANT ? 15 : 22;
    for (uint8_t window = 1; window <= 7; window++)
        for (unsigned o = 0; o < sizeof origins / sizeof origins[0]; o++)
            for (int delta = -1; delta <= 1; delta++) {
                initAutoSleep();
                memset(activeConfig + 9, 0, CONFIG_SIZE - 9);
                testSetLayout(2, 0, 0); testSetChordCount(1); testSetStringLength(0);
                activeConfig[CONFIG_HEADER_LED] = window;
                activeConfig[9 + stride - 1] = activeConfig[9 + 2 * stride - 1] = 0x10;
                activeConfig[9] = CONFIG_ACTION_MOMENTARY_LAYER; activeConfig[10] = 1;
                activeConfig[9 + 2 * NUM_LEDS] = 0x1D;
                activeConfig[10 + 2 * NUM_LEDS] = CONFIG_LED_PHASE_SET;
                activeConfig[9 + stride + 2 * NUM_LEDS] = 0x2D;
                activeConfig[10 + stride + 2 * NUM_LEDS] = CONFIG_LED_PHASE_SET;
                activeConfig[configLayerPaletteOffset(2)] = 0x70; // Global keys 0+1.
                uint16_t crc = configCrc(activeConfig); activeConfig[7] = crc; activeConfig[8] = crc >> 8;
                assert(configValid(activeConfig, PHYSICAL_VARIANT));
                firmwareApplyConfig(1);
                currentMs = origins[o]; P1 &= ~KEY_MASK[0]; loop();
                currentMs += DEBOUNCE_MS; loop();
                uint32_t accepted = currentMs;
                assert(actionsLayer() == 0);
                currentMs = accepted + configChordWindowMs() + delta - DEBOUNCE_MS;
                P3 &= ~8; loop(); // Stage the encoder-button edge before the deadline.
                currentMs += DEBOUNCE_MS; loop();
                assert(buttonFirst[NUM_LEDS] == 0x1D && ledSettings[0] == 1);
                assert(actionsLayer() == (delta >= 0));
                cases++;
            }
    printf("Ordinary chord scanner ordering %u: %u cases passed\n", PHYSICAL_VARIANT, cases);
    return 0;
}
