import { MAX_TIMED_ACTIONS, MAX_TIMED_TICKS } from './constants';
import { ledProblem } from './ledControl';
import { MAX_CHORD_WINDOW_UNITS, maxLayers, keyCount } from './constants';
import type { Action, Issue, Profile, Slot } from './types';
import { isSupportedUsage } from '../keys/keyboard';
import { describeCharacter, invalidCharacters } from './strings';
import { isMacroLayerSwitch, macroSwitchesLayer } from './macros';
import { computeCapacity } from './capacity';
import { chordSlot } from './chords';
import { ACTION_DESCRIPTORS, actionNeedsRelease, isPreviousLayer } from './actions';

export interface ActionContext {
  layerCount: number;
  /** Encoder rotation: actions needing a physical release are not allowed. */
  rotation: boolean;
  timed?: boolean;
  macro?: boolean;
  macroCount?: number;
  macros?: Profile['macros'];
}

/** Returns a problem description, or null when the action is legal in this context. */
export function actionProblem(action: Action, ctx: ActionContext): string | null {
  const actionDescriptor = ACTION_DESCRIPTORS.find((candidate) => candidate.type === action.type);
  if (!actionDescriptor) return 'This action type is no longer supported. Choose another action.';
  if ((ctx.rotation || ctx.timed) && actionNeedsRelease(action)) {
    const label = action.type === 'scroll' ? 'Scroll hold' : action.type === 'mouseX' || action.type === 'mouseY' ? 'Pointer hold' : actionDescriptor.label;
    return `${label} needs a release and cannot be bound to ${ctx.timed ? 'a timed action' : 'rotation'}.`;
  }
  if (ctx.macro && (action.type === 'macro' || action.type === 'none')) return 'Macro steps cannot execute another macro or be Nothing. Use Pause for a delay.';
  if (ctx.macro && actionNeedsRelease(action)) return 'Macro steps cannot require a physical release.';
  switch (action.type) {
    case 'macro':
      if (!Number.isInteger(action.macro) || action.macro < 0 || (ctx.macroCount !== undefined && action.macro >= ctx.macroCount)) return 'Choose an existing macro.';
      if (ctx.macros?.[action.macro] && macroSwitchesLayer(ctx.macros[action.macro]!.actions) && action.repeats !== 1) return 'Macros containing a layer switch must have a repeat count of 1.';
      return Number.isInteger(action.repeats) && action.repeats >= 1 && action.repeats <= 16 ? null : 'Repeat count must be 1–16.';
    case 'pause': return Number.isInteger(action.ticks) && action.ticks >= 0 && action.ticks <= 255 ? null : 'Pause must be 0–255 ticks of 16ms.';
    case 'ledControl': return ledProblem(action.command, action.value, action.brightness);
    case 'none':
      return null;
    case 'relativeLayer':
    case 'oneShotRelativeLayer':
      return Number.isInteger(action.offset) && action.offset >= -6 && action.offset <= 6 ? null : 'Relative layer offset must be a whole number from -6 to 6.';
    case 'keyTap':
    case 'keyHold':
      if (!Number.isInteger(action.usage) || !isSupportedUsage(action.usage)) return `Key usage 0x${action.usage.toString(16)} is not supported.`;
      if (!Number.isInteger(action.modifiers) || action.modifiers < 0 || action.modifiers > 15) return 'Modifier mask is out of range.';
      if (action.usage === 0 && action.modifiers === 0) return 'Choose a key or at least one modifier.';
      return null;
    case 'modifierToggle':
    case 'modifierDown':
    case 'modifierUp':
      return Number.isInteger(action.modifiers) && action.modifiers >= 1 && action.modifiers <= 15 ? null : 'Choose at least one modifier (Ctrl, Shift, Alt or GUI).';
    case 'mouseClick':
    case 'mouseHold':
    case 'mouseDown':
    case 'mouseUp':
    case 'mouseToggle':
      if (action.type === 'mouseClick' && (!Number.isInteger(action.clicks ?? 1) || (action.clicks ?? 1) < 1 || (action.clicks ?? 1) > 16)) return 'Click count must be a whole number from 1 to 16.';
      if (!Number.isInteger(action.buttons) || action.buttons < 1 || action.buttons > 255) return 'Choose at least one mouse button.';
      return null;
    case 'scroll':
    case 'mouseX':
    case 'mouseY':
      if (action.type === 'scroll' && action.horizontal !== undefined && typeof action.horizontal !== 'boolean') return 'Horizontal must be on or off.';
      if (action.hold !== undefined && typeof action.hold !== 'boolean') return 'Hold must be on or off.';
      if (action.type === 'scroll' && 'acceleration' in action && action.acceleration !== undefined && action.acceleration !== 'off') return 'Scroll acceleration is unavailable in this firmware.';
      if (!Number.isInteger(action.delta) || action.delta < -127 || action.delta > 127) return 'Delta must be a whole number from -127 to 127.';
      if (action.delta === 0) return 'A zero step does nothing; choose a non-zero value.';
      return null;
    case 'consumer':
    case 'consumerHold':
      if (!Number.isInteger(action.usage) || action.usage < 1 || action.usage > 0xfff) return 'Consumer usage must be 0x001–0xFFF.';
      return null;
    case 'string': {
      const bad = invalidCharacters(action.text);
      if (bad.length) return `Unsupported character${bad.length > 1 ? 's' : ''}: ${bad.slice(0, 4).map(describeCharacter).join(', ')}. Only printable ASCII, tab and newline can be typed.`;
      return null;
    }
    case 'setLayer':
    case 'oneShotSetLayer':
    case 'momentaryLayer':
      if (isPreviousLayer(action)) return null;
      if (!Number.isInteger(action.layer) || action.layer < 0 || action.layer >= ctx.layerCount) return `Layer ${action.layer + 1} does not exist.`;
      return null;
  }
}

