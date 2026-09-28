#include "actions.h"
#include "config.h"
#include "userUsbHidKeyboardMouse/USBHIDKeyboardMouse.h"

#define MAX_INPUTS 7
#define TOGGLE_INPUTS 9
#define EVENT_COUNT 8

__xdata uint8_t buttonFirst[MAX_INPUTS];
__xdata uint8_t buttonSecond[MAX_INPUTS];
__xdata uint8_t buttonPressed[MAX_INPUTS];
__xdata uint16_t buttonOrder[MAX_INPUTS];
__xdata uint8_t latchedMouse[TOGGLE_INPUTS];
__xdata uint8_t lastKeyboard[8];
__xdata uint8_t nextKeyboard[8];
__xdata uint8_t lastMouse;
__xdata uint8_t lastReportGeneration;
__xdata uint8_t eventData[EVENT_COUNT][3];
__xdata uint8_t eventHead;
__xdata uint8_t eventTail;
__xdata uint8_t eventUsed;
__xdata uint8_t baseLayer;
__xdata uint8_t effectiveLayer;
__xdata uint16_t pressOrder;
__xdata uint8_t currentFirst;
__xdata uint8_t currentSecond;
__xdata uint8_t currentLayer;
__xdata uint8_t currentRotation;
__xdata uint8_t phase;
__xdata uint8_t tempFirst;
__xdata uint8_t tempSecond;
__xdata uint8_t tempMouse;
__xdata uint8_t tempOn;
__xdata uint8_t clicksLeft;
__xdata uint8_t stringIndex;
__xdata uint8_t consumerReleasePending;
__xdata uint16_t deadline;

static uint8_t actionType(uint8_t first) {
  return first & 15;
}

static uint8_t queueAction(uint8_t first, uint8_t second, uint8_t layer,
                           uint8_t rotation) {
  if (eventUsed == EVENT_COUNT) {
    return 0; // Drop the newest action when the bounded queue is full.
  }
  eventData[eventHead][0] = first;
  eventData[eventHead][1] = second;
  eventData[eventHead][2] = layer | (rotation ? 0x80 : 0);
  eventHead = (eventHead + 1) & (EVENT_COUNT - 1);
  eventUsed++;
  return 1;
}

static uint8_t mouseButtons(void) {
  uint8_t buttons = 0;
  uint8_t i;
  for (i = 0; i < TOGGLE_INPUTS; i++) {
    buttons |= latchedMouse[i];
  }
  for (i = 0; i < MAX_INPUTS; i++) {
    if (buttonPressed[i] && actionType(buttonFirst[i]) == CONFIG_ACTION_MOUSE_HOLD) {
      buttons |= buttonSecond[i];
    }
  }
  if (tempOn) {
    buttons |= tempMouse;
  }
  return buttons;
}

static void addUsage(uint8_t usage) {
  uint8_t i;
  if (!usage) {
    return;
  }
  for (i = 2; i < 8; i++) {
    if (nextKeyboard[i] == usage) {
      return;
    }
    if (nextKeyboard[i] == 0) {
      nextKeyboard[i] = usage;
      return;
    }
  }
  // The seventh distinct key waits until one of the six report slots is free.
}

static uint8_t flushOutputs(void) {
  uint8_t i;
  uint8_t changed = 0;
  uint8_t buttons;
  for (i = 0; i < 8; i++) {
    nextKeyboard[i] = 0;
  }
  for (i = 0; i < MAX_INPUTS; i++) {
    if (buttonPressed[i] && actionType(buttonFirst[i]) == CONFIG_ACTION_KEY_HOLD) {
      nextKeyboard[0] |= buttonFirst[i] >> 4;
      addUsage(buttonSecond[i]);
    }
  }
  if (tempOn && actionType(tempFirst) == CONFIG_ACTION_KEY_TAP) {
    nextKeyboard[0] |= tempFirst >> 4;
    addUsage(tempSecond);
  }
  for (i = 0; i < 8; i++) {
    if (nextKeyboard[i] != lastKeyboard[i]) {
      changed = 1;
    }
  }
  if (changed) {
    if (!USB_queueKeyboard(nextKeyboard)) {
      return 0;
    }
    for (i = 0; i < 8; i++) {
      lastKeyboard[i] = nextKeyboard[i];
    }
  }
  buttons = mouseButtons();
  if (buttons != lastMouse) {
    if (!USB_queueMouse(buttons, 0, 0, 0)) {
      return 0;
    }
    lastMouse = buttons;
  }
  return 1;
}

