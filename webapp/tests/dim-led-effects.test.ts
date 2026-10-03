import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createFirmwareValidator } from './firmware-validator.mjs';
import { defaultProfile } from '../src/model/defaults';
import { encodeAction, encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { exportProfile, importProfile } from '../src/io/json';
import { loadDraft, storeDraft } from '../src/io/drafts';
import { LED_COMMANDS, ledSummary, type LedCommand } from '../src/model/ledControl';
import { profileChanges } from '../src/model/changes';
import type { Action } from '../src/model/types';
import { ConfigClient } from '../src/protocol/client';
import { SimulatedDevice } from '../src/protocol/simulator';

let validator: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { validator = createFirmwareValidator(); });
afterAll(() => validator.close());
afterEach(() => vi.unstubAllGlobals());

it.each([0, 1] as const)('round-trips all dim colors and modes against firmware on variant %s', variant => {
  for (const spec of LED_COMMANDS.filter(c => c.code >= 0x81)) {
    for (let color = 0; color < 16; color++) {
      const p = defaultProfile(variant);
      const action: Action = { type: 'ledControl', command: spec.command, value: color, brightness: 'dim' };
      p.layers[0]!.keys[0] = action;
      p.layers[0]!.clockwise = action;
      p.layers[0]!.encoderButton = action;
      p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: false, action }];
      p.timedActions = [{ ticks: 1, resetOnInput: true, consumeInput: true, action, resumeAction: action }];
      const image = encodeProfile(p);
      expect(encodeAction(action, new Map())).toEqual([color << 4 | 0xf, spec.code | 0x10]);
      expect(validator.accepts(image, variant)).toBe(true);
      expect(decodeImage(image)).toEqual({ ok: true, profile: p });
      expect(importProfile(exportProfile(p)).profile).toEqual(p);
    }
  }
});

it('preserves dim effects in drafts and simulator saves and shows brightness in changes', async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const p = defaultProfile(0);
  p.layers[0]!.keys[0] = { type: 'ledControl', command: 'effectBlink8', value: 15 };
  const before = structuredClone(p);
  p.layers[0]!.keys[0] = { ...p.layers[0]!.keys[0], brightness: 'dim' };
  storeDraft(p, {});
  expect(loadDraft(0)?.profile).toEqual(p);
  expect(profileChanges(before, p)[0]?.after).toContain('Dim');
  expect(ledSummary('effectBlink8', 15, true, 'dim')).toBe('All LEDs: Rainbow · Dim · Blink 8 times');
  const device = new SimulatedDevice({ variant: 0 });
  try {
    const client = new ConfigClient(device);
    const image = encodeProfile(p);
    await client.saveImage(image);
    expect(await client.readFlash()).toEqual(image);
    expect(decodeImage(await client.readActive())).toEqual({ ok: true, profile: p });
  } finally { await device.close(); }
});

it('defaults old effects to Bright and normalizes explicit bright JSON', () => {
  const p = defaultProfile(0);
  p.layers[0]!.keys[0] = { type: 'ledControl', command: 'effectOn', value: 15 };
  const original = encodeProfile(p);
  expect(original[10]).toBe(0x81);
  expect(decodeImage(original)).toEqual({ ok: true, profile: p });
  const json = JSON.parse(exportProfile(p));
  json.layers[0].keys[0].brightness = 'bright';
  expect(importProfile(JSON.stringify(json)).profile).toEqual(p);
  expect(encodeProfile(importProfile(JSON.stringify(json)).profile)).toEqual(original);
});

it('rejects malformed brightness, brightness on restore/ordinary commands, and reserved 0x90', () => {
  for (const brightness of [null, false, 1, 'off', 'DIM']) {
    const p = defaultProfile(0);
    p.layers[0]!.keys[0] = { type: 'ledControl', command: 'effectOn', value: 0 };
    const json = JSON.parse(exportProfile(p));
    json.layers[0].keys[0].brightness = brightness;
    expect(() => importProfile(JSON.stringify(json))).toThrow();
    expect(() => encodeAction({ ...p.layers[0]!.keys[0], brightness } as Action, new Map())).toThrow();
  }
  for (const command of ['effectRestore', 'brightnessBothSet'] as LedCommand[]) {
    expect(() => encodeAction({ type: 'ledControl', command, value: 0, brightness: 'dim' }, new Map())).toThrow();
    const p = defaultProfile(0);
    p.layers[0]!.keys[0] = { type: 'ledControl', command, value: 0 };
    const json = JSON.parse(exportProfile(p));
    json.layers[0].keys[0].brightness = 'dim';
    expect(() => importProfile(JSON.stringify(json))).toThrow();
  }
  const image = encodeProfile(defaultProfile(0));
  image[9] = 0x0f; image[10] = 0x90; sealImage(image);
  expect(decodeImage(image).ok).toBe(false);
  expect(validator.accepts(image, 0)).toBe(false);
  image[10] = 0x91; image[2] = 6; sealImage(image);
  expect(decodeImage(image).ok).toBe(false);
});
