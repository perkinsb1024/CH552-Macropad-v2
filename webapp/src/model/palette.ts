import type { Action, Profile } from './types';

/** Firmware palette version 4. Indices are stored on the device; RGB values are not. */
export interface PaletteEntry {
  index: number;
  hex: string;
  name: string;
}

export const PALETTE_VERSION = 4;

export const PALETTE: readonly PaletteEntry[] = [
  { index: 0, hex: '#000000', name: 'Off' },
  { index: 1, hex: '#FF0000', name: 'Red' },
  { index: 2, hex: '#FF6B5E', name: 'Coral' },
  { index: 3, hex: '#FF4B00', name: 'Orange' },
  { index: 4, hex: '#FFB400', name: 'Amber' },
  { index: 5, hex: '#FFFF00', name: 'Yellow' },
  { index: 6, hex: '#00FF00', name: 'Green' },
  { index: 7, hex: '#40C820', name: 'Leaf' },
  { index: 8, hex: '#00FFFF', name: 'Cyan' },
  { index: 9, hex: '#0040FF', name: 'Azure' },
  { index: 10, hex: '#0000FF', name: 'Blue' },
  { index: 11, hex: '#8000FF', name: 'Violet' },
  { index: 12, hex: '#FF00FF', name: 'Magenta' },
  { index: 13, hex: '#FF0064', name: 'Rose' },
  { index: 14, hex: '#FFFFFF', name: 'White' },
  { index: 15, hex: '#000000', name: 'Rainbow' },
];

export function paletteHex(index: number): string {
  return PALETTE[index & 15]?.hex ?? '#000000';
}

/** Palette v3 values for validating and parsing historical profiles before migration. */
export const LEGACY_PALETTE: readonly PaletteEntry[] = [
  ...PALETTE.slice(1, 8).map(c => ({ ...c, index: c.index - 1 })),
  { index: 7, hex: '#209696', name: 'Teal' },
  ...PALETTE.slice(8, 15),
  { index: 15, hex: '#000000', name: 'Off' },
];

export function migrateColor(color: number, keyPress = false): number {
  return Number.isInteger(color) && color >= 0 && color <= 6 ? color + 1 : color === 7 ? 8 : keyPress && color === 15 ? 0 : color;
}

/** Semantic migration after source decoding, shared by binary, JSON, and drafts. */
export function migrateProfileColors(profile: Profile): boolean {
  let replacedTeal = false;
  const color = (value: number, key = false) => {
    if (value === 7) replacedTeal = true;
    return migrateColor(value, key);
  };
  const visited = new WeakSet<Action>();
  const action = (a: Action) => {
    if (visited.has(a)) return;
    visited.add(a);
    if (a.type === 'ledControl' && /^effect(On|Blink[1-8])$/.test(a.command) && typeof a.value === 'number') a.value = color(a.value);
  };
  for (const layer of profile.layers) {
    layer.indicatorColor = color(layer.indicatorColor);
    layer.leds = layer.leds.map(c => color(c, true));
    delete layer.idleLeds;
    [...layer.keys, layer.encoderButton, layer.clockwise, layer.counterclockwise].forEach(action);
  }
  profile.chords.forEach(c => action(c.action));
  profile.timedActions?.forEach(t => { action(t.action); action(t.resumeAction); });
  profile.macros?.forEach(m => m.actions.forEach(action));
  return replacedTeal;
}
