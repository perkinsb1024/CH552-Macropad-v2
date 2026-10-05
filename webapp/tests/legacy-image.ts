import { keyCount, layerSize } from '../src/model/constants';
/** Re-encode v8 text records as v6/v7 text, before changing the version byte. */
export function legacyTextCodes(image: Uint8Array): void {
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
