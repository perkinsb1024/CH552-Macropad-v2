import { describe, expect, it } from 'vitest';
import { parseStatus, parseRuntime, parseTimers, type FastLiveState } from '../src/protocol/packet';
import { advanceActivity, counterDelta, sourceKeys, timerRemaining } from '../src/protocol/live';
import { ConfigClient, ProtocolError } from '../src/protocol/client';
import { SimulatedDevice } from '../src/protocol/simulator';
import { defaultProfile } from '../src/model/defaults';
import { encodeProfile } from '../src/codec/encode';
import { decodeLiveAction } from '../src/codec/decode';
import { ActionCode } from '../src/model/constants';

const sample = (changes: Partial<FastLiveState> = {}): FastLiveState => ({
  bindingLayer: 0, pressed: 0, clockwise: 0, counterclockwise: 0, bindings: Array(9).fill(0),
  source: 0, first: 1, second: 4, sequence: 0, ...changes,
});
describe('telemetry decoding and activity', () => {
  it('preserves old status replies and decodes the appended prefix-compatible fields', () => {
    expect(parseStatus(Uint8Array.of(1, 2, 0, 0, 3, 4))?.live).toBeUndefined();
    const bytes = Uint8Array.from([1, 2, 0, 0, 3, 4, 1, 65, 254, 3, ...Array(9).fill(9), 0x20, 0x31, 4, 255]);
    const status = parseStatus(bytes)!;
    expect(status.currentLayer).toBe(2);
    expect(status.droppedRotationActions).toBe(4);
    expect(status.live).toMatchObject({ bindingLayer: 1, pressed: 65, clockwise: 254, counterclockwise: 3, source: 0x20, first: 0x31, second: 4, sequence: 255 });
    expect(sourceKeys(0x20)).toEqual([0, 1]);
    expect(sourceKeys(0x01)).toEqual([1]);
    expect(sourceKeys(0x87)).toEqual([]);
  });
  it('counts both rotation directions and wraps without treating physical wake as a binding', () => {
    const before = advanceActivity(null, sample({ clockwise: 254, counterclockwise: 255 }), 0);
    const after = advanceActivity(before, sample({ clockwise: 1, counterclockwise: 1 }), 50);
    expect(after.turns).toEqual([3, 2]);
    expect(after.turnUntil).toEqual([230, 230]);
    expect(after.hotUntil[7]).toBe(0);
    expect(after.latest).toBeNull();
    expect(counterDelta(0, 255)).toBe(1);
  });
  it('accumulates detents independently until each direction highlight expires', () => {
    let activity = advanceActivity(null, sample({ clockwise: 254 }), 0);
    activity = advanceActivity(activity, sample({ clockwise: 255, counterclockwise: 2 }), 50);
    activity = advanceActivity(activity, sample({ clockwise: 1, counterclockwise: 2 }), 150);
    expect(activity.turns).toEqual([3, 2]);
    expect(activity.turnUntil).toEqual([330, 230]);
    activity = advanceActivity(activity, sample({ clockwise: 1, counterclockwise: 2 }), 200);
    expect(activity.turns).toEqual([3, 2]);
    expect(activity.turnUntil).toEqual([330, 230]); // Idle polls do not extend highlights.
    activity = advanceActivity(activity, sample({ clockwise: 2, counterclockwise: 3 }), 250);
    expect(activity.turns).toEqual([4, 1]);
    expect(activity.turnUntil).toEqual([430, 430]);
    activity = advanceActivity(activity, sample({ clockwise: 2, counterclockwise: 3 }), 430);
    expect(activity.turns).toEqual([0, 0]);
    activity = advanceActivity(activity, sample({ clockwise: 3, counterclockwise: 4 }), 450);
    expect(activity.turns).toEqual([1, 1]);
  });
  it('starts a new detent count when a turn arrives exactly at highlight expiry', () => {
    let activity = advanceActivity(null, sample(), 0);
    activity = advanceActivity(activity, sample({ clockwise: 2 }), 50);
    activity = advanceActivity(activity, sample({ clockwise: 3 }), 230);
    expect(activity.turns).toEqual([1, 0]);
  });
  it('flashes short accepted presses and both chord keys after they have been released', () => {
    const before = advanceActivity(null, sample({ sequence: 255 }), 0);
    const after = advanceActivity(before, sample({ source: 0x20, sequence: 0, bindings: [1, ...Array(8).fill(0)] }), 50);
    expect(after.sample.pressed).toBe(0);
    expect(after.hotUntil.slice(0, 2)).toEqual([230, 230]);
    expect(after.latest?.source).toBe(0x20);
    expect(after.bindingDelta).toBe(1);
  });
  it('retains only the latest action while recording a multi-action update, and drops old activity after a gap', () => {
    const before = advanceActivity(null, sample(), 0);
    const after = advanceActivity(before, sample({ sequence: 5, source: 1 }), 50);
    expect(after.bindingDelta).toBe(5);
    expect(after.latest?.source).toBe(1);
    const resumed = advanceActivity(after, sample({ sequence: 10 }), 1100);
    expect(resumed.latest).toBeNull();
    expect(resumed.hotUntil).toEqual(Array(9).fill(0));
  });
  it('decodes LED policies and preview/effect state without transmitting rendered colors', () => {
    const bytes = new Uint8Array(23);
    bytes.set([2, 1, 0, 255, 1, 42, 3]);
    bytes.set([3, 2, 1, 0, 0xfd, 2, 0, 8], 14);
    expect(parseRuntime(bytes)).toMatchObject({ layer: 2, baseLayer: 1, oneShotReturn: 255, actionBusy: true,
      macroBusy: true, queued: 3, rainbowPhase: 3, rainbowSpeed: 2, indicatorPolicy: 1, keyPolicy: 0, colorPreview: true, generation: 8 });
    bytes[18] = 0xfb;
    expect(parseRuntime(bytes)?.colorPreview).toBe(false);
    expect(parseRuntime(bytes.slice(0, 22))).toBeNull();
  });
  it('uses coarse age, high bits and 16ms fractions while ignoring the pending-action bit', () => {
    const bytes = new Uint8Array(17);
    bytes[0] = 12; bytes[5] = 9; bytes[10] = 128; bytes[15] = 0x34; bytes[16] = 0x12;
    const state = parseTimers(bytes)!;
    expect(state.profileCrc).toBe(0x1234);
    expect(timerRemaining(state, 0, 440)).toBeCloseTo((440 - 256 - 12.5) * 4.096);
    expect(timerRemaining(state, 0, 1)).toBe(0);
    expect(parseTimers(bytes.slice(0, 16))).toBeNull();
  });
});
describe('telemetry protocol integration', () => {
  it('reads snapshots and tolerates older firmware without telemetry', async () => {
    const device = new SimulatedDevice({ variant: 0 });
    const client = new ConfigClient(device);
    device.liveStatus[1] = 1;
    device.liveStatus[4] = 7;
    device.runtime[13] = 5;
    expect((await client.getStatus()).live?.pressed).toBe(1);
    expect((await client.getRuntime()).mouseButtons).toBe(5);
    expect((await client.getTimers()).profileCrc).toBe(device.active[7]! | device.active[8]! << 8);
    expect((await client.getStatus()).live?.bindings[0]).toBe(7); // Reads are nondestructive.
    await device.close();
    const old = new SimulatedDevice({ variant: 0, liveSupported: false });
    const oldClient = new ConfigClient(old);
    expect((await oldClient.getStatus()).live).toBeUndefined();
    await expect(oldClient.getRuntime()).rejects.toBeInstanceOf(ProtocolError);
    await old.close();
  });
  it('decodes the actual dispatched bytes even after a layer change, including strings and macros', () => {
    const p = defaultProfile(0); p.layers = p.layers.slice(0, 1);
    p.layers[0]!.keys[0] = { type: 'string', text: 'Hello' };
    p.layers[0]!.keys[1] = { type: 'macro', macro: 0, repeats: 2 };
    p.macros = [{ actions: [{ type: 'keyTap', usage: 4, modifiers: 0 }] }];
    const image = encodeProfile(p);
    expect(decodeLiveAction(image, image[9]!, image[10]!)).toEqual(p.layers[0]!.keys[0]);
    expect(decodeLiveAction(image, image[11]!, image[12]!)).toEqual(p.layers[0]!.keys[1]);
    expect(decodeLiveAction(image, ActionCode.KeyTap, 5)).toEqual({ type: 'keyTap', usage: 5, modifiers: 0 });
    expect(decodeLiveAction(image, 13, 14)).toBeNull(); // Internal sleep commands are not saved bindings.
    image[12] = image[12]! ^ 1;
    expect(decodeLiveAction(image, 1, 4)).toBeNull();
  });
});
