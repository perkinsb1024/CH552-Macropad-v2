import { afterAll, beforeAll, expect, it } from 'vitest';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { computeCapacity } from '../src/model/capacity';
import { actionProblem, validateProfile } from '../src/model/validate';
import { HOLD_THRESHOLDS, holdBindings, holdThreshold, setHoldThreshold } from '../src/model/tapHold';
import type { Action, Profile, TapHoldAction } from '../src/model/types';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage, decodeLiveAction } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { exportProfile, importProfile } from '../src/io/json';
import { removeMacro, reorderMacros, untriggeredMacros } from '../src/model/macros';
import { layerReachabilityWarnings } from '../src/model/reachability';
import { liveGestureClassifier } from '../src/ui/liveGestures';
import { advanceActivity } from '../src/protocol/live';
import type { FastLiveState } from '../src/protocol/packet';
import { createFirmwareValidator } from './firmware-validator.mjs';
import { SimulatedDevice } from '../src/protocol/simulator';
import { ConfigClient } from '../src/protocol/client';

let firmware: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { firmware = createFirmwareValidator(); });
afterAll(() => firmware.close());
const gesture = (): TapHoldAction => ({ type: 'tapHold', tap: { type: 'keyTap', usage: 40, modifiers: 0 }, hold: { type: 'keyHold', usage: 0, modifiers: 1 } });
function decoded(image: Uint8Array): Profile {
  const result = decodeImage(image);
  if (!result.ok) throw new Error(result.detail);
  return result.profile;
}
const sample = (changes: Partial<FastLiveState> = {}): FastLiveState => ({ bindingLayer: 0, pressed: 0, clockwise: 0, counterclockwise: 0, bindings: Array(9).fill(0), source: 0, first: 1, second: 40, sequence: 0, ...changes });

it.each([0, 1] as const)('encodes a shared pair at every threshold and physical binding on variant %s', variant => {
  for (const threshold of HOLD_THRESHOLDS) {
    const p = defaultProfile(variant); p.layers = [emptyLayer(variant)];
    p.holdThresholdMs = threshold;
    p.layers[0]!.keys[0] = gesture(); p.layers[0]!.encoderButton = gesture();
    p.chords = [{ layer: 0, global: true, keyA: 0, keyB: 1, action: gesture() }];
    const image = encodeProfile(p);
    expect(firmware.accepts(image, variant)).toBe(true);
    expect(image[9]).toBe(15 | (threshold / 32 - 1) << 4);
    expect(computeCapacity(p).tapHold).toBe(5);
    expect(encodeProfile(decoded(image))).toEqual(image);
    expect(holdBindings(decoded(image))).toHaveLength(3);
    expect(holdThreshold(decoded(image))).toBe(threshold);
  }
});

it.each([0, 1] as const)('repackages text, macro branches and palettes without corrupting references on variant %s', variant => {
  const p = defaultProfile(variant); p.layers = [emptyLayer(variant)];
  p.macros = [{ actions: [{ type: 'keyTap', usage: 4, modifiers: 8 }] }, { actions: [{ type: 'string', text: 'Hi' }] }];
  p.layers[0]!.keys[0] = { type: 'tapHold', tap: { type: 'macro', macro: 1, repeats: 2 }, hold: { type: 'macro', macro: 0, repeats: 1 } };
  p.layers[0]!.encoderButton = { type: 'tapHold', tap: { type: 'string', text: 'Hi' }, hold: { type: 'string', text: 'Bye' } };
  for (const palettes of [false, true]) {
    if (palettes) { p.layers[0]!.indicatorColor = 0; p.layers[0]!.idleLeds = p.layers[0]!.leds.map(() => 8); }
    const image = encodeProfile(p);
    expect(firmware.accepts(image, variant)).toBe(true);
    expect(encodeProfile(decoded(image))).toEqual(image);
    const address = image[10]!;
    expect(decodeLiveAction(image, image[address]!, image[address + 1]!)).toEqual({ type: 'macro', macro: 1, repeats: 2 });
    expect(decodeLiveAction(image, image[address + 2]!, image[address + 3]!)).toEqual({ type: 'macro', macro: 0, repeats: 1 });
    expect(decodeLiveAction(image, 0x20, 0)).toEqual({ type: 'string', text: 'Hi' });
  }
});

