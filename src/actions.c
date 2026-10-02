#include "actions.h"
#include "config.h"
#include "led_control.h"
#include "userUsbHidKeyboardMouse/USBHIDKeyboardMouse.h"

#define MAX_INPUTS 7
#define TOGGLE_INPUTS (9 + CONFIG_TIMED_MAX)
#define EVENT_COUNT 8

// Page-zero xRAM uses one-byte addresses without consuming internal stack RAM.
// Together with ledSettings these must fit above USB DMA and below 0x100;
// build_firmware.py checks the linked layout. Startup selects P2=0.
__pdata uint8_t buttonFirst[MAX_INPUTS];
__pdata uint8_t buttonSecond[MAX_INPUTS];
__pdata uint8_t buttonPressed[MAX_INPUTS];
__pdata uint8_t buttonOrder[MAX_INPUTS];
__pdata uint8_t latchedMouse[TOGGLE_INPUTS];
__pdata uint8_t lastKeyboard[8];
__xdata uint8_t nextKeyboard[8];
__pdata uint8_t inputDown;
__pdata uint8_t chordPartner[6]; // Partner index plus one; retained until both keys are up.
__pdata uint8_t pendingInput; // Index plus one, or zero when no single key is waiting.
__pdata uint8_t pendingLayer;
__pdata uint16_t pendingSince;
__data uint8_t lastMouse;
__pdata uint8_t lastReportGeneration;
// Bindings are resolved before queuing; playback only needs the action bytes.
__pdata uint8_t eventData[EVENT_COUNT][2];
__pdata uint8_t eventHead;
__pdata uint8_t eventTail;
__data uint8_t eventUsed;
__pdata uint8_t droppedButtons;
__pdata uint8_t droppedRotation;
__data uint8_t baseLayer;
__data uint8_t effectiveLayer;
__pdata uint8_t layerSelectionPending;
// 0xFF means no one-shot layer is waiting to be consumed.
__data uint8_t oneShotReturnLayer;
__data uint8_t currentFirst;
__pdata uint8_t currentSecond;
__data uint8_t phase;
__pdata uint8_t tempFirst;
__pdata uint8_t tempSecond;
__pdata uint8_t tempMouse;
__data uint8_t tempOn;
__pdata uint8_t tempReady;
__pdata uint8_t clicksLeft;
__pdata uint8_t stringIndex;
__pdata uint8_t timedAge[CONFIG_TIMED_MAX];
__pdata uint8_t timedClock;
__pdata uint8_t consumerReleasePending;
__pdata uint16_t deadline;
__pdata uint8_t pointerRepeated;

#define actionType(first) ((first) & 15)

