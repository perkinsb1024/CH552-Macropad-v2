#include "actions.h"
#include "config.h"
#include "led_control.h"
#include "live_state.h"
#include "userUsbHidKeyboardMouse/USBHIDKeyboardMouse.h"

#define MAX_INPUTS 7
#define EVENT_COUNT 8

// Page-zero xRAM uses one-byte addresses without consuming internal stack RAM.
// Together with ledSettings these must fit above USB DMA and below 0x100;
// build_firmware.py checks the linked layout. Startup selects P2=0.
// Telemetry counters wrap modulo 256 and survive action/layer resets.
__xdata uint8_t liveBindings[13]; // Nine accepted-source counts, last source/action/sequence.
__xdata uint8_t liveBindingLayer;

__pdata uint8_t buttonFirst[MAX_INPUTS];
__pdata uint8_t buttonSecond[MAX_INPUTS];
__pdata uint8_t buttonPressed[MAX_INPUTS];
__pdata uint8_t buttonOrder[MAX_INPUTS];
__pdata uint8_t lastKeyboard[8];
__pdata uint8_t nextKeyboard[8];
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
// Selection and auto-sleep wake share a boolean indication request.
static ACTION_BIT layerSelectionPending;
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
// Toggle/down/up share one persistent mouse-button state; holds remain separate.
__pdata uint8_t persistentMouse;
__pdata uint8_t timedAge[CONFIG_TIMED_MAX + 1];
// High interval-counter bits occupy the same positions as record bits 3-5.
__idata uint8_t timedHigh[CONFIG_TIMED_MAX + 1];
__idata uint8_t timedFraction[CONFIG_TIMED_MAX + 1];
__pdata uint8_t timedClock;
__pdata uint8_t timedWork; // Shared interval/release-mask scratch.
__pdata uint8_t consumerModifiers; // Temporary ownership in the latest-wins lane.
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

// These compact consumer/pointer predicates depend on the saved-format allocation.
// Revisit them and remeasure both builds when changing the action numbering.
#if CONFIG_ACTION_CONSUMER != 0x8 || CONFIG_ACTION_CONSUMER_HOLD != 0x9 || \
    CONFIG_ACTION_CONSUMER_MODIFIED != 0xA || CONFIG_ACTION_CONSUMER_MODIFIED_HOLD != 0xB || \
    CONFIG_ACTION_MOUSE_AXIS != 0x6 || CONFIG_ACTION_MOUSE_XY != 0x7
#error Action type predicates require updating for this action allocation.
#endif

