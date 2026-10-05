import { legacyActionCodes } from './legacy-image';
import { describe, expect, it } from 'vitest';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { imageCrc, sealImage, storedCrc } from '../src/codec/crc16';
import { defaultProfile, cloneProfile, emptyLayer } from '../src/model/defaults';
import { VARIANT_SIX_KEYS, VARIANT_THREE_KEYS, type Variant } from '../src/model/constants';
import type { Action, Profile } from '../src/model/types';
import { computeCapacity } from '../src/model/capacity';
import { validateProfile } from '../src/model/validate';
import { ACTION_DESCRIPTORS, blankAction, relativeTargetLayer } from '../src/model/actions';

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

describe('default profile image headers', () => {
  it.each([VARIANT_SIX_KEYS, VARIANT_THREE_KEYS])('migrates version 2 images for variant %s and writes version 8', (variant) => {
    const profile = defaultProfile(variant);
    profile.layers[0]!.indicatorBehavior = 1;
    profile.layers[0]!.indicatorColor = 8;
    profile.layers[0]!.indicatorFullBrightness = true;
    profile.chords = [{ layer: 0, keyA: 0, keyB: 1, global: true, action: { type: 'setLayer', layer: 1 } }];
    const legacy = encodeProfile(profile);
    legacyActionCodes(legacy);
    legacy[2] = 2;
    legacy[8] = legacy[8]! & 15;
    sealImage(legacy);
    const decoded = decodeImage(legacy);
    expect(decoded.ok && decoded.profile).toEqual(profile);
    if (!decoded.ok) throw new Error(decoded.detail);
    const upgraded = encodeProfile(decoded.profile);
    expect(upgraded[2]).toBe(8);
    expect(upgraded[8]).toBe(legacy[8]! | 0x60);
    expect([...upgraded.subarray(9)]).toEqual([...encodeProfile(profile).subarray(9)]);
    legacy[6] = legacy[6]! ^ 1;
    expect(decodeImage(legacy)).toMatchObject({ ok: false, reason: 'bad-crc' });
  });
  it('round-trips transparency in header bit 7 without changing chord count', () => {
    const profile = defaultProfile(VARIANT_THREE_KEYS);
    profile.transparentBlack = true;
    profile.chords = [{ layer: 0, keyA: 0, keyB: 1, global: false, action: { type: 'setLayer', layer: 1 } }];
    const image = encodeProfile(profile);
    expect(image[5]).toBe(0x83);
    const decoded = decodeImage(image);
    expect(decoded.ok && decoded.profile).toEqual(profile);
  });
  it('six-key default header', () => {
    const image = encodeProfile(defaultProfile(VARIANT_SIX_KEYS));
    expect(hex(image.subarray(0, 6))).toBe('4D 50 08 01 00 00');
    expect(imageCrc(image)).toBe(storedCrc(image));
  });
  it('three-key default header', () => {
    const image = encodeProfile(defaultProfile(VARIANT_THREE_KEYS));
    expect(hex(image.subarray(0, 6))).toBe('4D 50 08 01 00 01');
    expect(imageCrc(image)).toBe(storedCrc(image));
  });
  it('defaults round-trip', () => {
    for (const variant of [VARIANT_SIX_KEYS, VARIANT_THREE_KEYS] as Variant[]) {
      const profile = defaultProfile(variant);
      const decoded = decodeImage(encodeProfile(profile));
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(decoded.profile).toEqual(profile);
    }
  });
  it('stores full brightness in layer option bit 0', () => {
    const profile = defaultProfile(VARIANT_SIX_KEYS);
    profile.layers[0]!.indicatorFullBrightness = true;
    const image = encodeProfile(profile);
    expect(image[30]! & 1).toBe(1);
    const decoded = decodeImage(image);
    expect(decoded.ok && decoded.profile.layers[0]!.indicatorFullBrightness).toBe(true);
  });
  it('rejects the other variant', () => {
    const image = encodeProfile(defaultProfile(VARIANT_SIX_KEYS));
    expect(decodeImage(image, VARIANT_THREE_KEYS).ok).toBe(false);
  });
});

