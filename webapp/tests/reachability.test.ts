import { expect, it } from 'vitest';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { PREVIOUS_LAYER } from '../src/model/constants';
import { layerReachabilityWarnings } from '../src/model/reachability';
import type { Action } from '../src/model/types';
const previous: Action = { type: 'setLayer', layer: PREVIOUS_LAYER };
const jump = (layer: number): Action => ({ type: 'setLayer', layer });
function profile(count: number) {
  const p = defaultProfile(0);
  p.layers = Array.from({ length: count }, () => emptyLayer(0));
  return p;
}
it('detects the five-layer forward-only trap and conditional return from Layer 5', () => {
  const p = profile(5);
  for (const layer of p.layers.slice(0, 4)) {
    layer.keys[0] = jump(4);
    layer.keys[1] = { type: 'relativeLayer', offset: 1 };
  }
  p.layers[4]!.keys[0] = previous;
  const warnings = layerReachabilityWarnings(p);
  expect(warnings.map(w => w.layer)).toEqual([1, 2, 3, 4]);
  for (const w of warnings.slice(0, 3)) expect(w.message).toContain('There is no path');
  expect(warnings[3]!.message).toContain('After some layer changes');
  expect(warnings[3]!.message).toContain('Previous layer remembers only one layer');
});
it('finds a trap even when another history on the same layer can return', () => {
  const p = profile(3);
  p.layers[0]!.keys[0] = jump(1);
  p.layers[1]!.keys[0] = previous;
  p.layers[1]!.keys[1] = jump(2);
  p.layers[2]!.keys[0] = previous;
  expect(layerReachabilityWarnings(p).map(w => [w.layer, w.message.includes('After some')])).toEqual([[1, true], [2, false]]);
  p.layers[2]!.keys[1] = jump(0);
  expect(layerReachabilityWarnings(p)).toEqual([]);
});
it('models relative wraparound with a non-first startup layer', () => {
  const p = profile(3);
  p.startupLayer = 2;
  for (const layer of p.layers) layer.keys[0] = { type: 'relativeLayer', offset: 1 };
  expect(layerReachabilityWarnings(p)).toEqual([]);
});
it('retains previous history through one-shot visits and consumption', () => {
  const p = profile(3);
  p.layers[0]!.keys[0] = jump(1);
  p.layers[1]!.keys[0] = { type: 'oneShotSetLayer', layer: 2 };
  p.layers[2]!.keys[0] = previous;
  expect(layerReachabilityWarnings(p)).toEqual([]);
});
it('detects overwritten timed one-shot returns', () => {
  const p = profile(3);
  p.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false,
    action: { type: 'oneShotSetLayer', layer: 1 }, resumeAction: { type: 'oneShotSetLayer', layer: 2 } }];
  expect(layerReachabilityWarnings(p).map(w => w.layer)).toEqual([1, 2]);
});
it('keeps held visits separate from persistent history, including selections under a hold', () => {
  const p = profile(3);
  p.layers[0]!.keys[0] = { type: 'momentaryLayer', layer: 1 };
  p.layers[1]!.keys[0] = jump(2);
  p.layers[2]!.keys[0] = previous;
  expect(layerReachabilityWarnings(p)).toEqual([]);
});
it('uses global chords and timer actions as possible routes back', () => {
  const p = profile(3);
  p.layers[0]!.keys[0] = jump(1);
  p.layers[1]!.keys[0] = jump(2);
  p.layers[2]!.keys[0] = previous;
  p.chords.push({ layer: 0, global: true, keyA: 0, keyB: 1, action: jump(0) });
  expect(layerReachabilityWarnings(p)).toEqual([]);
  p.chords = [];
  p.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: jump(0), resumeAction: { type: 'none' } }];
  expect(layerReachabilityWarnings(p)).toEqual([]);
});
it('does not rewrite previous history when selecting the same persistent layer', () => {
  const p = profile(2);
  p.layers[0]!.keys[0] = jump(1);
  p.layers[1]!.keys[0] = jump(1);
  p.layers[1]!.keys[1] = previous;
  expect(layerReachabilityWarnings(p)).toEqual([]);
});
it('respects local chord overrides of a global return route', () => {
  const p = profile(3);
  p.layers[0]!.keys[0] = jump(1);
  p.layers[1]!.keys[0] = jump(2);
  p.layers[2]!.keys[0] = previous;
  p.chords = [{ layer: 0, global: true, keyA: 0, keyB: 1, action: jump(0) },
    { layer: 1, keyA: 0, keyB: 1, action: { type: 'none' } },
    { layer: 2, keyA: 0, keyB: 1, action: { type: 'none' } }];
  expect(layerReachabilityWarnings(p).map(w => w.layer)).toEqual([1, 2]);
});
