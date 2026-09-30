import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeProfile } from '../src/codec/encode';
import { sealImage } from '../src/codec/crc16';
import { defaultProfile } from '../src/model/defaults';
import { Opcode } from '../src/protocol/packet';
import { SimulatedDevice } from '../src/protocol/simulator';
import { canSave, connection, connectSimulator, disconnect, issues, profile, save, saveState, updateProfile } from '../src/ui/store';

afterEach(async () => { await disconnect(); vi.restoreAllMocks(); });

function legacyImage() {
  const image = encodeProfile(defaultProfile(0));
  image[2] = 2;
  sealImage(image);
  return image;
}

describe('device profile migration', () => {
  it('loads old flash on new firmware and saves the upgraded profile only on request', async () => {
    const legacy = legacyImage();
    const originalSend = SimulatedDevice.prototype.send;
    let seeded = false;
    vi.spyOn(SimulatedDevice.prototype, 'send').mockImplementation(function (this: SimulatedDevice, payload) {
      if (!seeded && payload[3] === Opcode.GetInfo) {
        seeded = true;
        this.flash.set(legacy);
        this.flashValid = false;
      }
      return originalSend.call(this, payload);
    });
    await connectSimulator(0);
    const c = connection.value;
    if (c.kind !== 'connected') throw new Error('connection failed');
    const device = c.connection.transport as SimulatedDevice;
    expect(profile.value).toEqual(defaultProfile(0));
    expect(device.flash).toEqual(legacy);
    expect(canSave.value).toBe(true);
    await save();
    expect(device.flash[2]).toBe(3);
    expect(device.flashValid).toBe(true);
  });

  it.each([0, 1] as const)('saves and verifies format 2 on an older variant %s device', async (variant) => {
    await connectSimulator(variant, false, 2);
    const c = connection.value;
    if (c.kind !== 'connected') throw new Error('connection failed');
    expect(profile.value).toEqual(defaultProfile(variant));
    expect(canSave.value).toBe(true);
    updateProfile((p) => {
      p.layers[0]!.indicatorBehavior = 1;
      p.layers[0]!.indicatorColor = 8;
      p.layers[0]!.keys[0] = { type: 'string', text: 'legacy save' };
      p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: true, action: { type: 'setLayer', layer: 1 } }];
    });
    await save();
    const device = c.connection.transport as SimulatedDevice;
    expect(saveState.value.phase).toBe('saved');
    expect(device.flash).toEqual(encodeProfile(profile.value!, 2));
    expect(device.flash[2]).toBe(2);
    expect(device.flash[5]! & 0x80).toBe(0);
    expect(device.flashValid).toBe(true);
  });

  it('requires explicitly disabling imported transparency before saving to v2', async () => {
    await connectSimulator(0, false, 2);
    const c = connection.value;
    if (c.kind !== 'connected') throw new Error('connection failed');
    const device = c.connection.transport as SimulatedDevice;
    const before = device.flash.slice();
    updateProfile((p) => { p.transparentBlack = true; });
    expect(canSave.value).toBe(false);
    expect(issues.value.some((issue) => issue.message.includes('Transparent black requires'))).toBe(true);
    await save();
    expect(device.flash).toEqual(before);
    expect(profile.value!.transparentBlack).toBe(true);
    updateProfile((p) => { p.transparentBlack = false; });
    expect(canSave.value).toBe(true);
    await save();
    expect(saveState.value.phase).toBe('saved');
    expect(device.flash[2]).toBe(2);
  });
});
