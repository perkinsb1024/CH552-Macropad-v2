import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isLiveViewPath } from '../src/site';
import { defaultProfile } from '../src/model/defaults';
import { encodeProfile } from '../src/codec/encode';
import { SimulatedDevice } from '../src/protocol/simulator';
import { draftKey, storeDraft } from '../src/io/drafts';
import { connection, connectSimulator, disconnect, dialog, profile, selectedLayer, viewerMode } from '../src/ui/store';
import { followDeviceLayer } from '../src/ui/profileViewer';
import { viewerSection } from '../src/ui/viewerSections';
import { DeviceView } from '../src/ui/components/DeviceView';
import { LiveStatus, countdown } from '../src/ui/components/LiveStatus';
import { liveActivity, liveRuntime, liveClock, toasts } from '../src/ui/store';
import { ProfileViewer, ViewerChords, ViewerMacros, ViewerTimers, tallestViewerSection } from '../src/ui/components/ProfileViewer';

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
  toasts.value = [];
  viewerMode.value = true;
  profile.value = null;
  dialog.value = null;
});
afterEach(async () => {
  dispose?.(); dispose = undefined;
  const disconnecting = disconnect();
  await vi.advanceTimersByTimeAsync(20);
  await disconnecting;
  profile.value = null;
  viewerMode.value = false;
  vi.restoreAllMocks();
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
  for (const path of ['/liveView', '/liveView/', '/liveView/index.html', '/macropad/liveView/']) {
    expect(isLiveViewPath(path)).toBe(true);
  }
  for (const path of ['/', '/liveViewOther', '/versions/']) expect(isLiveViewPath(path)).toBe(false);
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
  device.active[2] = (device.active[2]! & ~112) | (1 << 4);
  await vi.advanceTimersByTimeAsync(510);
  expect(selectedLayer.value).toBe(1);
  expect(text(ProfileViewer())).not.toContain('Your macropad is on');
  device.active[2] &= ~112;
  await vi.advanceTimersByTimeAsync(510);
  expect(selectedLayer.value).toBe(0);
  expect(profile.value).toBe(loaded);
  const disconnecting = disconnect();
  await vi.advanceTimersByTimeAsync(20);
  await disconnecting;
  expect(text(ProfileViewer())).toContain('Device disconnected');
});
it('follows the current runtime layer rather than the startup layer on initial load and reconnect', async () => {
  const conn = await connect();
  const device = conn.transport as SimulatedDevice;
  device.active[2] = (device.active[2]! & ~112) | (1 << 4);
  await vi.advanceTimersByTimeAsync(510);
  dispose = followDeviceLayer();
  expect(selectedLayer.value).toBe(1);
  const disconnecting = disconnect();
  await vi.advanceTimersByTimeAsync(20);
  await disconnecting;
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
    expect(text(chords[1])).toContain('All Layers');
    expect(text(ViewerTimers())).toContain('Consumed');
    expect(nodes(ViewerTimers()).some(n => ['input', 'button', 'select'].includes(String(n.type)))).toBe(false);
  }
  expect(encodeProfile(p)).toHaveLength(128);
});

it('shows macro definitions and their ordered steps in Live View without editing controls', () => {
  profile.value = defaultProfile(0);
  profile.value.macros = [{ actions: [{ type: 'pause', ticks: 16 }, { type: 'keyTap', usage: 4, modifiers: 0 }] }];
  expect(text(ViewerMacros())).toContain('Macro 1');
  expect(nodes(ViewerMacros()).filter(n => n.type === 'li')).toHaveLength(2);
  expect(nodes(ViewerMacros()).some(n => ['input', 'button', 'select'].includes(String(n.type)))).toBe(false);
});

