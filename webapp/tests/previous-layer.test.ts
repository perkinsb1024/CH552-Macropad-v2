import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createFirmwareValidator } from './firmware-validator.mjs';
import { defaultProfile } from '../src/model/defaults';
import { PREVIOUS_LAYER } from '../src/model/constants';
import { isPreviousLayer, summarize } from '../src/model/actions';
import { actionProblem, validateProfile } from '../src/model/validate';
import { layerReachabilityWarnings } from '../src/model/reachability';
import { selfReferentialLayerWarnings } from '../src/model/layerWarnings';
import { encodeAction, encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { exportProfile, importProfile } from '../src/io/json';
import { draftKey, loadDraft, storeDraft } from '../src/io/drafts';
import { profileChanges } from '../src/model/changes';
import { ConfigClient } from '../src/protocol/client';
import { SimulatedDevice } from '../src/protocol/simulator';
import type { Action, Profile } from '../src/model/types';
import { Inspector } from '../src/ui/components/Inspector';
import {
  addLayer, copySelectedConfiguration, getAction, insertLayer, pasteSelectedConfiguration,
  profile, redo, removeLayer, selectedLayer, selectedSlot, setAction, swapLayers, undo,
} from '../src/ui/store';

vi.mock('preact/hooks', () => ({ useMemo: (factory: () => unknown) => factory(), useState: (initial: unknown) => [initial, vi.fn()] }));
let validator: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { validator = createFirmwareValidator(); });
afterAll(() => validator.close());
afterEach(() => { profile.value = null; selectedSlot.value = null; vi.unstubAllGlobals(); });
const previous: Action = { type: 'setLayer', layer: PREVIOUS_LAYER };
const oneShot: Action = { type: 'oneShotSetLayer', layer: PREVIOUS_LAYER };
function populated(variant: 0 | 1): Profile {
  const p = defaultProfile(variant);
  for (const layer of p.layers) {
    layer.keys[0] = previous; layer.keys[1] = oneShot;
    layer.encoderButton = previous; layer.clockwise = oneShot; layer.counterclockwise = previous;
  }
  p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: true, action: previous }];
  p.timedActions = [{ ticks: 64, resetOnInput: true, consumeInput: true, action: oneShot, resumeAction: previous }];
  return p;
}
function expectPreviousTargets(p: Profile) {
  expect(validateProfile(p)).toEqual([]);
  for (const layer of p.layers) {
    expect(layer.keys[0]).toEqual(previous); expect(layer.keys[1]).toEqual(oneShot);
    expect(layer.encoderButton).toEqual(previous); expect(layer.clockwise).toEqual(oneShot);
    expect(layer.counterclockwise).toEqual(previous);
  }
  expect(p.chords[0]!.action).toEqual(previous);
  expect(p.timedActions![0]!.action).toEqual(oneShot);
  expect(p.timedActions![0]!.resumeAction).toEqual(previous);
}

it.each([0, 1] as const)('round-trips previous targets in every binding with firmware validation on variant %s', variant => {
  const p = populated(variant);
  expect(encodeAction(previous, new Map())).toEqual([0x09, 0xff]);
  expect(encodeAction(oneShot, new Map())).toEqual([0x19, 0xff]);
  const image = encodeProfile(p);
  expect(validator.accepts(image, variant)).toBe(true);
  expect(decodeImage(image)).toEqual({ ok: true, profile: p });
  expect(importProfile(exportProfile(p)).profile).toEqual(p);
});

it('accepts only configured layer indices or 255 and rejects previous in v6 and momentary actions', () => {
  for (const type of ['setLayer', 'oneShotSetLayer', 'momentaryLayer'] as const) {
    for (let layer = 0; layer < 256; layer++) {
      const action: Action = { type, layer };
      expect(actionProblem(action, { layerCount: 2, rotation: false }) === null).toBe(layer < 2 || (type !== 'momentaryLayer' && layer === 255));
    }
  }
  const p = defaultProfile(0); p.layers[0]!.keys[0] = previous;
  const image = encodeProfile(p); image[2] = 6; sealImage(image);
  expect(decodeImage(image).ok).toBe(false); expect(validator.accepts(image, 0)).toBe(false);
  image[2] = 7; image[9] = 0x2a; sealImage(image);
  expect(decodeImage(image).ok).toBe(false); expect(validator.accepts(image, 0)).toBe(false);
  const json = JSON.parse(exportProfile(p));
  for (let version = 1; version <= 6; version++) {
    json.version = version;
    expect(() => importProfile(JSON.stringify(json))).toThrow();
  }
});

