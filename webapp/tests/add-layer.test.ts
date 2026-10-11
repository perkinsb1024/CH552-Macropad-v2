import { afterEach, expect, it } from 'vitest';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { maxLayers } from '../src/model/constants';
import { addLayer, profile, redo, selectedLayer, selectedSlot, undo } from '../src/ui/store';

afterEach(() => {
  profile.value = null;
  selectedLayer.value = 0;
  selectedSlot.value = null;
});

it.each([0, 1] as const)('adds a blank layer by default on variant %s, preserving global chords and undo/redo', variant => {
  const before = defaultProfile(variant);
  before.chords = [
    { layer: 0, keyA: 0, keyB: 1, action: { type: 'keyTap', usage: 4, modifiers: 0 } },
    { layer: 0, keyA: 0, keyB: 2, global: true, action: { type: 'keyTap', usage: 5, modifiers: 0 } },
  ];
  profile.value = structuredClone(before);
  selectedLayer.value = 0;
  selectedSlot.value = { kind: 'key', layer: 0, index: 0 };
  addLayer();
  const added = structuredClone(profile.value!);
  expect(added.layers).toEqual([...before.layers, emptyLayer(variant)]);
  expect(added.chords).toEqual(before.chords);
  expect(selectedLayer.value).toBe(2);
  expect(selectedSlot.value).toBeNull();
  undo();
  expect(profile.value).toEqual(before);
  expect(selectedLayer.value).toBe(1);
  redo();
  expect(profile.value).toEqual(added);
  expect(selectedLayer.value).toBe(1);
});

it.each([0, 1] as const)('duplicates the selected layer and only its local chords on variant %s', variant => {
  const before = defaultProfile(variant);
  before.chords = [
    { layer: 1, keyA: 0, keyB: 1, action: { type: 'keyTap', usage: 4, modifiers: 0 } },
    { layer: 0, keyA: 0, keyB: 1, action: { type: 'none' } },
    { layer: 1, keyA: 0, keyB: 2, global: true, action: { type: 'none' } },
  ];
  profile.value = structuredClone(before);
  selectedLayer.value = 1;
  addLayer('duplicate');
  expect(profile.value!.layers[2]).toEqual(before.layers[1]);
  expect(profile.value!.chords).toEqual([...before.chords, { ...before.chords[0], layer: 2 }]);
  expect(selectedLayer.value).toBe(2);
  expect(profile.value!.layers[2]!.keys).not.toBe(profile.value!.layers[1]!.keys);
  expect(profile.value!.layers[2]!.leds).not.toBe(profile.value!.layers[1]!.leds);
});

it.each([0, 1] as const)('enforces the layer limit for both creation modes on variant %s', variant => {
  const full = defaultProfile(variant);
  full.layers = Array.from({ length: maxLayers(variant) }, () => emptyLayer(variant));
  profile.value = full;
  selectedLayer.value = 0;
  addLayer();
  addLayer('duplicate');
  expect(profile.value).toBe(full);
  expect(selectedLayer.value).toBe(0);
});
