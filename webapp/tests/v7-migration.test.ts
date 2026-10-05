import { afterAll, beforeAll, expect, it } from 'vitest';
import { createFirmwareValidator } from './firmware-validator.mjs';
import { sortedChords } from '../src/model/capacity';
import { defaultProfile } from '../src/model/defaults';
import { importProfile, exportProfile } from '../src/io/json';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { SimulatedDevice } from '../src/protocol/simulator';
import { ConfigClient } from '../src/protocol/client';
import { legacyTextCodes } from './legacy-image';
let validator: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { validator = createFirmwareValidator(); });
afterAll(() => validator.close());

it.each([0, 1] as const)('preserves v6 settings, LED actions and metadata when migrating variant %s', async variant => {
  const p = defaultProfile(variant);
  p.startupLayer = 1; p.rainbowPhase = 3; p.rainbowSpeed = 0; p.transparentBlack = true;
  p.layers[0]!.keys[0] = { type: 'ledControl', command: 'commonPresetToggle', value: 3 };
  p.layers[0]!.keys[1] = { type: 'string', text: 'Hello\n' };
  p.chords = [{ layer: 1, keyA: 0, keyB: 1, global: true, action: { type: 'ledControl', command: 'rainbowPhaseRelative', value: -2 } }];
  const original = encodeProfile(p); legacyTextCodes(original); original[2] = 6; sealImage(original);
  const decoded = decodeImage(original); expect(decoded).toEqual({ ok: true, profile: p });
  if (!decoded.ok) throw new Error('decode failed');
  const migrated = encodeProfile(decoded.profile);
  expect(migrated[2]).toBe(8);
  const reverted = migrated.slice(); legacyTextCodes(reverted); reverted[2] = 6; sealImage(reverted);
  expect(reverted).toEqual(original);
  expect(validator.accepts(original, variant)).toBe(false);
  expect(validator.accepts(migrated, variant)).toBe(true);
  expect(decoded.profile.timedActions).toBeUndefined();
  const meta = { profileName: 'v6 backup', layerNames: ['One', 'Two'] };
  const json = JSON.parse(exportProfile(p, meta)); json.version = 6;
  expect(importProfile(JSON.stringify(json))).toEqual({ profile: p, meta });
  const device = new SimulatedDevice({ variant }); const client = new ConfigClient(device);
  await expect(client.saveImage(original)).rejects.toThrow();
  await client.saveImage(migrated); expect(await client.readFlash()).toEqual(migrated);
  await device.close();
});
it('validates and round-trips every bundled v7 profile against firmware', () => {
  const profiles = import.meta.glob('../../profiles/*-max-action-slots.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  expect(Object.keys(profiles)).toHaveLength(2);
  for (const text of Object.values(profiles)) {
    expect(JSON.parse(text).version).toBe(7);
    const { profile: p, meta } = importProfile(text);
    expect(importProfile(exportProfile(p, meta))).toEqual({ profile: p, meta });
    const image = encodeProfile(p);
    expect(decodeImage(image)).toEqual({ ok: true, profile: { ...p, chords: sortedChords(p) } });
    expect(validator.accepts(image, p.variant)).toBe(true);
  }
});
it('rejects temporary effects masquerading as v6 and malformed consume flags', () => {
  const p = defaultProfile(0);
  p.layers[0]!.keys[0] = { type: 'ledControl', command: 'effectOn', value: 15 };
  const old = encodeProfile(p); old[2] = 6; sealImage(old);
  expect(decodeImage(old).ok).toBe(false);
  const json = JSON.parse(exportProfile(p)); json.version = 6;
  expect(() => importProfile(JSON.stringify(json))).toThrow('version 7');
  json.version = 7; json.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: 'yes', action: { type: 'none' }, resumeAction: { type: 'none' } }];
  expect(() => importProfile(JSON.stringify(json))).toThrow('Consume');
});