describe('every action type round-trips', () => {
  const samples: Action[] = [
    { type: 'none' },
    { type: 'keyTap', usage: 0x04, modifiers: 0 },
    { type: 'keyTap', usage: 0, modifiers: 15 },
    { type: 'keyHold', usage: 0x73, modifiers: 9 },
    { type: 'mouseClick', buttons: 1 },
    { type: 'mouseClick', buttons: 7, clicks: 2 },
    { type: 'mouseHold', buttons: 4 },
    { type: 'mouseToggle', buttons: 2 },
    { type: 'scroll', delta: -127 },
    { type: 'scroll', delta: 127 },
    { type: 'consumer', usage: 0xe9 },
    { type: 'consumer', usage: 0xfff },
    { type: 'consumerHold', usage: 0xe9 },
    { type: 'consumerHold', usage: 0xfff },
    { type: 'scroll', delta: 1, hold: true },
    { type: 'ledControl', command: 'commonPresetRelative', value: 1 },
    { type: 'string', text: 'hello\tworld\n' },
    { type: 'string', text: '' },
    { type: 'setLayer', layer: 1 },
    { type: 'oneShotSetLayer', layer: 1 },
    { type: 'oneShotRelativeLayer', offset: -1 },
    { type: 'momentaryLayer', layer: 2 },
    { type: 'relativeLayer', offset: -3 },
    { type: 'mouseX', delta: -5 },
    { type: 'mouseY', delta: 100 },
    { type: 'mouseX', delta: -1, hold: true },
    { type: 'mouseY', delta: 127, hold: true },
  ];
  it('covers every supported code', () => {
    const types = new Set(samples.map((s) => s.type));
    for (const d of ACTION_DESCRIPTORS) expect(types.has(d.type)).toBe(true);
  });
  it('round-trips as key bindings', () => {
    // Keep each batch within 128 bytes, including the shared text pool.
    for (let start = 0; start < samples.length; start += 24) {
      const profile = defaultProfile(VARIANT_SIX_KEYS);
      profile.layers = [0, 1, 2, 3].map(() => emptyLayer(VARIANT_SIX_KEYS));
      samples.slice(start, start + 24).forEach((a, i) => {
        profile.layers[Math.floor(i / 6)]!.keys[i % 6] = a;
      });
      expect(validateProfile(profile)).toEqual([]);
      const decoded = decodeImage(encodeProfile(profile));
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(decoded.profile).toEqual(profile);
    }
  });
  it('blank actions are valid for buttons', () => {
    for (const d of ACTION_DESCRIPTORS) {
      const profile = defaultProfile(VARIANT_SIX_KEYS);
      profile.layers[0]!.keys[0] = blankAction(d.type);
      expect(validateProfile(profile)).toEqual([]);
    }
  });
});

describe('pointer hold auxiliary bit', () => {
  it('keeps existing tap bytes and uses only auxiliary bit 0 for hold', () => {
    const profile = defaultProfile(VARIANT_SIX_KEYS);
    profile.layers[0]!.keys[0] = { type: 'mouseX', delta: -1 };
    let image = encodeProfile(profile);
    expect([...image.subarray(9, 11)]).toEqual([0x0d, 0xff]);
    profile.layers[0]!.keys[0] = { type: 'mouseX', delta: -1, hold: true };
    image = encodeProfile(profile);
    expect([...image.subarray(9, 11)]).toEqual([0x1d, 0xff]);
    expect(image[2]).toBe(8);
    image[9] = 0x2d;
    sealImage(image);
    expect(decodeImage(image).ok).toBe(false);
  });

  it('rejects hold on rotation in both the editor and decoder', () => {
    const profile = defaultProfile(VARIANT_SIX_KEYS);
    profile.layers[0]!.clockwise = { type: 'mouseY', delta: 1 };
    const image = encodeProfile(profile);
    image[23] = 0x1e;
    sealImage(image);
    expect(decodeImage(image).ok).toBe(false);
    profile.layers[0]!.clockwise = { type: 'mouseY', delta: 1, hold: true };
    expect(validateProfile(profile).some((issue) => issue.message.includes('release'))).toBe(true);
    expect(() => encodeProfile(profile)).toThrow();
  });

  it('round-trips hold on the encoder button and chords', () => {
    const profile = defaultProfile(VARIANT_THREE_KEYS);
    profile.layers[0]!.encoderButton = { type: 'mouseY', delta: -127, hold: true };
    profile.chords = [{ layer: 0, keyA: 0, keyB: 1, global: false, action: { type: 'mouseX', delta: 1, hold: true } }];
    const decoded = decodeImage(encodeProfile(profile));
    expect(decoded.ok && decoded.profile).toEqual(profile);
  });
});

