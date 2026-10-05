import { afterAll, beforeAll, expect, it } from 'vitest';
import { createFirmwareValidator } from './firmware-validator.mjs';
import { legacyTextCodes, legacyActionCodes } from './legacy-image';
import { defaultProfile } from '../src/model/defaults';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { exportProfile, importProfile } from '../src/io/json';
import { actionNeedsRelease, summarize } from '../src/model/actions';
import type { Action } from '../src/model/types';
import { SimulatedDevice } from '../src/protocol/simulator';
import { ConfigClient } from '../src/protocol/client';

let validator: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { validator = createFirmwareValidator(); });
afterAll(() => validator.close());

it.each([0, 1] as const)('migrates v7 text in keys, wheel, chords and both timer slots on variant %s', variant => {
  const p = defaultProfile(variant);
  const text: Action = { type: 'string', text: 'abc' };
  p.layers[0]!.keys[0] = text;
  p.layers[0]!.encoderButton = text;
  p.layers[0]!.clockwise = text;
  p.layers[0]!.keys[1] = { type: 'consumer', usage: 0xfff };
  p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: true, action: text }];
  p.timedActions = [{ ticks: 64, resetOnInput: true, consumeInput: true, action: text, resumeAction: text }];
  const modern = encodeProfile(p);
  expect(modern.slice(9, 11)).toEqual(new Uint8Array([0x10, 0]));
  const old = modern.slice(); legacyTextCodes(old); old[2] = 7; sealImage(old);
  expect(old[9]).toBe(9);
  expect(validator.accepts(old, variant)).toBe(false);
  const decoded = decodeImage(old);
  expect(decoded).toEqual({ ok: true, profile: p });
  if (!decoded.ok) throw new Error(decoded.detail);
  expect(encodeProfile(decoded.profile)).toEqual(modern);
  expect(validator.accepts(modern, variant)).toBe(true);
  const meta = { profileName: 'Work', layerNames: ['Tools', 'Media'] };
  const json = JSON.parse(exportProfile(p, meta)); json.version = 7;
  expect(importProfile(JSON.stringify(json))).toEqual({ profile: p, meta });
});

it.each([0, 1] as const)('round-trips Consumer Hold endpoints and high usage bits with firmware on variant %s', variant => {
  for (const usage of [1, 0xff, 0x100, 0xabc, 0xfff]) {
    const p = defaultProfile(variant);
    p.layers[0]!.keys[0] = { type: 'consumerHold', usage };
    const image = encodeProfile(p);
    expect([...image.slice(9, 11)]).toEqual([((usage >> 8) << 4) | 9, usage & 255]);
    expect(decodeImage(image)).toEqual({ ok: true, profile: p });
    expect(validator.accepts(image, variant)).toBe(true);
    expect(importProfile(exportProfile(p)).profile).toEqual(p);
    expect(actionNeedsRelease(p.layers[0]!.keys[0]!)).toBe(true);
    expect(summarize(p.layers[0]!.keys[0]!)).toContain('Hold');
  }
});

it.each([0, 1] as const)('round-trips held scrolling on keys, chords and wheel press on variant %s', variant => {
  const p = defaultProfile(variant);
  const hold: Action = { type: 'scroll', delta: -127, hold: true };
  p.layers[0]!.keys[0] = hold;
  p.layers[0]!.encoderButton = hold;
  p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: false, action: hold }];
  const image = encodeProfile(p);
  expect([...image.slice(9, 11)]).toEqual([0x47, 0x81]);
  expect(decodeImage(image)).toEqual({ ok: true, profile: p });
  expect(validator.accepts(image, variant)).toBe(true);
  expect(importProfile(exportProfile(p)).profile).toEqual(p);
  expect(summarize(hold)).toBe('Scroll up 127 (hold)');
});

it.each([[0x04, 1], [0x14, 1], [0xF4, 7], [0x20, 0], [0, 1], [0x10, 0], [9, 0], [0x17, 1], [0x27, 1], [0x87, 1]])('rejects invalid/reserved action bytes %s, %s in both validators', (first, second) => {
  const image = encodeProfile(defaultProfile(0));
  image.set([first, second], 9); sealImage(image);
  expect(decodeImage(image).ok).toBe(false);
  expect(validator.accepts(image, 0)).toBe(false);
});

it.each([0x09, 0x47])('rejects release-dependent encoding %s on rotation and both timer slots', first => {
  const p = defaultProfile(0);
  p.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: { type: 'none' }, resumeAction: { type: 'none' } }];
  for (const offset of [23, 25, 54, 56]) {
    const image = encodeProfile(p); image.set([first, 1], offset); sealImage(image);
    expect(decodeImage(image).ok).toBe(false);
    expect(validator.accepts(image, 0)).toBe(false);
  }
});

