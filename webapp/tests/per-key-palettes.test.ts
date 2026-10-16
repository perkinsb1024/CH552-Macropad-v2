import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { LayerIndicatorBehavior, layerPaletteSize, maxLayers } from '../src/model/constants';
import { computeCapacity } from '../src/model/capacity';
import { validateProfile } from '../src/model/validate';
import { PALETTE } from '../src/model/palette';
import { layerIndicatorBackground, layerPaletteWarnings, usePerKeyColors } from '../src/model/layerPalette';
import { encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { exportProfile, importProfile } from '../src/io/json';
import { draftKey, loadDraft, storeDraft } from '../src/io/drafts';
import { createFirmwareValidator } from './firmware-validator.mjs';
import { legacyHeader } from './legacy-image';
import { profile, selectedLayer, selectedSlot, updateProfile, undo, redo, addLayer, disconnect, connectSimulator, save, baseline, copySelectedConfiguration, pasteSelectedConfiguration, insertSlotAction, swapSlotActions } from '../src/ui/store';
import { IdleColor } from '../src/ui/components/IdleColor';
import { LayerOptions } from '../src/ui/components/LayerOptions';
import { ProfilePanel } from '../src/ui/components/ProfilePanel';
import { Inspector } from '../src/ui/components/Inspector';
import { DeviceView } from '../src/ui/components/DeviceView';
import { StorageMeter } from '../src/ui/components/StorageMeter';
import { IssuesPanel } from '../src/ui/components/IssuesPanel';
import { profileChanges } from '../src/model/changes';
vi.mock('preact/hooks', () => ({ useMemo: (factory: () => unknown) => factory(), useState: (initial: unknown) => [initial, vi.fn()] }));
type Node = { type: unknown; props: Record<string, any> };
function nodes(v: unknown): Node[] {
  if (Array.isArray(v)) return v.flatMap(nodes);
  if (!v || typeof v !== 'object' || !('props' in v)) return [];
  return [v as Node, ...nodes((v as Node).props.children)];
}
let firmware: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { firmware = createFirmwareValidator(); });
afterAll(() => firmware.close());
afterEach(async () => { await disconnect(); vi.unstubAllGlobals(); });
function localStorageMock() {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) });
  return storage;
}

it.each([0, 1] as const)('packs palettes in layer order and shifts every following section on variant %s', variant => {
  const p = defaultProfile(variant);
  p.layers.push(emptyLayer(variant));
  usePerKeyColors(p.layers[0]!); usePerKeyColors(p.layers[2]!);
  p.layers[0]!.idleLeds = variant ? [0, 15, 8] : [0, 15, 8, 1, 14, 7];
  p.layers[2]!.idleLeds = variant ? [15, 4, 0] : [15, 4, 0, 6, 9, 12];
  p.layers[0]!.leds[0] = 15;
  p.layers[0]!.keys[0] = { type: 'macro', macro: 0, repeats: 2 };
  p.chords = [{ layer: 2, keyA: 0, keyB: 1, global: false, action: { type: 'string', text: 'Hi' } }];
  p.timedActions = [{ ticks: 2048, resetOnInput: true, consumeInput: true, action: { type: 'macro', macro: 0, repeats: 1 }, resumeAction: { type: 'string', text: 'Hi' } }];
  p.macros = [{ actions: [{ type: 'ledControl', command: 'effectOn', value: 15 }, { type: 'string', text: 'Hi' }] }];
  const image = encodeProfile(p), start = 9 + p.layers.length * (variant ? 15 : 22);
  const bytes = variant ? [0xf0, 8, 0x4f, 0] : [0xf0, 0x18, 0x7e, 0x4f, 0x60, 0xc9];
  expect([...image.slice(start, start + bytes.length)]).toEqual(bytes);
  expect(computeCapacity(p).layerPalettes).toBe(bytes.length);
  expect(image[10]).toBe(start + bytes.length + 3 + 6 + 3);
  expect(firmware.accepts(image, variant)).toBe(true);
  expect(decodeImage(image)).toEqual({ ok: true, profile: p });
  expect(importProfile(exportProfile(p)).profile).toEqual(p);
});

