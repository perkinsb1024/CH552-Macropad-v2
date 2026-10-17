// Pinout
// 3.4 - WS2812 NeoPixel GRB (D7->D6->D5)
// 3.3 - Encoder button
// 3.0 - Encoder A
// 3.1 - Encoder B
// 1.1 - Key U1
// 1.7 - Key U2
// 1.6 - Key U3
// 1.5 - Key U4
// 1.4 - Key U5
// 3.2 - Key U6

#include <WS2812.h>
#include "src/actions.h"
#include "src/led_control.h"
#include "src/live_state.h"
#include "src/config.h"
#include "src/protocol_firmware.h"
#include "src/userUsbHidKeyboardMouse/USBHIDKeyboardMouse.h"

// Hardware connections are fixed for both board variants.
#define LED_FUNC        neopixel_show_P3_4
#define KEY_P1_MASK     (PHYSICAL_VARIANT ? 0xC2 : 0xF2)
#define INPUT_P3_MASK   (PHYSICAL_VARIANT ? 0x0B : 0x0F)

#define NUM_LEDS        (PHYSICAL_VARIANT ? 3 : 6)
#define NUM_BYTES       (NUM_LEDS * 3)
#define RAINBOW_DRIFT_MASK 3 // Fastest drift: mask+1 frames; each drift slot is half as fast.
#define RAINBOW_DRIFT_SLOT_MASK(slot) ((RAINBOW_DRIFT_MASK << (slot)) | ((1U << (slot)) - 1))
#define DEBOUNCE_MS     10
#define LAYER_INDICATOR_PHASE_TICKS 125 // 250 ms in 2 ms ticks; signed deadline < 128 ticks.
#define LED_EFFECT_FLAG 2 // Unused by color preview; shares the alternate option byte.

__code uint8_t KEY_MASK[5] = {0x02, 0x80, 0x40, 0x20, 0x10};
#if PHYSICAL_VARIANT == CONFIG_SIX_KEYS
// Phase order around the six-key perimeter: 1 -> 2 -> 3 -> 6 -> 5 -> 4.
__code uint8_t rainbowPositions[6] = {0, 1, 2, 5, 4, 3};
// Alternate fast/slow drift across rows: fast slow fast / slow fast slow.
__code uint8_t rainbowDriftMasks[6] = {
  RAINBOW_DRIFT_SLOT_MASK(0), RAINBOW_DRIFT_SLOT_MASK(3), RAINBOW_DRIFT_SLOT_MASK(1),
  RAINBOW_DRIFT_SLOT_MASK(4), RAINBOW_DRIFT_SLOT_MASK(2), RAINBOW_DRIFT_SLOT_MASK(5)
};
#else
__code uint8_t rainbowPositions[3] = {0, 1, 2};
__code uint8_t rainbowDriftMasks[3] = {
  RAINBOW_DRIFT_SLOT_MASK(0), RAINBOW_DRIFT_SLOT_MASK(2), RAINBOW_DRIFT_SLOT_MASK(1)
};
#endif
// Header bits 4–5 select 0, ~30, ~60, or ~150 degrees between LEDs.
__code uint8_t rainbowSteps[4] = {0, 21, 42, 109};
// Header bits 6–7 select extra fast, fast, slow, or extra slow rainbow speed.
__code uint8_t rainbowFrameMs[4] = {4, 6, 10, 18};
__code int8_t encoderTransitions[16] = {
  0, -1, 1, 0,
  1, 0, 0, -1,
  -1, 0, 0, 1,
  0, 1, -1, 0,
};

