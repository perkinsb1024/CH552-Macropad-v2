import type { Action, OrdinaryAction, Profile, TapHoldAction } from './types';

export const DEFAULT_HOLD_THRESHOLD_MS = 256;
export const HOLD_THRESHOLDS = Array.from({ length: 16 }, (_, i) => (i + 1) * 32);

export function branches(action: Action): OrdinaryAction[] {
  return action.type === 'tapHold' ? [action.tap, action.hold] : [action];
}

export function mapBranches(action: Action, map: (action: OrdinaryAction) => OrdinaryAction): Action {
  return action.type === 'tapHold' ? { ...action, tap: map(action.tap), hold: map(action.hold) } : map(action);
}

export function profileBindings(profile: Profile): Action[] {
  return [...profile.layers.flatMap(l => [...l.keys, l.encoderButton, l.clockwise, l.counterclockwise]),
    ...profile.chords.map(c => c.action), ...(profile.timedActions ?? []).flatMap(t => [t.action, t.resumeAction]),
    ...(profile.macros ?? []).flatMap(m => m.actions)];
}

export function holdBindings(profile: Profile): TapHoldAction[] {
  return profileBindings(profile).filter((a): a is TapHoldAction => a.type === 'tapHold');
}

export function holdThreshold(profile: Profile, action?: TapHoldAction): number {
  return action?.thresholdMs ?? profile.holdThresholdMs ?? DEFAULT_HOLD_THRESHOLD_MS;
}

export function setHoldThreshold(profile: Profile, milliseconds: number): void {
  profile.holdThresholdMs = milliseconds;
  holdBindings(profile).forEach(a => { delete a.thresholdMs; });
}

/** Record identity excludes the threshold: firmware allows records to be shared. */
export const holdRecordKey = (action: TapHoldAction) => JSON.stringify([action.tap, action.hold]);
export function holdRecords(profile: Profile): TapHoldAction[] {
  return [...new Map(holdBindings(profile).map(a => [holdRecordKey(a), a])).values()];
}