it.each([0, 1] as const)('matches firmware across every palette count and color on variant %s', variant => {
  for (let count = 1; count <= maxLayers(variant); count++) {
    const p = defaultProfile(variant); p.layers = Array.from({ length: count }, () => emptyLayer(variant));
    for (let enabled = 0; enabled <= count; enabled++) for (let color = 0; color < 16; color++) {
      p.layers.forEach((l, i) => { l.indicatorColor = i < enabled ? 0 : 1; l.idleLeds = l.leds.map((_, key) => (color + key) & 15); });
      const cap = computeCapacity(p);
      expect(cap.layerPalettes).toBe(enabled * layerPaletteSize(variant));
      if (cap.remaining < 0) { expect(() => encodeProfile(p)).toThrow(); continue; }
      const image = encodeProfile(p);
      expect(firmware.accepts(image, variant)).toBe(true);
      const decoded = decodeImage(image); expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(encodeProfile(decoded.profile)).toEqual(image);
    }
  }
}, 20000);

it('rejects truncated palettes and ignores the three-key spare nibble while writing it as zero', () => {
  const p = defaultProfile(1); p.layers = Array.from({ length: 7 }, () => emptyLayer(1));
  p.layers.forEach(usePerKeyColors);
  const image = encodeProfile(p); expect(computeCapacity(p).remaining).toBe(0);
  image[115]! |= 0xf0; sealImage(image);
  expect(firmware.accepts(image, 1)).toBe(true);
  const decoded = decodeImage(image); expect(decoded.ok).toBe(true);
  if (decoded.ok) expect(encodeProfile(decoded.profile)[115]! & 0xf0).toBe(0);
  image[3] = 2; sealImage(image);
  expect(firmware.accepts(image, 1)).toBe(false); expect(decodeImage(image).ok).toBe(false);
  const six = defaultProfile(0); six.layers = Array.from({ length: 5 }, () => emptyLayer(0));
  const over = encodeProfile(six);
  for (let li = 0; li < 5; li++) over[9 + 22 * (li + 1) - 1]! &= 15;
  sealImage(over); expect(firmware.accepts(over, 0)).toBe(false); expect(decodeImage(over).ok).toBe(false);
});

it.each([undefined, [], [0, 1], [0, 1, 16], [0, 1, -1], [0, 1, 0.5]])('validates malformed active and retained palettes %j', colors => {
  const p = defaultProfile(1); p.layers[0]!.indicatorColor = 0; p.layers[0]!.idleLeds = colors;
  expect(validateProfile(p).length).toBeGreaterThan(0);
  expect(() => encodeProfile(p)).toThrow();
  expect(() => importProfile(exportProfile(p))).toThrow();
});

it('preserves inactive palettes through mode changes, JSON, drafts, copies and undo', () => {
  localStorageMock(); profile.value = defaultProfile(0); selectedLayer.value = 0;
  updateProfile(d => { usePerKeyColors(d.layers[0]!); d.layers[0]!.idleLeds![0] = 15; });
  const colors = [...profile.value!.layers[0]!.idleLeds!];
  updateProfile(d => { d.layers[0]!.indicatorColor = 8; });
  const p = profile.value!; expect(p.layers[0]!.indicatorColor).toBe(8); expect(p.layers[0]!.idleLeds).toEqual(colors);
  expect(computeCapacity(p).layerPalettes).toBe(0);
  expect(IdleColor({ layerIndex: 0, keyIndex: 0 })).toBeNull();
  expect(importProfile(exportProfile(p)).profile).toEqual(p);
  storeDraft(p, {}); expect(loadDraft(0)?.profile).toEqual(p);
  addLayer('duplicate'); expect(profile.value!.layers[2]!.idleLeds).toEqual(colors);
  expect(profile.value!.layers[2]!.idleLeds).not.toBe(profile.value!.layers[0]!.idleLeds);
  undo(); undo(); expect(profile.value!.layers[0]!.indicatorColor).toBe(0);
  redo(); expect(profile.value!.layers[0]!.indicatorColor).toBe(8);
  updateProfile(d => usePerKeyColors(d.layers[0]!)); expect(profile.value!.layers[0]!.idleLeds).toEqual(colors);
});

