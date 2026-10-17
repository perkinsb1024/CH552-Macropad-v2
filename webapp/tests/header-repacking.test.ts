import { legacyJson, legacyProfile } from './legacy-image';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage, peekHeader } from '../src/codec/decode';
import { imageCrc, sealImage, storedCrc } from '../src/codec/crc16';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { validateProfile } from '../src/model/validate';
import { exportProfile, importProfile } from '../src/io/json';
import { draftKey, loadDraft, storeDraft } from '../src/io/drafts';
import { createFirmwareValidator } from './firmware-validator.mjs';
import { legacyHeader } from './legacy-image';
import { SimulatedDevice } from '../src/protocol/simulator';
import { ConfigClient } from '../src/protocol/client';
import { ProfilePanel } from '../src/ui/components/ProfilePanel';
import { profile, updateProfile, removeChord, undo, redo, disconnect } from '../src/ui/store';

let firmware: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { firmware = createFirmwareValidator(); });
afterAll(() => firmware.close());
afterEach(async () => { await disconnect(); vi.unstubAllGlobals(); });

function reference(image: Uint8Array, skip: number): number {
  let remainder = 0xffff;
  for (let i = 0; i < 128; i++) {
    if (i === skip || i === skip + 1) continue;
    for (let mask = 128; mask; mask >>= 1) {
      const feedback = (remainder >>> 15) ^ Number(!!(image[i]! & mask));
      remainder = (remainder << 1) & 0xffff;
      if (feedback) remainder ^= 0x1021;
    }
  }
  return remainder;
}

it.each([0, 1] as const)('matches firmware for every window and LED combination on variant %s', variant => {
  const p = defaultProfile(variant);
  p.layers[0]!.autoSleep = true;
  p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: false, action: { type: 'keyHold', usage: 4, modifiers: 0 } }];
  p.timedActions = Array.from({ length: 4 }, () => ({ ticks: 2048, consumeInput: true, resetOnInput: true,
    action: { type: 'string' as const, text: 'A\n' }, resumeAction: { type: 'ledControl' as const, command: 'restoreAll' as const, value: 0 } }));
  for (let window = 0; window < 8; window++)
    for (let phase = 0; phase < 4; phase++)
      for (let speed = 0; speed < 4; speed++)
        for (const transparent of [false, true]) {
          p.chordWindow = 4 + 2 * window; p.rainbowPhase = phase; p.rainbowSpeed = speed; p.transparentBlack = transparent;
          const image = encodeProfile(p);
          expect([...image.subarray(0, 7)]).toEqual([0x42, 17, variant | 2, 6, 12,
            window | (Number(transparent) << 3) | (phase << 4) | (speed << 6), 13]);
          expect(peekHeader(image)).toEqual({ magic: true, version: 17, variant });
          expect(storedCrc(image)).toBe(reference(image, 7));
          expect(decodeImage(image)).toEqual({ ok: true, profile: p });
          expect(firmware.accepts(image, variant)).toBe(true);
        }
}, 20000);

it.each([0, 1] as const)('rejects every corrupt image bit and reserved field on variant %s', variant => {
  const image = encodeProfile(defaultProfile(variant));
  for (let bit = 0; bit < 1024; bit++) {
    const corrupt = image.slice(); corrupt[bit >> 3]! ^= 1 << (bit & 7);
    expect(decodeImage(corrupt).ok, `Bit ${bit}`).toBe(false);
    expect(firmware.accepts(corrupt, variant), `Bit ${bit}`).toBe(false);
  }
  for (const [offset, mask] of [[2, 128], [3, 1], ...Array.from({ length: 3 }, (_, i) => [6, 1 << (i + 5)])]) {
    const invalid = image.slice(); invalid[offset!]! |= mask!; sealImage(invalid);
    expect(decodeImage(invalid).ok).toBe(true);
    expect(firmware.accepts(invalid, variant)).toBe(true);
  }
  for (const count of [5, 6, 7]) {
    const invalid = image.slice(); invalid[4] = count; sealImage(invalid);
    expect(decodeImage(invalid).ok).toBe(false); expect(firmware.accepts(invalid, variant)).toBe(false);
  }
}, 20000);

