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
__idata uint8_t lastMouse;
__pdata uint8_t lastReportGeneration;
// Bindings are resolved before queuing; playback only needs the action bytes.
__pdata uint8_t eventData[EVENT_COUNT][2];
__pdata uint8_t eventHead;
__pdata uint8_t eventTail;
__data uint8_t eventUsed;
__pdata uint8_t droppedButtons;
__pdata uint8_t droppedRotation;
__data uint8_t baseLayer;
__data uint8_t previousLayer;
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
__pdata uint8_t stringIndex;
// A single streaming cursor avoids per-definition runtime storage or recursion.
__data uint8_t macroNext;
__data uint8_t macroStart;
#if CONFIG_MACRO_REPEAT
__idata uint8_t macroRepeat;
#endif
// A private toggle lane keeps macro ownership independent of physical/timed inputs.
__idata uint8_t macroMouse;
__pdata uint8_t timedAge[CONFIG_TIMED_MAX];
// High interval-counter bits occupy the same positions as record bits 3-5.
__idata uint8_t timedHigh[CONFIG_TIMED_MAX];
__idata uint8_t timedFraction[CONFIG_TIMED_MAX];
__pdata uint8_t timedClock;
__pdata uint8_t timedWork; // Shared interval/release-mask scratch.
__pdata uint8_t consumerReleasePending;
__data uint8_t consumerFirst;
__data uint8_t consumerSecond;
__data uint8_t consumerOwner; // Winning held input plus one; zero for a tap.
__pdata uint16_t deadline;
__pdata uint8_t pointerRepeated;
__idata uint8_t scrollRepeated; // Low-byte completion time; held steps wait 100 ms.
#if CONFIG_SCROLL_ACCELERATION
#define SCROLL_SIMPLE_GROWTH (CONFIG_SCROLL_SLOW_X == 1 && CONFIG_SCROLL_FAST_X == 1 && CONFIG_SCROLL_SLOW_Y == 2 && CONFIG_SCROLL_FAST_Y == 1)
#define SCROLL_FRACTIONAL (CONFIG_SCROLL_SLOW_Y > 1 || CONFIG_SCROLL_FAST_Y > 1)
#define scrollContext(first, second, rotation) ((uint8_t)(((first) & 0x70) | ((second) >> 7) | ((rotation) & 2)))
__idata uint16_t actionsInputNow;
__idata uint16_t scrollLast;
__idata uint8_t scrollFirst;
__idata uint8_t scrollGain;
#if !SCROLL_SIMPLE_GROWTH && SCROLL_FRACTIONAL
__idata uint8_t scrollFraction;
#endif
#endif

#define actionType(first) ((uint8_t)((first) & 15))

static FW_BIT queueAction(uint8_t first, uint8_t second, uint8_t rotation) {
  if (eventUsed == EVENT_COUNT ||
      ((rotation & 1) && eventUsed >= EVENT_COUNT - MAX_INPUTS)) {
    if (rotation & 1) {
      if (droppedRotation != 255) {
        droppedRotation++;
      }
    } else if (droppedButtons != 255) {
      droppedButtons++;
    }
    return 0; // Reserve room for one action per button during rotation bursts.
  }
#if CONFIG_SCROLL_ACCELERATION
  if (rotation != 2) { // Autonomous timers do not participate in the stream.
    if (actionType(first) != CONFIG_ACTION_SCROLL ||
        !(first & CONFIG_SCROLL_MODE_MASK) || !second) {
      scrollFirst = 0;
    } else {
      uint8_t magnitude;
      uint8_t context = scrollContext(first, second, rotation);
      if (scrollFirst != context ||
          (!(first & CONFIG_SCROLL_HOLD) && (uint16_t)(actionsInputNow - scrollLast) >= CONFIG_SCROLL_TIMEOUT_MS)) {
        scrollGain = 0;
#if !SCROLL_SIMPLE_GROWTH && SCROLL_FRACTIONAL
        scrollFraction = 0;
#endif
      } else {
#if SCROLL_SIMPLE_GROWTH
        // One packed counter: Slow adds half a unit, Fast a whole unit.
        // Gain 126 already saturates every nonzero base; stop before wrapping.
        if (scrollGain < 252) scrollGain += (uint8_t)((first & 0x20) ? 2 : 1);
#else
        __idata uint8_t increment = (first & 0x20) ? CONFIG_SCROLL_FAST_X : CONFIG_SCROLL_SLOW_X;
#if SCROLL_FRACTIONAL
        if (++scrollFraction >= ((first & 0x20) ? CONFIG_SCROLL_FAST_Y : CONFIG_SCROLL_SLOW_Y)) {
          scrollFraction = 0;
#endif
          if (scrollGain <= 127 - increment) scrollGain += increment;
          else scrollGain = 127;
#if SCROLL_FRACTIONAL
        }
#endif
#endif
      }
      scrollFirst = context;
      scrollLast = actionsInputNow;
      magnitude = (int8_t)second < 0 ? -second : second;
      magnitude += SCROLL_SIMPLE_GROWTH ? scrollGain >> 1 : scrollGain;
      if (magnitude > 127) magnitude = 127;
      second = (int8_t)second < 0 ? -magnitude : magnitude;
    }
  }
#endif
  eventData[eventHead][0] = first;
  eventData[eventHead][1] = second;
  eventHead = (eventHead + 1) & (EVENT_COUNT - 1);
  eventUsed++;
  return 1;
}

