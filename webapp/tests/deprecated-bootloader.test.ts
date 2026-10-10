import { describe, expect, it } from 'vitest';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { defaultProfile } from '../src/model/defaults';
import { exportProfile, importProfile } from '../src/io/json';

describe('deprecated runtime bootloader permission', () => {
  it.each([0, 1] as const)('accepts existing bits but clears them on save for variant %i', variant => {
    const profile = defaultProfile(variant);
    const image = encodeProfile(profile);
    const size = variant ? 15 : 22;
    for (let layer = 0; layer < profile.layers.length; layer++) image[9 + size * (layer + 1) - 1]! |= 2;
    sealImage(image);
    const decoded = decodeImage(image);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error(decoded.detail);
    expect(decoded.profile).toEqual(profile);
    expect(encodeProfile(decoded.profile)).toEqual(encodeProfile(profile));
  });

  it('ignores the former JSON field and omits it from new exports', () => {
    const profile = defaultProfile(0);
    const legacy = JSON.parse(exportProfile(profile));
    legacy.layers.forEach((layer: Record<string, unknown>) => { layer.bootloaderFromRun = true; });
    const imported = importProfile(JSON.stringify(legacy)).profile;
    expect(imported).toEqual(profile);
    expect(exportProfile(imported)).not.toContain('bootloaderFromRun');
  });
});