it.each([0, 1] as const)('applies idle colors to every key in per-key mode for variant %s, and warns only for redundant non-Off palettes', variant => {
  profile.value = defaultProfile(variant); selectedLayer.value = 0; usePerKeyColors(profile.value.layers[0]!);
  for (const color of [0, 1, 8, 15]) {
    updateProfile(d => { d.layers[0]!.idleLeds![0] = color; });
    nodes(IdleColor({ layerIndex: 0, keyIndex: 0 })).find(n => n.props.children === 'Apply to Layer')!.props.onClick();
    expect(profile.value!.layers[0]!.indicatorColor).toBe(0);
    expect(profile.value!.layers[0]!.idleLeds).toEqual(Array(variant ? 3 : 6).fill(color));
    expect(IdleColor({ layerIndex: 0, keyIndex: 0 })).not.toBeNull();
  }
  profile.value = defaultProfile(1); selectedLayer.value = 0; usePerKeyColors(profile.value.layers[0]!);
  profile.value.layers[0]!.idleLeds = [15, 8, 1];
  const apply = () => nodes(IdleColor({ layerIndex: 0, keyIndex: 0 })).find(n => n.props.children === 'Apply to Layer')!.props.onClick();
  apply(); expect(profile.value!.layers[0]!.indicatorColor).toBe(0);
  expect(profile.value!.layers[0]!.idleLeds).toEqual([15, 15, 15]);
  updateProfile(d => { usePerKeyColors(d.layers[0]!); d.layers[0]!.idleLeds![0] = 0; });
  apply(); expect(profile.value!.layers[0]!.idleLeds).toEqual([0, 0, 0]);
  expect(profile.value!.layers[0]!.indicatorColor).toBe(0);
  expect(layerPaletteWarnings(profile.value!)[0]?.message).toBe('Every key uses Off. Select Do Not Indicate to reclaim 2 bytes.');
  for (const color of [1, 8, 15]) {
    updateProfile(d => { d.layers[0]!.idleLeds = [color, color, color]; });
    expect(layerPaletteWarnings(profile.value!)[0]?.message).toContain('reclaim 2 bytes');
    expect(nodes(IssuesPanel()).some(n => String(n.props.children).includes('Uniform Layer Palettes'))).toBe(true);
    expect(validateProfile(profile.value!)).toEqual([]);
  }
});

it.each([0, 1] as const)('warns about all-off palettes with accurate reclaim guidance on variant %s', variant => {
  const p = defaultProfile(variant);
  p.layers = [emptyLayer(variant)];
  const layer = p.layers[0]!;
  usePerKeyColors(layer);
  layer.idleLeds = layer.leds.map(() => 0);
  const bytes = layerPaletteSize(variant);
  expect(layerPaletteWarnings(p)).toEqual([
    { layer: 0, color: 0, message: `Every key uses Off. Select Do Not Indicate to reclaim ${bytes} bytes.` },
  ]);
  const before = computeCapacity(p).layerPalettes;
  profile.value = p; selectedLayer.value = 0;
  const mode = nodes(LayerOptions()).find(n => n.props.id === 'layer-indicator-behavior')!;
  mode.props.onChange({ target: { value: String(LayerIndicatorBehavior.None) } });
  expect(before - computeCapacity(profile.value!).layerPalettes).toBe(bytes);
  expect(layerPaletteWarnings(profile.value!)).toEqual([]);
  expect(profile.value!.layers[0]!.idleLeds).toEqual(layer.idleLeds);
});

