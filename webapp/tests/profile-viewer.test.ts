import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isProfileViewerPath } from '../src/site';
import { defaultProfile } from '../src/model/defaults';
import { encodeProfile } from '../src/codec/encode';
import { SimulatedDevice } from '../src/protocol/simulator';
import { draftKey, storeDraft } from '../src/io/drafts';
import { connection, connectSimulator, disconnect, dialog, profile, selectedLayer, viewerMode } from '../src/ui/store';
import { followDeviceLayer } from '../src/ui/profileViewer';
import { DeviceView } from '../src/ui/components/DeviceView';
import { ProfileViewer, ViewerChords, ViewerTimers } from '../src/ui/components/ProfileViewer';

vi.mock('preact/hooks', async importOriginal => ({
  ...await importOriginal<typeof import('preact/hooks')>(),
  useEffect: () => {},
}));
type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join('');
  if (value && typeof value === 'object' && 'props' in value) return text((value as Node).props.children);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
let storage: Map<string, string>;
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  viewerMode.value = true;
  profile.value = null;
  dialog.value = null;
});
afterEach(async () => {
  dispose?.(); dispose = undefined;
  await disconnect();
  profile.value = null;
  viewerMode.value = false;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function connect(blank = false) {
  const pending = connectSimulator(0, blank);
  await vi.advanceTimersByTimeAsync(100);
  await pending;
  const c = connection.peek();
  if (c.kind !== 'connected') throw new Error('connection failed');
  return c.connection;
}
it('supports direct viewer URLs including project prefixes and static entry pages', () => {
  for (const path of ['/viewProfile', '/viewProfile/', '/viewProfile/index.html', '/macropad/viewProfile/']) {
    expect(isProfileViewerPath(path)).toBe(true);
  }
  for (const path of ['/', '/viewProfileOther', '/versions/']) expect(isProfileViewerPath(path)).toBe(false);
});
it('loads hardware bindings without restoring or clearing an existing editor draft', async () => {
  const draft = defaultProfile(0);
  draft.layers[0]!.keys[0] = { type: 'string', text: 'unsaved' };
  storeDraft(draft, { profileName: 'Keep me' });
  const before = storage.get(draftKey(0));
  await connect();
  await vi.advanceTimersByTimeAsync(1000);
  expect(profile.value!.layers[0]!.keys[0]).not.toEqual(draft.layers[0]!.keys[0]);
  expect(dialog.value).toBeNull();
  expect(storage.get(draftKey(0))).toBe(before);
  expect(storage.size).toBe(1);
});
it('keeps manual browsing through polls, warns persistently, then follows the next physical layer change', async () => {
  const conn = await connect();
  const loaded = profile.value;
  dispose = followDeviceLayer();
  expect(selectedLayer.value).toBe(0);
  selectedLayer.value = 1;
  await vi.advanceTimersByTimeAsync(1100);
  expect(selectedLayer.value).toBe(1);
  expect(text(ProfileViewer())).toContain('Your macropad is on Layer 1');
  const device = conn.transport as SimulatedDevice;
  device.active[3] = (device.active[3]! & ~56) | (1 << 3);
  await vi.advanceTimersByTimeAsync(510);
  expect(selectedLayer.value).toBe(1);
  expect(text(ProfileViewer())).not.toContain('Your macropad is on');
  device.active[3] &= ~56;
  await vi.advanceTimersByTimeAsync(510);
  expect(selectedLayer.value).toBe(0);
  expect(profile.value).toBe(loaded);
  await disconnect();
  expect(text(ProfileViewer())).toContain('Device disconnected');
});
it('follows the current runtime layer rather than the startup layer on initial load and reconnect', async () => {
  const conn = await connect();
  const device = conn.transport as SimulatedDevice;
  device.active[3] = (device.active[3]! & ~56) | (1 << 3);
  await vi.advanceTimersByTimeAsync(510);
  dispose = followDeviceLayer();
  expect(selectedLayer.value).toBe(1);
  await disconnect();
  await connect();
  expect(selectedLayer.value).toBe(0);
});
it('never displays starter shortcuts as if they were saved on a blank device', async () => {
  await connect(true);
  expect(profile.value).toBeNull();
  expect(text(ProfileViewer())).toContain('no valid saved profile');
});
it('renders the existing device without edit, clipboard or drag targets', () => {
  profile.value = defaultProfile(0);
  const buttons = nodes(DeviceView({ readOnly: true })).filter(n => n.type === 'button');
  expect(buttons).toHaveLength(9);
  for (const button of buttons) {
    expect(button.props.draggable).toBe(false);
    expect(button.props['data-clipboard-target']).toBeUndefined();
    for (const handler of ['onClick', 'onDragStart', 'onDragEnd', 'onDragOver', 'onDrop']) {
      expect(button.props[handler]).toBeUndefined();
    }
  }
});
it('filters local chords with the viewed layer and keeps global chords and all timers visible', () => {
  const p = defaultProfile(0);
  p.chords = [
    { layer: 0, keyA: 0, keyB: 1, action: { type: 'keyTap', usage: 4, modifiers: 0 } },
    { layer: 1, keyA: 2, keyB: 3, action: { type: 'keyTap', usage: 5, modifiers: 0 } },
    { layer: 0, global: true, keyA: 4, keyB: 5, action: { type: 'relativeLayer', offset: 1 } },
  ];
  p.timedActions = [{ ticks: 2, resetOnInput: true, consumeInput: true,
    action: { type: 'consumer', usage: 226 }, resumeAction: { type: 'none' } }];
  profile.value = p;
  for (const layer of [0, 1]) {
    selectedLayer.value = layer;
    const chords = nodes(ViewerChords()).filter(n => n.type === 'li');
    expect(chords).toHaveLength(2);
    expect(text(chords[0])).toContain(layer === 0 ? '1+2' : '3+4');
    expect(text(chords[1])).toContain('all layers');
    expect(text(ViewerTimers())).toContain('consumed');
    expect(nodes(ViewerTimers()).some(n => ['input', 'button', 'select'].includes(String(n.type)))).toBe(false);
  }
  expect(encodeProfile(p)).toHaveLength(128);
});
