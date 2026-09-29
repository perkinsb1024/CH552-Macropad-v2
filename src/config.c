#include "config.h"

__xdata uint8_t activeConfig[CONFIG_SIZE];

__code uint8_t configPalette[16][3] = {
  { 255, 0, 0 }, // Red
  { 255, 22, 7 }, // Coral
  { 255, 16, 0 }, // Orange
  { 255, 66, 0 }, // Amber
  { 255, 124, 0 }, // Yellow
  { 60, 255, 0 }, // Green
  { 100, 200, 20 }, // Leaf
  { 29, 123, 67 }, // Teal
  { 0, 255, 200 }, // Cyan
  { 0, 91, 255 }, // Azure
  { 0, 0, 255 }, // Blue
  { 115, 0, 180 }, // Violet
  { 255, 0, 194 }, // Magenta
  { 255, 0, 72 }, // Rose
  { 255, 255, 255 }, // White
  { 0, 0, 0 }, // Off
};

static uint8_t layerSize(uint8_t variant) {
    return variant == CONFIG_THREE_KEYS ? 15 : 22;
}

static uint8_t keyCount(uint8_t variant) {
    return variant == CONFIG_THREE_KEYS ? 3 : 6;
}

static uint8_t pairIndex(uint8_t a, uint8_t b, uint8_t keys) {
    uint8_t index = 0;
    uint8_t i;
    for (i = 0; i < a; i++) {
        index += keys - i - 1;
    }
    return index + b - a - 1;
}

uint16_t configCrc(const __xdata uint8_t *image) {
    uint16_t crc = 0xFFFF;
    uint8_t i;
    uint8_t bit;
    for (i = 0; i < CONFIG_SIZE; i++) {
        if (i == 6 || i == 7) {
            continue;
        }
        crc ^= (uint16_t)image[i] << 8;
        for (bit = 0; bit < 8; bit++) {
            crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
        }
    }
    return crc;
}

static uint8_t keyboardUsageValid(uint8_t usage) {
    // HID keyboard non-modifier usages supported by the US layout mapper.
    return usage == 0 || (usage >= 0x04 && usage <= 0x65) ||
           (usage >= 0x68 && usage <= 0x73);
}

static uint8_t actionValid(const __xdata uint8_t *image, uint8_t offset,
                           uint8_t layers, uint8_t rotation, uint8_t pool,
                           uint8_t poolUsed) {
    uint8_t type = image[offset] & 15;
    uint8_t aux = image[offset] >> 4;
    uint8_t param = image[offset + 1];
    uint8_t i;
    uint8_t start;
    switch (type) {
        case CONFIG_ACTION_NONE:
            return aux == 0 && param == 0;
        case CONFIG_ACTION_RELATIVE_LAYER:
            return aux <= 1 && (param <= 3 || param >= 0xFD);
        case CONFIG_ACTION_KEY_TAP:
        case CONFIG_ACTION_KEY_HOLD:
            return (!rotation || type != CONFIG_ACTION_KEY_HOLD) &&
                   keyboardUsageValid(param);
        case CONFIG_ACTION_MOUSE_CLICK:
        case CONFIG_ACTION_MOUSE_DOUBLE:
        case CONFIG_ACTION_MOUSE_HOLD:
        case CONFIG_ACTION_MOUSE_TOGGLE:
            return (!rotation || type != CONFIG_ACTION_MOUSE_HOLD) &&
                   aux == 0 && param > 0 && param <= 7;
        case CONFIG_ACTION_SCROLL:
        case CONFIG_ACTION_MOUSE_X:
        case CONFIG_ACTION_MOUSE_Y:
            return aux == 0 && param != 0x80;
        case CONFIG_ACTION_CONSUMER:
            // The full 12-bit consumer usage is retained, including its high nibble.
            return aux != 0 || param != 0;
        case CONFIG_ACTION_STRING:
            if (aux || param >= poolUsed) {
                return 0;
            }
            start = 0;
            for (i = 0; i < poolUsed; i++) {
                if (i == param && start) {
                    return 1;
                }
                start = image[pool + i] == 0;
            }
            return param == 0;
        case CONFIG_ACTION_SET_LAYER:
            return aux <= 1 && param < layers;
        case CONFIG_ACTION_MOMENTARY_LAYER:
            return aux == 0 && param < layers && !rotation;
        default:
            return 0;
    }
}

