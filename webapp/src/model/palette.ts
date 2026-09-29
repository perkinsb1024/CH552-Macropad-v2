/** Firmware palette version 2. Indices are stored on the device; RGB values are not. */
export interface PaletteEntry {
  index: number;
  hex: string;
  name: string;
}

export const PALETTE_VERSION = 2;

export const PALETTE: readonly PaletteEntry[] = [
  { index: 0, hex: '#FF0000', name: 'Red' },
  { index: 1, hex: '#FF6B5E', name: 'Coral' },
  { index: 2, hex: '#FF4B00', name: 'Orange' },
  { index: 3, hex: '#FFB400', name: 'Amber' },
  { index: 4, hex: '#FFFF00', name: 'Yellow' },
  { index: 5, hex: '#00FF00', name: 'Green' },
  { index: 6, hex: '#40C820', name: 'Leaf' },
  { index: 7, hex: '#209696', name: 'Teal' },
  { index: 8, hex: '#00FFFF', name: 'Cyan' },
  { index: 9, hex: '#0040FF', name: 'Azure' },
  { index: 10, hex: '#0000FF', name: 'Blue' },
  { index: 11, hex: '#8000FF', name: 'Violet' },
  { index: 12, hex: '#FF00FF', name: 'Magenta' },
  { index: 13, hex: '#FF0064', name: 'Rose' },
  { index: 14, hex: '#FFFFFF', name: 'White' },
  { index: 15, hex: '#000000', name: 'Off' },
];

export function paletteHex(index: number): string {
  return PALETTE[index & 15]?.hex ?? '#000000';
}
