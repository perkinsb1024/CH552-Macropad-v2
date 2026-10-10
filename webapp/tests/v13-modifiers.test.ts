import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createFirmwareValidator } from './firmware-validator.mjs';
import { defaultProfile } from '../src/model/defaults';
import { encodeAction, encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { exportProfile, importProfile } from '../src/io/json';
import { draftKey, loadDraft, storeDraft } from '../src/io/drafts';
import { actionNeedsRelease, actionTooltip, summarize } from '../src/model/actions';
import type { Action } from '../src/model/types';
let validator: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { validator = createFirmwareValidator(); });
afterAll(() => validator.close());
afterEach(() => vi.unstubAllGlobals());
const types = ['modifierToggle', 'modifierDown', 'modifierUp'] as const;

it.each([0, 1] as const)('round-trips every persistent modifier mask at all action sites on variant %s', variant => {
  for (const [mode, type] of types.entries()) for (let modifiers = 1; modifiers <= 15; modifiers++) {
    const action: Action = { type, modifiers };
    expect(encodeAction(action, new Map())).toEqual([mode << 4 | 4, modifiers]);
    expect(actionNeedsRelease(action)).toBe(false);
    const p = defaultProfile(variant); p.layers = [p.layers[0]!];
    p.layers[0]!.keys.fill(action); p.layers[0]!.encoderButton = action;
    p.layers[0]!.clockwise = action; p.layers[0]!.counterclockwise = action;
    p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: true, action }];
    p.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action, resumeAction: action }];
    p.macros = [{ actions: [action, { type: 'consumer', usage: 0x6f }, { type: 'modifierUp', modifiers }] }];
    p.layers[0]!.keys[0] = { type: 'macro', macro: 0, repeats: 2 };
    const image = encodeProfile(p);
    expect(decodeImage(image)).toEqual({ ok: true, profile: p });
    expect(validator.accepts(image, variant)).toBe(true);
    expect(importProfile(exportProfile(p)).profile).toEqual(p);
  }
  expect(summarize({ type: 'modifierDown', modifiers: 6 })).toBe('Down Shift + Alt');
  expect(actionTooltip({ type: 'modifierUp', modifiers: 6 })).toBe('Modifier up: Shift + Alt');
});

it.each([0, 1] as const)('matches firmware reserved modes and mask validation on variant %s', variant => {
  const p = defaultProfile(variant); p.layers = [p.layers[0]!];
  p.chords = [{ layer: 0, keyA: 0, keyB: 1, action: { type: 'none' } }];
  p.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: { type: 'none' }, resumeAction: { type: 'none' } }];
  p.macros = [{ actions: [{ type: 'modifierDown', modifiers: 1 }] }];
  const end = variant ? 24 : 31;
  for (const offset of [9, variant ? 15 : 21, variant ? 17 : 23, variant ? 19 : 25, end + 1, end + 4, end + 6, end + 9]) {
    for (let aux = 0; aux < 16; aux++) for (const mask of [0, 1, 15, 16, 255]) {
      const image = encodeProfile(p); image.set([aux << 4 | 4, mask], offset); sealImage(image);
      const valid = aux <= 2 && mask >= 1 && mask <= 15;
      expect(decodeImage(image).ok).toBe(valid);
      expect(validator.accepts(image, variant)).toBe(valid);
    }
  }
}, 20000);

it.each([0, 1] as const)('migrates genuine v12 mouse holds without interpreting them as modifiers on variant %s', variant => {
  const p = defaultProfile(variant); p.layers = [p.layers[0]!];
  const hold: Action = { type: 'mouseHold', buttons: 0x88 };
  p.layers[0]!.keys[0] = hold; p.layers[0]!.encoderButton = hold;
  p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: false, action: hold }];
  const image = encodeProfile(p); image[2] = 12;
  const offsets = [9, variant ? 15 : 21, (variant ? 24 : 31) + 1];
  for (const offset of offsets) image[offset] = 4;
  sealImage(image);
  const read = decodeImage(image); expect(read).toEqual({ ok: true, profile: p });
  if (!read.ok) throw new Error(read.detail);
  const migrated = encodeProfile(read.profile);
  expect(migrated[2]).toBe(13);
  for (const offset of offsets) expect(migrated[offset]).toBe(0x35);
  expect(validator.accepts(migrated, variant)).toBe(true);
  const json = JSON.parse(exportProfile(p)); json.version = 12;
  expect(importProfile(JSON.stringify(json)).profile).toEqual(p);
  const oldKey = `universal-macropad:format-v12:draft:${variant ? 'three-key' : 'six-key'}`;
  const original = JSON.stringify({ formatVersion: 12, profile: p, meta: { profileName: 'Hold' }, savedAt: 'old' });
  const storage = new Map([[oldKey, original]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  expect(loadDraft(variant)).toMatchObject({ formatVersion: 13, profile: p });
  storeDraft(p, { profileName: 'Hold' });
  expect(loadDraft(variant)?.profile).toEqual(p);
  expect(storage.get(oldKey)).toBe(original);
  expect(storage.has(draftKey(variant))).toBe(true);
});

it.each(types)('rejects invalid editor masks and pre-v13 JSON/drafts for %s', type => {
  const p = defaultProfile(0); p.layers[0]!.keys[0] = { type, modifiers: 6 };
  const json = JSON.parse(exportProfile(p)); json.version = 12;
  expect(() => importProfile(JSON.stringify(json))).toThrow('version 13');
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ formatVersion: 12, profile: p }) });
  expect(loadDraft(0)).toBeNull();
  for (const modifiers of [0, 16, -1, 1.5, NaN]) {
    p.layers[0]!.keys[0] = { type, modifiers };
    expect(() => encodeProfile(p)).toThrow('modifier');
  }
});
