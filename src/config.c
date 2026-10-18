#include "config.h"

// Page alignment shortens indexed reads. protocolInit loads every byte before
// use; build_firmware.py checks this absolute allocation separately from XSEG.
#ifdef __SDCC
__xdata __at (0x300) uint8_t activeConfig[CONFIG_ACTIVE_SIZE];
#else
__xdata uint8_t activeConfig[CONFIG_ACTIVE_SIZE];
#endif

__code uint8_t configPalette[16][3] = {
  { 0, 0, 0 }, // Off; zero is a source sentinel only in the layer options.
  { 255, 0, 0 }, // Red
  { 255, 22, 7 }, // Coral
  { 255, 16, 0 }, // Orange
  { 255, 66, 0 }, // Amber
  { 255, 124, 0 }, // Yellow
  { 60, 255, 0 }, // Green
  { 100, 200, 20 }, // Leaf
  { 0, 255, 200 }, // Cyan
  { 0, 91, 255 }, // Azure
  { 0, 0, 255 }, // Blue
  { 115, 0, 180 }, // Violet
  { 255, 0, 194 }, // Magenta
  { 255, 0, 72 }, // Rose
  { 255, 255, 255 }, // White
  { 0, 0, 0 }, // Rainbow is rendered procedurally.
};

// Each firmware binary has fixed geometry; do not emit runtime variant branches
// or a 16-bit multiply for layer addressing. Host validation exercises both.
#ifdef __SDCC
#define layerSize(variant) ((uint8_t)(PHYSICAL_VARIANT == CONFIG_THREE_KEYS ? 15 : 22))
#define keyCount(variant) ((uint8_t)(PHYSICAL_VARIANT == CONFIG_THREE_KEYS ? 3 : 6))
#define maxLayers(variant) ((uint8_t)CONFIG_MAX_LAYERS)
#define pairCount(variant) ((uint8_t)(PHYSICAL_VARIANT == CONFIG_THREE_KEYS ? 3 : 15))
#else
static uint8_t layerSize(uint8_t variant) { return variant == CONFIG_THREE_KEYS ? 15 : 22; }
static uint8_t keyCount(uint8_t variant) { return variant == CONFIG_THREE_KEYS ? 3 : 6; }
static uint8_t maxLayers(uint8_t variant) { return variant == CONFIG_THREE_KEYS ? 7 : 5; }
static uint8_t pairCount(uint8_t variant) { return variant == CONFIG_THREE_KEYS ? 3 : 15; }
#endif

uint16_t configCrc(const __xdata uint8_t *image) {
    uint16_t crc = 0xFFFF;
    uint8_t i;
    uint8_t bit;
    for (i = 0; i < CONFIG_SIZE; i++) {
        if (i == CONFIG_HEADER_CRC || i == CONFIG_HEADER_CRC + 1) {
            continue;
        }
        crc ^= (uint16_t)image[i] << 8;
        for (bit = 0; bit < 8; bit++) {
            uint8_t high = (uint8_t)(crc >> 8) & 0x80;
            crc <<= 1;
            if (high) crc ^= 0x1021;
        }
    }
    return crc;
}

static FW_BIT keyboardUsageValid(uint8_t usage) {
    // HID keyboard non-modifier usages supported by the US layout mapper.
    if (!usage) return 1;
    usage -= 0x04;
    if (usage <= 0x61) return 1;
    usage -= 0x64;
    return usage <= 0x0B;
}

