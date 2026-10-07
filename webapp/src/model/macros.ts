import type { Action, Profile } from './types';

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
  const shift = (action: Action): Action => action.type !== 'macro' ? action
    : action.macro === index ? { type: 'none' }
    : action.macro > index ? { ...action, macro: action.macro - 1 } : action;
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
