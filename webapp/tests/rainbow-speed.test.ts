import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { exportProfile, importProfile } from '../src/io/json';
import { draftKey, loadDraft, storeDraft } from '../src/io/drafts';
import { cloneProfile, defaultProfile } from '../src/model/defaults';
import { profileChanges } from '../src/model/changes';
import { validateProfile } from '../src/model/validate';
import { RAINBOW_SPEED_LABELS, type Variant } from '../src/model/constants';
import { ProfilePanel } from '../src/ui/components/ProfilePanel';
import { baseline, profile, undo, updateProfile } from '../src/ui/store';

afterEach(() => vi.unstubAllGlobals());

describe('rainbow speed', () => {
  it.each([0, 1] as Variant[])('round-trips all header-bit combinations and JSON speeds on variant %s', (variant) => {
    for (let speed = 0; speed < 4; speed++) {
      for (let phase = 0; phase < 4; phase++) {
        for (let chordWindow = 0; chordWindow < 16; chordWindow++) {
          const p = defaultProfile(variant);
          p.rainbowSpeed = speed;
          p.rainbowPhase = phase;
          p.chordWindow = chordWindow;
          const image = encodeProfile(p);
          expect(image[2]).toBe(5);
          expect(image[8]).toBe(chordWindow | (phase << 4) | (speed << 6));
          expect(decodeImage(image)).toEqual({ ok: true, profile: p });
          const text = exportProfile(p);
          expect(JSON.parse(text).rainbowSpeed).toBe(RAINBOW_SPEED_LABELS[speed]!.toLowerCase());
          expect(importProfile(text).profile).toEqual(p);
        }
      }
    }
  });

  it.each([1, 2, 3, 4, 5])('migrates JSON v%s without speed to Fast', (version) => {
    const p = defaultProfile(1);
    const old = JSON.parse(exportProfile(p));
    old.version = version;
    delete old.rainbowSpeed;
    expect(importProfile(JSON.stringify(old)).profile).toEqual(p);
  });

  it('preserves a pre-speed v5 JSON phase setting when adding Fast speed', () => {
    const p = defaultProfile(0);
    p.rainbowPhase = 3;
    const old = JSON.parse(exportProfile(p));
    delete old.rainbowSpeed;
    expect(importProfile(JSON.stringify(old)).profile).toEqual(p);
  });

  it.each([2, 3, 4])('migrates binary format %s to Fast', (version) => {
    const p = defaultProfile(0);
    const image = encodeProfile(p);
    image[2] = version;
    image[8] = image[8]! & 15;
    sealImage(image);
    expect(decodeImage(image)).toEqual({ ok: true, profile: p });
  });

  it('interprets 00 in v5 binary images as Extra fast, without changing the format', () => {
    const p = defaultProfile(0);
    p.rainbowSpeed = 0;
    expect(decodeImage(encodeProfile(p))).toEqual({ ok: true, profile: p });
  });

  it('migrates pre-speed v5 drafts and preserves speed in new drafts', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const p = defaultProfile(0);
    p.rainbowPhase = 3;
    const old = { ...p } as Partial<typeof p>;
    delete old.rainbowSpeed;
    storage.set(draftKey(0), JSON.stringify({ formatVersion: 5, profile: old, meta: {}, savedAt: 'old' }));
    expect(loadDraft(0)?.profile).toEqual(p);
    p.rainbowSpeed = 3;
    storeDraft(p, {});
    expect(loadDraft(0)?.profile).toEqual(p);
  });

  it('imports the previous experimental speed names at their existing indices', () => {
    for (const [index, name] of ['double', 'normal', 'half', 'quarter'].entries()) {
      const p = defaultProfile(0);
      p.rainbowSpeed = index;
      const raw = JSON.parse(exportProfile(p));
      raw.rainbowSpeed = name;
      expect(importProfile(JSON.stringify(raw)).profile).toEqual(p);
    }
  });

  it('rejects invalid editor and JSON speed values', () => {
    const p = defaultProfile(0);
    for (const invalid of [-1, 4, 1.5, NaN]) {
      p.rainbowSpeed = invalid;
      expect(validateProfile(p).some((issue) => issue.message.includes('Rainbow speed'))).toBe(true);
    }
    p.rainbowSpeed = 1;
    for (const invalid of [null, 1, 'turbo', '']) {
      const raw = JSON.parse(exportProfile(p));
      raw.rainbowSpeed = invalid;
      expect(() => importProfile(JSON.stringify(raw))).toThrow();
    }
  });

  it('offers speed beside phase, with undo, change comparison, and an inline save reminder', () => {
    type Element = { type: unknown; props: Record<string, unknown> };
    const elements = (node: unknown): Element[] => {
      if (Array.isArray(node)) return node.flatMap(elements);
      if (!node || typeof node !== 'object' || !('props' in node)) return [];
      const e = node as Element;
      return [e, ...elements(e.props.children)];
    };
    profile.value = defaultProfile(1);
    baseline.value = cloneProfile(profile.value);
    const controls = () => elements(ProfilePanel());
    const info = () => controls().filter((e) => e.props.class === 'notice notice-info');
    const selector = controls().find((e) => e.props.id === 'rainbow-speed')!;
    expect(selector.props.value).toBe(1);
    expect(elements(selector.props.children).map((e) => e.props.children)).toEqual(['Extra fast', 'Fast', 'Slow', 'Extra slow']);
    const fields = controls().filter((e) => e.props.class === 'field');
    expect(fields.filter((e) => elements(e).some((child) => child.props.id === 'rainbow-phase' || child.props.id === 'rainbow-speed'))).toHaveLength(2);
    expect(info()).toHaveLength(0);
    (selector.props.onChange as (event: unknown) => void)({ target: { value: '0' } });
    expect(profile.value!.rainbowSpeed).toBe(0);
    expect(info()).toHaveLength(1);
    expect(profileChanges(baseline.value, profile.value!)[0]).toMatchObject({ where: 'Rainbow speed', before: 'Fast', after: 'Extra fast' });
    undo();
    expect(profile.value!.rainbowSpeed).toBe(1);
    expect(info()).toHaveLength(0);
    updateProfile((p) => { p.rainbowSpeed = 3; });
    const change = profileChanges(baseline.value, profile.value!)[0]!;
    const restored = cloneProfile(profile.value!);
    change.undo!(restored);
    expect(restored).toEqual(baseline.value);
    baseline.value = cloneProfile(profile.value!);
    expect(info()).toHaveLength(0);
  });

  it('sets both starters and all bundled profiles to Fast', () => {
    for (const variant of [0, 1] as Variant[]) expect(defaultProfile(variant).rainbowSpeed).toBe(1);
    const bundled = import.meta.glob<string>('../../profiles/*.json', { query: '?raw', import: 'default', eager: true });
    expect(Object.keys(bundled)).toHaveLength(2);
    for (const text of Object.values(bundled)) {
      expect(JSON.parse(text).rainbowSpeed).toBe('fast');
      expect(importProfile(text).profile.rainbowSpeed).toBe(1);
    }
  });
});