it('checks both CRC layouts against independent division on random bytes', () => {
  let state = 0x1548abc;
  for (let sample = 0; sample < 1000; sample++) {
    const image = new Uint8Array(128);
    for (let i = 0; i < 128; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; image[i] = state; }
    image[0] = 0x42; expect(imageCrc(image)).toBe(reference(image, 7));
    image[0] = 0x4d; image[1] = 0x50; expect(imageCrc(image)).toBe(reference(image, 6));
  }
});

it.each([0, 1] as const)('preserves capacity for all geometries and the 30-chord profile on variant %s', variant => {
  for (let layers = 1; layers <= (variant ? 7 : 5); layers++) {
    const p = defaultProfile(variant); p.layers = Array.from({ length: layers }, () => emptyLayer(variant));
    const pairs: [number, number][] = [];
    for (let a = 0; a < (variant ? 3 : 6); a++) for (let b = a + 1; b < (variant ? 3 : 6); b++) pairs.push([a, b]);
    const bound = Math.min(pairs.length * (layers + 1), Math.floor((119 - (variant ? 15 : 22) * layers) / 3));
    expect(bound).toBeLessThanOrEqual(30);
    for (let i = 0; i < bound; i++) p.chords.push({ layer: i < pairs.length * layers ? Math.floor(i / pairs.length) : 0,
      keyA: pairs[i % pairs.length]![0], keyB: pairs[i % pairs.length]![1], global: i >= pairs.length * layers, action: { type: 'none' } });
    const image = encodeProfile(p);
    expect(image[4]! >> 3).toBe(bound); expect(firmware.accepts(image, variant)).toBe(true);
    expect(decodeImage(image).ok).toBe(true);
  }
});

it.each([0, 1] as const)('migrates every legacy window consistently in binary, JSON and drafts on variant %s', variant => {
  for (let units = 0; units < 16; units++) {
    const p = defaultProfile(variant); p.layers[0]!.autoSleep = true;
    p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: false, action: { type: 'consumerModifiedHold', usage: 111, modifiers: 6 } }];
    const old = legacyHeader(encodeProfile(p)); old[8] = (old[8]! & 0xf0) | units; sealImage(old);
    const original = old.slice(); const decoded = decodeImage(old);
    expect(decoded.ok).toBe(true); if (!decoded.ok) throw new Error(decoded.detail);
    const expected = units ? Math.max(4, Math.round(units / 2) * 2) : 0;
    expect(decoded.profile.chordWindow).toBe(expected);
    expect(decoded.profile.chords).toEqual(p.chords); expect(decoded.profile.layers[0]!.autoSleep).toBe(true);
    expect(old).toEqual(original); expect(peekHeader(old)).toEqual({ magic: true, version: 15, variant });
    expect(!!decoded.notices?.length).toBe(units !== expected || units === 0);
    const json = JSON.parse(exportProfile(p)); legacyJson(json); json.version = 15; delete json.headerMarker; json.chordWindowMs = units * 5;
    const imported = importProfile(JSON.stringify(json)); expect(imported.profile).toEqual(decoded.profile);
    const key = `universal-macropad:format-v15:draft:${variant ? 'three-key' : 'six-key'}`;
    p.chordWindow = units;
    const raw = JSON.stringify({ formatVersion: 15, profile: legacyProfile(p), meta: { profileName: 'Old' }, savedAt: 'old' });
    const storage = new Map([[key, raw]]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
    const recovered = loadDraft(variant)!; expect(recovered.profile).toEqual(decoded.profile);
    expect(storage.get(key)).toBe(raw);
    storeDraft(recovered.profile, recovered.meta); expect(storage.has(draftKey(variant))).toBe(true); expect(storage.get(key)).toBe(raw);
    if (!units) {
      expect(() => encodeProfile(imported.profile)).toThrow('Previously disabled');
      expect(importProfile(exportProfile(imported.profile)).profile).toEqual(imported.profile);
    } else expect(firmware.accepts(encodeProfile(imported.profile), variant)).toBe(true);
    old[127]! ^= 1; expect(decodeImage(old)).toMatchObject({ ok: false, reason: 'bad-crc' });
  }
});