__xdata uint8_t ledData[NUM_BYTES];
// Raw levels use ordinary external RAM to preserve the internal stack reserve.
// Stable levels and debounce times remain private to this main-loop scanner.
__xdata uint8_t rawState[7];
__idata uint8_t stableState[7];
__xdata uint16_t rawChanged[7];
__xdata uint8_t liveRotations[2];
__xdata uint8_t liveGeneration;
__pdata uint8_t encoderState;
__pdata int8_t encoderMovement;
__pdata uint8_t lastLayer;
__pdata uint8_t layerIndicatorPhasesLeft;
__pdata uint8_t layerIndicatorDeadline;
__data uint8_t rainbowChanged;
__data uint8_t rainbowHue;
// Extra hue steps in physical LED order; staggered rates change relative phases.
__idata uint8_t rainbowDrift[NUM_LEDS];
// Current global rainbow presets; saved defaults remain in activeConfig.
// Phase, speed, indicator policy, key policy. Policies: Off=0, Dim=1, Bright=2, Configured=3.
__pdata uint8_t ledSettings[4]; // Shares the checked page-zero budget with actions.c.
// Exact two-bit policies, including As Configured; captured once per sleep.
static __data uint8_t awakeBrightness;
static ACTION_BIT sleepBrightnessPending;
__code uint8_t ledPresets[5] = {15, 13, 5, 4, 0};
__pdata uint8_t previewOptions; // Zero = normal; bit 1 marks a persistent LED effect.
static ACTION_BIT colorPreviewActive;
// Cache all animation participation during rendering, including custom palettes.
static ACTION_BIT rainbowAnimationActive;
// Per-frame scratch; only the main-loop renderer accesses it.
static __pdata uint8_t frameLayerColors;
static ACTION_BIT startupWaiting;
static ACTION_BIT startupWarning;
__xdata uint16_t errorLedChanged;

void displayLeds() {
  // Allow the LEDs to latch the previous frame before another transmission.
  delayMicroseconds(300);
#ifdef __SDCC
  // Pack the driver's DPTR/B/A arguments directly to fit the application limit.
  __asm
    mov dptr,#_ledData
#if PHYSICAL_VARIANT == CONFIG_THREE_KEYS
    mov b,#9
#else
    mov b,#18
#endif
    clr a
    lcall _neopixel_show_long_P3_4
  __endasm;
#else
  LED_FUNC(ledData, NUM_BYTES);
#endif
}

void clearLeds() {
  for (uint8_t i = 0; i < NUM_BYTES; i++) {
    ledData[i] = 0;
  }
  displayLeds();
}

uint8_t dimIndicatorComponent(uint8_t value) {
  if (!value) return 0;
  return (value >> 4) | 1;
}

uint8_t indicatorBrightness(uint8_t options) {
  uint8_t level = ledSettings[2];
  return level == 3 ? 1 + (options & CONFIG_LAYER_OPT_FULL_BRIGHTNESS) : level;
}