export function slotLabel(slot: Slot): string {
  const layer = `Layer ${slot.layer + 1}`;
  switch (slot.kind) {
    case 'macro': return `Macro ${slot.index + 1} · Step ${slot.step + 1}`;
    case 'timed':
      return `Timed action ${slot.index + 1}${slot.resume ? ' · Resume' : ''}`;
    case 'key':
      return `${layer} · Key ${slot.index + 1}`;
    case 'encoderButton':
      return `${layer} · Encoder button`;
    case 'clockwise':
      return `${layer} · Encoder clockwise`;
    case 'counterclockwise':
      return `${layer} · Encoder counterclockwise`;
    case 'chord':
      return `${slot.global ? 'Global' : layer} · Chord ${slot.keyA + 1}+${slot.keyB + 1}`;
  }
}

/** All problems that would prevent encoding a valid image. Empty means the profile is encodable. */
export function validateProfile(profile: Profile): Issue[] {
  const issues: Issue[] = [];
  const keys = keyCount(profile.variant);
  const layerCount = profile.layers.length;

  if (typeof profile.transparentBlack !== 'boolean') {
    issues.push({ where: 'Profile', message: 'Transparent black must be true or false.' });
  }

  if (layerCount < 1 || layerCount > maxLayers(profile.variant)) issues.push({ where: 'Profile', message: `Layer count must be 1–${maxLayers(profile.variant)}.` });
  if (!Number.isInteger(profile.startupLayer) || profile.startupLayer < 0 || profile.startupLayer >= layerCount) {
    issues.push({ where: 'Profile', message: `Startup layer ${profile.startupLayer + 1} does not exist.` });
  }
  if (!Number.isInteger(profile.chordWindow) || profile.chordWindow < 0 || profile.chordWindow > MAX_CHORD_WINDOW_UNITS) {
    issues.push({ where: 'Profile', message: 'Chord window must be 0–75ms in 5ms steps.' });
  }

  if (!Number.isInteger(profile.rainbowPhase) || profile.rainbowPhase < 0 || profile.rainbowPhase > 3) {
    issues.push({ where: 'Profile', message: 'Rainbow phase must be 0–3 (0°, ~30°, ~60°, ~150°).' });
  }

  if (!Number.isInteger(profile.rainbowSpeed) || profile.rainbowSpeed < 0 || profile.rainbowSpeed > 3) {
    issues.push({ where: 'Profile', message: 'Rainbow speed must be Extra fast, Fast, Slow or Extra slow.' });
  }

  profile.layers.forEach((layer, li) => {
    if (!Number.isInteger(layer.indicatorBehavior) || layer.indicatorBehavior < 0 || layer.indicatorBehavior > 3) {
      issues.push({ where: `Layer ${li + 1}`, message: 'Layer indicator behavior must be 0–3.' });
    }
    if (!Number.isInteger(layer.indicatorColor) || layer.indicatorColor < 0 || layer.indicatorColor > 15) {
      issues.push({ where: `Layer ${li + 1}`, message: 'Layer indicator color must be 0–15.' });
    }
    if (typeof layer.indicatorFullBrightness !== 'boolean') {
      issues.push({ where: `Layer ${li + 1}`, message: 'Full brightness must be on or off.' });
    }
    if (layer.keys.length !== keys) issues.push({ where: `Layer ${li + 1}`, message: `Expected ${keys} key bindings, found ${layer.keys.length}.` });
    if (layer.leds.length !== keys) issues.push({ where: `Layer ${li + 1}`, message: `Expected ${keys} LED colors, found ${layer.leds.length}.` });
    layer.leds.forEach((led, i) => {
      if (!Number.isInteger(led) || led < 0 || led > 15) issues.push({ where: `Layer ${li + 1} · LED ${i + 1}`, message: 'Palette index must be 0–15.' });
    });
    const check = (action: Action, slot: Slot, rotation: boolean) => {
      const problem = actionProblem(action, { layerCount, rotation, macroCount: profile.macros?.length ?? 0, macros: profile.macros });
      if (problem) issues.push({ where: slotLabel(slot), message: problem, slot });
    };
    layer.keys.forEach((a, i) => check(a, { kind: 'key', layer: li, index: i }, false));
    check(layer.encoderButton, { kind: 'encoderButton', layer: li }, false);
    check(layer.clockwise, { kind: 'clockwise', layer: li }, true);
    check(layer.counterclockwise, { kind: 'counterclockwise', layer: li }, true);
  });

  const seen = new Set<string>();
  const globalPairs = new Set<string>();
  for (const chord of profile.chords) {
    const slot = chordSlot(chord);
    const where = slotLabel(slot);
    if (chord.layer < 0 || chord.layer >= layerCount) {
      issues.push({ where, message: `Chord refers to layer ${chord.layer + 1}, which does not exist.`, slot });
      continue;
    }
    if (!(chord.keyA >= 0 && chord.keyA < chord.keyB && chord.keyB < keys)) {
      issues.push({ where, message: 'Chord keys must be two different physical keys.', slot });
      continue;
    }
    const id = `${!!chord.global}:${chord.layer}:${chord.keyA}:${chord.keyB}`;
    if (seen.has(id)) issues.push({ where, message: 'Duplicate chord for this key pair.', slot });
    seen.add(id);
    const pair = `${chord.keyA}:${chord.keyB}`;
    if (chord.global) {
      if (globalPairs.has(pair)) issues.push({ where, message: 'Only one global chord can use this key pair.', slot });
      globalPairs.add(pair);
    }
    const problem = actionProblem(chord.action, { layerCount, rotation: false, macroCount: profile.macros?.length ?? 0, macros: profile.macros });
    if (problem) issues.push({ where, message: problem, slot });
  }

  const timers = profile.timedActions ?? [];
  if (!Array.isArray(timers)) return [...issues, { where: 'Timed actions', message: 'Timed actions must be a list.' }];
  if (timers.length > MAX_TIMED_ACTIONS) issues.push({ where: 'Timed actions', message: `At most ${MAX_TIMED_ACTIONS} timed actions are supported.` });
  timers.forEach((timer, index) => {
    const where = `Timed action ${index + 1}`;
    if (!Number.isInteger(timer.ticks) || timer.ticks < 1 || timer.ticks > MAX_TIMED_TICKS)
      issues.push({ where, message: `Interval must be a whole number from 1 to ${MAX_TIMED_TICKS} ticks.` });
    if (timer.layer !== undefined && (!Number.isInteger(timer.layer) || timer.layer < 0 || timer.layer >= layerCount))
      issues.push({ where, message: 'Choose an existing layer or All layers.' });
    if (typeof timer.consumeInput !== 'boolean') issues.push({ where, message: 'Consume input must be on or off.' });
    if (typeof timer.resetOnInput !== 'boolean') issues.push({ where, message: 'Reset on input must be on or off.' });
    for (const resume of [false, true]) {
      const slot: Slot = { kind: 'timed', layer: 0, index, resume };
      const action = resume ? timer.resumeAction : timer.action;
      const problem = action ? actionProblem(action, { layerCount, rotation: false, timed: true, macroCount: profile.macros?.length ?? 0, macros: profile.macros }) : 'Choose an action.';
      if (problem) issues.push({ where: slotLabel(slot), message: problem, slot });
    }
  });

  for (const [index, macro] of (profile.macros ?? []).entries()) {
    macro.actions.forEach((action, step) => {
      const slot: Slot = { kind: 'macro', layer: 0, index, step };
      const problem = isMacroLayerSwitch(action) && step !== macro.actions.length - 1
        ? 'A layer switch must be the final macro step. Move it to the end or remove the later steps.'
        : actionProblem(action, { layerCount, rotation: false, macro: true });
      if (problem) issues.push({ where: slotLabel(slot), message: problem, slot });
    });
  }
  const capacity = computeCapacity(profile);
  if (capacity.remaining < 0) {
    issues.push({ where: 'Storage', message: `Profile needs ${capacity.used} bytes but the device holds 128. Remove ${-capacity.remaining} byte${capacity.remaining === -1 ? '' : 's'} of macros, timers, chords or text.` });
  }
  return issues;
}
