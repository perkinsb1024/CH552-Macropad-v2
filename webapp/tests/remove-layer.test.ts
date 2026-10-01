import { afterEach, expect, it } from 'vitest';
import { cloneProfile, defaultProfile, emptyLayer } from '../src/model/defaults';
import { meta, profile, removeLayer, selectedLayer, selectedSlot, undo } from '../src/ui/store';

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