it('distinguishes Nothing from empty Type Text, and rejects unsupported acceleration imports', () => {
  const p = defaultProfile(0);
  p.layers[0]!.keys[0] = { type: 'none' };
  p.layers[0]!.keys[1] = { type: 'string', text: '' };
  const image = encodeProfile(p);
  expect([...image.slice(9, 13)]).toEqual([0, 0, 0x10, 0]);
  expect(decodeImage(image)).toEqual({ ok: true, profile: p });
  expect(validator.accepts(image, 0)).toBe(true);
  const json = JSON.parse(exportProfile(p));
  json.layers[0].keys[0] = { type: 'scroll', delta: 1, acceleration: 'slow' };
  expect(() => importProfile(JSON.stringify(json))).toThrow('acceleration is unavailable');
});

it.each([{ type: 'consumerHold', usage: 1 }, { type: 'scroll', delta: 1, hold: true }] as Action[])('rejects v8-only semantics in older JSON: %o', action => {
  const p = defaultProfile(0); p.layers[0]!.keys[0] = action;
  const json = JSON.parse(exportProfile(p)); json.version = 7;
  expect(() => importProfile(JSON.stringify(json))).toThrow('version 8');
});

it('keeps legacy flash readable but inactive until an explicit v8 save', async () => {
  const p = defaultProfile(0); p.layers[0]!.keys[0] = { type: 'string', text: 'Work' };
  const old = encodeProfile(p); legacyTextCodes(old); old[2] = 7; sealImage(old);
  const device = new SimulatedDevice({ variant: 0, initialImage: old });
  const client = new ConfigClient(device);
  expect((await client.getStatus()).flashValid).toBe(false);
  expect(await client.readFlash()).toEqual(old);
  expect(decodeImage(old)).toEqual({ ok: true, profile: p });
  await expect(client.saveImage(old)).rejects.toThrow();
  expect(await client.readFlash()).toEqual(old);
  await client.saveImage(encodeProfile(p));
  expect((await client.getStatus()).flashValid).toBe(true);
  expect(decodeImage(await client.readActive())).toEqual({ ok: true, profile: p });
  await device.close();
});

it.each([0, 1] as const)('round-trips all click counts in every binding with firmware on variant %s', variant => {
  for (let clicks = 1; clicks <= 16; clicks++) {
    const p = defaultProfile(variant);
    const click: Action = { type: 'mouseClick', buttons: 7, ...(clicks > 1 ? { clicks } : {}) };
    p.layers[0]!.keys[0] = click;
    p.layers[0]!.encoderButton = click;
    p.layers[0]!.clockwise = click;
    p.layers[0]!.counterclockwise = click;
    p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: false, action: click }];
    p.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: click, resumeAction: click }];
    const image = encodeProfile(p);
    expect([...image.slice(9, 11)]).toEqual([((clicks - 1) << 4) | 3, 7]);
    expect(decodeImage(image)).toEqual({ ok: true, profile: p });
    expect(validator.accepts(image, variant)).toBe(true);
    expect(importProfile(exportProfile(p)).profile).toEqual(p);
    expect(actionNeedsRelease(click)).toBe(false);
  }
});

it.each([2, 3, 4, 5, 6, 7])('migrates format %s double clicks to the v8 click encoding', version => {
  const p = defaultProfile(0);
  p.layers[0]!.keys[0] = { type: 'mouseClick', buttons: 1, clicks: 2 };
  p.layers[0]!.encoderButton = { type: 'none' };
  const image = encodeProfile(p);
  if (version < 6) legacyActionCodes(image);
  image[2] = version;
  image[9] = 4;
  if (version < 5) image[8] = image[8]! & 15;
  sealImage(image);
  const decoded = decodeImage(image);
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) throw new Error(decoded.detail);
  expect(decoded.profile.layers[0]!.keys[0]).toEqual({ type: 'mouseClick', buttons: 1, clicks: 2 });
  const migrated = encodeProfile(decoded.profile);
  expect(migrated[9]).toBe(0x13);
  expect(validator.accepts(migrated, 0)).toBe(true);
  image[9] = 0x13; sealImage(image);
  expect(decodeImage(image).ok).toBe(false); // Auxiliary count is new in v8.
});

it.each([0, 17, -1, 1.5, NaN])('rejects invalid click count %s before encoding', clicks => {
  const p = defaultProfile(0);
  p.layers[0]!.keys[0] = { type: 'mouseClick', buttons: 1, clicks };
  expect(() => encodeProfile(p)).toThrow(/Click count/);
});
