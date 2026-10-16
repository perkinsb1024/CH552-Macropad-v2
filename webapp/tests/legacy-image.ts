import { keyCount, layerSize } from '../src/model/constants';
/** Reconstruct the earlier MP/v15 header; record offsets and actions stay intact. */
export function legacyHeader(image: Uint8Array): Uint8Array {
  if (image[0] !== 0x42) return image;
  const layers = image[2]!;
  if (image[1] === 16) {
    const variant = (layers & 1) as 0 | 1;
    const count = ((layers >> 1) & 7) + 1;
    const color = (c: number, key = false) => c === 0 ? (key ? 15 : 0) : c < 8 ? c - 1 : c;
    const action = (offset: number) => {
      if ((image[offset]! & 15) === 13 && ((image[offset + 1]! >= 0x81 && image[offset + 1]! <= 0x89) || (image[offset + 1]! >= 0x91 && image[offset + 1]! <= 0x99))) image[offset] = 13 | color(image[offset]! >> 4) << 4;
    };
    for (let l = 0; l < count; l++) {
      const base = 9 + l * layerSize(variant);
      for (let k = 0; k < keyCount(variant) + 3; k++) action(base + 2 * k);
      const start = base + 2 * (keyCount(variant) + 3);
      for (let k = 0; k < keyCount(variant); k++) {
        const offset = start + (k >> 1), shift = (k & 1) * 4;
        image[offset] = (image[offset]! & ~(15 << shift)) | color((image[offset]! >> shift) & 15, true) << shift;
      }
      const options = base + layerSize(variant) - 1;
      if (image[options]! >> 4 === 0) throw new Error('Per-key palettes cannot be represented in legacy fixtures');
      image[options] = (image[options]! & 15) | color(image[options]! >> 4) << 4;
    }
    let offset = 9 + count * layerSize(variant);
    for (let c = 0; c < image[4]! >> 3; c++, offset += 3) action(offset + 1);
    for (let t = 0; t < (image[4]! & 7); t++, offset += 6) { action(offset + 1); action(offset + 3); }
    offset += image[3]! >> 1;
    while (offset < 128) { if (image[offset]) { action(offset); offset += 2; } else offset++; }
    image[1] = 15;
  }
  const pool = image[3]! >> 1;
  const counts = image[4]!;
  const led = image[5]!;
  const version = image[1]!;
  const window = 4 + 2 * (led & 7);
  if (window > 15) throw new Error('Window cannot be represented in a legacy header');
  image.fill(0, 0, 9);
  image.set([0x4d, 0x50, version,
    ((layers >> 1) & 7) | (((layers >> 4) & 7) << 3) | ((counts & 3) << 6),
    pool | ((counts & 4) << 5), (layers & 1) | ((counts >> 3) << 1) | ((led & 8) << 4),
    0, 0, window | (led & 0xf0)]);
  return image;
}
/** Reconstruct published v13 bytes without changing parameters or offsets. */
export function legacyV13Codes(image: Uint8Array): void {
  legacyHeader(image);
  if (image[2]! < 14) return;
  const variant = (image[5]! & 1) as 0 | 1;
  const layers = (image[3]! & 7) + 1;
  const remap = (offset: number) => {
    const first = image[offset]!;
    const type = first & 15;
    const aux = first >> 4;
    if (type === 0) image[offset] = aux === 1 ? 0x20 : aux === 2 ? 0x10 : first;
    else if (type === 12) {
      if (aux === 6) throw new Error('Relative holds require v14');
      image[offset] = aux === 2 ? 0x0a : aux & 4 ? ((aux & 1) << 4) | 0x0b : ((aux & 1) << 4) | 0x09;
    } else {
      if (type === 11) throw new Error('Modified holds require v14');
      const codes = [0, 1, 2, 3, 5, 6, 12, 13, 7, 8, 4, 0, 0, 14, 15];
      image[offset] = (first & 240) | codes[type]!;
    }
  };
  for (let l = 0; l < layers; l++) for (let i = 0; i < keyCount(variant) + 3; i++) remap(9 + l * layerSize(variant) + 2 * i);
  let offset = 9 + layers * layerSize(variant);
  const chords = (image[5]! >> 1) & 63;
  for (let c = 0; c < chords; c++) remap(offset + c * 3 + 1);
  offset += chords * 3;
  const timers = (image[3]! >> 6) | ((image[4]! >> 7) << 2);
  for (let t = 0; t < timers; t++) { remap(offset + t * 6 + 1); remap(offset + t * 6 + 3); }
  offset += timers * 6 + (image[4]! & 127);
  while (offset < 128) { if (image[offset]) { remap(offset); offset += 2; } else offset++; }
  image[2] = 13;
}

