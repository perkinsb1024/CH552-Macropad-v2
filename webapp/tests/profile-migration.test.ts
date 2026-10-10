import { legacyActionCodes, legacyTextCodes, legacyV10Codes } from './legacy-image';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteUrl } from '../src/site';
import { encodeProfile } from '../src/codec/encode';
import { sealImage } from '../src/codec/crc16';
import { defaultProfile } from '../src/model/defaults';
import { ConfigClient } from '../src/protocol/client';
import { Opcode } from '../src/protocol/packet';
import { SimulatedDevice } from '../src/protocol/simulator';
import { canSave, connection, connectSimulator, disconnect, profile, save, archivedFirmware } from '../src/ui/store';
import { ArchivedFirmwareNotice } from '../src/ui/components/ArchivedFirmwareNotice';

afterEach(async () => { await disconnect(); vi.restoreAllMocks(); });

function legacyImage() {
  const image = encodeProfile(defaultProfile(0));
  legacyActionCodes(image);
  image[2] = 2;
  image[8] = image[8]! & 15;
  sealImage(image);
  return image;
}

describe('device profile migration', () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])('loads format %s flash on new firmware and saves the upgraded profile only on request', async (version) => {
    const legacy = version >= 6 ? encodeProfile(defaultProfile(0)) : legacyImage();
    if (version >= 6 && version < 8) legacyTextCodes(legacy);
    if (version >= 8 && version < 11) legacyV10Codes(legacy);
    legacy[2] = version;
    if (version === 5) legacy[8] = 0x68;
    sealImage(legacy);
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
    expect(device.flash[2]).toBe(12);
    expect(device.flashValid).toBe(true);
  });

  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])('offers the archived editor instead of connecting to version %s firmware', async (version) => {
    const originalGetInfo = ConfigClient.prototype.getInfo;
    vi.spyOn(ConfigClient.prototype, 'getInfo').mockImplementation(async function (this: ConfigClient) {
      return { ...await originalGetInfo.call(this), formatVersion: version };
    });
    const writes = vi.spyOn(ConfigClient.prototype, 'saveImage');
    const flashReads = vi.spyOn(ConfigClient.prototype, 'readFlash');
    await connectSimulator(0);
    expect(connection.value.kind).toBe('disconnected');
    expect(canSave.value).toBe(false);
    expect(archivedFirmware.value).toEqual({ version, url: siteUrl(`versions/format-v${version}/`) });
    const notice = ArchivedFirmwareNotice()!;
    const links = (notice.props.children as { props?: { href?: string } }[])
      .filter(child => child && typeof child === 'object' && child.props?.href)
      .map(child => child.props!.href);
    expect(links).toEqual([siteUrl(`versions/format-v${version}/`), siteUrl('webUploader/')]);
    expect(flashReads).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    await connectSimulator(0);
    expect(connection.value.kind).toBe('connected');
    expect(archivedFirmware.value).toBeNull();
  });
});
