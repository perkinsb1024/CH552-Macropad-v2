import { chordSlot } from './chords';
import type { Action, Issue, Profile, Slot } from './types';
import { slotLabel } from './validate';

/** Advisory only: zero movement remains valid and encodable. */
export function stationaryPointerWarnings(profile: Profile): Issue[] {
  const warnings: Issue[] = [];
  const check = (action: Action, slot: Slot) => {
    if (action.type !== 'mouseXY' || action.x !== 0 || action.y !== 0) return;
    warnings.push({
      where: slotLabel(slot),
      message: 'Both amounts are 0, so this action does not move the mouse. Set at least one amount above 0.',
      slot,
    });
  };
  profile.layers.forEach((layer, li) => {
    layer.keys.forEach((action, index) => check(action, { kind: 'key', layer: li, index }));
    check(layer.encoderButton, { kind: 'encoderButton', layer: li });
    check(layer.clockwise, { kind: 'clockwise', layer: li });
    check(layer.counterclockwise, { kind: 'counterclockwise', layer: li });
  });
  profile.chords.forEach(chord => check(chord.action, chordSlot(chord)));
  profile.timedActions?.forEach((timer, index) => {
    check(timer.action, { kind: 'timed', layer: 0, index, resume: false });
    check(timer.resumeAction, { kind: 'timed', layer: 0, index, resume: true });
  });
  profile.macros?.forEach((macro, index) => {
    macro.actions.forEach((action, step) => check(action, { kind: 'macro', layer: 0, index, step }));
  });
  return warnings;
}
