import { decodeLiveAction } from '../codec/decode';
import { encodeAction } from '../codec/encode';
import { keyCount } from '../model/constants';
import type { Action, OrdinaryAction, Profile } from '../model/types';
import { sourceKeys, type TriggerClassifier, type TriggerKind } from '../protocol/live';

function sameAction(a: OrdinaryAction, b: Action): boolean {
  if (b.type === 'tapHold') return false;
  if (a.type === 'string' || b.type === 'string') return a.type === 'string' && b.type === 'string' && a.text === b.text;
  if (a.type === 'macro' || b.type === 'macro') return a.type === 'macro' && b.type === 'macro' && a.macro === b.macro && a.repeats === b.repeats;
  return encodeAction(a, new Map()).join(',') === encodeAction(b, new Map()).join(',');
}

/** Telemetry has action bytes, but no branch bit or binding's press-time layer.
 * Compare possible source layers; ambiguous and overwritten events stay neutral. */
export function liveGestureClassifier(profile: Profile, image: Uint8Array): TriggerClassifier {
  const keys = keyCount(profile.variant);
  const forInput = (input: number) => profile.layers.flatMap(l => input === keys ? [l.encoderButton] : input === 7 ? [l.clockwise] : input === 8 ? [l.counterclockwise] : [l.keys[input]!]).filter(Boolean);
  return (sample, input): TriggerKind => {
    if (!sample) {
      const possibleHold = forInput(input).some(a => a.type === 'tapHold') ||
        profile.chords.some(c => (c.keyA === input || c.keyB === input) && c.action.type === 'tapHold');
      return possibleHold ? 'unknown' : 'tap';
    }
    if (sample.source & 128) return 'tap';
    const source = sourceKeys(sample.source);
    const candidates = source.length === 2 ? profile.layers.flatMap((_, layer) => {
      const local = profile.chords.find(c => !c.global && c.layer === layer && source.includes(c.keyA) && source.includes(c.keyB));
      const chord = local ?? profile.chords.find(c => c.global && source.includes(c.keyA) && source.includes(c.keyB));
      return chord ? [chord.action] : [];
    }) : forInput(source[0]!);
    const action = decodeLiveAction(image, sample.first, sample.second);
    if (!action) return 'unknown';
    const matches = new Set<TriggerKind>();
    for (const candidate of candidates) {
      if (candidate.type === 'tapHold') {
        if (sameAction(candidate.tap, action)) matches.add('tap');
        if (sameAction(candidate.hold, action)) matches.add('hold');
      } else if (sameAction(candidate, action)) matches.add('tap');
    }
    return matches.size === 1 ? [...matches][0]! : 'unknown';
  };
}