// Validation runs only in the main loop. Sharing context avoids repeatedly
// passing image metadata and reduces SDCC register spills into internal RAM.
// Validated image/pool addresses stay below 128; narrow bounded index sums before access.
// Keep small masks and limits byte-sized too, before C's promoted comparisons.
static __data uint8_t validationLayers, validationPool, validationUsed;
static __data uint8_t validationMacros;
static const __xdata uint8_t *__data validationImage;
static FW_BIT actionValid(uint8_t offset, uint8_t rotation) {
    uint8_t first = validationImage[offset];
    uint8_t type = first & 15;
    uint8_t aux = first >> 4;
    uint8_t param = validationImage[(uint8_t)(offset + 1)];
    __idata uint8_t macros = validationMacros;
    if (rotation == 2 && type != CONFIG_ACTION_MACRO) rotation = 1;
    switch (type) {
        case CONFIG_ACTION_TAP_HOLD:
            return !rotation && param > (uint8_t)(validationPool + validationUsed) && param < macros &&
                   !((param ^ macros) & 3);
        case CONFIG_ACTION_MACRO:
            // Absolute image offset: no runtime directory or recursive lookup.
            // Macro steps use rotation=2, which prohibits nested invocations.
            if (rotation == 2 ||
                (!CONFIG_MACRO_REPEAT && aux) || param < macros ||
                param >= CONFIG_SIZE) return 0;
            // Zero terminators consume one byte; action parameters are not starts.
            while (macros < param) {
                if (validationImage[macros]) macros++;
                macros++;
            }
            return macros == param;
        case CONFIG_ACTION_LED_CONTROL:
            if (param >= CONFIG_LED_EFFECT_RESTORE) {
                if (param == CONFIG_LED_EFFECT_RESTORE) return 1; // Value is ignored by restore.
                param &= ~CONFIG_LED_EFFECT_DIM;
                return (uint8_t)(param - CONFIG_LED_EFFECT_ON) <=
                       CONFIG_LED_EFFECT_BLINK_8 - CONFIG_LED_EFFECT_ON;
            }
            if (param > CONFIG_LED_PRESET_TOGGLE) return 0;
            if (param == CONFIG_LED_RESTORE) return 1; // Value is ignored by restore.
            if (param == CONFIG_LED_PRESET_TOGGLE) {
                --aux; // uint8_t wrap rejects preset zero.
                return aux < 4;
            }
            if (param == CONFIG_LED_PRESET_SET) return aux <= 4;
            // The nibble is nonzero and not -8 exactly when its low bits are nonzero.
            if ((param & 1) || param == CONFIG_LED_PRESET_RELATIVE)
                return aux & 7;
            if (aux == 15) return 1;
            if (param < CONFIG_LED_INDICATOR_SET) return aux <= 3;
            return aux <= 2;
        case CONFIG_ACTION_KEY_TAP:
        case CONFIG_ACTION_KEY_HOLD:
            return (!rotation || type != CONFIG_ACTION_KEY_HOLD) &&
                   keyboardUsageValid(param);
        case CONFIG_ACTION_CONSUMER_MODIFIED:
        case CONFIG_ACTION_CONSUMER_MODIFIED_HOLD:
        case CONFIG_ACTION_CONSUMER:
        case CONFIG_ACTION_CONSUMER_HOLD:
            // Bit 0 selects hold; only unmodified types 8/9 may use the
            // auxiliary nibble to make an otherwise-zero usage nonzero.
            if (rotation && (type & 1)) return 0;
            return param != 0 || (!(type & 2) && aux != 0);
        case CONFIG_ACTION_MOUSE_CLICK:
            return param != 0; // Auxiliary 0–15 means 1–16 clicks; all eight button bits.
        case CONFIG_ACTION_MOUSE_TOGGLE:
            return aux <= (uint8_t)(rotation ? 2 : 3) && param != 0;
        case CONFIG_ACTION_SCROLL:
#if CONFIG_SCROLL_ACCELERATION
            return aux < 7 && (aux & 3) != 3 &&
                   (!rotation || !(aux & 4)) && param != 0x80 &&
                   (CONFIG_SCROLL_HOLD_SUPPORT || !(aux & 4));
#elif CONFIG_SCROLL_HOLD_SUPPORT
            // Binding-kind callers pass rotation as 0 or 1.
            return !(aux & (uint8_t)((rotation << 2) | 3)) && param != 0x80;
#else
            return !aux && param != 0x80;
#endif
        case CONFIG_ACTION_MOUSE_AXIS:
            if (param == 0x80) return 0;
            // Fall through: both pointer actions share hold and reserved-bit checks.
        case CONFIG_ACTION_MOUSE_XY:
            return !(aux & rotation); // Other unused pointer bits are ignored at runtime.
        case CONFIG_ACTION_NONE:
            if (!aux) return 1; // A None parameter is never read.
#if CONFIG_MACRO_PAUSE
            if (aux == (CONFIG_ACTION_PAUSE >> 4)) return 1;
#endif
            if (aux != (CONFIG_ACTION_STRING >> 4) || param >= validationUsed) return 0;
            return param == 0 || validationImage[(uint8_t)(validationPool + param - 1)] == 0;
        case CONFIG_ACTION_SET_LAYER:
            if ((aux & (uint8_t)(rotation << 1)) || (aux & 3) == 3) return 0;
            if (aux & 4) return (uint8_t)(param + 6) <= 12;
            return param < validationLayers || (!(aux & 2) && param == CONFIG_LAYER_PREVIOUS);
        default:
            return 0;
    }
}

