import { keyCount, layerSize } from '../src/model/constants';
/** Convert current action codes to the historical v8–v10 numbering. */
export function legacyV10Codes(image: Uint8Array): void {
  if (image[2]! < 11) return;
  const variant = (image[5]! & 1) as 0 | 1;
  const layers = (image[3]! & 7) + 1;
  const size = layerSize(variant);
  const remap = (offset: number) => {
    const type = image[offset]! & 15;
    if (type >= 4 && type <= 14) image[offset] = (image[offset]! & 240) | (type + 1);
  };
  for (let l = 0; l < layers; l++) for (let i = 0; i < keyCount(variant) + 3; i++) remap(9 + l * size + 2 * i);
  let offset = 9 + layers * size;
  const chords = (image[5]! >> 1) & 63;
  for (let c = 0; c < chords; c++) remap(offset + c * 3 + 1);
  offset += chords * 3;
  const timers = (image[3]! >> 6) | ((image[4]! >> 7) << 2);
  for (let t = 0; t < timers; t++) { remap(offset + t * 6 + 1); remap(offset + t * 6 + 3); }
  image[2] = 10;
}
/** Convert representable v10 timer durations to five-byte legacy records. */
export function legacyTimerRecords(image: Uint8Array): void {
  legacyV10Codes(image);
  if (image[2]! < 10) return;
  let offset = 9 + layerSize((image[5]! & 1) as 0 | 1) * ((image[3]! & 7) + 1) + 3 * ((image[5]! >> 1) & 63);
  const original = image.slice();
  const timers = (image[3]! >> 6) | ((image[4]! >> 7) << 2);
  const start = offset;
  for (let i = 0; i < timers; i++, offset += 5) {
    const old = start + i * 6;
    const ticks = (original[old]! | ((original[old + 5]! & 56) << 5)) + 1;
    if (ticks % 32 || (original[old + 5]! & 7)) throw new Error('Timer cannot be represented in a legacy image');
    image[offset] = ticks / 32 - 1 | (original[old + 5]! & 192);
    image.set(original.slice(old + 1, old + 5), offset + 1);
  }
  image.fill(0, offset);
  image.set(original.slice(start + timers * 6, start + timers * 6 + (image[4]! & 127)), offset);
  image[2] = 9;
}
/** Re-encode v8 text records as v6/v7 text, before changing the version byte. */
export function legacyTextCodes(image: Uint8Array): void {
  legacyTimerRecords(image);
  const variant = (image[5]! & 1) as 0 | 1;
  const size = layerSize(variant);
  const layers = (image[3]! & 7) + 1;
  const remap = (offset: number) => { if (image[offset] === 0x10) image[offset] = 0x09; };
  for (let l = 0; l < layers; l++) for (let i = 0; i < keyCount(variant) + 3; i++) remap(9 + l * size + 2 * i);
  let offset = 9 + layers * size;
  const chords = (image[5]! >> 1) & 63;
  for (let c = 0; c < chords; c++) remap(offset + c * 3 + 1);
  offset += chords * 3;
  const timers = (image[3]! >> 6) | ((image[4]! >> 7) << 2);
  for (let t = 0; t < timers; t++) { remap(offset + t * 5 + 1); remap(offset + t * 5 + 3); }
}

/** Convert v8 action records to v2–v5 while the modern header layout is intact. */
export function legacyActionCodes(image: Uint8Array): void {
  legacyTextCodes(image);
  const variant = (image[5]! & 1) as 0 | 1;
  const size = layerSize(variant);
  const layers = (image[3]! & 7) + 1;
  const remap = (offset: number) => { const code = image[offset]! & 15; if (code >= 12 && code <= 14) image[offset] = (image[offset]! & 0xf0) | (code + 1); };
  for (let l = 0; l < layers; l++) for (let i = 0; i < keyCount(variant) + 3; i++) remap(9 + l * size + 2 * i);
  for (let c = 0; c < ((image[5]! >> 1) & 63); c++) remap(9 + layers * size + c * 3 + 1);
}
