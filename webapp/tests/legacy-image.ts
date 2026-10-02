import { keyCount, layerSize } from '../src/model/constants';
/** Convert action IDs only, while image still has the v6 header layout. */
export function legacyActionCodes(image: Uint8Array): void {
  const variant = (image[5]! & 1) as 0 | 1;
  const size = layerSize(variant);
  const layers = (image[3]! & 7) + 1;
  const remap = (offset: number) => { const code = image[offset]! & 15; if (code >= 12 && code <= 14) image[offset] = (image[offset]! & 0xf0) | (code + 1); };
  for (let l = 0; l < layers; l++) for (let i = 0; i < keyCount(variant) + 3; i++) remap(9 + l * size + 2 * i);
  for (let c = 0; c < ((image[5]! >> 1) & 63); c++) remap(9 + layers * size + c * 3 + 1);
}