describe('relative layer action', () => {
  it('round-trips signed offsets, including the legacy zero byte', () => {
    for (let offset = -6; offset <= 6; offset++) {
      const profile = defaultProfile(VARIANT_SIX_KEYS);
      profile.layers[0]!.keys[0] = { type: 'relativeLayer', offset };
      const image = encodeProfile(profile);
      expect(image[9]).toBe(0x0c);
      expect(image[10]).toBe(offset & 0xff);
      const decoded = decodeImage(image);
      expect(decoded.ok && decoded.profile.layers[0]!.keys[0]).toEqual({ type: 'relativeLayer', offset });
    }
  });
  it('rejects offsets outside -6 through 6', () => {
    for (const byte of [7, 0xf9]) {
      const image = encodeProfile(defaultProfile(VARIANT_SIX_KEYS));
      image[9] = 0x0c;
      image[10] = byte;
      sealImage(image);
      expect(decodeImage(image).ok).toBe(false);
    }
  });
  it('wraps the target preview for any layer count', () => {
    expect(relativeTargetLayer(0, 2, 4)).toBe(2);
    expect(relativeTargetLayer(0, -1, 4)).toBe(3);
    expect(relativeTargetLayer(0, -3, 1)).toBe(0);
    expect(relativeTargetLayer(2, 0, 4)).toBe(2);
  });
});

describe('rotation restrictions', () => {
  it('rejects hold and momentary actions on rotation', () => {
    for (const a of [{ type: 'keyHold', usage: 4, modifiers: 0 }, { type: 'mouseHold', buttons: 1 }, { type: 'momentaryLayer', layer: 0 }] as Action[]) {
      const profile = defaultProfile(VARIANT_SIX_KEYS);
      profile.layers[0]!.clockwise = a;
      expect(validateProfile(profile).length).toBeGreaterThan(0);
    }
  });
  it('decoder rejects hold on rotation', () => {
    const image = encodeProfile(defaultProfile(VARIANT_SIX_KEYS));
    image[23] = 0x05; // clockwise → mouse hold
    image[24] = 1;
    sealImage(image);
    expect(decodeImage(image).ok).toBe(false);
  });
});

describe('capacity', () => {
  const table: Record<number, [number, number]> = { 1: [97, 104], 2: [75, 89], 3: [53, 74], 4: [31, 59] };
  for (const layers of [1, 2, 3, 4]) {
    it(`layers=${layers}`, () => {
      for (const variant of [VARIANT_SIX_KEYS, VARIANT_THREE_KEYS] as Variant[]) {
        const profile = defaultProfile(variant);
        profile.layers = profile.layers.slice(0, layers);
        while (profile.layers.length < layers) profile.layers.push(emptyLayer(variant));
        expect(computeCapacity(profile).remaining).toBe(table[layers]![variant as 0 | 1]);
      }
    });
  }
  it('exact fit and one-byte overflow', () => {
    const profile = defaultProfile(VARIANT_SIX_KEYS);
    profile.layers = profile.layers.slice(0, 1);
    profile.layers[0]!.encoderButton = { type: 'none' };
    profile.layers[0]!.keys[0] = { type: 'string', text: 'x'.repeat(96) }; // 97 bytes with terminator
    expect(computeCapacity(profile).remaining).toBe(0);
    expect(validateProfile(profile)).toEqual([]);
    const decoded = decodeImage(encodeProfile(profile));
    expect(decoded.ok).toBe(true);
    profile.layers[0]!.keys[0] = { type: 'string', text: 'x'.repeat(97) };
    expect(computeCapacity(profile).remaining).toBe(-1);
    expect(validateProfile(profile).some((i) => i.where === 'Storage')).toBe(true);
    expect(() => encodeProfile(profile)).toThrow();
  });
  it('shares identical strings and empty strings', () => {
    const profile = defaultProfile(VARIANT_SIX_KEYS);
    profile.layers[0]!.keys[0] = { type: 'string', text: 'abc' };
    profile.layers[0]!.keys[1] = { type: 'string', text: 'abc' };
    profile.layers[0]!.keys[2] = { type: 'string', text: '' };
    profile.layers[0]!.keys[3] = { type: 'string', text: '' };
    expect(computeCapacity(profile).strings).toBe(5);
    const image = encodeProfile(profile);
    expect(image[4]).toBe(5);
    expect(image[10]).toBe(0); // first string offset
    expect(image[12]).toBe(0);
    expect(image[14]).toBe(4); // empty string offset
    const decoded = decodeImage(image);
    expect(decoded.ok && decoded.profile).toEqual(profile);
  });
  it('max chords on six-key four-layer', () => {
    const profile = defaultProfile(VARIANT_SIX_KEYS);
    profile.layers = [0, 1, 2, 3].map(() => emptyLayer(VARIANT_SIX_KEYS));
    for (let i = 0; i < 10; i++) profile.chords.push({ layer: Math.floor(i / 3), keyA: i % 3, keyB: 5, action: { type: 'relativeLayer', offset: 1 } });
    expect(computeCapacity(profile).remaining).toBe(1);
    expect(validateProfile(profile)).toEqual([]);
    const decoded = decodeImage(encodeProfile(profile));
    expect(decoded.ok).toBe(true);
    profile.chords.push({ layer: 3, keyA: 3, keyB: 4, action: { type: 'relativeLayer', offset: 1 } });
    expect(computeCapacity(profile).remaining).toBe(-2);
  });
  it('three-key four-layer holds all 12 chords', () => {
    const profile = defaultProfile(VARIANT_THREE_KEYS);
    profile.layers = [0, 1, 2, 3].map(() => emptyLayer(VARIANT_THREE_KEYS));
    for (let l = 0; l < 4; l++) for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) profile.chords.push({ layer: l, keyA: a!, keyB: b!, action: { type: 'relativeLayer', offset: 1 } });
    expect(computeCapacity(profile).remaining).toBe(23);
    const decoded = decodeImage(encodeProfile(profile));
    expect(decoded.ok && decoded.profile.chords.length).toBe(12);
  });
});