void updateLeds() {
  rainbowAnimationActive = 0;
  if (startupWaiting) return;
  if (!activeConfigValid && !previewOptions) return;
  uint8_t layer = actionsLayer();
  __idata uint8_t colors = configLedColorOffset(layer);
  uint8_t options = previewOptions ? previewOptions : configLayerOptions(layer);
  uint8_t behavior = (options >> CONFIG_LAYER_OPT_INDICATOR_SHIFT) & 3;
  uint8_t palette = options >> CONFIG_LAYER_OPT_COLOR_SHIFT;
  frameLayerColors = 0;
  if (!previewOptions && !palette) frameLayerColors = configLayerPaletteOffset(layer);
  rainbowAnimationActive = options >= 0xF4 && (!previewOptions || (options & 8));
  uint8_t phases = layerIndicatorPhasesLeft;
  uint8_t indicator = indicatorBrightness(options);
  uint8_t keyLevel = ledSettings[3];
  uint8_t spacing = ledSettings[0];
  if (previewOptions) {
    indicator = 1 + (options & CONFIG_LAYER_OPT_FULL_BRIGHTNESS);
    if (colorPreviewActive) spacing = (activeConfig[CONFIG_HEADER_LED] >> CONFIG_HEADER_RAINBOW_PHASE_SHIFT) & 3;
  } else
  if (!indicator) {
    // Suppressed indications must not obscure key feedback.
    phases = 0;
    behavior = CONFIG_LAYER_INDICATOR_NONE;
  }
  if (keyLevel == 3) keyLevel = 2;
  uint8_t phaseStep = rainbowSteps[spacing];
  __xdata uint8_t *ledPtr = ledData;
  for (uint8_t i = 0; i < NUM_LEDS; i++) {
    uint8_t color = frameLayerColors ? configLedColorAt(frameLayerColors, i) : palette;
    uint8_t level = indicator;
    if (frameLayerColors && color == 15) rainbowAnimationActive = 1;
    uint8_t red;
    uint8_t green;
    uint8_t blue;
    if (colorPreviewActive) {
      // Preview bypasses runtime brightness policies.
    } else
    if (phases) {
      if (behavior == CONFIG_LAYER_INDICATOR_BLINK_BY_LAYER && (phases & 1)) level = 0;
    } else {
      if (behavior != CONFIG_LAYER_INDICATOR_ALWAYS_ON) level = 0;
      if (keyLevel && stableState[i]) {
        uint8_t pressed = configLedColorAt(colors, i);
        if (pressed || !(activeConfig[CONFIG_HEADER_LED] & CONFIG_HEADER_TRANSPARENT_BLACK)) {
          color = pressed;
          level = keyLevel;
          if (color == 15) rainbowAnimationActive = 1;
        }
      }
    }
    if (!level) {
      red = green = blue = 0;
    } else if (color == 15 && (!colorPreviewActive || behavior == CONFIG_LAYER_INDICATOR_ALWAYS_ON)) {
      uint8_t wheel = rainbowHue + rainbowPositions[i] * phaseStep;
      if (spacing == 3) wheel += rainbowDrift[i];
      // Subtracting 85*3 adds one modulo 256; 170*3 adds two.
      color = wheel; // Reuse the palette scratch byte to retain the sector.
      wheel *= 3;
      if (color < 85) {
        green = 0;
        blue = wheel;
        red = (uint8_t)~wheel;
      } else if (color < 170) {
        wheel++;
        red = 0;
        green = wheel;
        blue = (uint8_t)~wheel;
      } else {
        wheel += 2;
        red = wheel;
        green = (uint8_t)~wheel;
        blue = 0;
      }
    } else {
      const __code uint8_t *rgb = configPalette[color];
      red = *rgb++;
      green = *rgb++;
      blue = *rgb;
    }
    if (level == 1) {
      red = dimIndicatorComponent(red);
      green = dimIndicatorComponent(green);
      blue = dimIndicatorComponent(blue);
    }
    ledPtr[0] = green;
    ledPtr[1] = red;
    ledPtr[2] = blue;
    ledPtr += 3;
  }
  displayLeds();
}

// Three whole cycles keep all supported deltas positive, without division.
uint8_t ledStep(uint8_t current, int8_t delta, uint8_t count) {
  uint8_t next = current + delta + count + count + count;
  while (next >= count) next -= count;
  return next;
}

void startLayerIndicator(uint8_t layer, uint16_t now);