static uint8_t mouseButtons(void) {
  uint8_t buttons = macroMouse;
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

static FW_BIT movePointer(uint8_t type, int8_t delta) {
  return USB_queueMouse(mouseButtons(),
                        type == CONFIG_ACTION_MOUSE_X ? delta : 0,
                        type == CONFIG_ACTION_MOUSE_Y ? delta : 0, 0);
}

static FW_BIT addUsage(uint8_t usage) {
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

static FW_BIT flushOutputs(void) {
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
  if (consumerFirst) {
    if (!USB_queueConsumer(((uint16_t)(consumerFirst >> 4) << 8) | consumerSecond)) {
      return 0;
    }
    consumerFirst = 0;
    if (!consumerOwner) consumerReleasePending = 1;
  }
  return 1;
}

static void updateLayer(void);
static void resetLayerTimers(void);

static void runAction(uint8_t first, uint8_t second, uint8_t rotation,
                      uint8_t input) {
  uint8_t selectedLayer = baseLayer;
#if CONFIG_SCROLL_ACCELERATION
  if (input >= 9) rotation = 2;
  else {
    if (rotation && input == 8) rotation = 3;
    if (actionType(first) != CONFIG_ACTION_SCROLL ||
        !(first & CONFIG_SCROLL_MODE_MASK) || !second ||
        scrollFirst != scrollContext(first, second, rotation))
      scrollFirst = 0;
  }
#endif
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
      if (first) queueAction(first, second, rotation); // Text/Pause auxiliary values.
      break;
    case CONFIG_ACTION_KEY_HOLD:
    case CONFIG_ACTION_MOUSE_HOLD:
      break;
    case CONFIG_ACTION_CONSUMER:
    case CONFIG_ACTION_CONSUMER_HOLD:
      // Consumers share one latest-wins lane, independent of queued key taps.
      consumerFirst = first;
      consumerSecond = second;
      // A tap interrupts a held usage with a release before its fresh press.
      // Format 11 consumer codes are tap=7 (odd), hold=8 (even).
      if (!(first & 1)) consumerReleasePending = 0;
      else if (consumerOwner) consumerReleasePending = 1;
      consumerOwner = !(first & 1) ? input + 1 : 0;
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
      if (second == CONFIG_LAYER_PREVIOUS) second = previousLayer;
      layerSelectionPending = 1;
      if (first & 0x10) {
        oneShotReturnLayer = baseLayer;
      } else {
        selectedLayer = oneShotReturnLayer == 0xFF ? baseLayer : oneShotReturnLayer;
        if (second != selectedLayer) previousLayer = selectedLayer;
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
    resetLayerTimers();
#if CONFIG_SCROLL_ACCELERATION
    scrollFirst = 0;
#endif
    for (i = 0; i < TOGGLE_INPUTS; i++) {
      latchedMouse[i] = 0;
    }
    eventUsed = 0;
    eventHead = 0;
    eventTail = 0;
    if (!consumerOwner && (consumerFirst || consumerReleasePending)) {
      consumerFirst = 0;
      consumerReleasePending = 1;
    }
    currentFirst = 0;
    macroNext = 0;
    macroMouse = 0;
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
  previousLayer = baseLayer;
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
  macroNext = 0;
  macroMouse = 0;
  phase = 0;
  consumerReleasePending = 0;
  consumerFirst = 0;
  consumerOwner = 0;
  pointerRepeated = 0;
  scrollRepeated = 0;
#if CONFIG_SCROLL_ACCELERATION
  scrollFirst = 0;
#endif
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
#if CONFIG_SCROLL_ACCELERATION
  actionsInputNow = now;
#endif
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
#if CONFIG_SCROLL_ACCELERATION
        scrollFirst = 0; // A pending chord is a distinct physical trigger.
#endif
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
#if CONFIG_SCROLL_ACCELERATION
  if (type == CONFIG_ACTION_SCROLL && (buttonFirst[input] & CONFIG_SCROLL_HOLD))
    scrollFirst = 0;
#endif
  if (buttonPressed[input]) {
    // Keep a brief hold alive until its press report has been accepted.
    buttonPressed[input] = type == CONFIG_ACTION_KEY_HOLD ||
                           type == CONFIG_ACTION_MOUSE_HOLD ||
                           type == CONFIG_ACTION_CONSUMER_HOLD ? 2 : 0;
  }
}

void actionsRelease(uint8_t input) {
  uint8_t other;
  if (input > configKeyCount()) {
    return;
  }
  timedWork = 1 << input;
  if (!(inputDown & timedWork)) return;
  inputDown &= ~timedWork;
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

#include "timed_actions.inc"

void actionsPoll(uint16_t now) {
  __idata uint8_t type;
  __idata uint8_t c;
  __idata uint8_t usage;
  __idata uint8_t i;
  __idata uint8_t slot;
#if CONFIG_SCROLL_ACCELERATION
  actionsInputNow = now;
  if (!(scrollFirst & CONFIG_SCROLL_HOLD) &&
      (uint16_t)(now - scrollLast) >= CONFIG_SCROLL_TIMEOUT_MS) scrollFirst = 0;
#endif
  if (pendingInput && (uint16_t)(now - pendingSince) >= configChordWindowMs()) {
    resolvePending();
    updateLayer();
  }
  if (lastReportGeneration != USB_reportGeneration()) {
    lastReportGeneration = USB_reportGeneration();
    lastKeyboard[0] = 0xFF;
    lastMouse = 0xFF;
    if (consumerOwner) {
      i = consumerOwner - 1;
      consumerFirst = buttonFirst[i];
      consumerSecond = buttonSecond[i];
    }
  }
  if (consumerReleasePending) {
    if (USB_queueConsumer(0)) {
      consumerReleasePending = 0;
    } else {
      return;
    }
  }
  if (!flushOutputs() || consumerReleasePending) {
    return;
  }
  // Repeat only when the transport and queued taps are idle. The short interval
  // permits an 8-bit clock; subtraction also works across timer wrap.
  c = !currentFirst && !macroNext && !eventUsed && !USB_reportsPending() &&
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
      if (consumerOwner == (uint8_t)(i + 1)) {
        consumerOwner = 0;
        consumerReleasePending = 1;
      }
      buttonPressed[i] = 0;
    } else if (c && buttonPressed[i]) {
      // Pointer holds keep their 8 ms cadence; scroll holds have a slower clock.
      if ((uint8_t)(buttonFirst[i] - (CONFIG_MOUSE_MOVE_HOLD | CONFIG_ACTION_MOUSE_X)) <= 1) {
        movePointer(actionType(buttonFirst[i]), buttonSecond[i]);
#if CONFIG_SCROLL_HOLD_SUPPORT
      } else if ((uint8_t)(buttonFirst[i] & (uint8_t)~CONFIG_SCROLL_HORIZONTAL) == (CONFIG_SCROLL_HOLD | CONFIG_ACTION_SCROLL) &&
                 (uint8_t)((uint8_t)now - scrollRepeated) >= 100) {
        queueAction(buttonFirst[i], buttonSecond[i], 0);
#endif
      }
    }
  }
  if (!flushOutputs()) {
    return;
  }
  if (!currentFirst) {
    if (macroNext) {
#if CONFIG_MACRO_STYLE == 1
      c = macroNext == (uint8_t)(macroStart + 4);
#else
      c = macroNext >= CONFIG_SIZE - 1 || !activeConfig[macroNext];
#endif
      if (c) {
#if CONFIG_MACRO_REPEAT
        if (macroRepeat) {
          macroRepeat--;
          macroNext = macroStart;
        } else
#endif
        macroNext = 0;
      }
      if (macroNext) {
        currentFirst = activeConfig[macroNext];
        // A repeated empty macro may point to the sole terminator at byte 127.
        if (currentFirst) currentSecond = activeConfig[macroNext + 1];
        macroNext += 2;
      }
    } else if (eventUsed) {
      currentFirst = eventData[eventTail][0];
      currentSecond = eventData[eventTail][1];
      eventTail = (eventTail + 1) & (EVENT_COUNT - 1);
      eventUsed--;
    }
    phase = 0;
    stringIndex = 0;
  }
  if (!currentFirst) {
    return;
  }
  type = actionType(currentFirst);
  if (phase == 0) {
    if (USB_reportsPending()) {
      return;
    }
#if CONFIG_MACRO_PAUSE
    if (currentFirst == CONFIG_ACTION_PAUSE) {
      deadline = now + ((uint16_t)currentSecond << 4);
      phase = 3;
    } else
#endif
    if (type == CONFIG_ACTION_MACRO) {
      macroNext = macroStart = currentSecond;
#if CONFIG_MACRO_REPEAT
      macroRepeat = currentFirst >> 4;
#endif
      currentFirst = 0;
    } else if (type == CONFIG_ACTION_MOUSE_TOGGLE) {
      macroMouse ^= currentSecond;
      currentFirst = 0;
    } else if (type == CONFIG_ACTION_SCROLL) {
      int8_t delta = currentSecond;
      if (!delta) {
        currentFirst = 0;
      } else if (USB_queueMouse(mouseButtons() | (currentFirst & CONFIG_SCROLL_HORIZONTAL), 0, 0, delta < 0 ? -1 : 1)) {
        currentSecond = delta < 0 ? delta + 1 : delta - 1;
        if (!currentSecond) {
          scrollRepeated = now; // Wait after the whole step, including large deltas.
          currentFirst = 0;
        }
      }
    } else if (type == CONFIG_ACTION_MOUSE_X || type == CONFIG_ACTION_MOUSE_Y) {
      int8_t delta = currentSecond;
      if (movePointer(type, delta)) {
        pointerRepeated = now;
        currentFirst = 0;
      }
    } else if (type >= CONFIG_ACTION_CONSUMER) {
      // Held bindings never enter this queue; X/Y movement was handled above.
      runAction(currentFirst, currentSecond, 0, 9);
      currentFirst = 0;
      updateLayer();
    } else {
      tempFirst = currentFirst;
      tempSecond = currentSecond;
      tempMouse = 0;
      if (type == CONFIG_ACTION_NONE) {
        c = configStringChar(currentSecond, stringIndex);
        if (!c) {
          currentFirst = 0;
          return;
        }
        usage = USB_asciiUsage(c);
        tempFirst = CONFIG_ACTION_KEY_TAP | ((usage & 0x80) ? 0x20 : 0);
        tempSecond = usage & 0x7F;
      } else if (type == CONFIG_ACTION_MOUSE_CLICK) {
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
    if (type == CONFIG_ACTION_NONE) {
      stringIndex++;
      // Give the host time to process each character after its release arrives.
      deadline = now + 32;
      phase = 3;
    } else if (type == CONFIG_ACTION_MOUSE_CLICK && (currentFirst & 0xF0)) {
      currentFirst -= 0x10; // Count remaining clicks in this playback copy only.
      deadline = now + 200;
      phase = 3;
    } else {
      currentFirst = 0;
    }
  } else if (phase == 3) {
    if ((int16_t)(now - deadline) >= 0) {
#if CONFIG_MACRO_PAUSE
      if (currentFirst == CONFIG_ACTION_PAUSE) { currentFirst = 0; return; }
#endif
      if (type == CONFIG_ACTION_NONE) { phase = 0; return; }
      tempOn = 1;
      if (flushOutputs()) {
        deadline = now + 8;
        phase = 1;
      }
    }
  }
}
