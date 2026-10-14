import { legacyHeader } from './legacy-image';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { computeCapacity } from '../src/model/capacity';
import { profileChanges } from '../src/model/changes';
import { validateProfile } from '../src/model/validate';
import { exportProfile, importProfile } from '../src/io/json';
import { draftKey, loadDraft, storeDraft } from '../src/io/drafts';
import { LayerOptions } from '../src/ui/components/LayerOptions';
import { ProfilePanel } from '../src/ui/components/ProfilePanel';
import { profile, selectedLayer, updateProfile, undo, redo, disconnect } from '../src/ui/store';
import { createFirmwareValidator } from './firmware-validator.mjs';

let validator: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { validator = createFirmwareValidator(); });
afterAll(() => validator.close());
afterEach(() => { disconnect(); vi.unstubAllGlobals(); });

type Node = { props: Record<string, unknown> };
function elements(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...elements(node.props.children)];
}

describe('per-layer auto-sleep', () => {
  it('synchronizes the profile toggle with layer settings without saving Per Layer', () => {
    profile.value = defaultProfile(0);
    selectedLayer.value = 0;
    const controls = () => elements(ProfilePanel()).find(node => node.props['aria-label'] === 'Profile Auto-Sleep')!;
    const buttons = () => elements(controls()).filter(node => node.props.type === 'button');
    const selected = () => buttons().find(node => node.props['aria-pressed'])!.props.children;
    const choose = (mode: string) => (buttons().find(node => node.props.children === mode)!.props.onClick as () => void)();
    const changeLayer = (checked: boolean) => {
      const checkbox = elements(LayerOptions()).find(node => node.props.type === 'checkbox')!;
      (checkbox.props.onChange as (event: unknown) => void)({ target: { checked } });
    };
    expect(selected()).toBe('Off');
    const original = exportProfile(profile.value!);
    choose('Per Layer');
    expect(selected()).toBe('Per Layer');
    expect(exportProfile(profile.value!)).toBe(original);
    updateProfile(draft => { draft.startupLayer = 1; });
    expect(selected()).toBe('Per Layer');
    choose('On');
    expect(profile.value!.layers.every(layer => layer.autoSleep)).toBe(true);
    expect(selected()).toBe('On');
    changeLayer(false);
    expect(selected()).toBe('Per Layer');
    changeLayer(true);
    expect(selected()).toBe('On');
    choose('Off');
    expect(profile.value!.layers.every(layer => !layer.autoSleep)).toBe(true);
    expect(selected()).toBe('Off');
    undo();
    expect(selected()).toBe('On');
    redo();
    expect(selected()).toBe('Off');
    const advanced = elements(LayerOptions()).find(node => node.props.class === 'layer-advanced')!;
    expect(advanced.props.open).toBeUndefined();
    expect(elements(advanced).some(node => node.props.type === 'checkbox')).toBe(true);
    profile.value = defaultProfile(0);
    profile.value.layers[0]!.autoSleep = true;
    profile.value = structuredClone(profile.value);
    expect(selected()).toBe('Per Layer');
  });

  it.each([0, 1] as const)('round-trips every layer-option byte against firmware on variant %s', variant => {
    const p = defaultProfile(variant);
    const optionsOffset = 9 + (variant ? 15 : 22) - 1;
    const capacity = computeCapacity(p);
    expect(emptyLayer(variant).autoSleep).toBe(false);
    for (let options = 0; options < 256; options++) {
      const layer = p.layers[0]!;
      layer.indicatorFullBrightness = !!(options & 1);
      layer.autoSleep = !!(options & 2);
      layer.indicatorBehavior = (options >> 2) & 3;
      layer.indicatorColor = options >> 4;
      const image = encodeProfile(p);
      expect(image[1]).toBe(15);
      expect(image[optionsOffset]).toBe(options);
      expect(validator.accepts(image, variant)).toBe(true);
      expect(decodeImage(image)).toEqual({ ok: true, profile: p });
      expect(computeCapacity(p)).toEqual(capacity);
    }
  });

  it.each([0, 1] as const)('clears the ignored v14 flag during binary migration on variant %s', variant => {
    const p = defaultProfile(variant);
    p.layers[0]!.keys[0] = { type: 'consumerModifiedHold', usage: 0x6f, modifiers: 6 };
    const image = encodeProfile(p); legacyHeader(image); image[2] = 14;
    const size = variant ? 15 : 22;
    p.layers.forEach((_, i) => { image[9 + size * (i + 1) - 1]! |= 2; });
    sealImage(image);
    const original = image.slice();
    expect(decodeImage(image)).toEqual({ ok: true, profile: p });
    const result = decodeImage(image);
    if (!result.ok) throw new Error(result.detail);
    const upgraded = encodeProfile(result.profile);
    p.layers.forEach((_, i) => expect(upgraded[9 + size * (i + 1) - 1]! & 2).toBe(0));
    expect(validator.accepts(upgraded, variant)).toBe(true);
    expect(image).toEqual(original);
  });

  it('preserves current JSON and drafts while clearing the option in old imports', () => {
    const p = defaultProfile(0); p.layers[0]!.autoSleep = true;
    const current = exportProfile(p, { profileName: 'Sleep' });
    expect(JSON.parse(current).version).toBe(15);
    expect(importProfile(current).profile).toEqual(p);
    const old = JSON.parse(current); old.version = 14;
    expect(importProfile(JSON.stringify(old)).profile.layers.every(l => !l.autoSleep)).toBe(true);
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const key = 'universal-macropad:format-v14:draft:six-key';
    const saved = JSON.stringify({ formatVersion: 14, profile: p, meta: {}, savedAt: 'old' });
    storage.set(key, saved);
    expect(loadDraft(0)?.profile.layers[0]!.autoSleep).toBe(false);
    expect(storage.get(key)).toBe(saved);
    storeDraft(p, { profileName: 'Sleep' });
    expect(draftKey(0)).toContain('format-v15:');
    expect(loadDraft(0)?.profile).toEqual(p);
  });

  it('includes the setting in validation, comparisons, undo and redo', () => {
    const before = defaultProfile(0);
    const after = structuredClone(before); after.layers[0]!.autoSleep = true;
    const changes = profileChanges(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ where: 'Layer 1 · Auto-Sleep', before: 'Off', after: 'On' });
    changes[0]!.undo!(after); expect(after).toEqual(before);
    profile.value = before; selectedLayer.value = 0;
    const checkbox = elements(LayerOptions()).find(node => node.props.type === 'checkbox')!;
    expect(checkbox.props.checked).toBe(false);
    (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    expect(profile.value!.layers[0]!.autoSleep).toBe(true);
    undo(); expect(profile.value!.layers[0]!.autoSleep).toBe(false);
    redo(); expect(profile.value!.layers[0]!.autoSleep).toBe(true);
    updateProfile(p => { (p.layers[0] as unknown as { autoSleep: string }).autoSleep = 'yes'; });
    expect(validateProfile(profile.value!).some(issue => issue.message.includes('Auto-sleep'))).toBe(true);
  });

  it.each([0, 1] as const)('keeps four user timers available on variant %s', variant => {
    const p = defaultProfile(variant); p.layers[0]!.autoSleep = true;
    p.timedActions = Array.from({ length: 4 }, () => ({ ticks: 1, resetOnInput: true, consumeInput: true,
      action: { type: 'none' as const }, resumeAction: { type: 'none' as const } }));
    const image = encodeProfile(p);
    expect(validator.accepts(image, variant)).toBe(true);
    expect(decodeImage(image)).toEqual({ ok: true, profile: p });
  });
});