it('requires explicit selection for disabled imported chords and preserves undo', () => {
  const p = defaultProfile(0); p.chordWindow = 0;
  p.chords = [{ layer: 0, keyA: 0, keyB: 1, action: { type: 'none' } }]; profile.value = p;
  expect(validateProfile(p).some(issue => issue.where === 'Chord Window')).toBe(true);
  type Node = { type: unknown; props: Record<string, unknown> };
  const nodes = (v: unknown): Node[] => Array.isArray(v) ? v.flatMap(nodes) : v && typeof v === 'object' && 'props' in v
    ? [v as Node, ...nodes((v as Node).props.children)] : [];
  const control = nodes(ProfilePanel()).find(n => n.props.type === 'range')!;
  expect(control.props).toMatchObject({ min: 4, max: 18, step: 2, value: 8 });
  expect(() => encodeProfile(profile.value!)).toThrow('Previously disabled');
  (control.props.onInput as (event: unknown) => void)({ target: { value: '4' } });
  expect(encodeProfile(profile.value!)[5]! & 7).toBe(0);
  undo(); expect(profile.value!.chordWindow).toBe(0); expect(() => encodeProfile(profile.value!)).toThrow();
  redo(); expect(profile.value!.chordWindow).toBe(4);
  updateProfile(draft => { draft.chordWindow = 18; }); expect(encodeProfile(profile.value!)[5]! & 7).toBe(7);
});

it('keeps MP/v15 DataFlash inactive and readable until a B/v15 upload', async () => {
  const old = legacyHeader(encodeProfile(defaultProfile(0))); sealImage(old);
  const device = new SimulatedDevice({ variant: 0, initialImage: old }); const client = new ConfigClient(device);
  expect((await client.getStatus()).flashValid).toBe(false); expect(await client.readFlash()).toEqual(old);
  await expect(client.saveImage(old)).rejects.toThrow();
  const current = encodeProfile(defaultProfile(0)); await client.saveImage(current);
  expect((await client.getStatus()).flashValid).toBe(true); expect(await client.readFlash()).toEqual(current);
  await device.close();
});


it('removing all disabled imported chords resolves the window without enabling bindings', () => {
  const p = defaultProfile(0); p.chordWindow = 0;
  const chord = { layer: 0, keyA: 0, keyB: 1, action: { type: 'none' as const } };
  p.chords = [chord]; profile.value = p;
  removeChord(chord);
  expect(profile.value!.chords).toEqual([]); expect(profile.value!.chordWindow).toBe(8);
  expect(() => encodeProfile(profile.value!)).not.toThrow();
  undo(); expect(profile.value!.chords).toEqual([chord]); expect(profile.value!.chordWindow).toBe(0);
});


it('allows explicit confirmation of the default window for disabled imported chords', () => {
  const p = defaultProfile(0); p.chordWindow = 0;
  p.chords = [{ layer: 0, keyA: 0, keyB: 1, action: { type: 'none' } }]; profile.value = p;
  type Node = { props: Record<string, unknown> };
  const nodes = (v: unknown): Node[] => Array.isArray(v) ? v.flatMap(nodes) : v && typeof v === 'object' && 'props' in v
    ? [v as Node, ...nodes((v as Node).props.children)] : [];
  const confirm = nodes(ProfilePanel()).find(n => n.props.children === 'Use 40ms')!;
  (confirm.props.onClick as () => void)();
  expect(profile.value!.chordWindow).toBe(8); expect(() => encodeProfile(profile.value!)).not.toThrow();
  undo(); expect(profile.value!.chordWindow).toBe(0);
});
