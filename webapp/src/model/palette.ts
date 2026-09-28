/** Firmware palette version 1. Indices are stored on the device; RGB values are not. */
export interface PaletteEntry {
  index: number;
  hex: string;
  name: string;
}

export const PALETTE_VERSION = 1;

export const PALETTE: readonly PaletteEntry[] = [
  { index: 0, hex: '#FF2020', name: 'Red' },
  { index: 1, hex: '#40C820', name: 'Leaf' },
  { index: 2, hex: '#209696', name: 'Teal' },
  { index: 3, hex: '#FF4B00', name: 'Orange' },
  { index: 4, hex: '#0040FF', name: 'Azure' },
  { index: 5, hex: '#FF0064', name: 'Rose' },
  { index: 6, hex: '#000000', name: 'Off' },
  { index: 7, hex: '#FFFFFF', name: 'White' },
  { index: 8, hex: '#FFB400', name: 'Amber' },
  { index: 9, hex: '#FFFF00', name: 'Yellow' },
  { index: 10, hex: '#00FF00', name: 'Green' },
  { index: 11, hex: '#00FFFF', name: 'Cyan' },
  { index: 12, hex: '#0000FF', name: 'Blue' },
  { index: 13, hex: '#8000FF', name: 'Violet' },
  { index: 14, hex: '#FF00FF', name: 'Magenta' },
  { index: 15, hex: '#808080', name: 'Grey' },
];

export function paletteHex(index: number): string {
  return PALETTE[index & 15]?.hex ?? '#000000';
}