it.each([0, 1] as const)('matches firmware for every wrapper address and malformed record boundary on variant %s', variant => {
  const p = defaultProfile(variant); p.layers = [emptyLayer(variant)]; p.layers[0]!.keys[0] = gesture();
  const original = encodeProfile(p);
  for (let address = 0; address < 256; address++) {
    const image = original.slice(); image[10] = address; sealImage(image);
    expect(decodeImage(image).ok, `address ${address}`).toBe(firmware.accepts(image, variant));
  }
  const record = original[10]!;
  for (const offset of [record - 1, record, record + 2]) for (let first = 0; first < 256; first++) {
    const image = original.slice(); image[offset] = first; sealImage(image);
    expect(decodeImage(image).ok, `byte ${offset}: ${first}`).toBe(firmware.accepts(image, variant));
  }
});

it('preserves mixed binary thresholds until the shared profile setting is explicitly changed', () => {
  const p = defaultProfile(0); p.layers = [emptyLayer(0)];
  p.layers[0]!.keys[0] = { ...gesture(), thresholdMs: 64 };
  p.layers[0]!.keys[1] = { ...gesture(), thresholdMs: 512 };
  const image = encodeProfile(p), read = decoded(image);
  expect(holdBindings(read).map(a => holdThreshold(read, a))).toEqual([64, 512]);
  expect(encodeProfile(read)).toEqual(image);
  expect(encodeProfile(importProfile(exportProfile(read)).profile)).toEqual(image);
  setHoldThreshold(read, 192);
  expect(holdBindings(read).map(a => holdThreshold(read, a))).toEqual([192, 192]);
});

it('rejects nested gestures, release-dependent taps, invalid thresholds and unsupported trigger sites', () => {
  const ctx = { layerCount: 2, rotation: false, macroCount: 1 };
  expect(actionProblem({ ...gesture(), tap: gesture() } as unknown as Action, ctx)).toMatch(/ordinary/);
  expect(actionProblem({ ...gesture(), tap: { type: 'keyHold', usage: 4, modifiers: 0 } }, ctx)).toMatch(/Tap.*release/);
  for (const context of [{ rotation: true }, { timed: true }, { macro: true }]) expect(actionProblem(gesture(), { ...ctx, ...context })).toMatch(/only/);
  const p = defaultProfile(0); p.layers[0]!.keys[0] = gesture(); p.holdThresholdMs = 250;
  expect(validateProfile(p).some(i => i.where === 'Hold Threshold')).toBe(true);
  const raw = JSON.parse(exportProfile(p)); raw.holdThresholdMs = 256; raw.version = 17;
  expect(() => importProfile(JSON.stringify(raw))).toThrow(/version 18/);
  raw.version = 18; raw.layers[0].keys[0].tap = gesture();
  expect(() => importProfile(JSON.stringify(raw))).toThrow(/nested/);
});

it('updates macro references inside both branches and includes Hold layer transitions in reachability', () => {
  const p = defaultProfile(0); p.layers = [emptyLayer(0), emptyLayer(0)];
  p.macros = [{ actions: [] }, { actions: [] }];
  p.layers[0]!.keys[0] = { type: 'tapHold', tap: { type: 'macro', macro: 0, repeats: 1 }, hold: { type: 'macro', macro: 1, repeats: 1 } };
  expect(untriggeredMacros(p)).toEqual([]);
  reorderMacros(p, [1, 0]);
  expect(holdBindings(p)[0]).toMatchObject({ tap: { macro: 1 }, hold: { macro: 0 } });
  removeMacro(p, 0);
  expect(holdBindings(p)[0]).toMatchObject({ tap: { macro: 0 }, hold: { type: 'none' } });
  p.layers[0]!.keys[0] = { ...gesture(), hold: { type: 'momentaryLayer', layer: 1 } };
  expect(layerReachabilityWarnings(p)).toEqual([]);
});

