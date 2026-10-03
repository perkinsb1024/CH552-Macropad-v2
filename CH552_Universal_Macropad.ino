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
#define DEBOUNCE_MS     10
#define ENTER_BOOTLOADER_MS 3000
#define LAYER_INDICATOR_PHASE_TICKS 125 // 250 ms in 2 ms ticks; signed deadline < 128 ticks.

__code uint8_t KEY_MASK[5] = {0x02, 0x80, 0x40, 0x20, 0x10};
#if PHYSICAL_VARIANT == CONFIG_SIX_KEYS
// Phase order around the six-key perimeter: 1 -> 2 -> 3 -> 6 -> 5 -> 4.
__code uint8_t rainbowPositions[6] = {0, 1, 2, 5, 4, 3};
// Alternate fast/slow drift across rows: fast slow fast / slow fast slow.
__code uint8_t rainbowDriftPositions[6] = {0, 3, 1, 4, 2, 5};
#else
__code uint8_t rainbowPositions[3] = {0, 1, 2};
__code uint8_t rainbowDriftPositions[3] = {0, 2, 1};
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
__xdata uint8_t rawState[7];
__xdata uint8_t stableState[7];
__xdata uint16_t rawChanged[7];
__pdata uint8_t encoderState;
__pdata int8_t encoderMovement;
__idata uint8_t lastLayer;
__xdata uint8_t allowRunBootloader;
__pdata uint8_t layerIndicatorPhasesLeft;
__pdata uint8_t layerIndicatorDeadline;
__idata uint8_t rainbowChanged;
__data uint8_t rainbowHue;
// Per-LED extra hue steps; staggered rates gently change relative phases.
__idata uint8_t rainbowDrift[NUM_LEDS];
// Current global rainbow presets; saved defaults remain in activeConfig.
// Phase, speed, indicator policy, key policy. Policies: Off=0, Dim=1, Bright=2, Configured=3.
__pdata uint8_t ledSettings[4]; // Shares the checked page-zero budget with actions.c.
__code uint8_t ledPresets[5] = {15, 13, 5, 4, 0};
#if ENABLE_COLOR_PREVIEW
__pdata uint8_t previewOptions; // Zero = normal LEDs; otherwise reuse layer option bits.
#else
#define previewOptions 0
#endif
// With invalid config, actions are inactive: reuse this timer for the error LED.
__xdata uint16_t encoderPressedMs;

