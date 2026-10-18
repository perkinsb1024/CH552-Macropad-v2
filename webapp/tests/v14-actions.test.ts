import { legacyJson, legacyProfile } from './legacy-image';
import { migrateProfileColors } from '../src/model/palette';
import v13Fixtures from './fixtures/v13-profiles.json';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createFirmwareValidator } from './firmware-validator.mjs';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { encodeAction, encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { exportProfile, importProfile } from '../src/io/json';
import { draftKey, loadDraft, storeDraft } from '../src/io/drafts';
import { actionProblem } from '../src/model/validate';
import { actionNeedsRelease, summarize } from '../src/model/actions';
import { layerReachabilityWarnings } from '../src/model/reachability';
import type { Action, Profile } from '../src/model/types';

let validator: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { validator = createFirmwareValidator(); });
afterAll(() => validator.close());
afterEach(() => vi.unstubAllGlobals());

const fixtures = v13Fixtures as {
  sourceCommit: string; fixtures: { profile: Profile; hex: string }[];
};
it.each(fixtures.fixtures)('migrates authentic finalized v13 bytes, JSON and drafts for variant $profile.variant', ({ profile: p, hex }) => {
  const original = Uint8Array.from(hex.match(/../g)!, byte => parseInt(byte, 16));
  p = { ...defaultProfile(p.variant), ...structuredClone(p) };
  for (const layer of p.layers) layer.autoSleep = false;
  expect(original[2]).toBe(13);
  migrateProfileColors(p);
  const result = decodeImage(original);
  expect(result).toEqual({ ok: true, profile: p });
  if (!result.ok) throw new Error(result.detail);
  const upgraded = encodeProfile(result.profile);
  expect(upgraded[1]).toBe(18);
  expect(validator.accepts(upgraded, p.variant)).toBe(true);
  expect(decodeImage(upgraded)).toEqual(result);
  expect([...original].map(byte => byte.toString(16).padStart(2, '0')).join('')).toBe(hex);
  const json = JSON.parse(exportProfile(p, { profileName: 'Migrated' })); legacyJson(json); json.version = 13;
  expect(importProfile(JSON.stringify(json))).toEqual({ profile: p, meta: { profileName: 'Migrated' } });
  const oldKey = `universal-macropad:format-v13:draft:${p.variant ? 'three-key' : 'six-key'}`;
  const oldDraft = JSON.stringify({ formatVersion: 13, profile: legacyProfile(p), meta: { profileName: 'Migrated' }, savedAt: 'old' });
  const storage = new Map([[oldKey, oldDraft]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  expect(loadDraft(p.variant)).toEqual({ formatVersion: 18, headerMarker: 'B', profile: p, meta: { profileName: 'Migrated' }, savedAt: 'old' });
  storeDraft(p, { profileName: 'Migrated' });
  expect(storage.has(draftKey(p.variant))).toBe(true);
  expect(storage.get(oldKey)).toBe(oldDraft);
});

it.each([0, 1] as const)('matches firmware v14 layer modes and modified holds at every action site on variant %s', variant => {
  const p = defaultProfile(variant); p.layers = [p.layers[0]!];
  p.chords = [{ layer: 0, keyA: 0, keyB: 1, action: { type: 'none' } }];
  p.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: { type: 'none' }, resumeAction: { type: 'none' } }];
  p.macros = [{ actions: [{ type: 'pause', ticks: 0 }] }];
  const end = variant ? 24 : 31;
  const sites = [[9, false], [variant ? 15 : 21, false], [variant ? 17 : 23, true], [variant ? 19 : 25, true], [end + 1, false], [end + 4, true], [end + 6, true], [end + 9, true]] as const;
  const original = encodeProfile(p);
  for (const [offset, autonomous] of sites) for (let aux = 0; aux < 16; aux++) {
    for (const param of [0, 1, 6, 7, 249, 250, 255]) {
      const image = original.slice(); image.set([aux << 4 | 12, param], offset); sealImage(image);
      const mode = aux & 3;
      const valid = (aux & 7) <= 6 && mode !== 3 && !(autonomous && mode === 2) && (aux & 4 ? param <= 6 || param >= 250 : param === 0 || (param === 255 && mode !== 2));
      expect(decodeImage(image).ok, `Layer mode ${aux}, parameter ${param}, site ${offset}`).toBe(valid);
      expect(validator.accepts(image, variant)).toBe(valid);
    }
    for (const param of [0, 1, 255]) {
      const image = original.slice(); image.set([aux << 4 | 11, param], offset); sealImage(image);
      const valid = !!param && !autonomous;
      expect(decodeImage(image).ok).toBe(valid);
      expect(validator.accepts(image, variant)).toBe(valid);
    }
    const reserved = original.slice(); reserved.set([aux << 4 | 15, 1], offset); sealImage(reserved);
    expect(decodeImage(reserved).ok).toBe(false);
    expect(validator.accepts(reserved, variant)).toBe(false);
  }
}, 20000);

it.each([0, 1] as const)('round-trips new holds in keys, encoder press, chords, JSON and drafts on variant %s', variant => {
  const p = defaultProfile(variant);
  for (const a of [{ type: 'consumerModifiedHold', usage: 255, modifiers: 15 }, { type: 'momentaryRelativeLayer', offset: -6 }] as Action[]) {
    p.layers[0]!.keys[0] = a; p.layers[0]!.encoderButton = a;
    p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: true, action: a }];
    const image = encodeProfile(p);
    expect(encodeAction(a, new Map())).toEqual(a.type === 'consumerModifiedHold' ? [0xfb, 255] : [0x6c, 250]);
    expect(decodeImage(image)).toEqual({ ok: true, profile: p });
    expect(validator.accepts(image, variant)).toBe(true);
    expect(importProfile(exportProfile(p)).profile).toEqual(p);
    expect(actionNeedsRelease(a)).toBe(true);
    expect(summarize(a)).toMatch(/hold/i);
    for (const ctx of [{ rotation: true }, { rotation: false, timed: true }, { rotation: false, macro: true }]) expect(actionProblem(a, { layerCount: 2, ...ctx })).toContain('release');
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    storeDraft(p, {}); expect(loadDraft(variant)?.profile).toEqual(p);
    const json = JSON.parse(exportProfile(p)); legacyJson(json); json.version = 13;
    expect(() => importProfile(JSON.stringify(json))).toThrow('version 14');
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ formatVersion: 13, profile: legacyProfile(p) }) });
    expect(loadDraft(variant)).toBeNull();
  }
});

it('includes relative holds in layer reachability', () => {
  const p = defaultProfile(0); p.layers = [emptyLayer(0), emptyLayer(0)];
  expect(layerReachabilityWarnings(p)).toHaveLength(1);
  p.layers[0]!.keys[0] = { type: 'momentaryRelativeLayer', offset: 1 };
  expect(layerReachabilityWarnings(p)).toEqual([]);
});
