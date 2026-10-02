import { legacyActionCodes } from './legacy-image';
import { describe, expect, it } from 'vitest';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { exportProfile, importProfile } from '../src/io/json';
import { cloneProfile, defaultProfile, emptyLayer } from '../src/model/defaults';
import { profileChanges } from '../src/model/changes';
import { validateProfile } from '../src/model/validate';
import { RAINBOW_PHASE_DEGREES, type Variant } from '../src/model/constants';
import { ProfilePanel } from '../src/ui/components/ProfilePanel';
import { baseline, profile, toasts, undo, updateProfile } from '../src/ui/store';

describe('rainbow phase spacing', () => {
  it.each([0, 1] as Variant[])('round-trips every choice on variant %s without disturbing the chord window', (variant) => {
    for (let phase = 0; phase < 4; phase++) {
      for (const chordWindow of [0, 8, 15]) {
        const p = defaultProfile(variant);
        p.rainbowPhase = phase;
        p.chordWindow = chordWindow;
        const image = encodeProfile(p);
        expect(image[8]).toBe(chordWindow | (phase << 4) | 0x40);
        expect(decodeImage(image)).toEqual({ ok: true, profile: p });
        const json = exportProfile(p);
        expect(JSON.parse(json).rainbowPhaseDegrees).toBe(RAINBOW_PHASE_DEGREES[phase]);
        expect(importProfile(json).profile).toEqual(p);
      }
    }
  });

  it.each([2, 3, 4])('migrates format %s binary images to 60 degrees on both variants', (version) => {
    for (const variant of [0, 1] as Variant[]) {
      const p = defaultProfile(variant);
      const image = encodeProfile(p);
      legacyActionCodes(image);
      image[2] = version;
      image[8] = image[8]! & 15;
      sealImage(image);
      expect(decodeImage(image)).toEqual({ ok: true, profile: p });
      image[8] = image[8]! | 0x10;
      sealImage(image);
      expect(decodeImage(image).ok).toBe(false);
    }
  });

  it('preserves format 4 extended layers and chords during migration', () => {
    const p = defaultProfile(1);
    while (p.layers.length < 7) p.layers.push(emptyLayer(1));
    p.startupLayer = 6;
    p.chords = [{ layer: 6, keyA: 0, keyB: 2, global: true, action: { type: 'relativeLayer', offset: -6 } }];
    const image = encodeProfile(p);
    legacyActionCodes(image);
    image[2] = 4;
    image[8] = image[8]! & 15;
    sealImage(image);
    expect(decodeImage(image)).toEqual({ ok: true, profile: p });
  });

  it.each([1, 2, 3, 4])('migrates JSON version %s to the shared default', (version) => {
    const p = defaultProfile(1);
    const old = JSON.parse(exportProfile(p));
    old.version = version;
    delete old.rainbowPhaseDegrees;
    expect(importProfile(JSON.stringify(old)).profile).toEqual(p);
  });

  it.each([5, 6])('imports legacy 120-degree JSON version %s as the 150-degree preset', (version) => {
    const p = defaultProfile(0);
    p.rainbowPhase = 3;
    const raw = JSON.parse(exportProfile(p));
    raw.version = version;
    raw.rainbowPhaseDegrees = 120;
    const imported = importProfile(JSON.stringify(raw)).profile;
    expect(imported).toEqual(p);
    expect(JSON.parse(exportProfile(imported)).rainbowPhaseDegrees).toBe(150);
  });

  it('rejects invalid new JSON choices and invalid editor values', () => {
    const p = defaultProfile(0);
    for (const invalid of [-1, 4, 1.5, NaN]) {
      p.rainbowPhase = invalid;
      expect(validateProfile(p).some((issue) => issue.message.includes('Rainbow phase'))).toBe(true);
    }
    p.rainbowPhase = 2;
    for (const invalid of [undefined, null, 45, '60']) {
      const raw = JSON.parse(exportProfile(p));
      raw.rainbowPhaseDegrees = invalid;
      expect(() => importProfile(JSON.stringify(raw))).toThrow();
    }
  });

  it('includes phase changes in the save comparison and supports reverting them', () => {
    const saved = defaultProfile(0);
    const edited = cloneProfile(saved);
    edited.rainbowPhase = 0;
    const changes = profileChanges(saved, edited);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ where: 'Rainbow phase spacing', before: '60°', after: '0°' });
    changes[0]!.undo!(edited);
    expect(edited).toEqual(saved);
  });

  it('offers all four phase choices and edits them through undoable profile updates', () => {
    type Element = { type: unknown; props: Record<string, unknown> };
    const elements = (node: unknown): Element[] => {
      if (Array.isArray(node)) return node.flatMap(elements);
      if (!node || typeof node !== 'object' || !('props' in node)) return [];
      const e = node as Element;
      return [e, ...elements(e.props.children)];
    };
    profile.value = defaultProfile(1);
    profile.value.layers[0]!.indicatorColor = 15;
    baseline.value = cloneProfile(profile.value);
    const info = () => elements(ProfilePanel()).find((e) => e.props.class === 'notice notice-info');
    expect(info()).toBeUndefined();
    const toastCount = toasts.value.length;
    const selector = elements(ProfilePanel()).find((e) => e.type === 'select' && e.props.id === 'rainbow-phase')!;
    expect(selector.props.value).toBe(2);
    expect(elements(selector.props.children).filter((e) => e.type === 'option').map((e) => e.props.value)).toEqual([0, 1, 2, 3]);
    expect(elements(selector.props.children).map((e) => e.props.children)).toEqual([
      '0° — All LEDs together', '30° — Gentle color wave', '60° — Rainbow sweep', '150° — Scattered colors',
    ]);
    // Start a fresh history before invoking the actual selector callback.
    updateProfile((p) => { p.rainbowPhase = 2; });
    (selector.props.onChange as (event: unknown) => void)({ target: { value: '3' } });
    expect(profile.value!.rainbowPhase).toBe(3);
    expect(info()?.props).toMatchObject({ role: 'status', children: 'Color previews will not use this setting until it is saved to the device' });
    expect(toasts.value).toHaveLength(toastCount);
    undo();
    expect(profile.value!.rainbowPhase).toBe(2);
    expect(info()).toBeUndefined();
    updateProfile((p) => { p.rainbowPhase = 3; });
    expect(info()).toBeDefined();
    baseline.value = cloneProfile(profile.value!); // Successful save updates the device baseline.
    expect(info()).toBeUndefined();
  });

  it('sets every bundled JSON profile and both starters to 60 degrees', () => {
    for (const variant of [0, 1] as Variant[]) expect(defaultProfile(variant).rainbowPhase).toBe(2);
    const bundled = import.meta.glob<string>('../../profiles/*.json', { query: '?raw', import: 'default', eager: true });
    expect(Object.keys(bundled)).toHaveLength(2);
    for (const text of Object.values(bundled)) {
      expect(JSON.parse(text).version).toBe(6);
      expect(importProfile(text).profile.rainbowPhase).toBe(2);
    }
  });
});