void displayLeds() {
  LED_FUNC(ledData, NUM_BYTES);
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
  if (!activeConfigValid && !previewOptions) return;
  uint8_t layer = actionsLayer();
  uint8_t options = previewOptions ? previewOptions : configLayerOptions(layer);
  uint8_t behavior = (options >> CONFIG_LAYER_OPT_INDICATOR_SHIFT) & 3;
  uint8_t palette = options >> CONFIG_LAYER_OPT_COLOR_SHIFT;
  uint8_t phases = layerIndicatorPhasesLeft;
  uint8_t indicator = indicatorBrightness(options);
  uint8_t keyLevel = ledSettings[3];
  uint8_t spacing = ledSettings[0];
#if ENABLE_COLOR_PREVIEW
  if (previewOptions) {
    indicator = 1 + (options & CONFIG_LAYER_OPT_FULL_BRIGHTNESS);
    spacing = (activeConfig[8] >> CONFIG_HEADER_RAINBOW_PHASE_SHIFT) & 3;
  } else
#endif
  if (!indicator) {
    // Suppressed indications must not obscure key feedback.
    phases = 0;
    behavior = CONFIG_LAYER_INDICATOR_NONE;
  }
  if (keyLevel == 3) keyLevel = 2;
  __xdata uint8_t *ledPtr = ledData;
  for (uint8_t i = 0; i < NUM_LEDS; i++) {
    uint8_t color = palette;
    uint8_t level = indicator;
    uint8_t rainbow = palette == 15 &&
        (previewOptions ? behavior == CONFIG_LAYER_INDICATOR_ALWAYS_ON : behavior != CONFIG_LAYER_INDICATOR_NONE);
    uint8_t red;
    uint8_t green;
    uint8_t blue;
#if ENABLE_COLOR_PREVIEW
    if (previewOptions) {
      // Preview bypasses runtime brightness policies.
    } else
#endif
    if (phases) {
      if (behavior == CONFIG_LAYER_INDICATOR_BLINK_BY_LAYER && (phases & 1)) level = 0;
    } else if (keyLevel && stableState[i] &&
               ((color = configLedColor(layer, i)) != 15 ||
                !(activeConfig[5] & CONFIG_HEADER_TRANSPARENT_BLACK))) {
      level = keyLevel;
      rainbow = 0; // Key palette 15 is Off, never Rainbow.
    } else {
      color = palette;
      if (behavior != CONFIG_LAYER_INDICATOR_ALWAYS_ON) level = 0;
    }
    if (!level) {
      red = green = blue = 0;
    } else if (rainbow) {
      uint8_t wheel = rainbowHue + rainbowPositions[i] * rainbowSteps[spacing];
      if (spacing == 3) wheel += rainbowDrift[rainbowDriftPositions[i]];
      // Three linear ramps cycle red -> blue -> green -> red.
      if (wheel < 85) {
        green = 0;
        blue = wheel * 3;
        red = (uint8_t)~blue;
      } else if (wheel < 170) {
        wheel -= 85;
        red = 0;
        green = wheel * 3;
        blue = (uint8_t)~green;
      } else {
        wheel -= 170;
        red = wheel * 3;
        green = (uint8_t)~red;
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

void firmwareLedAction(uint8_t command, uint8_t value) {
  int8_t delta = value;
  if (value & 8) delta -= 16;
  uint8_t relative = command & 1;
  uint8_t current;
  uint8_t end;
  if (command >= CONFIG_LED_PRESET_SET) {
    end = ledSettings[2] | (ledSettings[3] << 2);
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
    value = ledPresets[value];
    // Compare policies rather than rendered brightness; no toggle latch is needed.
    if (command == CONFIG_LED_PRESET_TOGGLE && value == end) value = 15;
    ledSettings[2] = value & 3;
    ledSettings[3] = value >> 2;
  } else {
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
        if (current == 0) next = (activeConfig[8] >> 4) & 3;
        if (current == 1) next = activeConfig[8] >> 6;
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
  previewOptions = options;
  if (!options && !activeConfigValid) {
    clearLeds();
    ledData[1] = 255;
    encoderPressedMs = millis();
    displayLeds();
  } else {
    updateLeds();
  }
}

#endif

void startLayerIndicator(uint8_t layer, uint16_t now) {
  uint8_t behavior = (configLayerOptions(layer) >> CONFIG_LAYER_OPT_INDICATOR_SHIFT) & 3;
  layerIndicatorPhasesLeft = 0;
  if (behavior == CONFIG_LAYER_INDICATOR_TIMED_ON ||
      behavior == CONFIG_LAYER_INDICATOR_BLINK_BY_LAYER) {
    layerIndicatorPhasesLeft = behavior == CONFIG_LAYER_INDICATOR_TIMED_ON ? 6 : 2 * (layer + 1);
    layerIndicatorDeadline = (uint8_t)((now >> 1) + LAYER_INDICATOR_PHASE_TICKS);
  }
  updateLeds();
}

void serviceLayerIndicator(uint16_t now) {
  if (!layerIndicatorPhasesLeft ||
      (int8_t)((uint8_t)(now >> 1) - layerIndicatorDeadline) < 0) {
    return;
  }
  layerIndicatorPhasesLeft--;
  layerIndicatorDeadline += LAYER_INDICATOR_PHASE_TICKS;
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
  displayLeds();

  USB_CTRL = 0;
  EA = 0;                     // Disabling all interrupts is required.
  TMOD = 0;
  delayMicroseconds(50000);
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
#if ENABLE_COLOR_PREVIEW
    if (previewOptions) firmwarePreviewColor(0);
    if (!activeConfigValid) return;
#endif
    if (pressed) {
      if (input == NUM_LEDS) {
        allowRunBootloader = configLayerOptions(actionsLayer()) & CONFIG_LAYER_OPT_BOOTLOADER_RUN;
        encoderPressedMs = now;
      }
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
  if (previewOptions) firmwarePreviewColor(0);
#endif
  movement = encoderTransitions[(encoderState << 2) | state];
  encoderState = state;
#if ENABLE_COLOR_PREVIEW
  if (!activeConfigValid) return;
#endif
  if (movement == 0) {
    encoderMovement = 0; // A skipped state is not a complete detent.
  } else {
    encoderMovement += movement;
    if (encoderMovement >= 4) {
      encoderMovement = 0;
      if (!actionsTimedInput()) actionsRotate(1);
      updateLeds();
    } else if (encoderMovement <= -4) {
      encoderMovement = 0;
      if (!actionsTimedInput()) actionsRotate(0);
      updateLeds();
    }
  }
}

void firmwareApplyConfig(void) {
  uint32_t clock = millis();
  uint16_t now = clock;
  actionsTimedReset(clock >> 16);
  ledSettings[0] = (activeConfig[8] >> 4) & 3;
  ledSettings[1] = activeConfig[8] >> 6;
  ledSettings[2] = ledSettings[3] = 3;
#if !ENABLE_COLOR_PREVIEW
  if (!activeConfigValid) {
    encoderPressedMs = now;
    ledData[1] = 255;
    displayLeds();
    return;
  }
#endif
  for (uint8_t i = 0; i <= NUM_LEDS; i++) {
    rawState[i] = stableState[i] = readButton(i);
    rawChanged[i] = now;
  }
  encoderState = readEncoder();
#if ENABLE_COLOR_PREVIEW
  if (!activeConfigValid) {
    if (!previewOptions) firmwarePreviewColor(0);
    return;
  }
#endif
  actionsClear();
  encoderMovement = 0;
  lastLayer = actionsLayer();
  allowRunBootloader = 0;
  layerIndicatorPhasesLeft = 0;
  rainbowChanged = (uint8_t)now;
  rainbowHue = 0;
  for (uint8_t i = 0; i < NUM_LEDS; i++) rainbowDrift[i] = 0;
  updateLeds();
}

void setup() {
  protocolInit();
  P1 |= KEY_P1_MASK;
  P1_MOD_OC |= KEY_P1_MASK;
  P1_DIR_PU |= KEY_P1_MASK;
  P3 |= INPUT_P3_MASK;
  P3_MOD_OC = (P3_MOD_OC | INPUT_P3_MASK) & ~0x10;
  P3_DIR_PU |= INPUT_P3_MASK | 0x10; // P3.4 is the push-pull LED output.
  clearLeds();
  firmwareApplyConfig();
  USBInit();
  if (readButton(NUM_LEDS)) {
    enterBootloader();
  }
}

void loop() {
  uint32_t clock = millis();
  uint16_t now = clock;
  USB_reportPoll(now);
  protocolPoll(now);
#if !ENABLE_COLOR_PREVIEW
  if (!activeConfigValid) {
    if ((uint16_t)(now - encoderPressedMs) >= 500) {
      encoderPressedMs = now;
      ledData[1] ^= 255;
      displayLeds();
    }
    return;
  }
#endif
  // Process due timers before physical input so resume/input actions win this frame.
  if (activeConfigValid) actionsTimedPoll(clock >> 16);
  for (uint8_t i = 0; i <= NUM_LEDS; i++) {
    scanButton(i, now);
  }
  scanEncoder();
  if ((uint8_t)((uint8_t)now - rainbowChanged) >=
      rainbowFrameMs[previewOptions ? activeConfig[8] >> CONFIG_HEADER_RAINBOW_SPEED_SHIFT : ledSettings[1]] &&
#if ENABLE_COLOR_PREVIEW
      ((previewOptions ? (previewOptions & 8 ? previewOptions : 0) :
        (activeConfigValid ? configLayerOptions(actionsLayer()) : 0)) & 0xFC) > 0xF0)
#else
      (configLayerOptions(actionsLayer()) & 0xFC) > 0xF0)
#endif
  {
    rainbowChanged = (uint8_t)now;
    rainbowHue++;
    // One extra step every 4, 8, 16, 32, 64, or 128 rainbow frames.
    uint8_t mask = RAINBOW_DRIFT_MASK;
    for (uint8_t i = 0; i < NUM_LEDS; i++) {
      if (!(rainbowHue & mask)) rainbowDrift[i]++;
      mask = (mask << 1) | 1;
    }
    updateLeds();
  }
#if ENABLE_COLOR_PREVIEW
  if (!activeConfigValid) {
    if (!previewOptions && (uint16_t)(now - encoderPressedMs) >= 500) {
      encoderPressedMs = now;
      ledData[1] ^= 255;
      displayLeds();
    }
    return;
  }
#endif
  actionsPoll(now);
  if (actionsTakeLayerSelection() || lastLayer != actionsLayer()) {
    if (lastLayer != actionsLayer()) {
      lastLayer = actionsLayer();
      encoderState = readEncoder();
      encoderMovement = 0;
    }
    startLayerIndicator(lastLayer, now);
  }
  serviceLayerIndicator(now);
  if (allowRunBootloader && stableState[NUM_LEDS] &&
      (uint16_t)(now - encoderPressedMs) >= ENTER_BOOTLOADER_MS) {
    enterBootloader();
  }
}