static void updateLayer(void) {
  uint8_t next = baseLayer;
  uint16_t newest = 0;
  uint8_t i;
  for (i = 0; i < MAX_INPUTS; i++) {
    if (buttonPressed[i] &&
        actionType(buttonFirst[i]) == CONFIG_ACTION_MOMENTARY_LAYER &&
        buttonOrder[i] >= newest) {
      newest = buttonOrder[i];
      next = buttonSecond[i];
    }
  }
  if (next == effectiveLayer) {
    return;
  }
  effectiveLayer = next;
  for (i = 0; i < TOGGLE_INPUTS; i++) {
    latchedMouse[i] = 0;
  }
  eventUsed = 0;
  eventHead = 0;
  eventTail = 0;
  if (actionType(currentFirst) == CONFIG_ACTION_CONSUMER &&
      (phase == 4 || phase == 5)) {
    consumerReleasePending = 1;
  }
  currentFirst = 0;
  phase = 0;
  tempOn = 0;
  tempMouse = 0;
}

static void runAction(uint8_t first, uint8_t second, uint8_t layer,
                      uint8_t rotation, uint8_t input) {
  uint8_t type = actionType(first);
  switch (type) {
    case CONFIG_ACTION_NONE:
    case CONFIG_ACTION_KEY_HOLD:
    case CONFIG_ACTION_MOUSE_HOLD:
      break;
    case CONFIG_ACTION_MOUSE_TOGGLE:
      latchedMouse[input] ^= second;
      break;
    case CONFIG_ACTION_SET_LAYER:
      baseLayer = second;
      updateLayer();
      break;
    case CONFIG_ACTION_MOMENTARY_LAYER:
      if (!rotation) {
        updateLayer();
      }
      break;
    case CONFIG_ACTION_TOGGLE_LAYER:
      baseLayer = baseLayer == second ? configStartupLayer() : second;
      updateLayer();
      break;
    case CONFIG_ACTION_NEXT_LAYER:
      baseLayer = (baseLayer + 1) % configLayerCount();
      updateLayer();
      break;
    default:
      queueAction(first, second, layer, rotation);
      break;
  }
}

void actionsInit(void) {
  uint8_t i;
  baseLayer = configStartupLayer();
  effectiveLayer = baseLayer;
  pressOrder = 0;
  eventHead = 0;
  eventTail = 0;
  eventUsed = 0;
  currentFirst = 0;
  phase = 0;
  consumerReleasePending = 0;
  tempOn = 0;
  tempMouse = 0;
  lastMouse = 0;
  lastReportGeneration = USB_reportGeneration();
  for (i = 0; i < MAX_INPUTS; i++) {
    buttonPressed[i] = 0;
    buttonFirst[i] = 0;
    buttonSecond[i] = 0;
  }
  for (i = 0; i < TOGGLE_INPUTS; i++) {
    latchedMouse[i] = 0;
  }
  for (i = 0; i < 8; i++) {
    lastKeyboard[i] = 0;
  }
}

void actionsClear(void) {
  uint8_t i;
  USB_discardReports();
  actionsInit();
  for (i = 0; i < 8; i++) {
    nextKeyboard[i] = 0;
  }
  USB_queueKeyboard(nextKeyboard);
  USB_queueMouse(0, 0, 0, 0);
  USB_queueConsumer(0);
}

uint8_t actionsLayer(void) {
  return effectiveLayer;
}

void actionsPress(uint8_t input) {
  uint8_t first;
  uint8_t second;
  if (input >= configKeyCount() + 1 || buttonPressed[input]) {
    return;
  }
  configBinding(effectiveLayer, input, &first, &second);
  buttonFirst[input] = first;
  buttonSecond[input] = second;
  buttonPressed[input] = 1;
  buttonOrder[input] = ++pressOrder;
  runAction(first, second, effectiveLayer, 0, input);
}

void actionsRelease(uint8_t input) {
  if (input >= configKeyCount() + 1 || !buttonPressed[input]) {
    return;
  }
  buttonPressed[input] = 0;
  updateLayer();
}

