import { describe, expect, it } from 'vitest';
import { encodeAction, encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { defaultProfile } from '../src/model/defaults';
import { LED_COMMANDS, ledProblem } from '../src/model/ledControl';
import { actionProblem } from '../src/model/validate';
import { importProfile, exportProfile } from '../src/io/json';
import { legacyActionCodes } from './legacy-image';

describe('LED control format 6', () => {
  it.each([0, 1] as const)('validates all 4096 payloads on variant %s with exactly 116 accepted', (variant) => {
    const image = encodeProfile(defaultProfile(variant));
    let accepted = 0;
    for (let command = 0; command < 256; command++) for (let nibble = 0; nibble < 16; nibble++) {
      image[9] = nibble << 4 | 15; image[10] = command; sealImage(image);
      const spec = LED_COMMANDS[command];
      const value = spec?.relative ? nibble < 8 ? nibble : nibble - 16 : nibble === 15 ? 'asConfigured' : nibble;
      const valid = !!spec && !ledProblem(spec.command, value);
      const result = decodeImage(image);
      expect(result.ok).toBe(valid);
      if (result.ok && spec) {
        accepted++;
        const action = result.profile.layers[0]!.keys[0]!;
        expect(encodeAction(action, new Map())).toEqual([image[9], command]);
        expect(actionProblem(action, { rotation: true, layerCount: 2 })).toBeNull();
      }
    }
    expect(accepted).toBe(116);
  });
  it('rejects malformed LED inputs before standalone encoding can truncate them', () => {
    for (const value of [0, -8, 8, 127, 16, NaN]) {
      expect(() => encodeAction({ type: 'ledControl', command: 'rainbowPhaseRelative', value }, new Map())).toThrow();
    }
    expect(() => encodeAction({ type: 'ledControl', command: 'brightnessBothSet', value: 16 }, new Map())).toThrow();
    expect(() => encodeAction({ type: 'ledControl', command: 'future' as never, value: 0 }, new Map())).toThrow();
  });
  it('uses the value nibble, full command byte, and semantic JSON restore values', () => {
    const p = defaultProfile(1);
    p.layers[0]!.keys[0] = { type: 'ledControl', command: 'brightnessBothSet', value: 'asConfigured' };
    p.layers[0]!.encoderButton = { type: 'ledControl', command: 'commonPresetToggle', value: 3 };
    expect(encodeAction(p.layers[0]!.encoderButton, new Map())).toEqual([0x3f, 0x0d]);
    p.layers[0]!.clockwise = { type: 'ledControl', command: 'commonPresetRelative', value: 1 };
    p.layers[0]!.counterclockwise = { type: 'ledControl', command: 'commonPresetRelative', value: -1 };
    p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: true, action: { type: 'ledControl', command: 'commonPresetSet', value: 3 } }];
    expect(encodeAction(p.layers[0]!.keys[0]!, new Map())).toEqual([0xff, 8]);
    expect(importProfile(exportProfile(p)).profile).toEqual(p);
    expect(decodeImage(encodeProfile(p))).toEqual({ ok: true, profile: p });
    const old = JSON.parse(exportProfile(p)); old.version = 5;
    expect(() => importProfile(JSON.stringify(old))).toThrow('version 6');
  });
  it.each([2, 3, 4, 5])('migrates old D/E/F action semantics from format %s', (version) => {
    const p = defaultProfile(1);
    p.layers[0]!.keys[0] = { type: 'oneShotRelativeLayer', offset: -1 };
    p.layers[0]!.keys[1] = { type: 'mouseX', delta: -127, hold: true };
    p.layers[0]!.keys[2] = { type: 'mouseY', delta: 127, hold: true };
    p.layers[0]!.encoderButton = { type: 'mouseY', delta: -1 };
    p.layers[0]!.clockwise = { type: 'relativeLayer', offset: 1 };
    p.layers[0]!.counterclockwise = { type: 'mouseX', delta: 7 };
    p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: true, action: { type: 'mouseY', delta: -3 } }];
    const image = encodeProfile(p); legacyActionCodes(image); image[2] = version;
    if (version < 5) image[8] = image[8]! & 15;
    sealImage(image);
    expect(decodeImage(image)).toEqual({ ok: true, profile: p });
    image[9] = 0x0c; sealImage(image);
    expect(decodeImage(image)).toMatchObject({ ok: false });
  });
  it('preserves every v5 rainbow combination and metadata through binary and JSON migration', () => {
    for (let phase = 0; phase < 4; phase++) for (let speed = 0; speed < 4; speed++) {
      const p = defaultProfile(1); p.rainbowPhase = phase; p.rainbowSpeed = speed;
      const image = encodeProfile(p); legacyActionCodes(image); image[2] = 5; sealImage(image);
      expect(decodeImage(image)).toEqual({ ok: true, profile: p });
      const data = JSON.parse(exportProfile(p, { profileName: 'Old', layerNames: ['One', 'Two'] })); data.version = 5;
      expect(importProfile(JSON.stringify(data))).toEqual({ profile: p, meta: data.localMetadata });
    }
  });
});
