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
#include "src/config.h"
#include "src/protocol_firmware.h"
#include "src/userUsbHidKeyboardMouse/USBHIDKeyboardMouse.h"

// Hardware connections are fixed for both board variants.
#define LED_FUNC        neopixel_show_P3_4
#define KEY_P1_MASK     (PHYSICAL_VARIANT ? 0xC2 : 0xF2)
#define INPUT_P3_MASK   (PHYSICAL_VARIANT ? 0x0B : 0x0F)

#define NUM_LEDS        (PHYSICAL_VARIANT ? 3 : 6)
#define NUM_BYTES       (NUM_LEDS * 3)
#define DEBOUNCE_MS     10
#define ENTER_BOOTLOADER_MS 3000
#define LAYER_INDICATOR_PHASE_MS 100
#define RAINBOW_FRAME_MS 8

__code uint8_t KEY_MASK[5] = {0x02, 0x80, 0x40, 0x20, 0x10};
#if PHYSICAL_VARIANT == CONFIG_SIX_KEYS
// Phase order around the six-key perimeter: 1 -> 2 -> 3 -> 6 -> 5 -> 4.
__code uint8_t rainbowOffsets[6] = {0, 42, 84, 210, 168, 126};
#endif
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
__xdata uint8_t encoderState;
__xdata int8_t encoderMovement;
__xdata uint8_t lastLayer;
__xdata uint8_t allowRunBootloader;
__xdata uint8_t layerIndicatorPhasesLeft;
__xdata uint8_t layerIndicatorDeadline;
__xdata uint8_t rainbowChanged;
__xdata uint8_t rainbowHue;
__xdata uint16_t encoderPressedMs;
#ifdef ENABLE_NO_CONFIG_LED_BLINK
__xdata uint16_t noConfigBlinkChanged;
__xdata uint8_t noConfigBlinkOn;
#endif

void displayLeds() {
  LED_FUNC(ledData, NUM_BYTES);
}

void clearLeds() {
  __xdata uint8_t *ledPtr = ledData;
  for (uint8_t i = 0; i < NUM_LEDS; i++) {
    ledPtr[0] = 0;
    ledPtr[1] = 0;
    ledPtr[2] = 0;
    ledPtr += 3;
  }
  displayLeds();
}

uint8_t dimIndicatorComponent(uint8_t value) {
  return (value >> 4) | (value != 0);
}

void updateLeds() {
  if (!activeConfigValid) return;
  uint8_t layer = actionsLayer();
  uint8_t options = configLayerOptions(layer);
  uint8_t behavior = (options >> CONFIG_LAYER_OPT_INDICATOR_SHIFT) & 3;
  uint8_t palette = options >> CONFIG_LAYER_OPT_COLOR_SHIFT;
  uint8_t phases = layerIndicatorPhasesLeft;
  uint8_t blink = phases && !(phases & 1);
  uint8_t rainbow = behavior == CONFIG_LAYER_INDICATOR_ALWAYS_ON && palette == 15;
#if PHYSICAL_VARIANT == CONFIG_THREE_KEYS
  uint8_t hue = rainbowHue;
#endif
  __xdata uint8_t *ledPtr = ledData;
  for (uint8_t i = 0; i < NUM_LEDS; i++) {
    uint8_t color = palette;
    uint8_t dim = 0;
    uint8_t off = 0;
    uint8_t red;
    uint8_t green;
    uint8_t blue;
    uint8_t wheel;
#if PHYSICAL_VARIANT == CONFIG_SIX_KEYS
    wheel = rainbowHue + rainbowOffsets[i];
#else
    wheel = hue;
#endif
    if (blink) {
      // Blink takes priority over per-key colors while the animation is on.
    } else if (stableState[i]) {
      color = configLedColor(layer, i);
    } else if (behavior == CONFIG_LAYER_INDICATOR_ALWAYS_ON) {
      dim = 1;
    } else {
      off = 1;
    }
    if (dim && rainbow) {
      // Three linear color ramps form a full-brightness cycling rainbow.
      if (wheel < 85) {
        red = (85 - wheel) * 3;
        green = wheel * 3;
        blue = 0;
      } else if (wheel < 170) {
        wheel -= 85;
        red = 0;
        green = (85 - wheel) * 3;
        blue = wheel * 3;
      } else {
        wheel -= 170;
        red = wheel * 3;
        green = 0;
        blue = (85 - wheel) * 3;
      }
    } else {
      red = configPalette[color][0];
      green = configPalette[color][1];
      blue = configPalette[color][2];
    }
    if (dim && !(options & CONFIG_LAYER_OPT_FULL_BRIGHTNESS)) {
      red = dimIndicatorComponent(red);
      green = dimIndicatorComponent(green);
      blue = dimIndicatorComponent(blue);
    }
    if (off) {
      red = green = blue = 0;
    }
    ledPtr[0] = green;
    ledPtr[1] = red;
    ledPtr[2] = blue;
    ledPtr += 3;
#if PHYSICAL_VARIANT == CONFIG_THREE_KEYS
    hue += 256 / NUM_LEDS;
#endif
  }
  displayLeds();
}

