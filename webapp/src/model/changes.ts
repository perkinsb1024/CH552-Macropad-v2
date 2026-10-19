import { actionsEqual, summarize, isPreviousLayer } from './actions';
import { SLEEP_TIMEOUT_MINUTES, SLEEP_TIMEOUT_LABELS, RAINBOW_SPEED_LABELS, RAINBOW_PHASE_LABELS, LayerIndicatorBehavior, variantName } from './constants';
import { PALETTE } from './palette';
import type { Action, Chord, Profile } from './types';
import { holdThreshold, mapBranches } from './tapHold';

export interface ProfileChange { where: string; before?: string; after?: string; undo?: (draft: Profile) => void }

const behaviorNames = {
  [LayerIndicatorBehavior.None]: 'Do Not Indicate',
  [LayerIndicatorBehavior.TimedOn]: 'On for 1.5 Seconds',
  [LayerIndicatorBehavior.BlinkByLayer]: 'Blink by Layer Number',
  [LayerIndicatorBehavior.AlwaysOn]: 'Always On',
};
const colorName = (color: number) => PALETTE[color]?.name ?? 'Unknown';
const indicatorColor = (color: number) =>
  color === 0 ? 'Per-Key Colors' : colorName(color);
const actionName = (action: Action) => action.type === 'string'
  ? `Type ${JSON.stringify(action.text)}` : action.type === 'none' ? 'Nothing' : summarize(action);
const chordId = (chord: Chord) => `${chord.global ? 'global' : chord.layer}:${chord.keyA}:${chord.keyB}`;
const chordName = (chord: Chord) => `${chord.global ? 'All Layers' : `Layer ${chord.layer + 1}`} · Chord ${chord.keyA + 1} + ${chord.keyB + 1}`;