/** Restore the published v12 pointer and physical mouse-hold encodings. */
export function legacyV12Codes(image: Uint8Array): void {
  legacyV13Codes(image);
  if (image[2]! < 13) return;
  const variant = (image[5]! & 1) as 0 | 1;
  const layers = (image[3]! & 7) + 1;
  const remap = (offset: number) => {
    const first = image[offset]!;
    if (first === 0x35) image[offset] = 4;
    if ((first & 15) === 12) image[offset] = (first & 0x10) | (first & 0x20 ? 13 : 12);
    if ((first & 15) === 13) throw new Error('Combined movement cannot be represented in older formats');
  };
  for (let l = 0; l < layers; l++) for (let i = 0; i < keyCount(variant) + 3; i++) remap(9 + l * layerSize(variant) + 2 * i);
  let offset = 9 + layers * layerSize(variant);
  const chords = (image[5]! >> 1) & 63;
  for (let c = 0; c < chords; c++) remap(offset + c * 3 + 1);
  offset += chords * 3;
  const timers = (image[3]! >> 6) | ((image[4]! >> 7) << 2);
  for (let t = 0; t < timers; t++) { remap(offset + t * 6 + 1); remap(offset + t * 6 + 3); }
  offset += timers * 6 + (image[4]! & 127);
  while (offset < 128) { if (image[offset]) { remap(offset); offset += 2; } else offset++; }
  image[2] = 12;
}
/** Convert current action codes to the historical v8–v10 numbering. */
export function legacyV10Codes(image: Uint8Array): void {
  legacyV12Codes(image);
  if (image[2]! < 11) return;
  const variant = (image[5]! & 1) as 0 | 1;
  const layers = (image[3]! & 7) + 1;
  const size = layerSize(variant);
  const remap = (offset: number) => {
    if (image[offset] === 0x35) image[offset] = 4; // v13 mouse hold back to v11/v12
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

/** Express a current uniform-color profile using the pre-v16 palette. */
export function legacyProfile<T>(profile: T): T {
  const p = structuredClone(profile) as T & import('../src/model/types').Profile;
  const color = (c: number, key = false) => c === 0 ? (key ? 15 : 0) : c < 8 ? c - 1 : c;
  const action = (a: import('../src/model/types').Action) => {
    if (a.type === 'ledControl' && /^effect(On|Blink[1-8])$/.test(a.command) && typeof a.value === 'number') a.value = color(a.value);
  };
  for (const l of p.layers) {
    l.indicatorColor = color(l.indicatorColor);
    l.leds = l.leds.map(c => color(c, true));
    [...l.keys, l.encoderButton, l.clockwise, l.counterclockwise].forEach(action);
  }
  p.chords.forEach(c => action(c.action));
  p.timedActions?.forEach(t => { action(t.action); action(t.resumeAction); });
  p.macros?.forEach(m => m.actions.forEach(action));
  return p;
}

/** Downgrade only palette semantics before a fabricated historical JSON version is assigned. */
export function legacyJson(raw: any): void {
  if (raw.version !== 16) return;
  for (const l of raw.layers) l.indicatorColor = l.indicatorColor > 0 && l.indicatorColor < 8 ? l.indicatorColor - 1 : l.indicatorColor;
  const action = (a: any) => {
    if (a.type === 'ledControl' && /^effect(On|Blink[1-8])$/.test(a.command) && typeof a.value === 'number' && a.value > 0 && a.value < 8) a.value--;
  };
  raw.layers.forEach((l: any) => [...l.keys, l.encoderButton, l.clockwise, l.counterclockwise].forEach(action));
  raw.chords.forEach((c: any) => action(c.action));
  raw.timedActions?.forEach((t: any) => { action(t.action); action(t.resumeAction); });
  raw.macros?.forEach((m: any) => m.actions.forEach(action));
}
