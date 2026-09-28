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

// Hardware connections
#define LED_PIN         34
#define LED_FUNC        neopixel_show_P3_4
#define KEY0_PIN        11
#define KEY1_PIN        17
#define KEY2_PIN        16
#define KEY3_PIN        15
#define KEY4_PIN        14
#define KEY5_PIN        32
#define ENC_A_PIN       30
#define ENC_B_PIN       31
#define BUTTON_PIN      33

#define NUM_LEDS        (PHYSICAL_VARIANT ? 3 : 6)
#define NUM_BYTES       (NUM_LEDS * 3)
#define DEBOUNCE_MS     10
#define LED_UPDATE_MS   20
#define ENTER_BOOTLOADER_MS 3000

__code uint8_t KEY_PIN[6] = {
  KEY0_PIN, KEY1_PIN, KEY2_PIN, KEY3_PIN, KEY4_PIN, KEY5_PIN,
};
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
__xdata uint16_t lastLedUpdate;

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
    set_pixel_for_GRB_LED(ledData, i, configPalette[color][0],
                          configPalette[color][1], configPalette[color][2]);
  }
  displayLeds();
}

void enterBootloader() {
  actionsClear();
  uint16_t start = millis();
  while (USB_reportsPending() && (uint16_t)(millis() - start) < 100) {
    USB_reportPoll();
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
  __asm__ ("lcall #0x3800");  // Jump to bootloader code
  while (1);
}

void scanButton(uint8_t input, uint8_t pin, uint16_t now) {
  uint8_t pressed = digitalRead(pin) == LOW;
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
  }
}

void scanEncoder() {
  uint8_t state = (digitalRead(ENC_A_PIN) << 1) | digitalRead(ENC_B_PIN);
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

void setup() {
  protocolInit();
  actionsInit();
  pinMode(LED_PIN, OUTPUT);
  for (uint8_t i = 0; i < configKeyCount(); i++) {
    pinMode(KEY_PIN[i], INPUT_PULLUP);
  }
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(ENC_A_PIN, INPUT_PULLUP);
  pinMode(ENC_B_PIN, INPUT_PULLUP);
  clearLeds();
  for (uint8_t i = 0; i < configKeyCount(); i++) {
    rawState[i] = stableState[i] = digitalRead(KEY_PIN[i]) == LOW;
    rawChanged[i] = millis();
  }
  rawState[configKeyCount()] = stableState[configKeyCount()] =
      digitalRead(BUTTON_PIN) == LOW;
  rawChanged[configKeyCount()] = millis();
  encoderState = (digitalRead(ENC_A_PIN) << 1) | digitalRead(ENC_B_PIN);
  encoderMovement = 0;
  lastLayer = actionsLayer();
  lastLedUpdate = millis() - LED_UPDATE_MS;
  allowRunBootloader = 0;
  USBInit();
  if (configLayerOptions(configStartupLayer()) & 2) {
    if (digitalRead(KEY0_PIN) == LOW && digitalRead(KEY1_PIN) == LOW &&
        digitalRead(KEY2_PIN) == LOW) {
      enterBootloader();
    }
  }
}

void loop() {
  uint16_t now = millis();
  USB_reportPoll();
  protocolPoll();
  for (uint8_t i = 0; i < configKeyCount(); i++) {
    scanButton(i, KEY_PIN[i], now);
  }
  scanButton(configKeyCount(), BUTTON_PIN, now);
  scanEncoder();
  actionsPoll(now);
  if (lastLayer != actionsLayer()) {
    lastLayer = actionsLayer();
    encoderState = (digitalRead(ENC_A_PIN) << 1) | digitalRead(ENC_B_PIN);
    encoderMovement = 0;
    lastLedUpdate = now - LED_UPDATE_MS;
  }
  if ((uint16_t)(now - lastLedUpdate) >= LED_UPDATE_MS) {
    lastLedUpdate = now;
    updateLeds();
  }
  if (allowRunBootloader && stableState[configKeyCount()] &&
      (uint16_t)(now - encoderPressedMs) >= ENTER_BOOTLOADER_MS) {
    enterBootloader();
  }
}
