#ifndef MACROPAD_CONFIG_H
#define MACROPAD_CONFIG_H

#include <stdint.h>
#include "firmware_types.h"

#define CONFIG_SIZE 128
// v8: Type Text shares type 0; type 9 is Consumer Hold. Timers stay five bytes.
#define CONFIG_VERSION 8
#define CONFIG_TIMED_CONSUME 0x40
#define CONFIG_LAYER_PREVIOUS 0xFF
#ifndef CONFIG_TIMED_MAX
#define CONFIG_TIMED_MAX 4
#endif
#ifndef CONFIG_TIMED_ALL_RESET
#define CONFIG_TIMED_ALL_RESET 0
#endif
#ifndef CONFIG_TIMED_INTERVAL_MASK
#define CONFIG_TIMED_INTERVAL_MASK 63
#endif
#ifndef CONFIG_TIMED_RESUME
#define CONFIG_TIMED_RESUME 1
#endif
#define CONFIG_TIMED_SIZE (CONFIG_TIMED_RESUME ? 5 : 3)
#define CONFIG_HEADER_RAINBOW_PHASE_SHIFT 4
#define CONFIG_HEADER_RAINBOW_SPEED_SHIFT 6
#define CONFIG_HEADER_TRANSPARENT_BLACK 0x80
#define CONFIG_PALETTE_VERSION 3
#define CONFIG_MAX_LAYERS (PHYSICAL_VARIANT == CONFIG_THREE_KEYS ? 7 : 5)
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
#define CONFIG_ACTION_CONSUMER_HOLD    0x9
// Full first byte: type None with auxiliary value 1.
#define CONFIG_ACTION_STRING           0x10
#define CONFIG_ACTION_SET_LAYER        0xA
#define CONFIG_ACTION_MOMENTARY_LAYER  0xB
#define CONFIG_ACTION_RELATIVE_LAYER   0xC
#define CONFIG_ACTION_MOUSE_X          0xD
#define CONFIG_ACTION_MOUSE_Y          0xE
#define CONFIG_ACTION_LED_CONTROL      0xF

// LED command byte; the auxiliary nibble carries its value.
#define CONFIG_LED_PHASE_SET       0x00
#define CONFIG_LED_PHASE_RELATIVE  0x01
#define CONFIG_LED_SPEED_SET       0x02
#define CONFIG_LED_SPEED_RELATIVE  0x03
#define CONFIG_LED_INDICATOR_SET   0x04
#define CONFIG_LED_INDICATOR_RELATIVE 0x05
#define CONFIG_LED_KEY_SET         0x06
#define CONFIG_LED_KEY_RELATIVE    0x07
#define CONFIG_LED_BOTH_SET        0x08
#define CONFIG_LED_BOTH_RELATIVE   0x09
#define CONFIG_LED_RESTORE         0x0A
#define CONFIG_LED_PRESET_SET      0x0B
#define CONFIG_LED_PRESET_RELATIVE 0x0C
#define CONFIG_LED_PRESET_TOGGLE   0x0D
#define CONFIG_LED_EFFECT_RESTORE  0x80
#define CONFIG_LED_EFFECT_ON       0x81
#define CONFIG_LED_EFFECT_BLINK_1  0x82
#define CONFIG_LED_EFFECT_BLINK_8  0x89
#define CONFIG_LED_EFFECT_DIM      0x10 // OR into effect ON/BLINK commands, never RESTORE.
#define CONFIG_LED_OFF 0
#define CONFIG_LED_DIM 1
#define CONFIG_LED_BRIGHT 2
#define CONFIG_LED_CONFIGURED 15

#define CONFIG_MOUSE_MOVE_HOLD         0x10

// Per-layer option byte: full brightness bit 0, encoder bootloader bit 1, indicator bits 2–3, palette bits 4–7.
#define CONFIG_LAYER_OPT_FULL_BRIGHTNESS 0x01
#define CONFIG_LAYER_OPT_BOOTLOADER_RUN  0x02
#define CONFIG_LAYER_OPT_INDICATOR_SHIFT 2
#define CONFIG_LAYER_OPT_INDICATOR_MASK  0x0C
#define CONFIG_LAYER_OPT_COLOR_SHIFT     4
#define CONFIG_LAYER_OPT_COLOR_MASK      0xF0

#define CONFIG_LAYER_INDICATOR_NONE          0
#define CONFIG_LAYER_INDICATOR_TIMED_ON      1
#define CONFIG_LAYER_INDICATOR_BLINK_BY_LAYER 2
#define CONFIG_LAYER_INDICATOR_ALWAYS_ON     3

extern __xdata uint8_t activeConfig[CONFIG_SIZE];
extern __code uint8_t configPalette[16][3];

uint8_t configTimedCount(void);
uint8_t configTimedOffset(void);
uint16_t configCrc(const __xdata uint8_t *image);
FW_BIT configValid(const __xdata uint8_t *image, uint8_t variant);
uint8_t configLayerCount(void);
uint8_t configStartupLayer(void);
uint8_t configKeyCount(void);
uint8_t configChordWindowMs(void);
uint8_t configLayerOptions(uint8_t layer);
uint8_t configLedColor(uint8_t layer, uint8_t key);
void configBinding(uint8_t layer, uint8_t input, __data uint8_t *first, __data uint8_t *second);
FW_BIT configChord(uint8_t layer, uint8_t firstKey, uint8_t secondKey, __data uint8_t *first, __data uint8_t *second);
uint8_t configStringChar(uint8_t offset, __xdata uint8_t index);

#endif
