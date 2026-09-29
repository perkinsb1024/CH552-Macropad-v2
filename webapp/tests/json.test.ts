import { describe, expect, it } from 'vitest';
import { exportProfile, importProfile, ImportError } from '../src/io/json';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { VARIANT_SIX_KEYS, VARIANT_THREE_KEYS } from '../src/model/constants';

describe('JSON import/export', () => {
  it('round-trips with metadata', () => {
    const profile = defaultProfile(VARIANT_SIX_KEYS);
    profile.layers.push(emptyLayer(VARIANT_SIX_KEYS));
    profile.layers[1]!.keys[2] = { type: 'string', text: 'line1\nline2' };
    profile.chords.push({ layer: 1, keyA: 2, keyB: 4, action: { type: 'consumer', usage: 0xe9 } });
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
  it('imports a legacy nextLayer JSON action as a zero-offset action', () => {
    const profile = defaultProfile(VARIANT_SIX_KEYS);
    const text = exportProfile(profile).replace('"type": "keyTap"', '"type": "nextLayer"');
    expect(importProfile(text).profile.layers[0]!.keys[0]).toEqual({ type: 'relativeLayer', offset: 0 });
  });
});