FW_BIT configValid(const __xdata uint8_t *image, uint8_t variant) {
    uint8_t keys;
    uint8_t size;
    uint8_t chords;
    __idata uint8_t paletteBytes;
    __xdata uint8_t timers;
    __idata uint8_t layer;
    uint8_t offset;
    // Keep validator temporaries indirect to preserve direct RAM for dispatch.
    __idata uint8_t i;
    __idata uint8_t previous = 0;
    __idata uint8_t id;
#if CONFIG_TIMED_MAX <= 5
    uint8_t end;
#else
    uint16_t end;
#endif
    uint16_t crc;
    validationImage = image;
#ifdef __SDCC
    if (variant != PHYSICAL_VARIANT) return 0;
#endif
    if (variant > CONFIG_THREE_KEYS || validationImage[CONFIG_HEADER_MARKER] != CONFIG_MARKER ||
        validationImage[CONFIG_HEADER_VERSION] != CONFIG_VERSION ||
        (validationImage[CONFIG_HEADER_LAYERS] & CONFIG_HEADER_VARIANT_MASK) != variant) {
        return 0;
    }
    validationLayers = ((validationImage[CONFIG_HEADER_LAYERS] >> CONFIG_HEADER_LAYER_SHIFT) & CONFIG_HEADER_LAYER_MASK) + 1;
    if (((validationImage[CONFIG_HEADER_LAYERS] >> CONFIG_HEADER_STARTUP_SHIFT) & CONFIG_HEADER_LAYER_MASK) >= validationLayers) {
        return 0;
    }
    keys = keyCount(variant);
    size = layerSize(variant);
    if (validationLayers > maxLayers(variant)) return 0;
    chords = validationImage[CONFIG_HEADER_COUNTS] >> CONFIG_HEADER_CHORD_SHIFT;
    // Products fit a byte after the layer/chord count checks. Check section
    // capacity before adding the bounded pool/palette subtotal below.
    timers = validationImage[CONFIG_HEADER_COUNTS] & CONFIG_HEADER_TIMED_MASK;
    if (timers > CONFIG_TIMED_MAX) return 0;
    // Layer records keep their original stride; palettes follow all layers.
    paletteBytes = 0;
    offset = CONFIG_HEADER_SIZE + size - 1;
    for (layer = 0; layer < validationLayers; layer++) {
        if (!(validationImage[offset] & CONFIG_LAYER_OPT_COLOR_MASK))
            paletteBytes += (uint8_t)(keys + 1) >> 1;
        offset += size;
    }
    validationUsed = validationImage[CONFIG_HEADER_POOL] >> CONFIG_HEADER_POOL_SHIFT;
#if CONFIG_TIMED_MAX <= 5
    // Both subtotals fit a byte; check capacity before their addition.
    end = 9 + (uint8_t)(size * validationLayers) + (uint8_t)(3 * chords) +
          (uint8_t)(CONFIG_TIMED_SIZE * timers);
    if (end > CONFIG_SIZE || (uint8_t)(validationUsed + paletteBytes) >
        (uint8_t)(CONFIG_SIZE - end)) return 0;
    end += validationUsed + paletteBytes;
#else
    end = 9 + (uint8_t)(size * validationLayers) + (uint8_t)(3 * chords) +
          (uint8_t)(CONFIG_TIMED_SIZE * timers) + (uint16_t)validationUsed + paletteBytes;
    if (end > CONFIG_SIZE) {
        return 0;
    }
#endif
    validationPool = (uint8_t)end - validationUsed;
    // Optional counted pair block follows strings; ordinary profiles add nothing.
    validationMacros = (uint8_t)end;
    if (end < CONFIG_SIZE && (validationImage[(uint8_t)end] & 15) == CONFIG_ACTION_TAP_HOLD) {
        offset = (uint8_t)(5 + (uint8_t)((validationImage[(uint8_t)end] >> 4) << 2));
        // Both terms are <=128/65; the unsigned byte sum cannot wrap.
        validationMacros = (uint8_t)end + offset;
        if (validationMacros > CONFIG_SIZE) return 0;
    }
    offset = 9;
    for (layer = 0; layer < validationLayers; layer++) {
        for (i = 0; i < (uint8_t)(keys + 3); i++, offset += 2) {
            if (!actionValid(offset, i > keys)) {
                return 0;
            }
        }
        offset += size - 2 * (keys + 3);
    }
    // Writers zero unused palette nibbles; readers ignore them. CRC covers all bytes.
    offset += paletteBytes;
    for (i = 0; i < chords; i++) {
        id = validationImage[offset];
        if (((id >> 4) != 7 && (id >> 4) >= validationLayers) ||
            (id & 15) >= pairCount(variant) ||
            (i && id <= previous) ||
            !actionValid(offset + 1, 0)) {
            return 0;
        }
        previous = id;
        offset += 3;
    }
    for (i = 0; i < timers; i++, offset += CONFIG_TIMED_SIZE) {
        // The complete metadata capacity check already bounds this record.
        __idata uint8_t scope = validationImage[(uint8_t)(offset + 5)] & 7;
        if (scope > validationLayers) return 0;
        if (!actionValid(offset + 1, 1)) return 0;
#if CONFIG_TIMED_RESUME
        if (!actionValid(offset + 3, 1)) return 0;
#endif
    }
    if (validationUsed && validationImage[(uint8_t)(validationPool + validationUsed - 1)] != 0) {
        return 0;
    }
    for (i = 0; i < validationUsed; i++) {
        uint8_t c = validationImage[(uint8_t)(validationPool + i)];
        if ((uint8_t)(c - 32) > 94 && c && (uint8_t)(c - 9) > 1) {
            return 0;
        }
    }
    offset = validationPool + validationUsed;
    if (offset < validationMacros) offset++; // Skip the optional prefix.
    for (; offset < CONFIG_SIZE; offset++) {
        if (offset < validationMacros) {
            if ((validationImage[offset] & 15) == CONFIG_ACTION_TAP_HOLD ||
                !actionValid(offset, !((offset ^ validationMacros) & 2))) return 0;
        } else {
            if (!validationImage[offset]) continue;
            if (offset == CONFIG_SIZE - 1 || !actionValid(offset, 2)) return 0;
        }
        offset++;
    }
    crc = configCrc(validationImage);
    return validationImage[CONFIG_HEADER_CRC] == (uint8_t)crc &&
           validationImage[CONFIG_HEADER_CRC + 1] == (uint8_t)(crc >> 8);
}