it('shows the saved sleep timeout and wake policies for enabled layers', async () => {
  await connect();
  profile.value = defaultProfile(0);
  profile.value.layers[0]!.autoSleep = true;
  profile.value.sleepTimeoutMinutes = 120;
  profile.value.consumeWakeInput = false;
  profile.value.showLayerIndicatorOnWake = false;
  profile.value.dimInsteadOfOff = true;
  expect(text(ProfileViewer())).toContain('Auto-SleepTimeout2 HoursLEDsDimWake InputWake and ExecuteLayer ReminderOff');
  profile.value.layers[0]!.autoSleep = false;
  expect(text(ProfileViewer())).toContain('Auto-SleepStatusDisabled');
});

it('shows brief accepted bindings, physical holds and independent consumed encoder activity', async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  const conn = await connect();
  const device = conn.transport as SimulatedDevice;
  device.liveStatus[1] = 1; // Held Key 1.
  device.liveStatus[4] = 1; // Accepted Key 1 binding counter.
  device.liveStatus[13] = 0; device.liveStatus[14] = 1; device.liveStatus[15] = 4; device.liveStatus[16] = 1;
  await vi.advanceTimersByTimeAsync(60);
  const first = nodes(DeviceView({ readOnly: true })).find(node => String(node.props['aria-label']).startsWith('Key 1:'))!;
  expect(first.props.class).toContain('is-live-pressed');
  expect(first.props.class).toContain('is-live-fired');
  expect(text(LiveStatus())).toContain('Latest Trigger');
  const triggerToast = toasts.value.find(toast => toast.key === 'live-trigger')!;
  expect(triggerToast.text).toContain('Latest Trigger: Key 1 (Layer 1)');
  await vi.advanceTimersByTimeAsync(60);
  expect(toasts.value.filter(toast => toast.key === 'live-trigger')).toEqual([triggerToast]);
  device.liveStatus[16] = 2;
  await vi.advanceTimersByTimeAsync(60);
  expect(toasts.value.filter(toast => toast.key === 'live-trigger')).toHaveLength(2);
  for (let sequence = 3; sequence <= 6; sequence++) {
    device.liveStatus[16] = sequence;
    await vi.advanceTimersByTimeAsync(60);
  }
  const recent = toasts.value.filter(toast => toast.key === 'live-trigger');
  expect(recent).toHaveLength(4);
  expect(recent.some(toast => toast.id === triggerToast.id)).toBe(false);
  device.liveStatus[1] = 0;
  device.liveStatus[2] = 2; // Two clockwise detents consumed by wake; no binding counter change.
  await vi.advanceTimersByTimeAsync(60);
  const encoder = nodes(DeviceView({ readOnly: true })).filter(node => String(node.props.class).startsWith('enc-part '));
  expect(encoder.some(node => String(node.props.class).includes('is-live-pressed'))).toBe(true);
  expect(encoder.some(node => String(node.props.class).includes('is-live-fired'))).toBe(false);
  expect(liveActivity.value?.turns[0]).toBe(2);
});
it('reports sleep independently from brightness and marks stale telemetry', async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  const conn = await connect();
  const device = conn.transport as SimulatedDevice;
  device.timers[5 + (profile.value?.timedActions?.length ?? 0)] = 1;
  device.runtime[16] = 2; device.runtime[17] = 1; // Lighting can change while asleep.
  await vi.advanceTimersByTimeAsync(300);
  const content = text(LiveStatus());
  expect(content).toContain('Asleep');
  expect(content).toContain('LayersBright');
  expect(content).toContain('KeysDim');
  vi.spyOn(conn.client, 'getStatus').mockRejectedValue(new Error('unavailable'));
  await vi.advanceTimersByTimeAsync(1200);
  expect(text(LiveStatus())).toContain('Updates Paused');
  expect(nodes(DeviceView({ readOnly: true })).some(node => String(node.props.class).includes('is-live-pressed'))).toBe(false);
});
it('reloads bindings after an external profile save and clears old activity after a firmware reset', async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  const conn = await connect();
  const device = conn.transport as SimulatedDevice;
  const oldProfile = profile.value;
  const p = structuredClone(profile.value!);
  p.layers[0]!.keys[0] = { type: 'keyTap', modifiers: 0, usage: 5 };
  const image = encodeProfile(p);
  device.flash.set(image); device.active.set(image);
  device.runtime[21] = device.runtime[21]! + 1;
  await vi.advanceTimersByTimeAsync(400);
  expect(profile.value).not.toBe(oldProfile);
  expect(profile.value!.layers[0]!.keys[0]).toEqual(p.layers[0]!.keys[0]);
  expect(liveRuntime.value?.timers.profileCrc).toBe(image[7]! | image[8]! << 8);
  device.liveStatus[4] = 1; device.liveStatus[16] = 1;
  await vi.advanceTimersByTimeAsync(60);
  expect(liveActivity.value?.latest).not.toBeNull();
  device.runtime[21] = device.runtime[21]! + 1;
  await vi.advanceTimersByTimeAsync(300);
  expect(liveActivity.value?.latest).toBeNull();
  expect(liveClock.value - liveActivity.value!.receivedAt).toBeLessThan(100);
});

