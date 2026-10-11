import { legacyV10Codes } from './legacy-image';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createFirmwareValidator } from './firmware-validator.mjs';
import { defaultProfile } from '../src/model/defaults';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { exportProfile, importProfile } from '../src/io/json';
import { summarize } from '../src/model/actions';

let validator: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { validator = createFirmwareValidator(); });
afterAll(() => validator.close());

it.each([0, 1] as const)('validates every scroll auxiliary nibble and signed endpoint on variant %s', variant => {
  for (const rotation of [false, true]) for (let aux = 0; aux < 16; aux++) for (const delta of [-128, -127, -1, 1, 127]) {
    const image = encodeProfile(defaultProfile(variant));
    image.set([(aux << 4) | 6, delta & 255], rotation ? (variant ? 17 : 23) : 9);
    sealImage(image);
    const expected = !(aux & 3) && !(rotation && (aux & 4)) && delta !== -128;
    expect(decodeImage(image).ok, `aux=${aux}, rotation=${rotation}, delta=${delta}`).toBe(expected);
    expect(validator.accepts(image, variant)).toBe(expected);
  }
});

it.each([0, 1] as const)('round-trips horizontal buttons, chords, rotation and both timer slots on variant %s', variant => {
  const p = defaultProfile(variant);
  const tap = { type: 'scroll', delta: -127, horizontal: true } as const;
  const hold = { ...tap, hold: true };
  p.layers[0]!.keys[0] = hold;
  p.layers[0]!.encoderButton = hold;
  p.layers[0]!.clockwise = tap;
  p.layers[0]!.counterclockwise = { ...tap, delta: 127 };
  p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: true, action: hold }];
  p.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: tap, resumeAction: tap }];
  const image = encodeProfile(p);
  expect(image[2]).toBe(13);
  expect(image[9]).toBe(0xc6);
  expect(decodeImage(image)).toEqual({ ok: true, profile: p });
  expect(validator.accepts(image, variant)).toBe(true);
  expect(importProfile(exportProfile(p)).profile).toEqual(p);
  expect(summarize(hold)).toBe('Scroll left 127 (hold)');
  expect(summarize(p.layers[0]!.counterclockwise)).toBe('Scroll right 127');
  const json = JSON.parse(exportProfile(p)); json.version = 8;
  expect(() => importProfile(JSON.stringify(json))).toThrow('Horizontal scrolling requires profile version 9');
  image[2] = 8; sealImage(image);
  expect(decodeImage(image).ok).toBe(false);
  p.timedActions[0]!.action = hold;
  expect(() => encodeProfile(p)).toThrow();
});

it.each([0, 1] as const)('migrates v8 vertical hold and multi-click without altering action bytes on variant %s', variant => {
  const p = defaultProfile(variant);
  p.layers[0]!.keys[0] = { type: 'scroll', delta: 2, hold: true };
  p.layers[0]!.keys[1] = { type: 'mouseClick', buttons: 1, clicks: 16 };
  const latest = encodeProfile(p), old = latest.slice(); legacyV10Codes(old); old[2] = 8; sealImage(old);
  expect(decodeImage(old)).toEqual({ ok: true, profile: p });
  expect(validator.accepts(old, variant)).toBe(false);
  const decoded = decodeImage(old); if (!decoded.ok) throw new Error(decoded.detail);
  expect(encodeProfile(decoded.profile)).toEqual(latest);
  const json = JSON.parse(exportProfile(p)); json.version = 8;
  expect(importProfile(JSON.stringify(json)).profile).toEqual(p);
});