static FW_BIT queueAction(uint8_t first, uint8_t second, uint8_t rotation) {
  if (eventUsed == EVENT_COUNT ||
      ((rotation & 1) && eventUsed != 0)) {
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
  uint8_t buttons = persistentMouse;
  uint8_t i;
  for (i = 0; i < MAX_INPUTS; i++) {
    if (buttonPressed[i] && buttonFirst[i] == CONFIG_ACTION_MOUSE_HOLD) {
      buttons |= buttonSecond[i];
    }
  }
  if (tempOn) {
    buttons |= tempMouse;
  }
  return buttons;
}

static FW_BIT movePointer(uint8_t first, uint8_t second) {
  int8_t x = second;
  int8_t y;
  if (first & 1) { // Combined movement (type 7).
    x = ((second & 15) + 1) << 2;
    y = ((second >> 4) + 1) << 2;
    if (first & CONFIG_MOUSE_X_NEGATIVE) x = -x;
    if (first & CONFIG_MOUSE_Y_NEGATIVE) y = -y;
  } else {
    y = 0;
    if (first & CONFIG_MOUSE_AXIS_Y) {
      y = x;
      x = 0;
    }
  }
  return USB_queueMousePacked(mouseButtons(), x, y, 0);
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
  uint8_t buttons;
  uint8_t consumerHigh = consumerFirst >> 4;
  // Release the previous consumer before changing its temporary modifiers.
  if (consumerReleasePending) return 0;
  if (consumerFirst) {
    consumerModifiers = 0;
    // Pending consumers are types 8/9/A/B; bit 1 selects modifiers.
    // Keep bytes intact so rejected writes can retry.
    if (consumerFirst & 2) {
      consumerModifiers = consumerHigh;
      consumerHigh = 0;
    }
  }
  for (i = 1; i < 8; i++) {
    nextKeyboard[i] = 0;
  }
  nextKeyboard[0] = consumerModifiers;
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
      break;
    }
  }
  if (i < 8) {
    // PSEG is checked to stay in xRAM page zero, so this widening is exact.
    if (!USB_queueKeyboard((const __xdata uint8_t *)nextKeyboard)) {
      return 0;
    }
    for (i = 0; i < 8; i++) {
      lastKeyboard[i] = nextKeyboard[i];
    }
  }
  buttons = mouseButtons();
  if (buttons != lastMouse) {
    if (!USB_queueMousePacked(buttons, 0, 0, 0)) {
      return 0;
    }
    lastMouse = buttons;
  }
  if (consumerFirst) {
    if (!USB_queueConsumer(((uint16_t)consumerHigh << 8) | consumerSecond)) {
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
  __xdata uint8_t requestedSecond = second;
  __xdata uint8_t layer = effectiveLayer;
  uint8_t source;
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
  // This sparse dispatch avoids a 14-entry jump table; holds and no-op remain immediate.
  uint8_t type = actionType(first);
  if (type == CONFIG_ACTION_LED_CONTROL) {
    firmwareLedAction(second, first >> 4);
    goto liveRecord;
  } else if ((type & 12) == 8) {
    // Consumers share one latest-wins lane, independent of queued key taps.
    consumerFirst = first;
    consumerSecond = second;
    // Modified output releases before a replacement changes its modifiers.
    // A modified hold preserves an ordinary tap's pending release too.
    // Only types 8/9/A/B reach here; bit 0 distinguishes holds from taps.
    if (actionType(first) == CONFIG_ACTION_CONSUMER_HOLD && !consumerModifiers)
      consumerReleasePending = 0;
    else if (consumerModifiers || consumerOwner) consumerReleasePending = 1;
    consumerOwner = 0;
    if (first & 1) consumerOwner = input + 1;
    goto liveRecord;
  } else if (type == CONFIG_ACTION_MOUSE_TOGGLE) {
    if (first == CONFIG_ACTION_MOUSE_HOLD) goto liveRecord;
    // Down clears then XORs to set; up only clears; toggle only XORs.
    if (first & 0x30) persistentMouse &= ~second;
    if (!(first & 0x20)) persistentMouse ^= second;
    goto liveRecord;
  } else if (type == CONFIG_ACTION_SET_LAYER) {
    layerSelectionPending = 1;
    if (first & CONFIG_LAYER_RELATIVE) {
      uint8_t layers = configLayerCount();
      // Bias by a multiple of the layer count to wrap signed offsets (-6..6).
      // Resolve relative to the selected layer, before consuming a one-shot.
      second = selectedLayer + second + (layers << 3);
      while (second >= layers) second -= layers;
    }
    if (first & CONFIG_LAYER_HOLD) {
      // Snapshot a relative hold's target once; layer recomputation must not
      // reinterpret its offset after other layer changes.
      buttonFirst[input] = CONFIG_ACTION_MOMENTARY_LAYER;
      buttonSecond[input] = second;
      goto liveRecord;
    }
    if (second == CONFIG_LAYER_PREVIOUS) second = previousLayer;
    if (first & 0x10) {
      oneShotReturnLayer = baseLayer;
    } else {
      selectedLayer = oneShotReturnLayer == 0xFF ? baseLayer : oneShotReturnLayer;
      if (second != selectedLayer) previousLayer = selectedLayer;
    }
    baseLayer = second;
    goto liveRecord;
  } else if (first && type != CONFIG_ACTION_KEY_HOLD) {
    if (!queueAction(first, second, rotation)) return;
  }
liveRecord:
  source = input;
  if (input < 6) source |= chordPartner[input] << 4;
  if (input >= 7) source |= 0x80;
  if (input < 9) liveBindings[input]++;
  liveBindings[9] = source;
  liveBindings[10] = first;
  liveBindings[11] = requestedSecond;
  liveBindings[12]++;
  liveBindingLayer = layer;
}

static const __idata uint8_t * const __code liveInternal[] = {
  &effectiveLayer, &baseLayer, &previousLayer, &oneShotReturnLayer,
  &currentFirst, &macroNext, &eventUsed
};
void actionsWriteLive(void) {
  uint8_t i = 7;
  do { --i; liveReply[i] = *liveInternal[i]; } while (i);
  liveReply[12] = pendingInput;
  liveReply[13] = persistentMouse;
}

void actionsWriteTimers(void) {
  uint8_t i = 5;
  do {
    --i;
    liveReply[i] = timedAge[i];
    liveReply[(uint8_t)(5 + i)] = timedHigh[i];
    liveReply[(uint8_t)(10 + i)] = timedFraction[i];
  } while (i);
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
          buttonFirst[i] == CONFIG_ACTION_MOMENTARY_LAYER &&
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
    eventUsed = 0;
    eventHead = 0;
    eventTail = 0;
    if (!consumerOwner && (consumerFirst || consumerReleasePending)) {
      consumerFirst = 0;
      consumerReleasePending = 1;
    }
    currentFirst = 0;
    macroNext = 0;
    persistentMouse = 0;
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
  persistentMouse = 0;
  phase = 0;
  consumerModifiers = 0;
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
  flushOutputs(); // Consumer backpressure also defers keyboard/mouse cleanup.
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
  __idata uint8_t chordWindow = configChordWindowMs();
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
    if (input < keys && (uint16_t)(now - pendingSince) < chordWindow &&
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
  if (input < keys && chordWindow) {
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
    buttonPressed[input] = 0;
    if (type == CONFIG_ACTION_KEY_HOLD || buttonFirst[input] == CONFIG_ACTION_MOUSE_HOLD ||
        (type & 0xD) == CONFIG_ACTION_CONSUMER_HOLD) buttonPressed[input] = 2;
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
  i = USB_reportGeneration();
  if (lastReportGeneration != i) {
    lastReportGeneration = i;
    lastKeyboard[0] = 0xFF;
    // Every byte is now a valid button mask; force a mismatch even for 0xFF.
    lastMouse = ~mouseButtons();
    if (consumerOwner) {
      i = consumerOwner - 1;
      consumerFirst = buttonFirst[i];
      consumerSecond = buttonSecond[i];
    }
  }
  if (consumerReleasePending) {
    if (USB_queueConsumer(0)) {
      consumerReleasePending = 0;
      consumerModifiers = 0;
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
      if ((buttonFirst[i] & 0x1E) == (CONFIG_MOUSE_MOVE_HOLD | CONFIG_ACTION_MOUSE_AXIS)) {
        movePointer(buttonFirst[i], buttonSecond[i]);
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
      c = macroNext >= CONFIG_SIZE - 1 || !activeConfig[macroNext];
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
    } else if (type == CONFIG_ACTION_SCROLL) {
      int8_t delta = currentSecond;
      uint8_t scroll = delta < 0 ? 15 : 1;
      if (currentFirst & CONFIG_SCROLL_HORIZONTAL) scroll <<= 4;
      if (!delta) {
        currentFirst = 0;
      } else if (USB_queueMousePacked(mouseButtons(), 0, 0,
                 scroll)) {
        currentSecond = delta < 0 ? delta + 1 : delta - 1;
        if (!currentSecond) {
          scrollRepeated = now; // Wait after the whole step, including large deltas.
          currentFirst = 0;
        }
      }
    } else if ((type & 0xE) == CONFIG_ACTION_MOUSE_AXIS) {
      if (movePointer(currentFirst, currentSecond)) {
        pointerRepeated = now;
        currentFirst = 0;
      }
    } else if (type >= CONFIG_ACTION_MOUSE_TOGGLE) {
      // Held bindings never enter this queue; X/Y movement was handled above.
      runAction(currentFirst, currentSecond, 0, 14);
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
        tempFirst = CONFIG_ACTION_KEY_TAP | ((usage >> 2) & 0x20);
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
