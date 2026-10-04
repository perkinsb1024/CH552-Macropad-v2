import type { Chord, Slot } from './types';

type ChordIdentity = Pick<Chord, 'layer' | 'keyA' | 'keyB' | 'global'>;

/** Global and local chords can share both a storage layer and a key pair. */
export function matchesChord(chord: ChordIdentity, identity: ChordIdentity): boolean {
  return chord.layer === identity.layer && chord.keyA === identity.keyA &&
    chord.keyB === identity.keyB && !!chord.global === !!identity.global;
}

export function chordSlot(chord: ChordIdentity): Extract<Slot, { kind: 'chord' }> {
  return { kind: 'chord', layer: chord.layer, keyA: chord.keyA, keyB: chord.keyB,
    ...(chord.global ? { global: true } : {}) };
}