/** Net edits against the last device read/save, rather than an edit history. */
export function profileChanges(before: Profile | null, after: Profile): ProfileChange[] {
  if (!before) return [{ where: 'Entire profile is unsaved. No saved device profile is available to compare with.' }];
  const changes: ProfileChange[] = [];
  const change = <T,>(where: string, oldValue: T, newValue: T, format: (value: T) => string, undo: (draft: Profile) => void) => {
    if (oldValue !== newValue) changes.push({ where, before: format(oldValue), after: format(newValue), undo });
  };
  const binding = (where: string, oldAction: Action, newAction: Action, undo: (draft: Profile) => void) => {
    if (!actionsEqual(oldAction, newAction)) changes.push({ where, before: actionName(oldAction), after: actionName(newAction), undo });
  };
  change('Hardware', before.variant, after.variant, variantName, (draft) => {
    draft.variant = before.variant;
    for (const [i, layer] of draft.layers.entries()) {
      const saved = before.layers[i] ?? before.layers[0]!;
      layer.keys = saved.keys.map((action, key) => layer.keys[key] ?? { ...action });
      layer.leds = saved.leds.map((color, key) => layer.leds[key] ?? color);
      if (layer.idleLeds) layer.idleLeds = saved.leds.map((_, key) => layer.idleLeds![key] ?? saved.idleLeds?.[key] ?? saved.indicatorColor);
    }
    draft.chords = draft.chords.filter((chord) => chord.keyB < draft.layers[0]!.keys.length);
  });
  change('Sleep Timeout', before.sleepTimeoutMinutes, after.sleepTimeoutMinutes,
    minutes => SLEEP_TIMEOUT_LABELS[SLEEP_TIMEOUT_MINUTES.findIndex(value => value === minutes)] ?? 'Unknown',
    draft => { draft.sleepTimeoutMinutes = before.sleepTimeoutMinutes; });
  for (const [field, label] of [['consumeWakeInput', 'Consume Wake Input'],
    ['showLayerIndicatorOnWake', 'Show Layer Indicator'], ['dimInsteadOfOff', 'Sleep Behavior']] as const) {
    change(label, before[field], after[field], value => value ? (field === 'dimInsteadOfOff' ? 'Dim' : 'On') : 'Off', draft => { draft[field] = before[field]; });
  }
  change('Startup Layer', before.startupLayer, after.startupLayer, (n) => `Layer ${n + 1}`, (draft) => { draft.startupLayer = before.startupLayer; });
  change('Chord Window', before.chordWindow, after.chordWindow, (n) => n ? `${n * 5}ms` : 'Selection Required', (draft) => { draft.chordWindow = before.chordWindow; });
  change('Hold Threshold', holdThreshold(before), holdThreshold(after), n => `${n}ms`, draft => {
    if (before.holdThresholdMs === undefined) delete draft.holdThresholdMs;
    else draft.holdThresholdMs = before.holdThresholdMs;
  });
  change('Rainbow Phase Spacing', before.rainbowPhase, after.rainbowPhase, (v) => RAINBOW_PHASE_LABELS[v]!, (draft) => { draft.rainbowPhase = before.rainbowPhase; });
  change('Rainbow Speed', before.rainbowSpeed, after.rainbowSpeed, (v) => RAINBOW_SPEED_LABELS[v] ?? 'Unknown', (draft) => { draft.rainbowSpeed = before.rainbowSpeed; });
  change('Transparent Off Color', before.transparentBlack, after.transparentBlack, (v) => v ? 'Enabled' : 'Disabled', (draft) => { draft.transparentBlack = before.transparentBlack; });
  for (let i = 0; i < Math.max(before.layers.length, after.layers.length); i++) {
    const oldLayer = before.layers[i];
    const newLayer = after.layers[i];
    const label = `Layer ${i + 1}`;
    if (!oldLayer) {
      changes.push({ where: label, after: 'Added', undo: (draft) => {
        draft.layers.splice(i, 1);
        draft.chords = draft.chords.filter((chord) => chord.layer !== i).map((chord) => chord.layer > i ? { ...chord, layer: chord.layer - 1 } : chord);
        const shift = (binding: Action): Action => mapBranches(binding, action =>
          !isPreviousLayer(action) && (action.type === 'setLayer' || action.type === 'oneShotSetLayer' || action.type === 'momentaryLayer') && action.layer > i ? { ...action, layer: action.layer - 1 } : action);
        for (const layer of draft.layers) {
          layer.keys = layer.keys.map(shift);
          layer.encoderButton = shift(layer.encoderButton);
          layer.clockwise = shift(layer.clockwise);
          layer.counterclockwise = shift(layer.counterclockwise);
        }
        draft.chords.forEach((chord) => { chord.action = shift(chord.action); });
        draft.timedActions?.forEach((timer) => { timer.action = shift(timer.action); timer.resumeAction = shift(timer.resumeAction); });
        draft.macros?.forEach(macro => { macro.actions = macro.actions.map(shift); });
        if (draft.startupLayer > i) draft.startupLayer--;
        else if (draft.startupLayer === i) draft.startupLayer = Math.min(i, draft.layers.length - 1);
      } });
      continue;
    }
    if (!newLayer) {
      changes.push({ where: label, before: 'Removed', undo: (draft) => {
        // Restore preceding missing layers too, so this layer keeps its number.
        while (draft.layers.length <= i) draft.layers.push(structuredClone(before.layers[draft.layers.length]!));
      } });
      continue;
    }
    for (let key = 0; key < Math.max(oldLayer.keys.length, newLayer.keys.length); key++) {
      const oldAction = oldLayer.keys[key];
      const newAction = newLayer.keys[key];
      const where = `${label} · Key ${key + 1}`;
      if (oldAction && newAction) {
        binding(where, oldAction, newAction, (draft) => { draft.layers[i]!.keys[key] = { ...oldAction }; });
        change(`${where} Color`, oldLayer.leds[key] ?? 0, newLayer.leds[key] ?? 0, colorName, (draft) => { draft.layers[i]!.leds[key] = oldLayer.leds[key] ?? 0; });
      }
    }
    if (JSON.stringify(oldLayer.idleLeds) !== JSON.stringify(newLayer.idleLeds)) changes.push({
      where: `${label} · Idle Colors`, before: oldLayer.idleLeds?.map(colorName).join(', ') ?? 'Not Set', after: newLayer.idleLeds?.map(colorName).join(', ') ?? 'Not Set',
      undo: draft => { if (oldLayer.idleLeds) draft.layers[i]!.idleLeds = [...oldLayer.idleLeds]; else { delete draft.layers[i]!.idleLeds; draft.layers[i]!.indicatorColor = oldLayer.indicatorColor; } },
    });
    binding(`${label} · Encoder Button`, oldLayer.encoderButton, newLayer.encoderButton, (draft) => { draft.layers[i]!.encoderButton = { ...oldLayer.encoderButton }; });
    binding(`${label} · Clockwise`, oldLayer.clockwise, newLayer.clockwise, (draft) => { draft.layers[i]!.clockwise = { ...oldLayer.clockwise }; });
    binding(`${label} · Counterclockwise`, oldLayer.counterclockwise, newLayer.counterclockwise, (draft) => { draft.layers[i]!.counterclockwise = { ...oldLayer.counterclockwise }; });
    change(`${label} · Layer Selection LEDs`, oldLayer.indicatorBehavior, newLayer.indicatorBehavior, (v: LayerIndicatorBehavior) => behaviorNames[v], (draft) => { draft.layers[i]!.indicatorBehavior = oldLayer.indicatorBehavior; });
    // Compare the stored color independently: changing indicator behavior must
    // not produce a second, non-undoable Off/Rainbow entry for the same edit.
    if (oldLayer.indicatorColor !== newLayer.indicatorColor) changes.push({
      where: `${label} · Indicator Color`, before: indicatorColor(oldLayer.indicatorColor), after: indicatorColor(newLayer.indicatorColor),
      undo: (draft) => { draft.layers[i]!.indicatorColor = oldLayer.indicatorColor; if (oldLayer.indicatorColor === 0 && oldLayer.idleLeds) draft.layers[i]!.idleLeds = [...oldLayer.idleLeds]; },
    });
    change(`${label} · Auto-Sleep`, oldLayer.autoSleep, newLayer.autoSleep, (v) => v ? 'On' : 'Off', (draft) => { draft.layers[i]!.autoSleep = oldLayer.autoSleep; });
    change(`${label} · Indicator Brightness`, oldLayer.indicatorFullBrightness, newLayer.indicatorFullBrightness, (v) => v ? 'Full Brightness' : 'Dim', (draft) => { draft.layers[i]!.indicatorFullBrightness = oldLayer.indicatorFullBrightness; });
  }
  const oldChords = new Map(before.chords.map((chord) => [chordId(chord), chord]));
  const newChords = new Map(after.chords.map((chord) => [chordId(chord), chord]));
  for (const [id, chord] of oldChords) {
    const next = newChords.get(id);
    if (!next) changes.push({ where: chordName(chord), before: actionName(chord.action), after: 'Removed', undo: (draft) => {
      while (draft.layers.length <= chord.layer) draft.layers.push(structuredClone(before.layers[draft.layers.length]!));
      // A scope change appears as removal plus addition. Restoring the saved
      // chord also replaces its conflicting counterpart in the new scope.
      draft.chords = draft.chords.filter((c) => !(c.keyA === chord.keyA && c.keyB === chord.keyB && (c.global || chord.global || c.layer === chord.layer)));
      draft.chords.splice(before.chords.indexOf(chord), 0, structuredClone(chord));
    } });
    else {
      binding(chordName(chord), chord.action, next.action, (draft) => { draft.chords.find((c) => chordId(c) === id)!.action = { ...chord.action }; });
      if (chord.global) change(`${chordName(chord)} · Home Layer`, chord.layer, next.layer, (n) => `Layer ${n + 1}`, (draft) => { draft.chords.find((c) => chordId(c) === id)!.layer = chord.layer; });
    }
  }
  for (const [id, chord] of newChords) {
    if (!oldChords.has(id)) changes.push({ where: chordName(chord), before: 'Not Assigned', after: actionName(chord.action), undo: (draft) => { draft.chords = draft.chords.filter((c) => chordId(c) !== id); } });
  }
  if (!changes.length && JSON.stringify(before.chords) !== JSON.stringify(after.chords)) {
    changes.push({ where: 'Chord order updated', undo: (draft) => { draft.chords = structuredClone(before.chords); } });
  }
  if (JSON.stringify(before.timedActions ?? []) !== JSON.stringify(after.timedActions ?? [])) {
    const describe = (p: Profile) => (p.timedActions ?? []).map((t, i) =>
      `${i + 1}: ${t.ticks} ticks, ${t.layer === undefined ? 'All Layers' : `Layer ${t.layer + 1}`}${t.resetOnInput ? ', resets on input' : ''}${t.consumeInput ? ', consumes wake input' : ''} → ${actionName(t.action)}; resume: ${actionName(t.resumeAction)}`).join(' · ') || 'None';
    changes.push({ where: 'Timed Actions', before: describe(before), after: describe(after), undo: (draft) => {
      if (before.timedActions) draft.timedActions = structuredClone(before.timedActions);
      else delete draft.timedActions;
    } });
  }
  if (JSON.stringify(before.macros ?? []) !== JSON.stringify(after.macros ?? [])) {
    const describe = (p: Profile) => (p.macros ?? []).map((macro, i) => `${i + 1}: ${macro.actions.map(actionName).join(' → ') || 'Empty'}`).join(' · ') || 'None';
    changes.push({ where: 'Macros', before: describe(before), after: describe(after), undo: draft => {
      if (before.macros) draft.macros = structuredClone(before.macros);
      else delete draft.macros;
    } });
  }
  return changes;
}
