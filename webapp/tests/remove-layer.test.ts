import { afterEach, describe, expect, it } from 'vitest';
import { cloneProfile, defaultProfile, emptyLayer } from '../src/model/defaults';
import { VARIANT_SIX_KEYS, VARIANT_THREE_KEYS } from '../src/model/constants';
import { chordSlot } from '../src/model/chords';
import { validateProfile } from '../src/model/validate';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { getAction, layerReferences, meta, profile, redo, removeChord, removeLayer, selectedLayer, selectedSlot, setAction, setChordGlobal, swapSlotActions, undo } from '../src/ui/store';

afterEach(() => {
  profile.value = null;
  meta.value = {};
  selectedLayer.value = 0;
  selectedSlot.value = null;
});

it('sets the new Layer 1 as startup when deleting a later startup layer and supports undo', () => {
  const p = defaultProfile(0);
  p.layers.push(emptyLayer(0));
  p.startupLayer = 1;
  p.chords = [{ layer: 1, keyA: 0, keyB: 1, action: { type: 'none' } }];
  const original = cloneProfile(p);
  profile.value = p;
  removeLayer(1);
  expect(profile.value!.startupLayer).toBe(0);
  expect(profile.value!.layers).toEqual([original.layers[0], original.layers[2]]);
  expect(profile.value!.chords).toEqual([]);
  undo();
  expect(profile.value).toEqual(original);
});

it('keeps the same startup layer when removing an earlier non-startup layer', () => {
  const p = defaultProfile(0);
  p.startupLayer = 1;
  profile.value = p;
  const startup = cloneProfile(p).layers[1];
  removeLayer(0);
  expect(profile.value!.startupLayer).toBe(0);
  expect(profile.value!.layers[0]).toEqual(startup);
});

it('cannot remove the only layer or its metadata', () => {
  const p = defaultProfile(0);
  p.layers = [p.layers[0]!];
  profile.value = p;
  meta.value = { layerNames: ['Only layer'] };
  removeLayer(0);
  expect(profile.value).toEqual(p);
  expect(meta.value.layerNames).toEqual(['Only layer']);
});

describe.each([VARIANT_THREE_KEYS, VARIANT_SIX_KEYS])('global chords on variant %s', (variant) => {
  it.each([0, 1, 2])('preserves all global chords when removing layer %s, including save/reload and undo', (removed) => {
    const p = defaultProfile(variant);
    p.layers = Array.from({ length: 3 }, () => emptyLayer(variant));
    p.chords = [
      { layer: 0, keyA: 0, keyB: 1, global: true, action: { type: 'consumer', usage: 0xe9 } },
      { layer: 1, keyA: 0, keyB: 2, global: true, action: { type: 'consumer', usage: 0xea } },
      { layer: 2, keyA: 1, keyB: 2, global: true, action: { type: 'relativeLayer', offset: 1 } },
      ...[0, 1, 2].map((layer) => ({ layer, keyA: 0, keyB: 1, global: false, action: { type: 'none' as const } })),
    ];
    const original = cloneProfile(p);
    profile.value = p;
    removeLayer(removed);
    const updated = cloneProfile(profile.value!);
    const globals = updated.chords.filter((c) => c.global);
    expect(globals).toHaveLength(3);
    expect(globals.map((c) => c.action)).toEqual(original.chords.slice(0, 3).map((c) => c.action));
    expect(updated.chords.filter((c) => !c.global).map((c) => c.layer)).toEqual([0, 1]);
    expect(updated.chords.every((c) => c.layer >= 0 && c.layer < 2)).toBe(true);
    expect(validateProfile(updated)).toEqual([]);
    const decoded = decodeImage(encodeProfile(updated));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error(decoded.detail);
    expect(decoded.profile.chords).toEqual([...updated.chords].sort((a, b) => Number(!!a.global) - Number(!!b.global) || a.layer - b.layer || a.keyA - b.keyA || a.keyB - b.keyB));
    undo();
    expect(profile.value).toEqual(original);
    redo();
    expect(profile.value).toEqual(updated);
  });

  it('keeps global and local chords independently editable after their storage layers merge', () => {
    const p = defaultProfile(variant);
    p.chords = [
      { layer: 0, keyA: 0, keyB: 1, global: false, action: { type: 'consumer', usage: 0xe9 } },
      { layer: 1, keyA: 0, keyB: 1, global: true, action: { type: 'consumer', usage: 0xea } },
    ];
    profile.value = p;
    removeLayer(1);
    const local = chordSlot(profile.value!.chords[0]!);
    const global = chordSlot(profile.value!.chords[1]!);
    expect(getAction(profile.value!, local)).toEqual({ type: 'consumer', usage: 0xe9 });
    expect(getAction(profile.value!, global)).toEqual({ type: 'consumer', usage: 0xea });
    setAction(global, { type: 'consumer', usage: 0xe2 });
    expect(getAction(profile.value!, local)).toEqual({ type: 'consumer', usage: 0xe9 });
    swapSlotActions(local, global);
    expect(getAction(profile.value!, local)).toEqual({ type: 'consumer', usage: 0xe2 });
    expect(getAction(profile.value!, global)).toEqual({ type: 'consumer', usage: 0xe9 });
    const beforeConflict = cloneProfile(profile.value!);
    setChordGlobal(global, false, 0);
    expect(profile.value).toEqual(beforeConflict);
    selectedSlot.value = global;
    removeChord(local);
    expect(selectedSlot.value).toEqual(global);
    expect(profile.value!.chords).toHaveLength(1);
    expect(getAction(profile.value!, global)).toEqual({ type: 'consumer', usage: 0xe9 });
    setChordGlobal(global, false, 0);
    expect(profile.value!.chords[0]!.global).toBe(false);
    expect(selectedSlot.value).toEqual(local);
    setChordGlobal(local, true, 0);
    expect(selectedSlot.value).toEqual(global);
    removeChord(global);
    expect(profile.value!.chords).toEqual([]);
    expect(selectedSlot.value).toBeNull();
  });
});

it('counts only local chords as deleted and retains global layer-target references', () => {
  const p = defaultProfile(VARIANT_THREE_KEYS);
  p.chords = [
    { layer: 1, keyA: 0, keyB: 1, global: true, action: { type: 'setLayer', layer: 1 } },
    { layer: 1, keyA: 0, keyB: 2, action: { type: 'none' } },
  ];
  expect(layerReferences(p, 1)).toEqual({ actions: 1, chords: 1 });
});