it('expires highlights and marks stale state while a status request is still in flight', async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  const conn = await connect();
  const device = conn.transport as SimulatedDevice;
  device.liveStatus[1] = 1;
  await vi.advanceTimersByTimeAsync(60);
  let resolve!: (status: typeof conn.status) => void;
  vi.spyOn(conn.client, 'getStatus').mockImplementation(() => new Promise(done => { resolve = done; }));
  await vi.advanceTimersByTimeAsync(1200);
  expect(text(LiveStatus())).toContain('Updates Paused');
  expect(nodes(DeviceView({ readOnly: true })).some(node => String(node.props.class).includes('is-live-pressed'))).toBe(false);
  resolve(conn.status);
  await vi.advanceTimersByTimeAsync(1);
});

it('packs any tall Live View section beside the other two only when their heights are close', () => {
  expect(tallestViewerSection([100, 180, 160], 16)).toBeNull();
  expect(tallestViewerSection([100, 500, 160], 16)).toBe(1);
  expect(tallestViewerSection([500, 100, 160], 16)).toBe(0);
  expect(tallestViewerSection([100, 160, 500], 16)).toBe(2);
  expect(tallestViewerSection([100, 240, 160], 16)).toBe(1);
});

it('formats countdowns with explicit hours, minutes and seconds', () => {
  expect(countdown(0)).toBe('0s');
  expect(countdown(9)).toBe('9s');
  expect(countdown(59.2)).toBe('1m 00s');
  expect(countdown(129)).toBe('2m 09s');
  expect(countdown(3729)).toBe('1hr 02m 09s');
  expect(countdown(135 * 60 + 57)).toBe('2hr 15m 57s');
  expect(countdown(3600)).toBe('1hr 00m 00s');
});

it('remembers disclosure states independently and defaults Layer Settings to collapsed', () => {
  const settings = { open: true } as HTMLDetailsElement;
  viewerSection('layer-settings', false).ref(settings);
  expect(settings.open).toBe(false);
  settings.open = true;
  viewerSection('layer-settings', false).onToggle({ currentTarget: settings } as unknown as Event);
  const restored = { open: false } as HTMLDetailsElement;
  viewerSection('layer-settings', false).ref(restored);
  expect(restored.open).toBe(true);
  restored.open = false;
  viewerSection('layer-settings', false).ref(restored);
  expect(restored.open).toBe(false); // Renders preserve the native state.
  const chords = { open: false } as HTMLDetailsElement;
  viewerSection('chords').ref(chords);
  expect(chords.open).toBe(true);
});

it('keeps disclosures functional when local storage is blocked', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  });
  const element = { open: false } as HTMLDetailsElement;
  expect(() => viewerSection('macros').ref(element)).not.toThrow();
  expect(element.open).toBe(true);
  expect(() => viewerSection('macros').onToggle({ currentTarget: element } as unknown as Event)).not.toThrow();
});