it('colors chosen branches independently from output behavior and keeps ambiguous or overwritten decisions neutral', () => {
  const p = defaultProfile(0); p.layers = [emptyLayer(0)]; p.layers[0]!.keys[0] = gesture();
  const image = encodeProfile(p), classify = liveGestureClassifier(p, image);
  expect(classify(sample({ first: 1, second: 40 }), 0)).toBe('tap');
  expect(classify(sample({ first: 0x12, second: 0 }), 0)).toBe('hold');
  expect(classify(null, 0)).toBe('unknown');
  expect(classify(null, 1)).toBe('tap');
  let activity = advanceActivity(null, sample(), 0, classify);
  activity = advanceActivity(activity, sample({ first: 0x12, second: 0, sequence: 1, bindings: [1, ...Array(8).fill(0)] }), 50, classify);
  expect(activity.triggerKinds![0]).toBe('hold');
  expect(activity.latestGesture).toBe('hold');
  expect(activity.hotUntil[0]).toBe(230);
  const pair = p.layers[0]!.keys[0] as TapHoldAction;
  pair.hold = pair.tap;
  expect(liveGestureClassifier(p, encodeProfile(p))(sample(), 0)).toBe('unknown');
});

it('classifies both chord members and avoids guessing after a layer change', () => {
  const p = defaultProfile(1); p.layers = [emptyLayer(1), emptyLayer(1)];
  p.chords = [{ layer: 0, global: true, keyA: 0, keyB: 1, action: gesture() }];
  const image = encodeProfile(p), classify = liveGestureClassifier(p, image);
  const chord = sample({ source: 0x20, first: 0x12, second: 0, sequence: 1, bindings: [1, ...Array(8).fill(0)] });
  const activity = advanceActivity(advanceActivity(null, sample(), 0, classify), chord, 50, classify);
  expect(activity.triggerKinds!.slice(0, 2)).toEqual(['hold', 'hold']);
  p.chords.push({ layer: 1, keyA: 0, keyB: 1, action: gesture().hold });
  expect(liveGestureClassifier(p, encodeProfile(p))(chord, 0)).toBe('unknown');
});

it.each([0, 1] as const)('saves, verifies and reloads gestures through the HID protocol on variant %s', async variant => {
  const device = new SimulatedDevice({ variant, latency: 0 });
  const client = new ConfigClient(device);
  try {
    expect((await client.getInfo()).actionMask).toBe(0xffff);
    const p = defaultProfile(variant); p.layers = [emptyLayer(variant)];
    p.layers[0]!.keys[0] = gesture(); p.holdThresholdMs = 192;
    const image = encodeProfile(p);
    await client.saveImage(image);
    expect(await client.readFlash()).toEqual(image);
    expect(await client.readActive()).toEqual(image);
    expect(holdThreshold(decoded(await client.readFlash()))).toBe(192);
  } finally { await device.close(); }
});

it('rejects gesture uploads on older v18 firmware without changing saved flash', async () => {
  const device = new SimulatedDevice({ variant: 0, latency: 0, tapHoldSupported: false });
  const client = new ConfigClient(device);
  try {
    expect((await client.getInfo()).actionMask).toBe(0x7fff);
    const before = await client.readFlash();
    const p = defaultProfile(0); p.layers[0]!.keys[0] = gesture();
    await expect(client.saveImage(encodeProfile(p))).rejects.toThrow();
    expect(await client.readFlash()).toEqual(before);
  } finally { await device.close(); }
});
