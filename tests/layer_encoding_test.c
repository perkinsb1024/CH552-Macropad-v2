#define RELATIVE_HOLD_ENABLED 1
#define main existingMacroMain
#include "macros_test.c"
#undef main

static void setupLayers(uint8_t layers, uint8_t initial) {
    reset(); memset(activeConfig + 9, 0, CONFIG_SIZE - 9);
    activeConfig[3] = (layers - 1) | (initial << 3);
    actionsInit();
}
static void layerBinding(uint8_t layer, uint8_t input, uint8_t aux, uint8_t param) {
    uint8_t size = PHYSICAL_VARIANT ? 15 : 22;
    activeConfig[9 + size * layer + 2 * input] = CONFIG_ACTION_SET_LAYER | (aux << 4);
    activeConfig[10 + size * layer + 2 * input] = param;
}
static void testUnifiedLayerValidation(void) {
    for (uint8_t rotation = 0; rotation < 2; rotation++) {
        for (uint8_t aux = 0; aux < 16; aux++) {
            for (unsigned param = 0; param < 256; param++) {
                setupLayers(2, 0);
                uint8_t mode = aux & 3;
                uint8_t expected = aux < 8 && mode != 3 && (!rotation || mode != 2);
                if (!RELATIVE_HOLD_ENABLED && aux == 6) expected = 0;
                if (aux & 4) expected &= param <= 6 || param >= 0xfa;
                else expected &= param < 2 || (mode != 2 && param == CONFIG_LAYER_PREVIOUS);
                layerBinding(0, rotation ? configKeyCount() + 1 : 0, aux, param);
                seal(); assert(!!configValid(activeConfig, PHYSICAL_VARIANT) == expected);
            }
        }
    }
    // A unified hold remains prohibited in macro steps and timer fields.
    for (uint8_t aux = 2; aux <= 6; aux += 4) {
        setupLayers(2, 0); uint8_t tail = configTimedOffset();
        const uint8_t held[] = {CONFIG_ACTION_SET_LAYER | (aux << 4), 1};
        define(tail, held, 1); bind(0, tail, 1); seal();
        assert(!configValid(activeConfig, PHYSICAL_VARIANT));
        setupLayers(2, 0); tail = configTimedOffset(); activeConfig[3] |= 1 << 6;
        activeConfig[tail + 1] = held[0]; activeConfig[tail + 2] = 1;
        seal(); assert(!configValid(activeConfig, PHYSICAL_VARIANT));
        activeConfig[tail + 1] = activeConfig[tail + 2] = 0;
        activeConfig[tail + 3] = held[0]; activeConfig[tail + 4] = 1;
        seal(); assert(!configValid(activeConfig, PHYSICAL_VARIANT));
    }
}
static void testUnifiedRelativeModes(void) {
    for (uint8_t layers = 1; layers <= CONFIG_MAX_LAYERS; layers++) {
        for (uint8_t initial = 0; initial < layers; initial++) {
            for (int8_t delta = -6; delta <= 6; delta++) {
                for (uint8_t mode = 0; mode < (RELATIVE_HOLD_ENABLED ? 3 : 2); mode++) {
                    setupLayers(layers, initial);
                    layerBinding(initial, 0, 4 | mode, delta);
                    int8_t target = initial + delta;
                    while (target < 0) target += layers;
                    while (target >= layers) target -= layers;
                    seal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
                    actionsPress(0, 0); assert(actionsLayer() == target);
                    pump(0, 10); assert(actionsLayer() == target);
                    actionsRelease(0);
                    assert(actionsLayer() == (mode == 2 ? initial : target));
                    if (mode == 1) {
                        actionsPress(1, 10); assert(actionsLayer() == initial);
                    }
                }
            }
        }
    }
}
#if RELATIVE_HOLD_ENABLED
static void testRelativeHoldRetention(void) {
    // A base change beneath an overlay must not move the snapshot target.
    setupLayers(3, 0); layerBinding(0, 0, 6, 1); layerBinding(1, 1, 0, 2);
    actionsPress(0, 0); assert(actionsLayer() == 1);
    actionsPress(1, 1); assert(actionsLayer() == 1);
    actionsRelease(0); assert(actionsLayer() == 2);
    // Relative holds follow existing relative actions: resolve from base layer.
    setupLayers(3, 0); layerBinding(0, 0, 6, 1); layerBinding(1, 1, 6, 2);
    actionsPress(0, 0); actionsPress(1, 1); assert(actionsLayer() == 2);
    actionsRelease(1); assert(actionsLayer() == 1);
    actionsRelease(0); assert(actionsLayer() == 0);
    // Consuming a one-shot resolves relative to that selected base before return.
    setupLayers(3, 0); layerBinding(0, 0, 1, 1); layerBinding(1, 1, 6, 1);
    actionsPress(0, 0); actionsRelease(0); assert(actionsLayer() == 1);
    actionsPress(1, 1); assert(actionsLayer() == 2);
    actionsRelease(1); assert(actionsLayer() == 0);
    // Either chord key releases the resolved hold.
    setupLayers(3, 0); uint8_t tail = configTimedOffset(); activeConfig[5] |= 2;
    activeConfig[tail] = 0; activeConfig[tail + 1] = 0x69; activeConfig[tail + 2] = 2;
    seal(); assert(configValid(activeConfig, PHYSICAL_VARIANT));
    actionsPress(0, 0); actionsPress(1, 1); assert(actionsLayer() == 2);
    actionsRelease(1); assert(actionsLayer() == 0);
}
#endif
int main(void) {
    testUnifiedLayerValidation(); testUnifiedRelativeModes();
#if RELATIVE_HOLD_ENABLED
    testRelativeHoldRetention();
#endif
    return 0;
}