uint8_t configLayerCount(void) { return ((activeConfig[CONFIG_HEADER_LAYERS] >> CONFIG_HEADER_LAYER_SHIFT) & CONFIG_HEADER_LAYER_MASK) + 1; }
uint8_t configStartupLayer(void) { return (activeConfig[CONFIG_HEADER_LAYERS] >> CONFIG_HEADER_STARTUP_SHIFT) & CONFIG_HEADER_LAYER_MASK; }
#ifndef __SDCC
uint8_t configKeyCount(void) { return keyCount(activeConfig[CONFIG_HEADER_LAYERS] & CONFIG_HEADER_VARIANT_MASK); }
#endif
uint8_t configChordWindowMs(void) {
    if (!(activeConfig[CONFIG_HEADER_COUNTS] >> CONFIG_HEADER_CHORD_SHIFT)) return 0;
    return 20 + (activeConfig[CONFIG_HEADER_LED] & CONFIG_HEADER_WINDOW_MASK) * 10;
}

// Share the active-image layer address calculation across all accessors.
static uint8_t layerOffset(uint8_t layer) {
    return 9 + layerSize(activeConfig[CONFIG_HEADER_LAYERS] & CONFIG_HEADER_VARIANT_MASK) * layer;
}

uint8_t configLayerOptions(uint8_t layer) {
    return activeConfig[(uint8_t)(layerOffset(layer + 1) - 1)];
}

