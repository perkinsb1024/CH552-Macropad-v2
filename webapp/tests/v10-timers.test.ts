import { legacyV10Codes } from './legacy-image';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createFirmwareValidator } from './firmware-validator.mjs';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { exportProfile, importProfile } from '../src/io/json';
import { loadDraft, storeDraft } from '../src/io/drafts';
import { computeCapacity } from '../src/model/capacity';
import { validateProfile } from '../src/model/validate';
import { layerReachabilityWarnings } from '../src/model/reachability';
import { canSave, connection, connectSimulator, disconnect, insertLayer, profile, removeLayer, save, selectedSlot, undo } from '../src/ui/store';
import { ConfigClient } from '../src/protocol/client';
import { Opcode } from '../src/protocol/packet';
import { SimulatedDevice } from '../src/protocol/simulator';
import { TimedActionsPanel } from '../src/ui/components/TimedActionsPanel';

let firmware: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { firmware = createFirmwareValidator(); });
afterAll(() => firmware.close());
afterEach(async () => { await disconnect(); vi.restoreAllMocks(); vi.unstubAllGlobals(); selectedSlot.value = null; });
const timer = (ticks = 1) => ({ ticks, consumeInput: true, resetOnInput: true,
  action: { type: 'none' as const }, resumeAction: { type: 'none' as const } });

// A full, genuine five-byte v9 image: 9 + 44 + 20 + 55 = 128 bytes.
function fullLegacy() {
  const p = defaultProfile(0);
  p.layers[0]!.keys[0] = { type: 'string', text: 'x'.repeat(54) };
  const image = encodeProfile(p);
  legacyV10Codes(image);
  image.copyWithin(73, 53, 108); image.fill(0, 53, 73);
  image[2] = 9; image[4] = image[4]! | 128;
  for (let i = 0; i < 4; i++) image.set([63 | ((i & 1) ? 128 : 0) | ((i & 2) ? 64 : 0), 0x10, 0, 0, 0], 53 + 5 * i);
  sealImage(image);
  return image;
}

it.each([0, 1] as const)('matches firmware across every metadata byte on variant %s', variant => {
  const p = defaultProfile(variant);
  while (p.layers.length < (variant ? 7 : 5)) p.layers.push(emptyLayer(variant));
  p.timedActions = [timer(168)];
  const base = 9 + p.layers.length * (variant ? 15 : 22);
  for (let metadata = 0; metadata < 256; metadata++) {
    const image = encodeProfile(p); image[base + 5] = metadata; sealImage(image);
    const valid = (metadata & 7) <= p.layers.length;
    expect(decodeImage(image).ok).toBe(valid);
    expect(firmware.accepts(image, variant)).toBe(valid);
    if (valid) {
      const decoded = decodeImage(image);
      if (!decoded.ok) throw new Error(decoded.detail);
      expect(decoded.profile.timedActions![0]!.ticks).toBe(168 + ((metadata & 56) << 5));
      expect(encodeProfile(decoded.profile)).toEqual(image);
      expect(importProfile(exportProfile(decoded.profile)).profile).toEqual(decoded.profile);
    }
  }
});

