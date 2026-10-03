import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFirmwareValidator } from './firmware-validator.mjs';
import { defaultProfile, cloneProfile } from '../src/model/defaults';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { computeCapacity } from '../src/model/capacity';
import { validateProfile } from '../src/model/validate';
import { exportProfile, importProfile } from '../src/io/json';
import { profileChanges } from '../src/model/changes';
import type { Action, TimedAction, Profile } from '../src/model/types';
import { ConfigClient } from '../src/protocol/client';
import { SimulatedDevice } from '../src/protocol/simulator';

const timer = (ticks = 1, resetOnInput = true): TimedAction => ({ ticks, resetOnInput, consumeInput: false,
  action: { type: 'keyTap', usage: 4, modifiers: 0 },
  resumeAction: { type: 'ledControl', command: 'brightnessBothSet', value: 'asConfigured' } });
let validator: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { validator = createFirmwareValidator(); });
afterAll(() => { validator?.close(); });
function firmwareAccepts(image: Uint8Array, variant: number) {
  return validator.accepts(image, variant);
}

describe('v7 timed-action images', () => {
  it.each([0, 1] as const)('matches firmware for all four counts, endpoints and flag combinations on variant %s', (variant) => {
    for (let count = 0; count <= 4; count++) {
      const p = defaultProfile(variant);
      if (count) p.timedActions = Array.from({ length: count }, (_, i) => timer(i & 1 ? 64 : 1, !!(i & 1)));
      const image = encodeProfile(p);
      expect(image[2]).toBe(7);
      expect((image[3]! >> 6) | ((image[4]! >> 7) << 2)).toBe(count);
      expect(decodeImage(image)).toEqual({ ok: true, profile: p });
      expect(firmwareAccepts(image, variant)).toBe(true);
      expect(importProfile(exportProfile(p)).profile).toEqual(p);
    }
  });
  it('packs timer records after chords and before a shared string pool', () => {
    const p = defaultProfile(0);
    p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: false, action: { type: 'string', text: 'abc' } }];
    p.timedActions = [{ ...timer(64, true), action: { type: 'string', text: 'abc' }, resumeAction: { type: 'string', text: 'abc' } }];
    const image = encodeProfile(p);
    const offset = 9 + 44 + 3;
    expect([...image.slice(offset, offset + 5)]).toEqual([191, 9, 0, 9, 0]);
    expect([...image.slice(offset + 5, offset + 9)]).toEqual([97, 98, 99, 0]);
    expect(computeCapacity(p)).toMatchObject({ chords: 3, timedActions: 5, strings: 4, used: 65 });
    expect(decodeImage(image)).toEqual({ ok: true, profile: p });
    expect(firmwareAccepts(image, 0)).toBe(true);
  });
  it('rejects unsupported timer counts and truncated records in both validators', () => {
    const image = encodeProfile(defaultProfile(0));
    image[3] = image[3]! | 64;
    image[4] = 128; // count = 5
    sealImage(image);
    expect(decodeImage(image).ok).toBe(false);
    expect(firmwareAccepts(image, 0)).toBe(false);
    image[3] = 4; // five layers
    image[4] = 128; // four timers exceed the profile capacity
    sealImage(image);
    expect(decodeImage(image).ok).toBe(false);
    expect(firmwareAccepts(image, 0)).toBe(false);
  });
  it.each([
    { type: 'keyHold', usage: 4, modifiers: 0 }, { type: 'mouseHold', buttons: 1 },
    { type: 'momentaryLayer', layer: 0 }, { type: 'mouseX', delta: 1, hold: true },
  ] as Action[])('rejects release-dependent timer and resume bindings: %o', (action) => {
    for (const resume of [false, true]) {
      const p = defaultProfile(0);
      p.timedActions = [timer()];
      p.timedActions[0]![resume ? 'resumeAction' : 'action'] = action;
      expect(validateProfile(p).length).toBeGreaterThan(0);
      expect(() => encodeProfile(p)).toThrow();
      // Corrupt valid bytes to exercise actual decoder + firmware restrictions.
      const valid = defaultProfile(0); valid.timedActions = [timer()];
      const image = encodeProfile(valid);
      const offset = 53 + (resume ? 3 : 1);
      const bytes = action.type === 'keyHold' ? [2, 4] : action.type === 'mouseHold' ? [5, 1] : action.type === 'momentaryLayer' ? [11, 0] : [29, 1];
      image.set(bytes, offset); sealImage(image);
      expect(decodeImage(image).ok).toBe(false);
      expect(firmwareAccepts(image, 0)).toBe(false);
    }
  });
  it('validates intervals, flags, capacity, and backups without silently dropping timers', () => {
    const p = defaultProfile(0); p.timedActions = [timer()];
    for (const ticks of [0, 65, 1.5, NaN]) {
      p.timedActions[0]!.ticks = ticks;
      expect(validateProfile(p).length).toBeGreaterThan(0);
    }
    p.timedActions = Array.from({ length: 5 }, () => timer());
    expect(() => encodeProfile(p)).toThrow('At most 4');
    p.timedActions = [timer()];
    const raw = JSON.parse(exportProfile(p));
    raw.timedActions[0].resetOnInput = 'yes';
    expect(() => importProfile(JSON.stringify(raw))).toThrow();
    raw.version = 6; raw.timedActions[0].resetOnInput = true;
    expect(() => importProfile(JSON.stringify(raw))).toThrow('version 7');
  });
  it('includes timer edits in comparisons and restores them with undo', () => {
    const before = defaultProfile(0); const after = cloneProfile(before);
    after.timedActions = [timer()];
    const change = profileChanges(before, after).find(c => c.where === 'Timed actions')!;
    expect(change.after).toContain('1 ticks');
    change.undo!(after); expect(after).toEqual(before);
  });
  it.each([0, 1] as const)('saves and reads back timer profiles through the configuration protocol on variant %s', async (variant) => {
    const device = new SimulatedDevice({ variant, blankFlash: true });
    const client = new ConfigClient(device);
    const p: Profile = defaultProfile(variant); p.timedActions = [timer(55)];
    await client.saveImage(encodeProfile(p));
    expect(decodeImage(await client.readFlash())).toEqual({ ok: true, profile: p });
    await device.close();
  });
});

it.each([0, 1] as const)('packs both flags without reducing interval or profile capacity on variant %s', variant => {
  for (const ticks of [1, 64]) for (const reset of [false, true]) for (const consume of [false, true]) {
    const p = defaultProfile(variant);
    p.timedActions = [{ ...timer(ticks, reset), consumeInput: consume,
      action: { type: 'ledControl', command: 'effectOn', value: 15 },
      resumeAction: { type: 'ledControl', command: 'effectRestore', value: 0 } }];
    const image = encodeProfile(p);
    const offset = 9 + p.layers.length * (variant ? 15 : 22);
    expect([...image.slice(offset, offset + 5)]).toEqual([(ticks - 1) | (reset ? 128 : 0) | (consume ? 64 : 0), 255, 129, 15, 128]);
    expect(decodeImage(image)).toEqual({ ok: true, profile: p });
    expect(importProfile(exportProfile(p)).profile).toEqual(p);
    expect(firmwareAccepts(image, variant)).toBe(true);
  }
});