void firmwareLedAction(uint8_t command, uint8_t value) {
  if (command >= CONFIG_LED_EFFECT_RESTORE) {
    colorPreviewActive = 0;
    previewOptions = (value << 4) | LED_EFFECT_FLAG | 8 | !(command & CONFIG_LED_EFFECT_DIM);
    command &= ~CONFIG_LED_EFFECT_DIM;
    layerIndicatorPhasesLeft = (command - CONFIG_LED_EFFECT_ON) << 1;
    if (command == CONFIG_LED_EFFECT_ON) previewOptions |= 4;
    if (command == CONFIG_LED_EFFECT_RESTORE) {
      previewOptions = 0;
      layerIndicatorPhasesLeft = 0;
    }
    // Effects share the phase clock, but clearing one is not a layer selection.
    layerIndicatorDeadline = (uint8_t)(((uint16_t)millis() >> 1) + LAYER_INDICATOR_PHASE_TICKS);
    updateLeds();
    return;
  }
  int8_t delta = value;
  if (value & 8) delta -= 16;
  uint8_t relative = command & 1;
  uint8_t current;
  uint8_t end;
  if (command >= CONFIG_LED_PRESET_SET) {
    end = ledSettings[2] | (ledSettings[3] << 2);
    // Repeat expiry actions without replacing the original awake policies.
    if (command == LED_SLEEP_CAPTURE) {
      if (!sleepBrightnessPending) awakeBrightness = end;
      sleepBrightnessPending = 1;
    }
    if (command == CONFIG_LED_PRESET_RELATIVE) {
      // Match the actual policies, including As configured, not rendered RGB.
      for (current = 0; current < 5; current++)
        if (ledPresets[current] == end) break;
      if (current == 5) {
        current = 0;
        // Relative payloads are validated nonzero; sign alone selects the entry.
        if (delta >= 0) current = 4;
      }
      value = ledStep(current, delta, 5);
    }
    if (command == LED_SLEEP_RESTORE) {
      value = awakeBrightness;
      sleepBrightnessPending = 0;
    } else value = ledPresets[value];
    // Compare policies rather than rendered brightness; no toggle latch is needed.
    if (command == CONFIG_LED_PRESET_TOGGLE && value == end) value = 15;
    ledSettings[2] = value & 3;
    ledSettings[3] = value >> 2;
  } else {
    if (command == CONFIG_LED_BOTH_RELATIVE) {
      // Normalize both policies to the brighter resolved level before cycling.
      current = indicatorBrightness(configLayerOptions(actionsLayer()));
      end = ledSettings[3];
      if (end == 3) end = 2;
      if (current < end) current = end;
      ledSettings[2] = current;
      ledSettings[3] = current;
    }
    if (command == CONFIG_LED_RESTORE) {
      current = 0;
      end = 4;
      value = 15;
    } else {
      current = 2;
      end = 4;
      if (command < CONFIG_LED_BOTH_SET) {
        current = command >> 1;
        end = current + 1;
      }
    }
    if (command == CONFIG_LED_SPEED_RELATIVE) delta = -delta;
    for (; current < end; current++) {
      uint8_t next = value;
      if (relative) {
        next = ledSettings[current];
        uint8_t count = 4;
        if (current >= 2) {
          count = 3;
          if (next == 3) {
            next = 2;
            if (current == 2) next = indicatorBrightness(configLayerOptions(actionsLayer()));
          }
        }
        next = ledStep(next, delta, count);
      } else if (value == 15) {
        next = 3;
        if (current == 0) next = (activeConfig[CONFIG_HEADER_LED] >> 4) & 3;
        if (current == 1) next = activeConfig[CONFIG_HEADER_LED] >> 6;
      }
      ledSettings[current] = next;
    }
  }
  if (command == CONFIG_LED_SPEED_SET || command == CONFIG_LED_SPEED_RELATIVE || command == CONFIG_LED_RESTORE)
    rainbowChanged = (uint8_t)millis();
  updateLeds();
}

#if ENABLE_COLOR_PREVIEW
void firmwarePreviewColor(uint8_t options) {
  if (previewOptions & LED_EFFECT_FLAG) layerIndicatorPhasesLeft = 0;
  previewOptions = options;
  colorPreviewActive = options != 0;
  if (!options && !activeConfigValid) {
    clearLeds();
    ledData[1] = 255;
    errorLedChanged = millis();
    displayLeds();
  } else {
    updateLeds();
  }
}

#endif

void startLayerIndicator(uint8_t layer, uint16_t now) {
  if (!(previewOptions & LED_EFFECT_FLAG)) {
    uint8_t behavior = (configLayerOptions(layer) >> CONFIG_LAYER_OPT_INDICATOR_SHIFT) & 3;
    layerIndicatorPhasesLeft = 0;
    if (behavior == CONFIG_LAYER_INDICATOR_TIMED_ON) layerIndicatorPhasesLeft = 6;
    if (behavior == CONFIG_LAYER_INDICATOR_BLINK_BY_LAYER) layerIndicatorPhasesLeft = 2 * (layer + 1);
  }
  layerIndicatorDeadline = (uint8_t)((now >> 1) + LAYER_INDICATOR_PHASE_TICKS);
  updateLeds();
}

void serviceLayerIndicator(uint16_t now) {
  if (!layerIndicatorPhasesLeft ||
      (int8_t)((uint8_t)(now >> 1) - layerIndicatorDeadline) < 0) {
    return;
  }
  layerIndicatorPhasesLeft--;
  layerIndicatorDeadline += LAYER_INDICATOR_PHASE_TICKS;
  if (!layerIndicatorPhasesLeft && (previewOptions & LED_EFFECT_FLAG)) {
    previewOptions = 0;
  }
  updateLeds();
}

