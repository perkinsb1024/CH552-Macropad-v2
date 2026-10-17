import v16Fixtures from './fixtures/v16-profiles.json';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { importProfile, exportProfile, type LocalMetadata } from '../src/io/json';
import { clearDraft, draftKey, loadDraft, storeDraft } from '../src/io/drafts';
import type { Profile } from '../src/model/types';
import { Opcode } from '../src/protocol/packet';
import { SimulatedDevice } from '../src/protocol/simulator';
import { canSave, connection, connectSimulator, disconnect, profile, save } from '../src/ui/store';
import { createFirmwareValidator } from './firmware-validator.mjs';

// Produced by the finalized v16 source, independently of the active v17 encoder.
const { fixtures } = v16Fixtures as {
  fixtures: { variant: 0 | 1; profile: Profile; meta: LocalMetadata; hex: string; json: string }[];
};
let firmware: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { firmware = createFirmwareValidator(); });
afterAll(() => firmware.close());
afterEach(async () => { await disconnect(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(fixtures)('migrates published v16 binary and JSON without changing payload or settings on variant $variant', fixture => {
  const original = Uint8Array.from(fixture.hex.match(/../g)!, b => parseInt(b, 16));
  const decoded = decodeImage(original, fixture.variant);
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) throw new Error(decoded.detail);
  const migrated = encodeProfile(decoded.profile);
  const expected = original.slice(); expected[1] = 17; sealImage(expected);
  expect(migrated).toEqual(expected);
  expect(firmware.accepts(original, fixture.variant)).toBe(false);
  expect(firmware.accepts(migrated, fixture.variant)).toBe(true);
  expect(decodeImage(migrated)).toEqual(decoded);
  expect(original[1]).toBe(16);

  const imported = importProfile(fixture.json);
  const upgradedJson = JSON.parse(exportProfile(imported.profile, imported.meta));
  expect(upgradedJson).toEqual({ ...JSON.parse(fixture.json), version: 17 });
  expect(imported.profile.layers[1]!.idleLeds).toEqual(fixture.profile.layers[1]!.idleLeds);
});

it.each(fixtures)('recovers v16 drafts without rewriting them and isolates subsequent v17 saves on variant $variant', fixture => {
  const oldKey = `universal-macropad:format-v16:board:draft:${fixture.variant ? 'three-key' : 'six-key'}`;
  const original = JSON.stringify({ formatVersion: 16, headerMarker: 'B', profile: fixture.profile, meta: fixture.meta, savedAt: 'v16' });
  const storage = new Map([[oldKey, original]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const recovered = loadDraft(fixture.variant)!;
  expect(recovered).toEqual({ formatVersion: 17, headerMarker: 'B', profile: fixture.profile, meta: fixture.meta, savedAt: 'v16' });
  expect(storage.get(oldKey)).toBe(original);
  expect(storage.has(draftKey(fixture.variant))).toBe(false);
  storeDraft(recovered.profile, recovered.meta);
  expect(JSON.parse(storage.get(draftKey(fixture.variant))!).formatVersion).toBe(17);
  clearDraft(fixture.variant);
  expect(loadDraft(fixture.variant)).toBeNull();
  expect(storage.get(oldKey)).toBe(original);
});

it.each(fixtures)('keeps old device flash intact until explicitly saving v17 on variant $variant', async fixture => {
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
  expect(profile.value?.layers[0]!.idleLeds).toEqual(fixture.profile.layers[0]!.idleLeds);
  expect(profile.value?.timedActions).toHaveLength(4);
  expect(canSave.value).toBe(true);
  await save();
  expect(device.flash[1]).toBe(17);
  expect(device.flashValid).toBe(true);
  expect(firmware.accepts(device.flash, fixture.variant)).toBe(true);
});
