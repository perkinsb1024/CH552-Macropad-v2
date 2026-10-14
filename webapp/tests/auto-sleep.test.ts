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
import { autoSleepMode, baseline, profile, selectedLayer, setAutoSleepMode, swapLayers, removeLayer, addLayer, updateProfile, undo, redo, disconnect } from '../src/ui/store';
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

  it.each([0, 1] as const)('restores modified layer choices after global toggles on variant %s', variant => {
    profile.value = defaultProfile(variant);
    profile.value.layers.push(emptyLayer(variant));
    selectedLayer.value = 0;
    setAutoSleepMode('Per Layer');
    // Exercise actual layer controls to establish a custom mixed pattern.
    const checkbox = elements(LayerOptions()).find(node => node.props.type === 'checkbox')!;
    (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    const choices = () => profile.value!.layers.map(layer => layer.autoSleep);
    expect(choices()).toEqual([true, false, false]);
    const custom = encodeProfile(profile.value!);
    for (const global of ['On', 'Off', 'On', 'Off'] as const) {
      setAutoSleepMode(global);
      expect(choices()).toEqual([global === 'On', global === 'On', global === 'On']);
      // Other profile edits and a save baseline must not lose the memory.
      updateProfile(p => { p.sleepTimeoutMinutes = p.sleepTimeoutMinutes === 30 ? 60 : 30; });
      baseline.value = structuredClone(profile.value!);
      setAutoSleepMode('Per Layer');
      expect(choices()).toEqual([true, false, false]);
      expect(autoSleepMode.value).toBe('Per Layer');
    }
    setAutoSleepMode('On'); setAutoSleepMode('Off'); setAutoSleepMode('Per Layer');
    expect(choices()).toEqual([true, false, false]);
    updateProfile(p => { p.sleepTimeoutMinutes = 30; });
    expect(encodeProfile(profile.value!)).toEqual(custom);
  });

  it('restores both the mode and remembered choices through undo and redo', () => {
    profile.value = defaultProfile(0);
    profile.value.layers[0]!.autoSleep = true;
    profile.value = structuredClone(profile.value);
    const choices = () => profile.value!.layers.map(layer => layer.autoSleep);
    setAutoSleepMode('On');
    setAutoSleepMode('Off');
    setAutoSleepMode('Per Layer');
    expect(choices()).toEqual([true, false]);
    undo(); expect(choices()).toEqual([false, false]); expect(autoSleepMode.value).toBe('Off');
    undo(); expect(choices()).toEqual([true, true]); expect(autoSleepMode.value).toBe('On');
    redo(); expect(choices()).toEqual([false, false]);
    redo(); expect(choices()).toEqual([true, false]); expect(autoSleepMode.value).toBe('Per Layer');
    // Revising a choice replaces the remembered value, including uniform choices.
    updateProfile(p => { p.layers[0]!.autoSleep = false; });
    setAutoSleepMode('On'); setAutoSleepMode('Per Layer');
    expect(choices()).toEqual([false, false]); expect(autoSleepMode.value).toBe('Per Layer');
    undo(); expect(autoSleepMode.value).toBe('On');
    redo(); expect(autoSleepMode.value).toBe('Per Layer');
  });

  it('keeps remembered choices with layers through reordering, deletion and insertion', () => {
    profile.value = defaultProfile(0);
    profile.value.layers.push(emptyLayer(0));
    updateProfile(p => { p.layers[0]!.autoSleep = true; });
    setAutoSleepMode('On');
    swapLayers(0, 2);
    removeLayer(1);
    setAutoSleepMode('Per Layer');
    expect(profile.value!.layers.map(layer => layer.autoSleep)).toEqual([false, true]);
    setAutoSleepMode('Off');
    addLayer();
    setAutoSleepMode('Per Layer');
    expect(profile.value!.layers.map(layer => layer.autoSleep)).toEqual([false, true, false]);
  });

  it('starts fresh memory when another profile is loaded', () => {
    profile.value = defaultProfile(0);
    updateProfile(p => { p.layers[0]!.autoSleep = true; });
    setAutoSleepMode('On');
    profile.value = defaultProfile(1);
    setAutoSleepMode('On'); setAutoSleepMode('Per Layer');
    expect(profile.value!.layers.map(layer => layer.autoSleep)).toEqual([false, false]);
    expect(autoSleepMode.value).toBe('Per Layer');
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


describe('profile sleep settings', () => {
  it.each([0, 1] as const)('defaults both wake options on for every pre-v15 import on variant %s', variant => {
    const expected = defaultProfile(variant);
    expected.layers = [emptyLayer(variant)];
    expect(expected.consumeWakeInput).toBe(true);
    expect(expected.showLayerIndicatorOnWake).toBe(true);
    for (let version = 1; version < 15; version++) {
      // Older formats never assigned these fields, even if a draft/file has
      // stray false values. Source records must remain unchanged on recovery.
      const old = structuredClone(expected);
      old.consumeWakeInput = old.showLayerIndicatorOnWake = false;
      const json = JSON.parse(exportProfile(old)); json.version = version;
      expect(importProfile(JSON.stringify(json)).profile).toEqual(expected);
      const key = `universal-macropad:format-v${version}:draft:${variant ? 'three-key' : 'six-key'}`;
      const saved = JSON.stringify({ formatVersion: version, profile: old, meta: {}, savedAt: 'old' });
      const storage = new Map([[key, saved]]);
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      });
      // Draft recovery starts at v2; JSON additionally accepts v1.
      if (version >= 2) {
        expect(loadDraft(variant)?.profile).toEqual(expected);
        expect(storage.get(key)).toBe(saved);
        const image = legacyHeader(encodeProfile(old)); image[2] = version;
        if (version < 5) image[8]! &= 15; // Rainbow header settings began in v5.
        sealImage(image);
        expect(decodeImage(image)).toEqual({ ok: true, profile: expected });
      }
    }
  });


  it.each([0, 1] as const)('round-trips all 32 combinations without losing capacity on variant %s', variant => {
    const p = defaultProfile(variant);
    p.layers[0]!.autoSleep = true;
    p.timedActions = Array.from({ length: 4 }, () => ({ ticks: 1, resetOnInput: true, consumeInput: true,
      action: { type: 'none' as const }, resumeAction: { type: 'none' as const } }));
    const capacity = computeCapacity(p);
    for (let settings = 0; settings < 32; settings++) {
      p.sleepTimeoutMinutes = [15, 30, 60, 120][settings & 3]!;
      p.consumeWakeInput = !!(settings & 4);
      p.showLayerIndicatorOnWake = !!(settings & 8);
      p.dimInsteadOfOff = !!(settings & 16);
      const image = encodeProfile(p);
      expect(image[6]).toBe(settings);
      expect(validator.accepts(image, variant)).toBe(true);
      expect(decodeImage(image)).toEqual({ ok: true, profile: p });
      expect(importProfile(exportProfile(p)).profile).toEqual(p);
      expect(computeCapacity(p)).toEqual(capacity);
    }
  });

  it('defaults missing JSON and draft fields to the former sleep behavior', () => {
    const p = defaultProfile(0);
    p.layers[0]!.autoSleep = true;
    const old = JSON.parse(exportProfile(p));
    const oldDraft = structuredClone(p) as Partial<typeof p>;
    const fields = ['sleepTimeoutMinutes', 'consumeWakeInput', 'showLayerIndicatorOnWake', 'dimInsteadOfOff'] as const;
    for (const field of fields) { delete old[field]; delete oldDraft[field]; }
    expect(importProfile(JSON.stringify(old)).profile).toEqual(p);
    const saved = JSON.stringify({ formatVersion: 15, headerMarker: 'B', profile: oldDraft, meta: {}, savedAt: 'old' });
    const storage = new Map([[draftKey(0), saved]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    expect(loadDraft(0)?.profile).toEqual(p);
    expect(storage.get(draftKey(0))).toBe(saved);
    p.sleepTimeoutMinutes = 120; p.consumeWakeInput = false;
    p.showLayerIndicatorOnWake = false; p.dimInsteadOfOff = true;
    storeDraft(p, {}); expect(loadDraft(0)?.profile).toEqual(p);
  });

  it('validates all settings even when sleep is disabled', () => {
    for (const [field, value] of [['sleepTimeoutMinutes', 45], ['sleepTimeoutMinutes', null],
      ['consumeWakeInput', 1], ['showLayerIndicatorOnWake', null], ['dimInsteadOfOff', 'yes']] as const) {
      const p = defaultProfile(0);
      Object.assign(p, { [field]: value });
      expect(validateProfile(p).length).toBeGreaterThan(0);
      const json = JSON.parse(exportProfile(defaultProfile(0))); json[field] = value;
      expect(() => importProfile(JSON.stringify(json))).toThrow();
    }
  });

  it('connects all four controls to comparisons and undo/redo', () => {
    const before = defaultProfile(0); before.layers[0]!.autoSleep = true;
    profile.value = structuredClone(before);
    const select = elements(ProfilePanel()).find(n => n.props['aria-label'] === 'Auto-Sleep Timeout')!;
    (select.props.onChange as (event: unknown) => void)({ target: { value: '120' } });
    for (const field of ['consumeWakeInput', 'showLayerIndicatorOnWake', 'dimInsteadOfOff']) {
      const group = elements(ProfilePanel()).find(n => n.props['aria-labelledby'] === `sleep-${field}`)!;
      const buttons = elements(group).filter(n => n.props.type === 'button');
      expect(buttons.find(n => n.props['aria-pressed'])!.props.children).toBe(field === 'dimInsteadOfOff' ? 'Off' : 'On');
      const toggle = buttons.find(n => n.props.children === (field === 'dimInsteadOfOff' ? 'Dim' : 'Off'))!;
      (toggle.props.onClick as () => void)();
    }
    const expected = { ...before, sleepTimeoutMinutes: 120, consumeWakeInput: false,
      showLayerIndicatorOnWake: false, dimInsteadOfOff: true };
    expect(profile.value).toEqual(expected);
    const changes = profileChanges(before, profile.value!);
    expect(changes.map(change => change.where)).toEqual(['Sleep Timeout', 'Consume Wake Input', 'Show Layer Indicator', 'Sleep Behavior']);
    expect(changes[0]).toMatchObject({ before: '30 Minutes', after: '2 Hours' });
    for (const change of changes) change.undo!(expected);
    expect(expected).toEqual(before);
    undo(); expect(profile.value!.dimInsteadOfOff).toBe(false);
    redo(); expect(profile.value!.dimInsteadOfOff).toBe(true);
  });
});