uint8_t configLedColorOffset(uint8_t layer) {
    return layerOffset(layer) + 2 * (configKeyCount() + 3);
}

uint8_t configLayerPaletteOffset(uint8_t layer) {
    uint8_t offset = layerOffset(configLayerCount());
    uint8_t size = layerSize(activeConfig[CONFIG_HEADER_LAYERS] & 1);
    uint8_t options = CONFIG_HEADER_SIZE + size - 1;
    while (layer--) {
        if (!(activeConfig[options] & CONFIG_LAYER_OPT_COLOR_MASK))
            offset += (uint8_t)(configKeyCount() + 1) >> 1;
        options += size;
    }
    return offset;
}

uint8_t configLedColorAt(uint8_t offset, uint8_t key) {
    // Validated palettes and physical keys keep the final image offset below 128.
    offset += key >> 1;
    uint8_t colors = activeConfig[offset];
    if (key & 1) colors >>= 4;
    return colors & 15;
}

uint8_t configBindingOffset(uint8_t layer, uint8_t input) {
    return layerOffset(layer) + (uint8_t)(2 * input);
}

// Complemented physical-key masks, in the saved lexicographic pair order.
// An input mask is contained in a chord when none of its bits is excluded.
#if !defined(__SDCC) || PHYSICAL_VARIANT == CONFIG_THREE_KEYS
static const __code uint8_t chordExcludedThree[] = {0xFC, 0xFA, 0xF9};
#endif
#if !defined(__SDCC) || PHYSICAL_VARIANT == CONFIG_SIX_KEYS
static const __code uint8_t chordExcludedSix[] = {
    0xFC, 0xFA, 0xF6, 0xEE, 0xDE, 0xF9, 0xF5, 0xED, 0xDD, 0xF3, 0xEB, 0xDB, 0xE7, 0xD7, 0xCF
};
#endif

uint8_t configChordOffset(uint8_t layer, uint8_t inputs) {
    uint8_t count = activeConfig[CONFIG_HEADER_COUNTS] >> CONFIG_HEADER_CHORD_SHIFT;
    uint8_t offset;
    if (!count) return 0;
    offset = configLayerPaletteOffset(configLayerCount());
    uint8_t id;
    uint8_t excluded;
    uint8_t scope;

    do {
        id = activeConfig[offset];
        scope = id >> 4;
        if (scope == layer || scope == 7) {
#ifdef __SDCC
#if PHYSICAL_VARIANT == CONFIG_THREE_KEYS
            excluded = chordExcludedThree[(uint8_t)(id & 15)];
#else
            excluded = chordExcludedSix[(uint8_t)(id & 15)];
#endif
#else
            excluded = configKeyCount() == 3 ? chordExcludedThree[(uint8_t)(id & 15)] : chordExcludedSix[(uint8_t)(id & 15)];
#endif
            if (!(excluded & inputs)) return offset + 1;
        }
        offset += 3;
    } while (--count);
    return 0;
}

uint8_t configTimedCount(void) {
    return activeConfig[CONFIG_HEADER_COUNTS] & CONFIG_HEADER_TIMED_MASK;
}

uint8_t configTimedOffset(void) {
    return configLayerPaletteOffset(configLayerCount()) + 3 * (activeConfig[CONFIG_HEADER_COUNTS] >> CONFIG_HEADER_CHORD_SHIFT);
}

uint8_t configStringChar(uint8_t offset, uint8_t index) {
    uint8_t position = offset + index;
    uint8_t start;
    if (position < offset || position >= (activeConfig[CONFIG_HEADER_POOL] >> CONFIG_HEADER_POOL_SHIFT)) {
        return 0;
    }
    start = configTimedOffset() + CONFIG_TIMED_SIZE * configTimedCount();
    start += position;
    return activeConfig[start];
}
