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

__code uint8_t KEY_MASK[5] = {0x02, 0x80, 0x40, 0x20, 0x10};
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
__xdata uint16_t encoderPressedMs;

void displayLeds() {
  LED_FUNC(ledData, NUM_BYTES);
}

void clearLeds() {
  for (uint8_t i = 0; i < NUM_LEDS; i++) {
    set_pixel_for_GRB_LED(ledData, i, 0, 0, 0);
  }
  displayLeds();
}

void updateLeds() {
  uint8_t layer = actionsLayer();
  for (uint8_t i = 0; i < NUM_LEDS; i++) {
    uint8_t color = configLedColor(layer, i);
    if (stableState[i]) {
      set_pixel_for_GRB_LED(ledData, i, configPalette[color][0],
                            configPalette[color][1], configPalette[color][2]);
    } else {
      set_pixel_for_GRB_LED(ledData, i, 0, 0, 0);
    }
  }
  displayLeds();
}

void enterBootloader() {
  actionsClear();
  uint16_t start = millis();
  while (USB_reportsPending() && (uint16_t)(millis() - start) < 100) {
    USB_reportPoll(millis());
    actionsPoll(millis());
  }
  for (uint8_t i = 0; i < NUM_LEDS; i++) {
    set_pixel_for_GRB_LED(ledData, i, 255, 0, 0);
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
        allowRunBootloader = configLayerOptions(actionsLayer()) & 4;
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
  if (configLayerOptions(configStartupLayer()) & 2) {
    if (readButton(0) && readButton(1) && readButton(2)) {
      enterBootloader();
    }
  }
}

void loop() {
  uint16_t now = millis();
  USB_reportPoll(now);
  protocolPoll(now);
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
    updateLeds();
  }
  if (allowRunBootloader && stableState[configKeyCount()] &&
      (uint16_t)(now - encoderPressedMs) >= ENTER_BOOTLOADER_MS) {
    enterBootloader();
  }
}