it('offers Off/Per-Key first and Rainbow last, and exposes rainbow settings for key or idle rainbow', () => {
  profile.value = defaultProfile(1); selectedLayer.value = 0; selectedSlot.value = { kind: 'key', layer: 0, index: 0 };
  const layer = profile.value.layers[0]!;
  const layerRadios = nodes(LayerOptions()).filter(n => n.props.role === 'radio');
  expect(layerRadios[0]!.props['aria-label']).toBe('Per-Key Colors');
  expect(layerRadios.at(-1)!.props['aria-label']).toBe('Rainbow');
  layerRadios[0]!.props.onClick(); expect(profile.value!.layers[0]!.idleLeds).toEqual([14, 14, 14]);
  const radios = nodes(IdleColor({ layerIndex: 0, keyIndex: 0 })).filter(n => n.props.role === 'radio');
  expect(radios[0]!.props['aria-label']).toBe('Off'); expect(radios.at(-1)!.props['aria-label']).toBe('Rainbow');
  radios.at(-1)!.props.onClick();
  const setting = () => nodes(ProfilePanel()).some(n => n.props.id === 'rainbow-phase');
  expect(setting()).toBe(true);
  updateProfile(d => { d.layers[0]!.indicatorColor = 1; d.layers[0]!.leds[0] = 15; });
  expect(setting()).toBe(true);
  const pressed = nodes(Inspector()).filter(n => n.props.role === 'radio');
  expect(pressed[0]!.props['aria-label']).toBe('Off'); expect(pressed.at(-1)!.props['aria-label']).toBe('Rainbow');
  expect(nodes(DeviceView()).find(n => n.props.class?.includes('keycap-rainbow'))).toBeDefined();
  const meter = nodes(StorageMeter()); expect(meter.some(n => n.props.role === 'tooltip')).toBe(true);
  expect(PALETTE.some(c => c.name === 'Teal')).toBe(false);
});

it('shows each physical color and a complete local rainbow in the indicator gradient', () => {
  const layer = emptyLayer(0); usePerKeyColors(layer); layer.idleLeds = [1, 8, 15, 7, 13, 14];
  const background = layerIndicatorBackground(layer);
  expect(background).toContain('conic-gradient');
  for (const color of ['#FF0000', '#00FFFF', '#40C820', '#FF0064', '#B8BEC8', '#ff00ff']) expect(background).toContain(color);
  expect(background).not.toContain('undefined');
});

it.each([0, 1] as const)('migrates Teal, Off and all effect color sites from B/v15 without changing brightness on variant %s', variant => {
  const p = defaultProfile(variant); p.layers = [p.layers[0]!];
  p.layers[0]!.leds = p.layers[0]!.leds.map(() => 8); p.layers[0]!.leds[0] = 0;
  p.layers[0]!.indicatorColor = 8;
  const effect = () => ({ type: 'ledControl' as const, command: 'effectBlink2' as const, value: 8, brightness: 'dim' as const });
  p.layers[0]!.keys[0] = effect(); p.layers[0]!.encoderButton = effect(); p.layers[0]!.clockwise = effect(); p.layers[0]!.counterclockwise = effect();
  p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: false, action: effect() }];
  p.timedActions = [{ ticks: 5, resetOnInput: true, consumeInput: false, action: effect(), resumeAction: effect() }];
  p.macros = [{ actions: [effect(), { type: 'ledControl', command: 'brightnessBothSet', value: 2 }] }];
  const image = legacyHeader(encodeProfile(p));
  // Replace all legacy Cyan nibbles with Teal, retaining all command and brightness bytes.
  const size = variant ? 15 : 22, keyCount = variant ? 3 : 6;
  const colorStart = 9 + 2 * (keyCount + 3);
  for (let k = 1; k < keyCount; k++) { const offset = colorStart + (k >> 1), shift = (k & 1) * 4; image[offset] = (image[offset]! & ~(15 << shift)) | 7 << shift; }
  image[9 + size - 1] = (image[9 + size - 1]! & 15) | 0x70;
  const end = 9 + size;
  for (const offset of [9, 9 + keyCount * 2, 11 + keyCount * 2, 13 + keyCount * 2, end + 1, end + 4, end + 6, end + 9]) image[offset] = 0x7d;
  // Restore B/v15 header from the legacy header, without touching its old palette bytes.
  const current = encodeProfile(p); image.set(current.slice(0, 9)); image[1] = 15; sealImage(image);
  const decoded = decodeImage(image); expect(decoded.ok).toBe(true);
  if (!decoded.ok) throw new Error(decoded.detail);
  expect(decoded.profile).toEqual(p); expect(decoded.notices?.join(' ')).toContain('Teal');
  expect(firmware.accepts(encodeProfile(decoded.profile), variant)).toBe(true);
});