it('preserves full v9 images, blocks oversized writes, and allows an explicit repair', async () => {
  const old = fullLegacy();
  expect(firmware.accepts(old, 0)).toBe(false);
  const decoded = decodeImage(old);
  if (!decoded.ok) throw new Error(decoded.detail);
  const p = decoded.profile;
  expect(p.timedActions).toHaveLength(4);
  p.timedActions!.forEach((t, i) => expect(t).toMatchObject({ ticks: 2048, resetOnInput: !!(i & 1), consumeInput: !!(i & 2) }));
  expect(p.timedActions!.every(t => t.layer === undefined)).toBe(true);
  expect(computeCapacity(p)).toMatchObject({ used: 132, remaining: -4 });
  expect(() => encodeProfile(p)).toThrow('132 bytes');
  const raw = JSON.parse(exportProfile(p, { profileName: 'Full' }));
  expect(importProfile(JSON.stringify(raw)).profile).toEqual(p);
  raw.version = 9; raw.timedActions.forEach((t: { ticks: number }) => { t.ticks = 64; });
  expect(importProfile(JSON.stringify(raw))).toMatchObject({ profile: p, meta: { profileName: 'Full' } });
  const storage = new Map([['universal-macropad:format-v9:draft:six-key', JSON.stringify({ formatVersion: 9, profile: { ...p, timedActions: raw.timedActions }, meta: { profileName: 'Full' }, savedAt: 'old' })]]);
  const originalDraft = storage.values().next().value;
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
  expect(loadDraft(0)?.profile).toEqual(p);
  expect(storage.get('universal-macropad:format-v9:draft:six-key')).toBe(originalDraft);
  storeDraft(p, {}); expect(loadDraft(0)?.profile).toEqual(p);
  const original = SimulatedDevice.prototype.send;
  vi.spyOn(SimulatedDevice.prototype, 'send').mockImplementation(function (this: SimulatedDevice, request) {
    if (request[3] === Opcode.GetInfo) { this.flash.set(old); this.flashValid = false; }
    return original.call(this, request);
  });
  await connectSimulator(0);
  expect(canSave.value).toBe(false);
  const c = connection.value;
  if (c.kind !== 'connected') throw new Error('Not connected');
  await save(); expect(await c.connection.client.readFlash()).toEqual(old);
  // Four fewer text bytes accommodate all four larger timer records.
  profile.value!.layers[0]!.keys[0] = { type: 'string', text: 'x'.repeat(50) };
  profile.value!.timedActions!.forEach(t => { t.action = { type: 'string', text: 'x'.repeat(50) }; });
  profile.value = structuredClone(profile.value!);
  expect(canSave.value).toBe(true);
  await save(); expect((await c.connection.client.readFlash())[2]).toBe(13);
});

it.each([0, 1] as const)('uploads and reads back scoped maximum intervals on variant %s', async variant => {
  const device = new SimulatedDevice({ variant, blankFlash: true });
  const client = new ConfigClient(device);
  const p = defaultProfile(variant); p.timedActions = [{ ...timer(2048), layer: 1 }];
  await client.saveImage(encodeProfile(p));
  expect(decodeImage(await client.readFlash())).toEqual({ ok: true, profile: p });
  await device.close();
});

type Node = { type: unknown; props: Record<string, unknown> };
function nodes(v: unknown): Node[] {
  if (Array.isArray(v)) return v.flatMap(nodes);
  if (!v || typeof v !== 'object' || !('props' in v)) return [];
  const n = v as Node; return [n, ...nodes(n.props.children)];
}
it('edits interval and scope, remaps moved layers and preserves timers when their layer is deleted', () => {
  profile.value = defaultProfile(0); profile.value.timedActions = [timer()];
  const field = (label: string) => nodes(TimedActionsPanel()).find(n => n.props['aria-label'] === label)!;
  (field('Timer 1 interval ticks').props.onInput as (e: unknown) => void)({ target: { value: '73' } });
  expect(profile.value.timedActions[0]!.ticks).toBe(73);
  (field('Timer 1 layer').props.onChange as (e: unknown) => void)({ target: { value: '1' } });
  expect(profile.value.timedActions[0]!.layer).toBe(1);
  insertLayer(1, 0, 'before'); expect(profile.value!.timedActions![0]!.layer).toBe(0);
  removeLayer(0);
  expect(profile.value!.timedActions![0]!.layer).toBe(-1);
  expect(validateProfile(profile.value!).some(i => i.message.includes('existing layer'))).toBe(true);
  undo(); expect(profile.value!.timedActions![0]!.layer).toBe(0);
});

it('does not count an inactive-layer timer as a route to its own layer', () => {
  const p = defaultProfile(0);
  p.layers = [emptyLayer(0), emptyLayer(0)];
  p.timedActions = [{ ...timer(), layer: 1, action: { type: 'setLayer', layer: 1 } }];
  expect(layerReachabilityWarnings(p).some(w => w.layer === 1 && w.message.includes('cannot be reached'))).toBe(true);
  p.timedActions[0]!.layer = 0;
  expect(layerReachabilityWarnings(p).some(w => w.layer === 1 && w.message.includes('cannot be reached'))).toBe(false);
});
