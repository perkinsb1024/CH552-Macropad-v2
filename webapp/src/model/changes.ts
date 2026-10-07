import { actionsEqual, summarize, isPreviousLayer } from './actions';
import { RAINBOW_SPEED_LABELS, RAINBOW_PHASE_LABELS, LayerIndicatorBehavior, variantName } from './constants';
import { PALETTE } from './palette';
import type { Action, Chord, Profile } from './types';

export interface ProfileChange { where: string; before?: string; after?: string; undo?: (draft: Profile) => void }

const behaviorNames = {
  [LayerIndicatorBehavior.None]: 'Do not indicate',
  [LayerIndicatorBehavior.TimedOn]: 'On for 1.5 seconds',
  [LayerIndicatorBehavior.BlinkByLayer]: 'Blink by layer number',
  [LayerIndicatorBehavior.AlwaysOn]: 'Always on',
};
const colorName = (color: number) => PALETTE[color]?.name ?? 'Unknown';
const indicatorColor = (color: number, behavior: LayerIndicatorBehavior) =>
  color === 15 && behavior !== LayerIndicatorBehavior.None ? 'Rainbow' : colorName(color);
const actionName = (action: Action) => action.type === 'string'
  ? `Type ${JSON.stringify(action.text)}` : action.type === 'none' ? 'Nothing' : summarize(action);
const chordId = (chord: Chord) => `${chord.global ? 'global' : chord.layer}:${chord.keyA}:${chord.keyB}`;
const chordName = (chord: Chord) => `${chord.global ? 'All layers' : `Layer ${chord.layer + 1}`} · Chord ${chord.keyA + 1} + ${chord.keyB + 1}`;

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
    }
    draft.chords = draft.chords.filter((chord) => chord.keyB < draft.layers[0]!.keys.length);
  });
  change('Startup layer', before.startupLayer, after.startupLayer, (n) => `Layer ${n + 1}`, (draft) => { draft.startupLayer = before.startupLayer; });
  change('Chord window', before.chordWindow, after.chordWindow, (n) => n ? `${n * 5} ms` : 'Disabled', (draft) => { draft.chordWindow = before.chordWindow; });
  change('Rainbow phase spacing', before.rainbowPhase, after.rainbowPhase, (v) => RAINBOW_PHASE_LABELS[v]!, (draft) => { draft.rainbowPhase = before.rainbowPhase; });
  change('Rainbow speed', before.rainbowSpeed, after.rainbowSpeed, (v) => RAINBOW_SPEED_LABELS[v] ?? 'Unknown', (draft) => { draft.rainbowSpeed = before.rainbowSpeed; });
  change('Transparent Off color', before.transparentBlack, after.transparentBlack, (v) => v ? 'Enabled' : 'Disabled', (draft) => { draft.transparentBlack = before.transparentBlack; });
  for (let i = 0; i < Math.max(before.layers.length, after.layers.length); i++) {
    const oldLayer = before.layers[i];
    const newLayer = after.layers[i];
    const label = `Layer ${i + 1}`;
    if (!oldLayer) {
      changes.push({ where: label, after: 'Added', undo: (draft) => {
        draft.layers.splice(i, 1);
        draft.chords = draft.chords.filter((chord) => chord.layer !== i).map((chord) => chord.layer > i ? { ...chord, layer: chord.layer - 1 } : chord);
        const shift = (action: Action): Action =>
          !isPreviousLayer(action) && (action.type === 'setLayer' || action.type === 'oneShotSetLayer' || action.type === 'momentaryLayer') && action.layer > i ? { ...action, layer: action.layer - 1 } : action;
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
        change(`${where} color`, oldLayer.leds[key] ?? 15, newLayer.leds[key] ?? 15, colorName, (draft) => { draft.layers[i]!.leds[key] = oldLayer.leds[key] ?? 15; });
      }
    }
    binding(`${label} · Encoder button`, oldLayer.encoderButton, newLayer.encoderButton, (draft) => { draft.layers[i]!.encoderButton = { ...oldLayer.encoderButton }; });
    binding(`${label} · Clockwise`, oldLayer.clockwise, newLayer.clockwise, (draft) => { draft.layers[i]!.clockwise = { ...oldLayer.clockwise }; });
    binding(`${label} · Counterclockwise`, oldLayer.counterclockwise, newLayer.counterclockwise, (draft) => { draft.layers[i]!.counterclockwise = { ...oldLayer.counterclockwise }; });
    change(`${label} · Layer selection LEDs`, oldLayer.indicatorBehavior, newLayer.indicatorBehavior, (v: LayerIndicatorBehavior) => behaviorNames[v], (draft) => { draft.layers[i]!.indicatorBehavior = oldLayer.indicatorBehavior; });
    // Compare the stored color independently: changing indicator behavior must
    // not produce a second, non-undoable Off/Rainbow entry for the same edit.
    if (oldLayer.indicatorColor !== newLayer.indicatorColor) changes.push({
      where: `${label} · Indicator color`, before: indicatorColor(oldLayer.indicatorColor, oldLayer.indicatorBehavior), after: indicatorColor(newLayer.indicatorColor, newLayer.indicatorBehavior),
      undo: (draft) => { draft.layers[i]!.indicatorColor = oldLayer.indicatorColor; },
    });
    change(`${label} · Indicator brightness`, oldLayer.indicatorFullBrightness, newLayer.indicatorFullBrightness, (v) => v ? 'Full brightness' : 'Dim', (draft) => { draft.layers[i]!.indicatorFullBrightness = oldLayer.indicatorFullBrightness; });
    change(`${label} · Encoder bootloader entry`, oldLayer.bootloaderFromRun, newLayer.bootloaderFromRun, (v) => v ? 'Enabled' : 'Disabled', (draft) => { draft.layers[i]!.bootloaderFromRun = oldLayer.bootloaderFromRun; });
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
      if (chord.global) change(`${chordName(chord)} · Home layer`, chord.layer, next.layer, (n) => `Layer ${n + 1}`, (draft) => { draft.chords.find((c) => chordId(c) === id)!.layer = chord.layer; });
    }
  }
  for (const [id, chord] of newChords) {
    if (!oldChords.has(id)) changes.push({ where: chordName(chord), before: 'Not assigned', after: actionName(chord.action), undo: (draft) => { draft.chords = draft.chords.filter((c) => chordId(c) !== id); } });
  }
  if (!changes.length && JSON.stringify(before.chords) !== JSON.stringify(after.chords)) {
    changes.push({ where: 'Chord order updated', undo: (draft) => { draft.chords = structuredClone(before.chords); } });
  }
  if (JSON.stringify(before.timedActions ?? []) !== JSON.stringify(after.timedActions ?? [])) {
    const describe = (p: Profile) => (p.timedActions ?? []).map((t, i) =>
      `${i + 1}: ${t.ticks} ticks, ${t.layer === undefined ? 'all layers' : `Layer ${t.layer + 1}`}${t.resetOnInput ? ', resets on input' : ''}${t.consumeInput ? ', consumes wake input' : ''} → ${actionName(t.action)}; resume: ${actionName(t.resumeAction)}`).join(' · ') || 'None';
    changes.push({ where: 'Timed actions', before: describe(before), after: describe(after), undo: (draft) => {
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