describe('chords', () => {
  it('sorts by identifier and round-trips', () => {
    const profile = defaultProfile(VARIANT_SIX_KEYS);
    profile.chords = [
      { layer: 1, keyA: 0, keyB: 1, global: false, action: { type: 'keyTap', usage: 5, modifiers: 0 } },
      { layer: 0, keyA: 4, keyB: 5, global: false, action: { type: 'string', text: 'chord' } },
      { layer: 0, keyA: 0, keyB: 2, global: false, action: { type: 'mouseClick', buttons: 2 } },
    ];
    const image = encodeProfile(profile);
    const chordBase = 9 + 22 * 2;
    expect(image[chordBase]).toBe(1); // (0,2) on layer 0
    expect(image[chordBase + 3]).toBe(14); // (4,5) on layer 0
    expect(image[chordBase + 6]).toBe(0x10); // (0,1) on layer 1
    const decoded = decodeImage(image);
    expect(decoded.ok && decoded.profile.chords).toEqual([profile.chords[2], profile.chords[1], profile.chords[0]]);
  });
  it('rejects duplicates and dangling layers', () => {
    const profile = defaultProfile(VARIANT_SIX_KEYS);
    profile.chords = [
      { layer: 0, keyA: 0, keyB: 1, global: false, action: { type: 'relativeLayer', offset: 1 } },
      { layer: 0, keyA: 0, keyB: 1, global: false, action: { type: 'relativeLayer', offset: 1 } },
      { layer: 2, keyA: 0, keyB: 1, global: false, action: { type: 'relativeLayer', offset: 1 } },
    ];
    expect(validateProfile(profile).length).toBe(2);
  });
});

describe('decoder rejections', () => {
  const base = () => encodeProfile(defaultProfile(VARIANT_SIX_KEYS));
  it('bad CRC', () => {
    const image = base();
    image[6] = image[6]! ^ 1;
    expect(decodeImage(image)).toMatchObject({ ok: false, reason: 'bad-crc' });
  });
  it('unsupported version', () => {
    const image = base();
    image[2] = 9;
    sealImage(image);
    expect(decodeImage(image)).toMatchObject({ ok: false, reason: 'unsupported-version' });
  });
  it('no magic', () => {
    expect(decodeImage(new Uint8Array(128))).toMatchObject({ ok: false, reason: 'no-magic' });
  });
  it('reserved header bits in older formats', () => {
    const image = base();
    legacyActionCodes(image);
    image[2] = 4;
    image[8] = 0x48;
    sealImage(image);
    expect(decodeImage(image).ok).toBe(false);
  });
  it('bad key usage', () => {
    const image = base();
    image[9] = 0x02;
    image[10] = 0xe0;
    sealImage(image);
    expect(decodeImage(image).ok).toBe(false);
  });
  it('non-zero padding', () => {
    const image = base();
    image[127] = 1;
    sealImage(image);
    expect(decodeImage(image).ok).toBe(false);
  });
  it('string offset inside a string', () => {
    const profile = defaultProfile(VARIANT_SIX_KEYS);
    profile.layers[0]!.keys[0] = { type: 'string', text: 'AB' };
    const image = encodeProfile(profile);
    image[10] = 1;
    sealImage(image);
    expect(decodeImage(image).ok).toBe(false);
  });
  it('reserved LED nibble on three-key', () => {
    const image = encodeProfile(defaultProfile(VARIANT_THREE_KEYS));
    image[22] = 0xf2;
    sealImage(image);
    expect(decodeImage(image).ok).toBe(false);
  });
  it('chord window values 0–15 map to 0–75 ms', () => {
    for (let w = 0; w <= 15; w++) {
      const profile = defaultProfile(VARIANT_SIX_KEYS);
      profile.chordWindow = w;
      const decoded = decodeImage(encodeProfile(profile));
      expect(decoded.ok && decoded.profile.chordWindow).toBe(w);
    }
  });
  it('storedCrc reads little-endian', () => {
    const image = base();
    image[6] = 0xba;
    image[7] = 0xd3;
    expect(storedCrc(image)).toBe(0xd3ba);
  });
});