void enterBootloader() {
  actionsClear();
  uint16_t start = millis();
  while (USB_reportsPending() && (uint16_t)(millis() - start) < 100) {
    USB_reportPoll(millis());
    actionsPoll(millis());
  }
  __xdata uint8_t *ledPtr = ledData;
  for (uint8_t i = 0; i < NUM_LEDS; i++) {
    ledPtr[0] = 0;
    ledPtr[1] = 255;
    ledPtr[2] = 0;
    ledPtr += 3;
  }
  USB_CTRL = 0;
  EA = 0;                     // Disabling all interrupts is required.
  TMOD = 0;
  // Keep USB disconnected for 100ms; split the wait so both LED frames latch.
  delayMicroseconds(50000);
  displayLeds();
  delayMicroseconds(50000);
#ifdef __SDCC
  __asm__ ("lcall #0x3800");  // Jump to bootloader code
#endif
  while (1);
}

uint8_t readButton(uint8_t input) {
  if (input == NUM_LEDS) {
    return !P3_3;
  }
  return input == 5 ? !P3_2 : !(P1 & KEY_MASK[input]);
}

uint8_t readEncoder(void) {
  return (P3_0 << 1) | P3_1;
}

void scanButton(uint8_t input, uint16_t now) {
  uint8_t pressed = readButton(input);
  if (pressed != rawState[input]) {
    rawState[input] = pressed;
    rawChanged[input] = now;
  }
  if (pressed != stableState[input] &&
      (uint16_t)(now - rawChanged[input]) >= DEBOUNCE_MS) {
    stableState[input] = pressed;
    if (startupWaiting) {
      if (startupWarning && pressed) startupWaiting = 0;
      return; // Consume dismissal; its release has no matching action press.
    }
#if ENABLE_COLOR_PREVIEW
    if (colorPreviewActive) firmwarePreviewColor(0);
#endif
    if (!activeConfigValid) return;
    if (pressed) {
      if (!actionsTimedInput()) actionsPress(input, now);
    } else {
      actionsRelease(input);
    }
    updateLeds();
  }
}

void scanEncoder() {
  uint8_t state = readEncoder();
  int8_t movement;
  if (state == encoderState) {
    return;
  }
#if ENABLE_COLOR_PREVIEW
  if (colorPreviewActive) firmwarePreviewColor(0);
#endif
  movement = encoderTransitions[(encoderState << 2) | state];
  encoderState = state;
  if (!activeConfigValid) return;
  if (movement == 0) {
    encoderMovement = 0; // A skipped state is not a complete detent.
  } else {
    encoderMovement += movement;
    if (encoderMovement >= 4) {
      encoderMovement = 0;
      liveRotations[0]++;
      if (!actionsTimedInput()) actionsRotate(1);
      updateLeds();
    } else if (encoderMovement <= -4) {
      encoderMovement = 0;
      liveRotations[1]++;
      if (!actionsTimedInput()) actionsRotate(0);
      updateLeds();
    }
  }
}

void firmwareWriteInputs(void) {
  uint8_t mask = 0;
  uint8_t i = NUM_LEDS + 1;
  do { mask = (mask << 1) | stableState[--i]; } while (i);
  liveReply[7] = mask;
  liveReply[8] = liveRotations[0];
  liveReply[9] = liveRotations[1];
}

void firmwareWriteLive(void) {
  uint8_t i = 4;
  do { --i; liveReply[(uint8_t)(14 + i)] = ledSettings[i]; } while (i);
  liveReply[18] = previewOptions;
  liveReply[19] = layerIndicatorPhasesLeft;
  liveReply[21] = liveGeneration;
}

void firmwareApplyConfig(ACTION_BIT restartIndicator) {
  liveGeneration++;
  if (previewOptions & LED_EFFECT_FLAG) previewOptions = 0;
  uint32_t clock = millis();
  uint16_t now = clock;
  // Bits 4-11 form the 16 ms fine clock; the low word is sufficient.
  actionsTimedReset(now >> 4);
  ledSettings[0] = (activeConfig[CONFIG_HEADER_LED] >> 4) & 3;
  ledSettings[1] = activeConfig[CONFIG_HEADER_LED] >> 6;
  ledSettings[2] = ledSettings[3] = 3;
  sleepBrightnessPending = 0;
  for (uint8_t i = 0; i <= NUM_LEDS; i++) {
    rawState[i] = stableState[i] = readButton(i);
    rawChanged[i] = now;
  }
  encoderState = readEncoder();
  if (!activeConfigValid) {
#if ENABLE_COLOR_PREVIEW
    if (!previewOptions) firmwarePreviewColor(0);
#else
    errorLedChanged = now;
    ledData[1] = 255;
    displayLeds();
#endif
    return;
  }
  actionsClear();
  encoderMovement = 0;
  lastLayer = actionsLayer();
  // USB resets reapply input state without restarting LED animation or indication.
  if (restartIndicator) {
    layerIndicatorPhasesLeft = 0;
    rainbowChanged = (uint8_t)now;
    rainbowHue = 0;
    for (uint8_t i = 0; i < NUM_LEDS; i++) rainbowDrift[i] = 0;
    startLayerIndicator(lastLayer, now);
  } else updateLeds();
}

