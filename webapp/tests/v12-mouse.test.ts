import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createFirmwareValidator } from './firmware-validator.mjs';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { encodeProfile, encodeAction } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { exportProfile, importProfile } from '../src/io/json';
import { draftKey, loadDraft, clearDraft } from '../src/io/drafts';
import { actionNeedsRelease, summarize, actionTooltip } from '../src/model/actions';
import { computeCapacity } from '../src/model/capacity';
import type { Action } from '../src/model/types';
let validator: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { validator = createFirmwareValidator(); });
afterAll(() => validator.close());
afterEach(() => vi.unstubAllGlobals());

it.each([0, 1] as const)('round-trips all 255 masks and new modes on variant %s', variant => {
  for (const type of ['mouseClick', 'mouseHold', 'mouseToggle', 'mouseDown', 'mouseUp'] as const) {
    for (let buttons = 1; buttons <= 255; buttons++) {
      const p = defaultProfile(variant); p.layers[0]!.keys[0] = { type, buttons };
      const image = encodeProfile(p);
      expect(decodeImage(image)).toEqual({ ok: true, profile: p });
      expect(importProfile(exportProfile(p)).profile).toEqual(p);
      if (buttons === 128 || buttons === 255 || buttons === 24) expect(validator.accepts(image, variant)).toBe(true);
    }
  }
  expect(encodeAction({ type: 'mouseDown', buttons: 128 }, new Map())).toEqual([0x15, 128]);
  expect(encodeAction({ type: 'mouseUp', buttons: 255 }, new Map())).toEqual([0x25, 255]);
  expect(summarize({ type: 'mouseDown', buttons: 0x88 })).toBe('Down Button 4+Button 8');
  expect(actionTooltip({ type: 'mouseUp', buttons: 128 })).toBe('Mouse up: Button 8');
});

it.each([0, 1] as const)('matches firmware reserved-mode validation at every trigger on variant %s', variant => {
  for (const slot of ['key', 'rotation', 'chord', 'expiry', 'resume', 'macro']) {
    for (let aux = 0; aux < 16; aux++) {
      const p = defaultProfile(variant); p.layers = [p.layers[0]!];
      p.chords = [{ layer: 0, keyA: 0, keyB: 1, action: { type: 'none' } }];
      p.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: { type: 'none' }, resumeAction: { type: 'none' } }];
      p.macros = [{ actions: [{ type: 'mouseDown', buttons: 128 }] }];
      const image = encodeProfile(p);
      const timer = (variant ? 24 : 31) + 3;
      const offset = slot === 'key' ? 9 : slot === 'rotation' ? (variant ? 17 : 23) : slot === 'chord' ? timer - 2 : slot === 'expiry' ? timer + 1 : slot === 'resume' ? timer + 3 : timer + 6;
      image.set([aux << 4 | 5, 128], offset); sealImage(image);
      expect(decodeImage(image).ok).toBe(aux <= 2);
      expect(validator.accepts(image, variant)).toBe(aux <= 2);
      image[offset + 1] = 0; sealImage(image);
      expect(decodeImage(image).ok).toBe(false);
      expect(validator.accepts(image, variant)).toBe(false);
    }
  }
}, 20000);

it.each([0, 1] as const)('preserves drag macro references, pauses and repeats through storage relocation on variant %s', variant => {
  const p = defaultProfile(variant); p.layers = [p.layers[0]!];
  p.macros = [{ actions: [{ type: 'mouseDown', buttons: 128 }, { type: 'mouseX', delta: 10 }, { type: 'pause', ticks: 2 }, { type: 'mouseUp', buttons: 128 }] }];
  p.layers[0]!.clockwise = { type: 'macro', macro: 0, repeats: 16 };
  p.timedActions = [{ ticks: 2048, resetOnInput: true, consumeInput: false, action: { type: 'mouseDown', buttons: 24 }, resumeAction: { type: 'mouseUp', buttons: 24 } }];
  for (const type of ['mouseDown', 'mouseUp'] as const) expect(actionNeedsRelease({ type, buttons: 128 })).toBe(false);
  const first = encodeProfile(p), bytes = computeCapacity(p).used;
  p.layers.push(emptyLayer(variant));
  p.layers[0]!.keys[0] = { type: 'string', text: 'Drag' };
  p.chords.push({ layer: 0, keyA: 0, keyB: 1, global: false, action: { type: 'macro', macro: 0, repeats: 2 } });
  const relocated = encodeProfile(p);
  expect(relocated[variant ? 18 : 24]).toBeGreaterThan(first[variant ? 18 : 24]!);
  expect(computeCapacity(p).used).toBe(bytes + (variant ? 15 : 22) + 5 + 3);
  expect(decodeImage(relocated)).toEqual({ ok: true, profile: p });
  expect(validator.accepts(relocated, variant)).toBe(true);
});

it('migrates v11 macro, text and timer data without altering action bytes or storage', () => {
  const p = defaultProfile(0); p.layers = [p.layers[0]!];
  p.macros = [{ actions: [{ type: 'mouseToggle', buttons: 7 }, { type: 'pause', ticks: 255 }, { type: 'string', text: 'Go\n' }] }];
  p.layers[0]!.keys[0] = { type: 'macro', macro: 0, repeats: 16 };
  p.timedActions = [{ ticks: 2048, resetOnInput: true, consumeInput: false, action: { type: 'macro', macro: 0, repeats: 1 }, resumeAction: { type: 'mouseToggle', buttons: 3 } }];
  const old = encodeProfile(p); old[2] = 11; sealImage(old);
  const read = decodeImage(old); expect(read).toEqual({ ok: true, profile: p });
  if (!read.ok) throw new Error(read.detail);
  const current = encodeProfile(read.profile);
  expect(current.slice(8)).toEqual(old.slice(8));
  const json = JSON.parse(exportProfile(p)); json.version = 11;
  expect(importProfile(JSON.stringify(json)).profile).toEqual(p);
  const key = 'universal-macropad:format-v11:draft:six-key';
  const original = JSON.stringify({ formatVersion: 11, profile: p, meta: { profileName: 'Drag' }, savedAt: 'old' });
  const storage = new Map([[key, original]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  expect(loadDraft(0)).toMatchObject({ formatVersion: 12, profile: p, savedAt: 'old' });
  expect(storage.get(key)).toBe(original); expect(storage.has(draftKey(0))).toBe(false);
  clearDraft(0); expect(loadDraft(0)).toBeNull(); expect(storage.get(key)).toBe(original);
});

it.each(['mouseDown', 'mouseUp', 'mouseClick', 'mouseToggle', 'mouseHold'] as const)('rejects v12-only %s encodings in older binary/JSON/draft profiles', type => {
  const p = defaultProfile(0); p.layers[0]!.keys[0] = { type, buttons: 128 };
  const image = encodeProfile(p); image[2] = 11; sealImage(image);
  expect(decodeImage(image).ok).toBe(false);
  const json = JSON.parse(exportProfile(p)); json.version = 11;
  expect(() => importProfile(JSON.stringify(json))).toThrow('version 12');
  const raw = JSON.stringify({ formatVersion: 11, profile: p });
  vi.stubGlobal('localStorage', { getItem: () => raw }); expect(loadDraft(0)).toBeNull();
  // New auxiliary modes reject even with an old three-button mask.
  if (type === 'mouseDown' || type === 'mouseUp') { image[10] = 1; sealImage(image); expect(decodeImage(image).ok).toBe(false); }
});
