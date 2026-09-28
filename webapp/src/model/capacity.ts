import { CHORD_ENTRY_SIZE, HEADER_SIZE, IMAGE_SIZE, layerSize } from './constants';
import type { Action, Profile } from './types';
import { encodedLength } from './strings';

export interface Capacity {
  header: number;
  layers: number;
  chords: number;
  strings: number;
  used: number;
  remaining: number;
  /** Distinct strings in pool order. */
  pool: string[];
}

/** Every string action in canonical pool order: layers (inputs in record order), then chords by identifier. */
export function stringActionsInOrder(profile: Profile): string[] {
  const out: string[] = [];
  const visit = (a: Action) => {
    if (a.type === 'string') out.push(a.text);
  };
  for (const layer of profile.layers) {
    layer.keys.forEach(visit);
    visit(layer.encoderButton);
    visit(layer.clockwise);
    visit(layer.counterclockwise);
  }
  for (const chord of sortedChords(profile)) visit(chord.action);
  return out;
}

export function sortedChords(profile: Profile) {
  return [...profile.chords].sort((x, y) => x.layer - y.layer || x.keyA - y.keyA || x.keyB - y.keyB);
}

/** Distinct strings, first occurrence wins, matching the encoder's deduplication. */
export function stringPool(profile: Profile): string[] {
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const text of stringActionsInOrder(profile)) {
    if (!seen.has(text)) {
      seen.add(text);
      pool.push(text);
    }
  }
  return pool;
}

export function computeCapacity(profile: Profile): Capacity {
  const pool = stringPool(profile);
  const header = HEADER_SIZE;
  const layers = layerSize(profile.variant) * profile.layers.length;
  const chords = CHORD_ENTRY_SIZE * profile.chords.length;
  const strings = pool.reduce((sum, s) => sum + encodedLength(s), 0);
  const used = header + layers + chords + strings;
  return { header, layers, chords, strings, used, remaining: IMAGE_SIZE - used, pool };
}
