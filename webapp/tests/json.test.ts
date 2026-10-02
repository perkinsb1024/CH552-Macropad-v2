import { describe, expect, it } from 'vitest';
import { exportProfile, importProfile, ImportError } from '../src/io/json';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { VARIANT_SIX_KEYS, VARIANT_THREE_KEYS } from '../src/model/constants';

describe('JSON import/export', () => {
  it('preserves transparency and migrates older profile versions with transparency off', () => {
    const profile = defaultProfile(VARIANT_THREE_KEYS);
    profile.transparentBlack = true;
    const text = exportProfile(profile);
    expect(importProfile(text).profile).toEqual(profile);
    for (const version of [1, 2]) {
      const legacy = JSON.parse(text);
      legacy.version = version;
      delete legacy.transparentBlack;
      expect(importProfile(JSON.stringify(legacy)).profile).toEqual({ ...profile, transparentBlack: false });
    }
    expect(() => importProfile(text.replace('"version": 5', '"version": 6'))).toThrow(ImportError);
    expect(() => importProfile(text.replace('"transparentBlack": true', '"transparentBlack": 1'))).toThrow(ImportError);
  });
  it('preserves pointer hold and accepts older pointer actions without the option', () => {
    const profile = defaultProfile(VARIANT_SIX_KEYS);
    profile.layers[0]!.keys[0] = { type: 'mouseX', delta: -1, hold: true };
    profile.layers[0]!.keys[1] = { type: 'mouseY', delta: 1 };
    const text = exportProfile(profile);
    expect(importProfile(text).profile).toEqual(profile);
    expect(() => importProfile(text.replace('"hold": true', '"hold": 1'))).toThrow(ImportError);
  });
  it('round-trips with metadata', () => {
    const profile = defaultProfile(VARIANT_SIX_KEYS);
    profile.layers.push(emptyLayer(VARIANT_SIX_KEYS));
    profile.layers[1]!.keys[2] = { type: 'string', text: 'line1\nline2' };
    profile.chords.push({ layer: 1, keyA: 2, keyB: 4, global: false, action: { type: 'consumer', usage: 0xe9 } });
    const text = exportProfile(profile, { layerNames: ['Base', 'Media'] });
    const parsed = JSON.parse(text);
    expect(parsed.layers[0].leds[0]).toBe('White');
    expect(parsed.chordWindowMs).toBe(40);
    const imported = importProfile(text);
    expect(imported.profile).toEqual(profile);
    expect(imported.meta.layerNames).toEqual(['Base', 'Media']);
  });
  it('normalizes CRLF and rejects invalid content', () => {
    const profile = defaultProfile(VARIANT_THREE_KEYS);
    profile.layers[0]!.keys[0] = { type: 'string', text: 'a\nb' };
    const text = exportProfile(profile).replace('a\\nb', 'a\\r\\nb');
    expect(importProfile(text).profile.layers[0]!.keys[0]).toEqual({ type: 'string', text: 'a\nb' });
    expect(() => importProfile('{}')).toThrow(ImportError);
    expect(() => importProfile(text.replace('"startupLayer": 0', '"startupLayer": 3'))).toThrow(ImportError);
    expect(() => importProfile(text.replace('"a\\r\\nb"', '"é"'))).toThrow(ImportError);
  });
  it('migrates legacy nextLayer actions', () => {
    const profile = defaultProfile(VARIANT_SIX_KEYS);
    const text = exportProfile(profile).replace('"type": "keyTap"', '"type": "nextLayer"');
    expect(importProfile(text).profile.layers[0]!.keys[0]).toEqual({ type: 'relativeLayer', offset: 0 });
  });
});