describe('layer count changes', () => {
  it('removing a layer flags dangling references', () => {
    const profile: Profile = defaultProfile(VARIANT_SIX_KEYS);
    profile.layers = profile.layers.slice(0, 1);
    profile.layers[0]!.encoderButton = { type: 'none' };
    profile.layers.push(emptyLayer(VARIANT_SIX_KEYS));
    profile.layers[0]!.keys[0] = { type: 'setLayer', layer: 1 };
    profile.startupLayer = 1;
    expect(validateProfile(profile)).toEqual([]);
    const smaller = cloneProfile(profile);
    smaller.layers.pop();
    const issues = validateProfile(smaller);
    expect(issues.length).toBe(2);
  });
});

describe('expanded layers', () => {
  it.each([0, 1] as Variant[])('round-trips every startup layer and high-layer chords for variant %s', (variant) => {
    const count = variant ? 7 : 5;
    const profile = defaultProfile(variant);
    profile.layers = Array.from({ length: count }, () => emptyLayer(variant));
    profile.layers[0]!.keys[0] = { type: 'setLayer', layer: count - 1 };
    profile.layers[0]!.keys[1] = { type: 'oneShotSetLayer', layer: count - 1 };
    profile.layers[0]!.keys[2] = { type: 'momentaryLayer', layer: count - 1 };
    profile.layers[count - 1]!.clockwise = { type: 'relativeLayer', offset: 6 };
    profile.layers[count - 1]!.counterclockwise = { type: 'oneShotRelativeLayer', offset: -6 };
    profile.chords = [
      { layer: count - 1, keyA: 0, keyB: 1, global: false, action: { type: 'setLayer', layer: count - 1 } },
      { layer: count - 1, keyA: 0, keyB: 2, global: true, action: { type: 'setLayer', layer: 0 } },
    ];
    for (let startup = 0; startup < count; startup++) {
      profile.startupLayer = startup;
      const image = encodeProfile(profile);
      expect(image[3]).toBe((count - 1) | (startup << 3));
      const chordBase = 9 + (variant ? 15 : 22) * count;
      expect(image[chordBase]).toBe((count - 1) << 4);
      expect(image[chordBase + 3]).toBe(0x81 | ((count - 1) << 4));
      const decoded = decodeImage(image);
      expect(decoded.ok && decoded.profile).toEqual(profile);
    }
    expect(computeCapacity(profile).remaining).toBe(variant ? 8 : 3);
    profile.layers.push(emptyLayer(variant));
    expect(() => encodeProfile(profile)).toThrow();
  });
  it.each([2, 3])('migrates v%s startup and chord layer fields without shifting the old meaning', (version) => {
    const profile = defaultProfile(1);
    profile.layers = Array.from({ length: 4 }, () => emptyLayer(1));
    profile.startupLayer = 3;
    profile.chords = [{ layer: 3, keyA: 0, keyB: 1, global: true, action: { type: 'setLayer', layer: 3 } }];
    const image = encodeProfile(profile);
    legacyActionCodes(image);
    image[2] = version;
    image[8] = image[8]! & 15;
    image[3] = 3 | (3 << 2);
    sealImage(image);
    const decoded = decodeImage(image);
    expect(decoded.ok && decoded.profile).toEqual(profile);
  });
});
