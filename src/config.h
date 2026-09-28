#ifndef MACROPAD_CONFIG_H
#define MACROPAD_CONFIG_H

#include <stdint.h>

#define CONFIG_SIZE 128
#define CONFIG_VERSION 1
#define CONFIG_MAX_LAYERS 4
#define CONFIG_SIX_KEYS 0
#define CONFIG_THREE_KEYS 1

#ifndef PHYSICAL_VARIANT
#define PHYSICAL_VARIANT CONFIG_SIX_KEYS
#endif
#if PHYSICAL_VARIANT != CONFIG_SIX_KEYS && PHYSICAL_VARIANT != CONFIG_THREE_KEYS
#error "PHYSICAL_VARIANT must be 0 (six keys) or 1 (three keys)."
#endif

// Action numbers are part of the saved format.
#define CONFIG_ACTION_NONE             0x0
#define CONFIG_ACTION_KEY_TAP          0x1
#define CONFIG_ACTION_KEY_HOLD         0x2
#define CONFIG_ACTION_MOUSE_CLICK      0x3
#define CONFIG_ACTION_MOUSE_DOUBLE     0x4
#define CONFIG_ACTION_MOUSE_HOLD       0x5
#define CONFIG_ACTION_MOUSE_TOGGLE     0x6
#define CONFIG_ACTION_SCROLL           0x7
#define CONFIG_ACTION_CONSUMER         0x8
#define CONFIG_ACTION_STRING           0x9
#define CONFIG_ACTION_SET_LAYER        0xA
#define CONFIG_ACTION_MOMENTARY_LAYER  0xB
#define CONFIG_ACTION_TOGGLE_LAYER     0xC
#define CONFIG_ACTION_NEXT_LAYER       0xD
#define CONFIG_ACTION_MOUSE_X          0xE
#define CONFIG_ACTION_MOUSE_Y          0xF

// Per-layer option byte: boot bits 0–1, indicator behavior bits 2–3, palette bits 4–7.
#define CONFIG_LAYER_OPT_BOOTLOADER_BOOT 0x01
#define CONFIG_LAYER_OPT_BOOTLOADER_RUN  0x02
#define CONFIG_LAYER_OPT_INDICATOR_SHIFT 2
#define CONFIG_LAYER_OPT_INDICATOR_MASK  0x0C
#define CONFIG_LAYER_OPT_COLOR_SHIFT     4
#define CONFIG_LAYER_OPT_COLOR_MASK      0xF0

#define CONFIG_LAYER_INDICATOR_NONE          0
#define CONFIG_LAYER_INDICATOR_BLINK_ONCE    1
#define CONFIG_LAYER_INDICATOR_BLINK_BY_LAYER 2
#define CONFIG_LAYER_INDICATOR_ALWAYS_ON     3

extern __xdata uint8_t activeConfig[CONFIG_SIZE];
extern __code uint8_t configPalette[16][3];

uint16_t configCrc(const __xdata uint8_t *image);
uint8_t configValid(const __xdata uint8_t *image, uint8_t variant);
void configDefaults(uint8_t variant);
uint8_t configLayerCount(void);
uint8_t configStartupLayer(void);
uint8_t configKeyCount(void);
uint8_t configChordWindowMs(void);
uint8_t configLayerOptions(uint8_t layer);
uint8_t configLedColor(uint8_t layer, uint8_t key);
void configBinding(uint8_t layer, uint8_t input, __data uint8_t *first, __data uint8_t *second);
uint8_t configChord(uint8_t layer, uint8_t firstKey, uint8_t secondKey, __data uint8_t *first, __data uint8_t *second);
uint8_t configStringChar(uint8_t offset, uint8_t index);

#endif