uint8_t configValid(const __xdata uint8_t *image, uint8_t variant) {
    uint8_t layers;
    uint8_t keys;
    uint8_t size;
    uint8_t chords;
    uint8_t pool;
    uint8_t used;
    uint8_t layer;
    uint8_t offset;
    uint8_t i;
    uint8_t previous = 0;
    uint8_t id;
    uint16_t end;
    uint16_t padding;
    uint16_t crc;
    if (variant > CONFIG_THREE_KEYS || image[0] != 'M' || image[1] != 'P' ||
        image[2] != CONFIG_VERSION || (image[3] & 0xF0) ||
        (image[5] & 0x80) || ((image[5] & 1) != variant) ||
        (image[8] & 0xF0)) {
        return 0;
    }
    layers = (image[3] & 3) + 1;
    if (((image[3] >> 2) & 3) >= layers) {
        return 0;
    }
    keys = keyCount(variant);
    size = layerSize(variant);
    chords = (image[5] >> 1) & 63;
    end = 9 + (uint16_t)size * layers + (uint16_t)3 * chords + image[4];
    if (end > CONFIG_SIZE) {
        return 0;
    }
    pool = 9 + size * layers + 3 * chords;
    used = image[4];
    for (layer = 0; layer < layers; layer++) {
        offset = 9 + size * layer;
        for (i = 0; i < keys + 3; i++) {
            if (!actionValid(image, offset + 2 * i, layers,
                             i >= keys + 1, pool, used)) {
                return 0;
            }
        }
        if (keys == 3 && (image[offset + 13] & 0xF0)) {
            return 0;
        }
    }
    offset = 9 + size * layers;
    for (i = 0; i < chords; i++) {
        id = image[offset];
        if ((id & 0x40) || ((id >> 4) & 3) >= layers ||
            (id & 15) >= (keys == 3 ? 3 : 15) ||
            (i && id <= previous) ||
            !actionValid(image, offset + 1, layers, 0, pool, used)) {
            return 0;
        }
        previous = id;
        offset += 3;
    }
    if (used && image[pool + used - 1] != 0) {
        return 0;
    }
    for (i = 0; i < used; i++) {
        if (image[pool + i] != 0 && image[pool + i] != 9 &&
            image[pool + i] != 10 &&
            (image[pool + i] < 32 || image[pool + i] > 126)) {
            return 0;
        }
    }
    for (padding = end; padding < CONFIG_SIZE; padding++) {
        if (image[padding]) {
            return 0;
        }
    }
    crc = configCrc(image);
    return image[6] == (uint8_t)crc && image[7] == (uint8_t)(crc >> 8);
}

uint8_t configLayerCount(void) { return (activeConfig[3] & 3) + 1; }
uint8_t configStartupLayer(void) { return (activeConfig[3] >> 2) & 3; }
uint8_t configKeyCount(void) { return keyCount(activeConfig[5] & 1); }
uint8_t configChordWindowMs(void) { return (activeConfig[8] & 15) * 5; }

uint8_t configLayerOptions(uint8_t layer) {
    uint8_t size = (activeConfig[5] & 1) ? 15 : 22;
    return activeConfig[8 + size * (layer + 1)];
}

uint8_t configLedColor(uint8_t layer, uint8_t key) {
    uint8_t keys = configKeyCount();
    uint8_t offset;
    uint8_t colors;
    if (layer >= configLayerCount() || key >= keys) {
        return 6;
    }
    offset = 9 + layerSize(activeConfig[5] & 1) * layer;
    colors = activeConfig[offset + 2 * (keys + 3) + (key >> 1)];
    return key & 1 ? colors >> 4 : colors & 15;
}

void configBinding(uint8_t layer, uint8_t input, __data uint8_t *first, __data uint8_t *second) {
    uint8_t offset;
    if (layer >= configLayerCount() || input >= configKeyCount() + 3) {
        *first = 0;
        *second = 0;
        return;
    }
    offset = 9 + layerSize(activeConfig[5] & 1) * layer + 2 * input;
    *first = activeConfig[offset];
    *second = activeConfig[offset + 1];
}

uint8_t configChord(uint8_t layer, uint8_t firstKey, uint8_t secondKey,
                    __data uint8_t *first, __data uint8_t *second) {
    uint8_t keys = configKeyCount();
    uint8_t id;
    uint8_t count = (activeConfig[5] >> 1) & 63;
    uint8_t offset = 9 + layerSize(activeConfig[5] & 1) * configLayerCount();
    uint8_t i;
    uint8_t swap;
    if (firstKey == secondKey || firstKey >= keys || secondKey >= keys ||
        layer >= configLayerCount()) {
        return 0;
    }
    if (firstKey > secondKey) {
        swap = firstKey;
        firstKey = secondKey;
        secondKey = swap;
    }
    id = layer << 4 | pairIndex(firstKey, secondKey, keys);
    for (i = 0; i < count; i++, offset += 3) {
        if (activeConfig[offset] == id ||
            (activeConfig[offset] & 0x8F) == (0x80 | (id & 15))) {
            *first = activeConfig[offset + 1];
            *second = activeConfig[offset + 2];
            return 1;
        }
    }
    return 0;
}

uint8_t configStringChar(uint8_t offset, uint8_t index) {
    uint16_t position = (uint16_t)offset + index;
    uint8_t start;
    if (position >= activeConfig[4]) {
        return 0;
    }
    start = 9 + layerSize(activeConfig[5] & 1) * configLayerCount() +
            3 * ((activeConfig[5] >> 1) & 63);
    return activeConfig[start + position];
}