it('preserves previous targets through layer swaps, insertions, duplication, deletion, and undo', () => {
  profile.value = populated(0); selectedLayer.value = 0;
  swapLayers(0, 1); expectPreviousTargets(profile.value!);
  addLayer(); expectPreviousTargets(profile.value!);
  insertLayer(0, 2, 'after'); expectPreviousTargets(profile.value!);
  const beforeRemoval = structuredClone(profile.value!);
  removeLayer(1); expectPreviousTargets(profile.value!);
  undo(); expect(profile.value).toEqual(beforeRemoval);
  redo(); expectPreviousTargets(profile.value!);
  const before = populated(0);
  profile.value = structuredClone(before); selectedLayer.value = 0; addLayer();
  const added = profileChanges(before, profile.value!).find(c => c.after === 'Added')!;
  added.undo!(profile.value!); expectPreviousTargets(profile.value!);
  expect(profile.value!.layers).toHaveLength(2);
});

it('preserves targets through clipboard, drafts, and simulator saving', async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  profile.value = populated(0);
  selectedSlot.value = { kind: 'key', layer: 0, index: 0 };
  const clipboard = copySelectedConfiguration()!;
  selectedSlot.value = { kind: 'timed', layer: 0, index: 0, resume: false };
  expect(pasteSelectedConfiguration(clipboard)).toBe(true);
  expect(getAction(profile.value!, selectedSlot.value)).toEqual(previous);
  storeDraft(profile.value!, {}); expect(loadDraft(0)?.profile).toEqual(profile.value);
  const key = draftKey(0); const saved = storage.get(key)!;
  const legacy = JSON.parse(saved); legacy.formatVersion = 6;
  storage.set(key, JSON.stringify(legacy)); expect(loadDraft(0)).toBeNull();
  expect(storage.get(key)).toBe(JSON.stringify(legacy));
  const device = new SimulatedDevice({ variant: 0 });
  try {
    const client = new ConfigClient(device); const image = encodeProfile(profile.value!);
    await client.saveImage(image); expect(await client.readFlash()).toEqual(image);
    expect(decodeImage(await client.readActive())).toEqual({ ok: true, profile: profile.value });
  } finally { await device.close(); }
});

type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node; return [node, ...nodes(node.props.children)];
}
it('offers Previous layer only for persistent and one-shot selectors, including timers', () => {
  profile.value = populated(0);
  for (const type of ['setLayer', 'oneShotSetLayer', 'momentaryLayer'] as const) {
    selectedSlot.value = { kind: 'key', layer: 0, index: 0 }; setAction(selectedSlot.value, { type, layer: 0 });
    const options = nodes(Inspector()).filter(n => n.type === 'option' && n.props.value === 255);
    expect(options).toHaveLength(type === 'momentaryLayer' ? 0 : 1);
    if (options.length) expect(options[0]!.props.children).toBe('Previous layer');
  }
  selectedSlot.value = { kind: 'timed', layer: 0, index: 0, resume: true };
  expect(nodes(Inspector()).some(n => n.props.children === 'Layer 256 (missing)')).toBe(false);
  expect(nodes(Inspector()).some(n => n.props.children === 'Previous layer')).toBe(true);
  expect(summarize(previous)).toBe('Previous layer'); expect(summarize(oneShot)).toBe('Previous layer (one-shot)');
  expect(isPreviousLayer({ type: 'momentaryLayer', layer: 255 })).toBe(false);
});

it('does not invent entry paths or claim a fixed return path for history-dependent targets', () => {
  const p = defaultProfile(0);
  p.layers[0]!.keys.fill({ type: 'none' }); p.layers[1]!.keys.fill({ type: 'none' });
  for (const layer of p.layers) layer.encoderButton = layer.clockwise = layer.counterclockwise = { type: 'none' };
  p.layers[0]!.keys[0] = { type: 'setLayer', layer: 1 }; p.layers[1]!.keys[0] = previous;
  expect(layerReachabilityWarnings(p)).toEqual([]);
  expect(selfReferentialLayerWarnings(p)).toEqual([]);
  p.layers[0]!.keys[0] = previous;
  expect(layerReachabilityWarnings(p)).toEqual([{ layer: 1, message: 'Layer 2 cannot be reached from startup Layer 1.' }]);
});