static uint8_t queueAction(uint8_t first, uint8_t second, uint8_t rotation) {
  if (eventUsed == EVENT_COUNT ||
      (rotation && eventUsed >= EVENT_COUNT - MAX_INPUTS)) {
    if (rotation) {
      if (droppedRotation != 255) {
        droppedRotation++;
      }
    } else if (droppedButtons != 255) {
      droppedButtons++;
    }
    return 0; // Reserve room for one action per button during rotation bursts.
  }
  eventData[eventHead][0] = first;
  eventData[eventHead][1] = second;
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

static uint8_t movePointer(uint8_t type, int8_t delta) {
  return USB_queueMouse(mouseButtons(),
                        type == CONFIG_ACTION_MOUSE_X ? delta : 0,
                        type == CONFIG_ACTION_MOUSE_Y ? delta : 0, 0);
}

static uint8_t addUsage(uint8_t usage) {
  uint8_t i;
  if (!usage) {
    return 1;
  }
  for (i = 2; i < 8; i++) {
    if (nextKeyboard[i] == usage) {
      return 1;
    }
    if (nextKeyboard[i] == 0) {
      nextKeyboard[i] = usage;
      return 1;
    }
  }
  return 0; // Wait until one of the six report slots is free.
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
  tempReady = 1;
  if (tempOn && actionType(tempFirst) == CONFIG_ACTION_KEY_TAP) {
    tempReady = addUsage(tempSecond);
    if (tempReady) {
      nextKeyboard[0] |= tempFirst >> 4;
    }
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

static void updateLayer(void);

static void runAction(uint8_t first, uint8_t second, uint8_t rotation,
                      uint8_t input) {
  uint8_t selectedLayer = baseLayer;
  if (input >= 9) selectedLayer = effectiveLayer;
  else if (oneShotReturnLayer != 0xFF) {
    baseLayer = oneShotReturnLayer;
    oneShotReturnLayer = 0xFF;
    // Clear the old layer's playback before queuing the selected action.
    updateLayer();
  }
  switch (actionType(first)) {
    case CONFIG_ACTION_LED_CONTROL:
      firmwareLedAction(second, first >> 4);
      break;
    case CONFIG_ACTION_NONE:
    case CONFIG_ACTION_KEY_HOLD:
    case CONFIG_ACTION_MOUSE_HOLD:
      break;
    case CONFIG_ACTION_MOMENTARY_LAYER:
      layerSelectionPending = 1;
      break;
    case CONFIG_ACTION_MOUSE_TOGGLE:
      latchedMouse[input] ^= second;
      break;
    case CONFIG_ACTION_RELATIVE_LAYER:
      {
        uint8_t layers = configLayerCount();
        // Bias by a multiple of the layer count to wrap signed offsets (-6..6).
        // Resolve relative to the selected layer, before consuming a one-shot.
        second = selectedLayer + second + (layers << 3);
        while (second >= layers) second -= layers;
      }
      // Fall through: both layer actions share the one-shot flag and assignment.
    case CONFIG_ACTION_SET_LAYER:
      layerSelectionPending = 1;
      if (first & 0x10) {
        oneShotReturnLayer = baseLayer;
      }
      baseLayer = second;
      break;
    default:
      queueAction(first, second, rotation);
      break;
  }
}

static void resolvePending(void) {
  uint8_t input;
  if (!pendingInput) {
    return;
  }
  input = pendingInput - 1;
  pendingInput = 0;
  buttonPressed[input] = 1;
  runAction(buttonFirst[input], buttonSecond[input], 0, input);
}

static void updateLayer(void) {
  uint8_t next;
  uint8_t newest;
  uint8_t i;
  do {
    next = baseLayer;
    newest = 0;
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
    // Pending singles belong to the layer on which they were pressed.
    resolvePending();
  } while (1);
}

void actionsInit(void) {
  uint8_t i;
  baseLayer = configStartupLayer();
  effectiveLayer = baseLayer;
  layerSelectionPending = 0;
  oneShotReturnLayer = 0xFF;
  pendingInput = 0;
  inputDown = 0;
  droppedButtons = 0;
  droppedRotation = 0;
  for (i = 0; i < 6; i++) {
    chordPartner[i] = 0;
  }
  eventHead = 0;
  eventTail = 0;
  eventUsed = 0;
  currentFirst = 0;
  phase = 0;
  consumerReleasePending = 0;
  pointerRepeated = 0;
  tempOn = 0;
  tempMouse = 0;
  lastMouse = 0;
  lastReportGeneration = USB_reportGeneration();
  for (i = 0; i < MAX_INPUTS; i++) {
    buttonPressed[i] = 0;
    buttonOrder[i] = i;
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
  USB_discardReports();
  actionsInit();
  lastKeyboard[0] = 0xFF;
  lastMouse = 0xFF;
  consumerReleasePending = !USB_queueConsumer(0);
  flushOutputs(); // Unaccepted releases are retried by actionsPoll.
}

uint8_t actionsDropped(uint8_t rotation) {
  return rotation ? droppedRotation : droppedButtons;
}

uint8_t actionsLayer(void) {
  return effectiveLayer;
}

uint8_t actionsTakeLayerSelection(void) {
  uint8_t pending = layerSelectionPending;
  layerSelectionPending = 0;
  return pending;
}

static void orderPress(uint8_t input) {
  uint8_t i;
  uint8_t previous = buttonOrder[input];
  // Move this input to the front without a press counter that can wrap.
  for (i = 0; i < MAX_INPUTS; i++) {
    if (buttonOrder[i] > previous) {
      buttonOrder[i]--;
    }
  }
  buttonOrder[input] = MAX_INPUTS - 1;
}

void actionsPress(uint8_t input, uint16_t now) {
  uint8_t first;
  uint8_t second;
  uint8_t other;
  uint8_t keys = configKeyCount();
  if (input > keys || (inputDown & (1 << input))) {
    return;
  }
  inputDown |= 1 << input;
  if (input < keys && chordPartner[input]) {
    return; // A chord cannot retrigger until both of its keys have been released.
  }
  if (pendingInput && (input < keys || oneShotReturnLayer != 0xFF)) {
    other = pendingInput - 1;
    if (input < keys && (uint16_t)(now - pendingSince) < configChordWindowMs() &&
        configChord(pendingLayer, other, input, &first, &second)) {
      pendingInput = 0;
      chordPartner[other] = input + 1;
      chordPartner[input] = other + 1;
      buttonFirst[other] = first;
      buttonSecond[other] = second;
      buttonFirst[input] = 0;
      buttonSecond[input] = 0;
      buttonPressed[input] = 0;
      buttonPressed[other] = 1;
      orderPress(other);
      runAction(first, second, 0, other);
      updateLayer();
      return;
    }
    resolvePending();
    updateLayer();
  }
  configBinding(effectiveLayer, input, &first, &second);
  buttonFirst[input] = first;
  buttonSecond[input] = second;
  orderPress(input);
  if (input < keys && configChordWindowMs()) {
    for (other = 0; other < keys; other++) {
      if (configChord(effectiveLayer, input, other, &first, &second)) {
        pendingInput = input + 1;
        pendingLayer = effectiveLayer;
        pendingSince = now;
        return;
      }
    }
  }
  buttonPressed[input] = 1;
  runAction(buttonFirst[input], buttonSecond[input], 0, input);
  updateLayer();
}

static void releaseAction(uint8_t input) {
  uint8_t type = actionType(buttonFirst[input]);
  if (buttonPressed[input]) {
    // Keep a brief hold alive until its press report has been accepted.
    buttonPressed[input] = type == CONFIG_ACTION_KEY_HOLD ||
                           type == CONFIG_ACTION_MOUSE_HOLD ? 2 : 0;
  }
}

void actionsRelease(uint8_t input) {
  uint8_t other;
  if (input > configKeyCount()) {
    return;
  }
  inputDown &= ~(1 << input);
  if (pendingInput == input + 1) {
    resolvePending();
    updateLayer();
  }
  releaseAction(input);
  if (input < configKeyCount() && chordPartner[input]) {
    other = chordPartner[input] - 1;
    releaseAction(other);
    if (!(inputDown & (1 << other))) {
      chordPartner[input] = 0;
      chordPartner[other] = 0;
    }
  }
  updateLayer();
}

void actionsRotate(uint8_t clockwise) {
  uint8_t first;
  uint8_t second;
  uint8_t input = configKeyCount() + (clockwise ? 1 : 2);
  if (pendingInput && oneShotReturnLayer != 0xFF) {
    resolvePending();
    updateLayer();
  }
  configBinding(effectiveLayer, input, &first, &second);
  runAction(first, second, 1, clockwise ? 7 : 8);
  updateLayer();
}

// Prototype: validated rotation-compatible actions, independent virtual toggles.
void actionsTimedReset(uint8_t tick) {
  timedClock = tick;
  for (uint8_t i = 0; i < CONFIG_TIMED_MAX; i++) timedAge[i] = 0;
}

// Tick and physical-input events share record traversal and action dispatch.
static void timedEvent(uint8_t tick) {
  __pdata uint8_t offset = configTimedOffset();
  for (uint8_t i = 0; i < configTimedCount(); i++, offset += CONFIG_TIMED_SIZE) {
    uint8_t age = timedAge[i];
    uint8_t action = 0;
    if (tick) {
      if ((age & 127) == (activeConfig[offset] & CONFIG_TIMED_INTERVAL_MASK)) {
        age = CONFIG_TIMED_RESUME ? 128 : 0;
        action = 1;
      } else age++;
    } else {
#if CONFIG_TIMED_RESUME
      if (age & 128) action = 3;
#endif
      age &= 127;
      if (CONFIG_TIMED_ALL_RESET || (activeConfig[offset] & 128)) age = 0;
    }
    timedAge[i] = age;
    if (action) {
      action += offset;
      runAction(activeConfig[action], activeConfig[action + 1], 0, 9 + i);
      updateLayer();
    }
  }
}

void actionsTimedPoll(uint8_t tick) {
  if (tick == timedClock) return;
  timedClock = tick;
  timedEvent(1);
}

void actionsTimedInput(void) {
  timedEvent(0);
}

void actionsPoll(uint16_t now) {
  uint8_t type;
  uint8_t c;
  uint8_t usage;
  uint8_t i;
  uint8_t slot;
  if (pendingInput && (uint16_t)(now - pendingSince) >= configChordWindowMs()) {
    resolvePending();
    updateLayer();
  }
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
  // Repeat only when the transport and queued taps are idle. The short interval
  // permits an 8-bit clock; subtraction also works across timer wrap.
  c = !currentFirst && !eventUsed && !USB_reportsPending() &&
      (uint8_t)((uint8_t)now - pointerRepeated) >= 8;
  if (c) pointerRepeated = now;
  for (i = 0; i < MAX_INPUTS; i++) {
    if (buttonPressed[i] == 2) {
      if (actionType(buttonFirst[i]) == CONFIG_ACTION_KEY_HOLD && buttonSecond[i]) {
        for (slot = 2; slot < 8; slot++) {
          if (lastKeyboard[slot] == buttonSecond[i]) {
            break;
          }
        }
        if (slot == 8) {
          continue; // A brief seventh hold still needs its own press report.
        }
      }
      buttonPressed[i] = 0;
    } else if (c && buttonPressed[i] &&
               (buttonFirst[i] == (CONFIG_MOUSE_MOVE_HOLD | CONFIG_ACTION_MOUSE_X) ||
                buttonFirst[i] == (CONFIG_MOUSE_MOVE_HOLD | CONFIG_ACTION_MOUSE_Y))) {
      movePointer(actionType(buttonFirst[i]), buttonSecond[i]);
    }
  }
  if (!flushOutputs()) {
    return;
  }
  if (!currentFirst && eventUsed) {
    currentFirst = eventData[eventTail][0];
    currentSecond = eventData[eventTail][1];
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
    if (type == CONFIG_ACTION_SCROLL) {
      int8_t delta = currentSecond;
      if (!delta) {
        currentFirst = 0;
      } else if (USB_queueMouse(mouseButtons(), 0, 0, delta < 0 ? -1 : 1)) {
        currentSecond = delta < 0 ? delta + 1 : delta - 1;
        if (!currentSecond) {
          currentFirst = 0;
        }
      }
    } else if (type == CONFIG_ACTION_MOUSE_X || type == CONFIG_ACTION_MOUSE_Y) {
      int8_t delta = currentSecond;
      if (movePointer(type, delta)) {
        pointerRepeated = now;
        currentFirst = 0;
      }
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
      if (!flushOutputs() || !tempReady) {
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
