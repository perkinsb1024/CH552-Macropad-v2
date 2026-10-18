import v17Fixtures from './fixtures/v17-profiles.json';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { exportProfile, importProfile, type LocalMetadata } from '../src/io/json';
import { clearDraft, draftKey, loadDraft, storeDraft } from '../src/io/drafts';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import type { Profile } from '../src/model/types';
import { Opcode } from '../src/protocol/packet';
import { liveSource } from '../src/ui/liveTrigger';
import { SimulatedDevice } from '../src/protocol/simulator';
import { canSave, connection, connectSimulator, disconnect, profile, save } from '../src/ui/store';
import { createFirmwareValidator } from './firmware-validator.mjs';

// Produced with the finalized outgoing encoder at 38724fb, before v18 edits.
const { fixtures } = v17Fixtures as {
  fixtures: { variant: 0 | 1; profile: Profile; meta: LocalMetadata; hex: string; json: string }[];
};
let firmware: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { firmware = createFirmwareValidator(); });
afterAll(() => firmware.close());
afterEach(async () => { await disconnect(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(fixtures)('migrates authentic v17 global/local chords and all four timers on variant $variant', fixture => {
  const original = Uint8Array.from(fixture.hex.match(/../g)!, b => parseInt(b, 16));
  const decoded = decodeImage(original, fixture.variant);
  if (!decoded.ok) throw new Error(decoded.detail);
  expect(decoded.profile.chords.map(c => [c.layer, !!c.global])).toEqual([[1, false], [1, true]]);
  const migrated = encodeProfile(decoded.profile);
  const expected = original.slice(); expected[1] = 18;
  const size = fixture.variant ? 15 : 22;
  let offset = 9 + size * decoded.profile.layers.length;
  for (const layer of decoded.profile.layers) if (layer.indicatorColor === 0) offset += fixture.variant ? 2 : 3;
  expect(original[offset + 3]).toBe(0x90);
  expected[offset + 3] = 0x70;
  sealImage(expected);
  expect(migrated).toEqual(expected);
  expect(firmware.accepts(original, fixture.variant)).toBe(false);
  expect(firmware.accepts(migrated, fixture.variant)).toBe(true);
  const canonical = { ...decoded.profile, chords: decoded.profile.chords.map(c => c.global ? { ...c, layer: 0 } : c) };
  expect(decodeImage(migrated)).toEqual({ ok: true, profile: canonical });
  expect(canonical.timedActions).toHaveLength(4);
  const imported = importProfile(fixture.json);
  expect(JSON.parse(exportProfile(imported.profile, imported.meta))).toEqual({ ...JSON.parse(fixture.json), version: 18 });
});

it.each(fixtures)('recovers v17 drafts without changing the archived namespace on variant $variant', fixture => {
  const oldKey = `universal-macropad:format-v17:board:draft:${fixture.variant ? 'three-key' : 'six-key'}`;
  const original = JSON.stringify({ formatVersion: 17, headerMarker: 'B', profile: fixture.profile, meta: fixture.meta, savedAt: 'v17' });
  const storage = new Map([[oldKey, original]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const recovered = loadDraft(fixture.variant)!;
  expect(recovered).toEqual({ formatVersion: 18, headerMarker: 'B', profile: fixture.profile, meta: fixture.meta, savedAt: 'v17' });
  expect(storage.get(oldKey)).toBe(original);
  storeDraft(recovered.profile, recovered.meta);
  expect(JSON.parse(storage.get(draftKey(fixture.variant))!).formatVersion).toBe(18);
  clearDraft(fixture.variant);
  expect(loadDraft(fixture.variant)).toBeNull();
  expect(storage.get(oldKey)).toBe(original);
});

it.each(fixtures)('preserves old flash until Save to Device explicitly writes v18 on variant $variant', async fixture => {
  const original = Uint8Array.from(fixture.hex.match(/../g)!, b => parseInt(b, 16));
  const send = SimulatedDevice.prototype.send;
  vi.spyOn(SimulatedDevice.prototype, 'send').mockImplementation(function (this: SimulatedDevice, payload) {
    if (payload[3] === Opcode.GetInfo) { this.flash.set(original); this.flashValid = false; }
    return send.call(this, payload);
  });
  await connectSimulator(fixture.variant);
  const c = connection.value;
  if (c.kind !== 'connected') throw new Error('Connection failed');
  const device = c.connection.transport as SimulatedDevice;
  expect(device.flash).toEqual(original);
  expect(profile.value?.chords.map(c => c.action)).toEqual(fixture.profile.chords.map(c => c.action));
  expect(canSave.value).toBe(true);
  await save();
  expect(device.flash[1]).toBe(18);
  expect(firmware.accepts(device.flash, fixture.variant)).toBe(true);
});

it.each([0, 1] as const)('matches firmware for every chord identifier at minimum and maximum layers on variant %s', variant => {
  const p = defaultProfile(variant);
  for (const layers of [1, variant ? 7 : 5]) {
    p.layers = Array.from({ length: layers }, () => emptyLayer(variant));
    p.chords = [{ layer: 0, keyA: 0, keyB: 1, action: { type: 'none' } }];
    for (let id = 0; id < 256; id++) {
      const image = encodeProfile(p); image[9 + layers * (variant ? 15 : 22)] = id; sealImage(image);
      const expected = (id >> 4 === 7 || id >> 4 < layers) && (id & 15) < (variant ? 3 : 15);
      expect(decodeImage(image).ok, `ID ${id}`).toBe(expected);
      expect(firmware.accepts(image, variant), `ID ${id}`).toBe(expected);
    }
  }
}, 20000);

it('sorts global chords by key pair independently of their former storage layers', () => {
  const p = defaultProfile(1);
  p.chords = [
    { layer: 1, keyA: 0, keyB: 1, global: true, action: { type: 'none' } },
    { layer: 0, keyA: 1, keyB: 2, global: true, action: { type: 'none' } },
    { layer: 1, keyA: 0, keyB: 2, global: true, action: { type: 'none' } },
  ];
  const image = encodeProfile(p);
  expect([image[39], image[42], image[45]]).toEqual([0x70, 0x71, 0x72]);
  expect(firmware.accepts(image, 1)).toBe(true);
});

it('keeps fifth timer, Auto-Sleep and macro telemetry sources distinct', () => {
  expect(liveSource(0x8d, 6, 5)).toBe('Timer 5');
  expect(liveSource(0x8e, 6, 5)).toBe('Auto-Sleep');
  expect(liveSource(0x8f, 6, 5)).toBe('Macro Step');
});

it('rejects a fifth timer falsely labelled as a pre-v18 binary, JSON profile or draft', () => {
  const p = defaultProfile(0);
  p.timedActions = Array.from({ length: 5 }, () => ({ ticks: 1, resetOnInput: false, consumeInput: false,
    action: { type: 'none' as const }, resumeAction: { type: 'none' as const } }));
  const image = encodeProfile(p); image[1] = 17; sealImage(image);
  expect(decodeImage(image)).toMatchObject({ ok: false, reason: 'malformed' });
  const json = JSON.parse(exportProfile(p)); json.version = 17;
  expect(() => importProfile(JSON.stringify(json))).toThrow('version 18');
  vi.stubGlobal('localStorage', { getItem: (key: string) => key.endsWith('draft:six-key') ? JSON.stringify({ formatVersion: 17, headerMarker: 'B', profile: p, meta: {} }) : null });
  expect(loadDraft(0)).toBeNull();
});