void setup() {
  protocolInit();
  startupWaiting = activeConfigValid;
  startupWarning = 0;
  P1 |= KEY_P1_MASK;
  P1_MOD_OC |= KEY_P1_MASK;
  P1_DIR_PU |= KEY_P1_MASK;
  P3 |= INPUT_P3_MASK;
  P3_MOD_OC = (P3_MOD_OC | INPUT_P3_MASK) & ~0x10;
  P3_DIR_PU |= INPUT_P3_MASK | 0x10; // P3.4 is the push-pull LED output.
  clearLeds();
  USBInit();
  firmwareApplyConfig(0);
  errorLedChanged = rawChanged[0]; // Input initialization samples the post-USB clock.
  // Only a button held through the startup sampling window requests recovery.
  uint8_t samples = DEBOUNCE_MS;
  do {
    if (P3_3) return;
    delayMicroseconds(1000);
  } while (--samples);
  if (!P3_3) enterBootloader();
}

void loop() {
  uint32_t clock = millis();
  uint16_t now = clock;
  USB_reportPoll(now);
  protocolPoll(now);
  if (protocolState == 3) enterBootloader();
  if (startupWaiting) {
    scanButton(0, now);
    if (UsbConfig || !startupWaiting) {
      startupWaiting = startupWarning = 0;
      firmwareApplyConfig(1);
    } else goto errorLed;
    return;
  }
  // Process due timers before physical input so resume/input actions win this frame.
#if CONFIG_SCROLL_ACCELERATION
  actionsInputNow = now;
#endif
  if (activeConfigValid) actionsTimedPoll(now >> 4);
  for (uint8_t i = 0; i <= NUM_LEDS; i++) {
    scanButton(i, now);
  }
  scanEncoder();
  if ((uint8_t)((uint8_t)now - rainbowChanged) >=
      rainbowFrameMs[previewOptions ? activeConfig[CONFIG_HEADER_LED] >> CONFIG_HEADER_RAINBOW_SPEED_SHIFT : ledSettings[1]])
  {
    if (rainbowAnimationActive) {
      rainbowChanged = (uint8_t)now;
      rainbowHue++;
      // Advance each physical LED at its original staggered frame cadence.
      for (uint8_t i = 0; i < NUM_LEDS; i++) {
        if (!(rainbowHue & rainbowDriftMasks[i])) rainbowDrift[i]++;
      }
      updateLeds();
    }
  }
errorLed:
  if (startupWaiting || !activeConfigValid) {
    if (!previewOptions && (uint16_t)(now - errorLedChanged) >= 500) {
      errorLedChanged = now;
      uint8_t color = ~ledData[1];
      if (startupWaiting) {
        // The warning starts with a dark phase; first yellow appears at 1000ms.
        if (!startupWarning) color = 0;
        startupWarning = 1;
        ledData[0] = color;
      }
      ledData[1] = color;
      displayLeds();
    }
    return;
  }
  actionsPoll(now);
  uint8_t selected = actionsTakeLayerSelection();
  uint8_t layer = actionsLayer();
  if (lastLayer != layer) {
    if (previewOptions & LED_EFFECT_FLAG) previewOptions = 0;
    lastLayer = layer;
    encoderState = readEncoder();
    encoderMovement = 0;
    selected = 1;
  }
  if (selected && !(previewOptions & LED_EFFECT_FLAG)) startLayerIndicator(lastLayer, now);
  serviceLayerIndicator(now);
}
