import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createFirmwareValidator } from './firmware-validator.mjs';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { computeCapacity } from '../src/model/capacity';
import { validateProfile } from '../src/model/validate';
import { exportProfile, importProfile } from '../src/io/json';
import { storeDraft, loadDraft } from '../src/io/drafts';
import type { Action, Profile } from '../src/model/types';
import { legacyV10Codes } from './legacy-image';
import { ConfigClient } from '../src/protocol/client';
import { SimulatedDevice } from '../src/protocol/simulator';
import { layerReachabilityWarnings } from '../src/model/reachability';
let validator: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { validator = createFirmwareValidator(); });
afterAll(() => validator.close());
const tap: Action = { type: 'keyTap', usage: 4, modifiers: 0 };
function oneLayer(variant: 0 | 1): Profile {
  const p = defaultProfile(variant); p.layers = [emptyLayer(variant)]; return p;
}
it.each([0, 1] as const)('round-trips all invocation sites and repeated Spotlight steps on variant %s', async variant => {
  const p = defaultProfile(variant);
  p.macros = [{ actions: [{ type: 'keyTap', usage: 0x2c, modifiers: 8 }, { type: 'pause', ticks: 16 }, { type: 'string', text: 'chrome' }, { type: 'keyTap', usage: 0x28, modifiers: 0 }] }, { actions: [tap] }];
  const invoke: Action = { type: 'macro', macro: 0, repeats: 16 };
  p.layers[0]!.keys[0] = invoke;
  p.layers[0]!.encoderButton = invoke; p.layers[0]!.clockwise = invoke; p.layers[0]!.counterclockwise = invoke;
  p.layers[0]!.keys[1] = { type: 'macro', macro: 1, repeats: 1 };
  p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: true, action: invoke }];
  p.timedActions = [{ ticks: 2048, layer: 1, resetOnInput: true, consumeInput: true, action: invoke, resumeAction: invoke }];
  const image = encodeProfile(p);
  expect(image[9]).toBe(0xff);
  expect(image[image[10]!]!).toBe(0x81);
  expect(computeCapacity(p)).toMatchObject({ macros: 14, strings: 7, timedActions: 6 });
  expect(validator.accepts(image, variant)).toBe(true);
  expect(decodeImage(image)).toEqual({ ok: true, profile: p });
  expect(importProfile(exportProfile(p)).profile).toEqual(p);
  const device = new SimulatedDevice({ variant, blankFlash: true });
  const client = new ConfigClient(device); await client.saveImage(image);
  expect(await client.readFlash()).toEqual(image); await device.close();
});
it.each([0, 1] as const)('fits the full macro tail and rejects an extra step on variant %s', variant => {
  const p = oneLayer(variant);
  p.macros = [{ actions: Array.from({ length: variant ? 52 : 48 }, () => tap) }];
  p.layers[0]!.keys[0] = { type: 'macro', macro: 0, repeats: 16 };
  const image = encodeProfile(p);
  expect(computeCapacity(p).remaining).toBe(variant ? 0 : 1);
  expect(validator.accepts(image, variant)).toBe(true);
  expect(decodeImage(image)).toEqual({ ok: true, profile: p });
  p.macros[0]!.actions.push(tap); expect(() => encodeProfile(p)).toThrow();
});
it('deduplicates strings across macros and direct bindings and remaps addresses when storage moves', () => {
  const p = oneLayer(0); p.macros = [{ actions: [{ type: 'string', text: 'same' }] }];
  p.layers[0]!.keys[0] = { type: 'macro', macro: 0, repeats: 1 };
  p.layers[0]!.keys[1] = { type: 'string', text: 'same' };
  expect(computeCapacity(p).strings).toBe(5);
  const first = encodeProfile(p); expect(first[10]).toBe(36);
  p.chords.push({ layer: 0, keyA: 0, keyB: 1, action: tap });
  const next = encodeProfile(p); expect(next[10]).toBe(39);
  expect(decodeImage(next)).toMatchObject({ ok: true }); expect(validator.accepts(next, 0)).toBe(true);
});
it.each([
  { type: 'keyHold', usage: 4, modifiers: 0 }, { type: 'mouseHold', buttons: 1 },
  { type: 'consumerHold', usage: 1 }, { type: 'momentaryLayer', layer: 0 },
  { type: 'scroll', delta: 1, hold: true }, { type: 'mouseX', delta: 1, hold: true },
  { type: 'mouseY', delta: 1, hold: true }, { type: 'macro', macro: 0, repeats: 1 }, { type: 'none' },
] as Action[])('rejects a prohibited editor step %o', action => {
  const p = oneLayer(0); p.macros = [{ actions: [action] }]; expect(() => encodeProfile(p)).toThrow();
});
it.each([2, 4, 8, 10, 0x46, 0x1c, 0x1d, 15])('rejects held or nested wire steps even without a reference: %s', first => {
  const image = encodeProfile(oneLayer(0)); image.set([first, 1], 31); sealImage(image);
  expect(decodeImage(image).ok).toBe(false); expect(validator.accepts(image, 0)).toBe(false);
});
it.each([0, 30, 32, 127, 128, 255])('rejects an invalid absolute reference %s', address => {
  const image = encodeProfile(oneLayer(0)); image.set([15, address], 9); sealImage(image);
  expect(decodeImage(image).ok).toBe(false); expect(validator.accepts(image, 0)).toBe(false);
});
it('accepts suffix references and empty macros, including odd tail alignment', () => {
  const p = oneLayer(0); p.macros = [{ actions: [tap, { type: 'pause', ticks: 0 }] }, { actions: [] }];
  p.layers[0]!.keys[0] = { type: 'macro', macro: 0, repeats: 2 };
  p.layers[0]!.keys[1] = { type: 'macro', macro: 1, repeats: 1 };
  const image = encodeProfile(p); image[10] = 33; sealImage(image);
  expect(validator.accepts(image, 0)).toBe(true);
  const decoded = decodeImage(image); if (!decoded.ok) throw new Error(decoded.detail);
  expect(decoded.profile.macros![1]!.actions).toEqual([{ type: 'pause', ticks: 0 }]);
  expect(validator.accepts(encodeProfile(decoded.profile), 0)).toBe(true);
});
it.each([0, 17, -1, 1.5])('rejects invalid repeats %s', repeats => {
  const p = oneLayer(0); p.macros = [{ actions: [tap] }]; p.layers[0]!.keys[0] = { type: 'macro', macro: 0, repeats };
  expect(() => encodeProfile(p)).toThrow();
});
it('validates pause endpoints and missing macros, and preserves oversize JSON for repair', () => {
  const p = oneLayer(0);
  for (const ticks of [0, 255]) { p.layers[0]!.keys[0] = { type: 'pause', ticks }; expect(validator.accepts(encodeProfile(p), 0)).toBe(true); }
  for (const ticks of [-1, 256, 1.5]) { p.layers[0]!.keys[0] = { type: 'pause', ticks }; expect(() => encodeProfile(p)).toThrow(); }
  p.layers[0]!.keys[0] = { type: 'macro', macro: 0, repeats: 1 }; expect(validateProfile(p).length).toBeGreaterThan(0);
  p.macros = [{ actions: Array.from({ length: 60 }, () => tap) }];
  expect(importProfile(exportProfile(p)).profile).toEqual(p); expect(() => encodeProfile(p)).toThrow();
  const old = JSON.parse(exportProfile(p)); old.version = 10; expect(() => importProfile(JSON.stringify(old))).toThrow('version 11');
});
it.each([0, 1] as const)('migrates every shifted v10 action in layers, chords and timer slots on variant %s', variant => {
  const samples: Action[] = [{ type: 'mouseHold', buttons: 1 }, { type: 'mouseToggle', buttons: 3 }, { type: 'scroll', delta: 1 }, { type: 'consumer', usage: 0xabc }, { type: 'consumerHold', usage: 0x123 }, { type: 'setLayer', layer: 1 }, { type: 'momentaryLayer', layer: 1 }, { type: 'relativeLayer', offset: -1 }, { type: 'mouseX', delta: -1 }, { type: 'mouseY', delta: 1 }, { type: 'ledControl', command: 'effectOn', value: 15 }];
  for (const action of samples) {
    const p = defaultProfile(variant); p.layers[0]!.keys[0] = action;
    p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: true, action }];
    if (!['mouseHold', 'consumerHold', 'momentaryLayer'].includes(action.type)) {
      p.layers[0]!.clockwise = action;
      p.timedActions = [{ ticks: 2048, layer: 1, resetOnInput: true, consumeInput: true, action, resumeAction: action }];
    }
    const current = encodeProfile(p); const old = current.slice(); legacyV10Codes(old); sealImage(old);
    const decoded = decodeImage(old); expect(decoded).toEqual({ ok: true, profile: p });
    if (!decoded.ok) throw new Error(decoded.detail);
    expect(encodeProfile(decoded.profile)).toEqual(current);
    expect(validator.accepts(current, variant)).toBe(true); expect(validator.accepts(old, variant)).toBe(false);
  }
});
it('recovers v10 drafts without changing their originals and persists macro drafts', () => {
  const p = oneLayer(0); const old = JSON.stringify({ formatVersion: 10, profile: p, meta: {}, savedAt: 'old' });
  const storage = new Map([['universal-macropad:format-v10:draft:six-key', old]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  try {
    expect(loadDraft(0)?.profile).toEqual(p);
    p.macros = [{ actions: [tap] }]; storeDraft(p, {}); expect(loadDraft(0)?.profile).toEqual(p);
    expect(storage.get('universal-macropad:format-v10:draft:six-key')).toBe(old);
  } finally { vi.unstubAllGlobals(); }
});
it('recognizes macro layer routes and stops at the first effective layer change', () => {
  const p = defaultProfile(0); p.layers = [emptyLayer(0), emptyLayer(0), emptyLayer(0)];
  p.macros = [{ actions: [{ type: 'setLayer', layer: 1 }, { type: 'setLayer', layer: 2 }] }];
  p.layers[0]!.keys[0] = { type: 'macro', macro: 0, repeats: 16 };
  const warnings = layerReachabilityWarnings(p);
  expect(warnings.some(w => w.layer === 1 && w.message.includes('cannot be reached'))).toBe(false);
  expect(warnings.some(w => w.layer === 2 && w.message.includes('cannot be reached'))).toBe(true);
});

it.each<Action>([
  { type: 'setLayer', layer: 0 }, { type: 'setLayer', layer: 255 },
  { type: 'oneShotSetLayer', layer: 0 }, { type: 'relativeLayer', offset: 0 },
  { type: 'oneShotRelativeLayer', offset: 1 },
])('requires even potentially self-targeting layer switches to finish a macro: %j', change => {
  const p = defaultProfile(0);
  p.macros = [{ actions: [tap, change] }];
  p.layers[0]!.keys[0] = { type: 'macro', macro: 0, repeats: 1 };
  expect(validateProfile(p)).toEqual([]);
  expect(() => encodeProfile(p)).not.toThrow();
  p.macros[0]!.actions.push({ type: 'pause', ticks: 0 });
  expect(validateProfile(p).some(i => i.slot?.kind === 'macro' && i.message.includes('final macro step'))).toBe(true);
  expect(() => encodeProfile(p)).toThrow(/final macro step/);
  expect(() => importProfile(exportProfile(p, {}))).toThrow(/final macro step/);
});

it('blocks repeats at every invocation site after editing a macro to switch layers', () => {
  const p = defaultProfile(0);
  const invoke: Action = { type: 'macro', macro: 0, repeats: 2 };
  p.macros = [{ actions: [tap] }];
  p.layers[0]!.keys[0] = invoke;
  p.layers[0]!.encoderButton = invoke;
  p.layers[0]!.clockwise = invoke;
  p.layers[0]!.counterclockwise = invoke;
  p.chords = [{ layer: 0, keyA: 0, keyB: 1, action: invoke }];
  p.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: invoke, resumeAction: invoke }];
  expect(validateProfile(p)).toEqual([]);
  p.macros[0]!.actions.push({ type: 'setLayer', layer: 0 });
  expect(validateProfile(p).filter(i => i.message.includes('repeat count of 1'))).toHaveLength(7);
  expect(() => encodeProfile(p)).toThrow(/repeat count of 1/);
  expect(() => importProfile(exportProfile(p, {}))).toThrow(/repeat count of 1/);
  p.macros[0]!.actions.pop();
  expect(validateProfile(p)).toEqual([]);
});
