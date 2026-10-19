import type { Action, OrdinaryAction, Profile } from './types';
import { branches, mapBranches } from './tapHold';

/** Layer switches must finish a macro, regardless of its invocation layer. */
export function isMacroLayerSwitch(action: Action): boolean {
  return action.type === 'setLayer' || action.type === 'oneShotSetLayer'
    || action.type === 'relativeLayer' || action.type === 'oneShotRelativeLayer';
}

export function macroSwitchesLayer(actions: Action[]): boolean {
  return actions.some(isMacroLayerSwitch);
}

/** Apply a reference edit everywhere an invocation can be bound. */
export function removeMacro(profile: Profile, index: number): void {
  profile.macros?.splice(index, 1);
  if (!profile.macros?.length) delete profile.macros;
  const shift = (binding: Action): Action => mapBranches(binding, (action: OrdinaryAction): OrdinaryAction => action.type !== 'macro' ? action
    : action.macro === index ? { type: 'none' }
    : action.macro > index ? { ...action, macro: action.macro - 1 } : action);
  for (const layer of profile.layers) {
    layer.keys = layer.keys.map(shift);
    layer.encoderButton = shift(layer.encoderButton);
    layer.clockwise = shift(layer.clockwise);
    layer.counterclockwise = shift(layer.counterclockwise);
  }
  for (const chord of profile.chords) chord.action = shift(chord.action);
  for (const timer of profile.timedActions ?? []) {
    timer.action = shift(timer.action);
    timer.resumeAction = shift(timer.resumeAction);
  }
}

/** Definitions without an Execute macro binding anywhere in the profile. */
export function untriggeredMacros(profile: Profile): number[] {
  const actions = [
    ...profile.layers.flatMap(layer => [...layer.keys, layer.encoderButton, layer.clockwise, layer.counterclockwise]),
    ...profile.chords.map(chord => chord.action),
    ...(profile.timedActions ?? []).flatMap(timer => [timer.action, timer.resumeAction]),
  ];
  const used = new Set(actions.flatMap(branches).filter(action => action.type === 'macro').map(action => action.macro));
  return (profile.macros ?? []).flatMap((_, index) => used.has(index) ? [] : [index]);
}

/** Reorder definitions while preserving the macro invoked by every binding. */
export function reorderMacros(profile: Profile, order: number[]): void {
  const macros = profile.macros ?? [];
  if (order.length !== macros.length || new Set(order).size !== macros.length
    || order.some(index => !Number.isInteger(index) || !macros[index])) return;
  profile.macros = order.map(index => macros[index]!);
  const remap = (binding: Action): Action => mapBranches(binding, action => {
    if (action.type !== 'macro') return action;
    const index = order.indexOf(action.macro);
    return index < 0 ? action : { ...action, macro: index };
  });
  for (const layer of profile.layers) {
    layer.keys = layer.keys.map(remap);
    layer.encoderButton = remap(layer.encoderButton);
    layer.clockwise = remap(layer.clockwise);
    layer.counterclockwise = remap(layer.counterclockwise);
  }
  for (const chord of profile.chords) chord.action = remap(chord.action);
  for (const timer of profile.timedActions ?? []) {
    timer.action = remap(timer.action);
    timer.resumeAction = remap(timer.resumeAction);
  }
}