it('keeps retained palettes in a draft after saving to the simulator', async () => {
  const storage = localStorageMock(); profile.value = null; baseline.value = null; await connectSimulator(1);
  updateProfile(d => { usePerKeyColors(d.layers[0]!); d.layers[0]!.idleLeds![0] = 15; d.layers[0]!.indicatorColor = 8; });
  await save(); expect(baseline.value).toEqual(profile.value);
  expect(JSON.parse(storage.get(draftKey(1))!).profile.layers[0].idleLeds).toEqual([15, 14, 14]);
  const changes = profileChanges(defaultProfile(1), profile.value!); expect(changes.some(c => c.where.includes('Idle Colors'))).toBe(true);
});


it.each(Array.from({ length: 16 }, (_, i) => i))('migrates source color %s consistently in v15 JSON and drafts', color => {
  const map = [1, 2, 3, 4, 5, 6, 7, 8, 8, 9, 10, 11, 12, 13, 14, 15];
  const p = defaultProfile(1); p.layers = [p.layers[0]!];
  const raw = JSON.parse(exportProfile(p)); raw.version = 15;
  raw.layers[0].leds = [color, color, color]; raw.layers[0].indicatorColor = color;
  raw.layers[0].keys[0] = { type: 'ledControl', command: 'effectOn', value: color, brightness: 'dim' };
  const imported = importProfile(JSON.stringify(raw)).profile;
  expect(imported.layers[0]!.leds).toEqual(Array(3).fill(color === 15 ? 0 : map[color]));
  expect(imported.layers[0]!.indicatorColor).toBe(map[color]);
  expect(imported.layers[0]!.keys[0]).toEqual({ type: 'ledControl', command: 'effectOn', value: map[color], brightness: 'dim' });
  const old = structuredClone(p); old.layers[0]!.leds = [color, color, color]; old.layers[0]!.indicatorColor = color; old.layers[0]!.keys[0] = raw.layers[0].keys[0];
  const storage = localStorageMock(), key = 'universal-macropad:format-v15:board:draft:three-key';
  const original = JSON.stringify({ formatVersion: 15, headerMarker: 'B', profile: old, meta: {}, savedAt: 'old' });
  storage.set(key, original);
  expect(loadDraft(1)?.profile).toEqual(imported); expect(storage.get(key)).toBe(original);
});

it('moves idle colors with keys and migrates earlier clipboard palette values', () => {
  profile.value = defaultProfile(1); selectedLayer.value = 0;
  usePerKeyColors(profile.value.layers[0]!); profile.value.layers[0]!.idleLeds = [1, 8, 15];
  const key = (index: number) => ({ kind: 'key' as const, layer: 0, index });
  insertSlotAction(key(0), key(2), 'after'); expect(profile.value!.layers[0]!.idleLeds).toEqual([8, 15, 1]);
  swapSlotActions(key(0), key(2)); expect(profile.value!.layers[0]!.idleLeds).toEqual([1, 15, 8]);
  selectedSlot.value = key(1); const copied = copySelectedConfiguration(false)!;
  expect(JSON.parse(copied)).toMatchObject({ version: 2, idleLed: 15 });
  selectedSlot.value = key(2); expect(pasteSelectedConfiguration(copied)).toBe(true);
  expect(profile.value!.layers[0]!.idleLeds).toEqual([1, 15, 15]);
  expect(pasteSelectedConfiguration(JSON.stringify({ format: 'universal-macropad-action', version: 1, led: 15, action: { type: 'ledControl', command: 'effectOn', value: 7 } }))).toBe(true);
  expect(profile.value!.layers[0]!.leds[2]).toBe(0);
  expect(profile.value!.layers[0]!.keys[2]).toMatchObject({ command: 'effectOn', value: 8 });
  expect(validateProfile(profile.value!)).toEqual([]);
});