void actionsRotate(uint8_t clockwise) {
  uint8_t first;
  uint8_t second;
  uint8_t input = configKeyCount() + (clockwise ? 1 : 2);
  configBinding(effectiveLayer, input, &first, &second);
  runAction(first, second, effectiveLayer, 1, clockwise ? 7 : 8);
}

void actionsPoll(uint16_t now) {
  uint8_t type;
  uint8_t c;
  uint8_t usage;
  if (lastReportGeneration != USB_reportGeneration()) {
    lastReportGeneration = USB_reportGeneration();
    lastKeyboard[0] = 0xFF;
    lastMouse = 0xFF;
  }
  if (consumerReleasePending) {
    if (USB_queueConsumer(0)) {
      consumerReleasePending = 0;
    } else {
      return;
    }
  }
  if (!flushOutputs()) {
    return;
  }
  if (!currentFirst && eventUsed) {
    currentFirst = eventData[eventTail][0];
    currentSecond = eventData[eventTail][1];
    currentLayer = eventData[eventTail][2] & 3;
    currentRotation = eventData[eventTail][2] & 0x80;
    eventTail = (eventTail + 1) & (EVENT_COUNT - 1);
    eventUsed--;
    phase = 0;
    stringIndex = 0;
    clicksLeft = actionType(currentFirst) == CONFIG_ACTION_MOUSE_DOUBLE ? 2 : 1;
  }
  if (!currentFirst) {
    return;
  }
  type = actionType(currentFirst);
  if (phase == 0) {
    if (USB_reportsPending()) {
      return;
    }
    if (type == CONFIG_ACTION_SCROLL || type == CONFIG_ACTION_MOUSE_X ||
        type == CONFIG_ACTION_MOUSE_Y) {
      int8_t delta = currentSecond;
      if (type == CONFIG_ACTION_SCROLL && currentRotation &&
          (configLayerOptions(currentLayer) & 1)) {
        delta = -delta;
      }
      if (!USB_queueMouse(mouseButtons(),
                          type == CONFIG_ACTION_MOUSE_X ? delta : 0,
                          type == CONFIG_ACTION_MOUSE_Y ? delta : 0,
                          type == CONFIG_ACTION_SCROLL ? delta : 0)) {
        return;
      }
      currentFirst = 0;
    } else if (type == CONFIG_ACTION_CONSUMER) {
      if (USB_queueConsumer(((uint16_t)currentFirst >> 4 << 8) | currentSecond)) {
        phase = 4;
      }
    } else {
      tempFirst = currentFirst;
      tempSecond = currentSecond;
      tempMouse = 0;
      if (type == CONFIG_ACTION_STRING) {
        c = configStringChar(currentSecond, stringIndex);
        if (!c) {
          currentFirst = 0;
          return;
        }
        usage = USB_asciiUsage(c);
        tempFirst = CONFIG_ACTION_KEY_TAP | ((usage & 0x80) ? 0x20 : 0);
        tempSecond = usage & 0x7F;
      } else if (type == CONFIG_ACTION_MOUSE_CLICK ||
                 type == CONFIG_ACTION_MOUSE_DOUBLE) {
        tempMouse = currentSecond;
      }
      tempOn = 1;
      if (!flushOutputs()) {
        return;
      }
      deadline = now + 8;
      phase = 1;
    }
  } else if (phase == 1) {
    if ((int16_t)(now - deadline) >= 0 && !USB_reportsPending()) {
      tempOn = 0;
      if (flushOutputs()) {
        phase = 2;
      }
    }
  } else if (phase == 2) {
    if (USB_reportsPending()) {
      return;
    }
    if (type == CONFIG_ACTION_STRING) {
      stringIndex++;
      phase = 0;
    } else if (--clicksLeft) {
      deadline = now + 200;
      phase = 3;
    } else {
      currentFirst = 0;
    }
  } else if (phase == 3) {
    if ((int16_t)(now - deadline) >= 0) {
      tempOn = 1;
      if (flushOutputs()) {
        deadline = now + 8;
        phase = 1;
      }
    }
  } else if (phase == 4) {
    if (!USB_reportsPending() && USB_queueConsumer(0)) {
      phase = 5;
    }
  } else if (phase == 5 && !USB_reportsPending()) {
    currentFirst = 0;
  }
}