void startLayerIndicator(uint8_t layer, uint16_t now) {
  uint8_t behavior = (configLayerOptions(layer) >> CONFIG_LAYER_OPT_INDICATOR_SHIFT) & 3;
  layerIndicatorPhasesLeft = 0;
  if (behavior == CONFIG_LAYER_INDICATOR_BLINK_ONCE ||
      behavior == CONFIG_LAYER_INDICATOR_BLINK_BY_LAYER) {
    layerIndicatorPhasesLeft = 2 *
        (behavior == CONFIG_LAYER_INDICATOR_BLINK_ONCE ? 1 : layer + 1);
    layerIndicatorDeadline = (uint8_t)(now + LAYER_INDICATOR_PHASE_MS);
  }
  updateLeds();
}

void serviceLayerIndicator(uint16_t now) {
  if (!layerIndicatorPhasesLeft ||
      (int8_t)((uint8_t)now - layerIndicatorDeadline) < 0) {
    return;
  }
  layerIndicatorPhasesLeft--;
  layerIndicatorDeadline += LAYER_INDICATOR_PHASE_MS;
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
    if (pressed) {
      if (input == configKeyCount()) {
        allowRunBootloader = configLayerOptions(actionsLayer()) & CONFIG_LAYER_OPT_BOOTLOADER_RUN;
        encoderPressedMs = now;
      }
      actionsPress(input, now);
    } else {
      actionsRelease(input);
    }
    if (input < NUM_LEDS) {
      updateLeds();
    }
  }
}

void scanEncoder() {
  uint8_t state = readEncoder();
  int8_t movement;
  if (state == encoderState) {
    return;
  }
  movement = encoderTransitions[(encoderState << 2) | state];
  encoderState = state;
  if (movement == 0) {
    encoderMovement = 0; // A skipped state is not a complete detent.
  } else {
    encoderMovement += movement;
    if (encoderMovement >= 4) {
      encoderMovement = 0;
      actionsRotate(1);
    } else if (encoderMovement <= -4) {
      encoderMovement = 0;
      actionsRotate(0);
    }
  }
}

void firmwareApplyConfig(void) {
  if (!activeConfigValid) return;
  uint16_t now = millis();
  actionsClear();
  for (uint8_t i = 0; i <= NUM_LEDS; i++) {
    rawState[i] = stableState[i] = readButton(i);
    rawChanged[i] = now;
  }
  encoderState = readEncoder();
  encoderMovement = 0;
  lastLayer = actionsLayer();
  allowRunBootloader = 0;
  layerIndicatorPhasesLeft = 0;
  rainbowChanged = (uint8_t)now;
  rainbowHue = 0;
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
  if (readButton(0) && readButton(1) && readButton(2)) {
    enterBootloader();
  }
}

void loop() {
  uint16_t now = millis();
  USB_reportPoll(now);
  protocolPoll(now);
  if (!activeConfigValid) {
#ifdef ENABLE_NO_CONFIG_LED_BLINK
    if ((uint16_t)(now - noConfigBlinkChanged) >= 500) {
      noConfigBlinkChanged = now;
      noConfigBlinkOn = !noConfigBlinkOn;
      ledData[0] = 0;
      ledData[1] = noConfigBlinkOn ? 255 : 0;
      ledData[2] = 0;
      displayLeds();
    }
#endif
    return;
  }
  for (uint8_t i = 0; i < configKeyCount(); i++) {
    scanButton(i, now);
  }
  scanButton(configKeyCount(), now);
  scanEncoder();
  actionsPoll(now);
  if (lastLayer != actionsLayer()) {
    lastLayer = actionsLayer();
    encoderState = readEncoder();
    encoderMovement = 0;
    startLayerIndicator(lastLayer, now);
  }
  serviceLayerIndicator(now);
  if ((uint8_t)((uint8_t)now - rainbowChanged) >= RAINBOW_FRAME_MS &&
      (configLayerOptions(actionsLayer()) & 0xFC) == 0xFC) {
    rainbowChanged = (uint8_t)now;
    rainbowHue++;
    updateLeds();
  }
  if (allowRunBootloader && stableState[configKeyCount()] &&
      (uint16_t)(now - encoderPressedMs) >= ENTER_BOOTLOADER_MS) {
    enterBootloader();
  }
}
