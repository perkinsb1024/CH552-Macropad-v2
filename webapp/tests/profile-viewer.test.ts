import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isLiveViewPath } from '../src/site';
import { defaultProfile } from '../src/model/defaults';
import { encodeProfile } from '../src/codec/encode';
import { SimulatedDevice } from '../src/protocol/simulator';
import { ConfigClient } from '../src/protocol/client';
import { draftKey, storeDraft } from '../src/io/drafts';
import { connection, connectSimulator, disconnect, dialog, profile, selectedLayer, viewerMode } from '../src/ui/store';
import { followDeviceLayer } from '../src/ui/profileViewer';
import { viewerSection } from '../src/ui/viewerSections';
import { DeviceView } from '../src/ui/components/DeviceView';
import { LiveStatus, countdown } from '../src/ui/components/LiveStatus';
import { liveActivity, liveRuntime, liveClock, toasts } from '../src/ui/store';
import { ProfileViewer, ViewerChords, ViewerMacros, ViewerTimers, tallestViewerSection } from '../src/ui/components/ProfileViewer';
import { Toasts, liveTelemetryWarning } from '../src/ui/components/Toasts';
import { liveLighting, liveRainbowFrame, rainbowAnimation, setRainbowAnimation, startLiveLighting } from '../src/ui/liveLighting';

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
  expect(text(ProfileViewer())).toContain('these do not match the device');
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
it.each([false, true])('waits for profile validation before warning, including after a blank device (blank=%s)', async blank => {
  await connect(true);
  const closing = disconnect();
  await vi.advanceTimersByTimeAsync(20);
  await closing;
  toasts.value = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const readFlash = ConfigClient.prototype.readFlash;
  vi.spyOn(ConfigClient.prototype, 'readFlash').mockImplementationOnce(async function (this: ConfigClient) {
    await held;
    return readFlash.call(this);
  });
  const pending = connectSimulator(0, blank);
  await vi.advanceTimersByTimeAsync(20);
  expect(connection.value.kind).toBe('connected');
  expect(profile.value).toBeNull();
  expect(text(ProfileViewer())).not.toContain('no valid saved profile');
  expect(toasts.value).toEqual([]);
  release();
  await vi.advanceTimersByTimeAsync(100);
  await pending;
  expect(text(ProfileViewer()).includes('no valid saved profile')).toBe(blank);
  expect(toasts.value.some(toast => toast.text.includes('no valid saved profile'))).toBe(blank);
  expect(profile.value === null).toBe(blank);
});
it.each([false, true])('waits for current LED overrides before displaying the device (reconnect=%s)', async reconnect => {
  if (reconnect) {
    await connect();
    const closing = disconnect();
    await vi.advanceTimersByTimeAsync(20);
    await closing;
  }
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const getRuntime = ConfigClient.prototype.getRuntime;
  const request = vi.spyOn(ConfigClient.prototype, 'getRuntime').mockImplementationOnce(async function (this: ConfigClient) {
    await held;
    return getRuntime.call(this);
  });
  const pending = connectSimulator(0);
  expect(text(ProfileViewer())).toContain('Reading the saved profile and current device state');
  expect(nodes(ProfileViewer()).some(node => node.type === DeviceView)).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  await pending;
  expect(profile.value).not.toBeNull();
  expect(request).toHaveBeenCalled();
  expect(liveRuntime.value).toBeNull();
  expect(nodes(ProfileViewer()).some(node => node.type === DeviceView)).toBe(false);
  const c = connection.peek();
  if (c.kind !== 'connected') throw new Error('connection failed');
  (c.connection.transport as SimulatedDevice).runtime[16] = 0; // Override the configured layer indicator to off.
  (c.connection.transport as SimulatedDevice).runtime[17] = 0; // Override the configured key LEDs to off.
  release();
  await vi.advanceTimersByTimeAsync(100);
  expect(nodes(ProfileViewer()).some(node => node.type === DeviceView)).toBe(true);
  expect(text(ProfileViewer())).not.toContain('Reading the saved profile and current device state');
  expect(liveLighting.value!.colors.every(color => color === '#000000')).toBe(true);
  const keys = nodes(DeviceView({ readOnly: true })).filter(node => String(node.props.class).startsWith('keycap '));
  expect(keys.every(key => String(key.props.style).includes('--led:#000000'))).toBe(true);
});
it('renders the existing device without edit, clipboard or drag targets', () => {
  profile.value = defaultProfile(0);
  const buttons = nodes(DeviceView({ readOnly: true })).filter(n => n.type === 'button');
  expect(buttons).toHaveLength(9);
  for (const button of buttons) {
    expect(button.props.draggable).toBe(false);
    expect(button.props['data-clipboard-target']).toBeUndefined();
    expect(typeof button.props.onClick).toBe(String(button.props.class).startsWith('keycap ') ? 'function' : 'undefined');
    for (const handler of ['onDragStart', 'onDragEnd', 'onDragOver', 'onDrop']) {
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
  expect(triggerToast.text).toMatch(/^Key 1 \(Layer 1\) - /);
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

it('keeps a telemetry warning visible until both input and LED updates recover, even with activity collapsed', async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  const conn = await connect();
  await vi.advanceTimersByTimeAsync(300);
  expect(liveTelemetryWarning()).toBeNull();
  const runtime = vi.spyOn(conn.client, 'getRuntime').mockRejectedValue(new Error('unavailable'));
  await vi.advanceTimersByTimeAsync(1200);
  expect(liveClock.value - liveActivity.value!.receivedAt).toBeLessThan(100);
  expect(text(LiveStatus())).toContain('Updates Paused');
  expect(text(Toasts())).toContain('Live updates are paused');
  // No timeout or dismiss control can hide the warning while telemetry is lost.
  await vi.advanceTimersByTimeAsync(15000);
  expect(text(Toasts())).toContain('LED colors may be out of date');
  expect(nodes(Toasts()).some(n => n.type === 'button')).toBe(false);
  runtime.mockRestore();
  await vi.advanceTimersByTimeAsync(100);
  expect(liveTelemetryWarning()).toBeNull();
  const pending = disconnect();
  await vi.advanceTimersByTimeAsync(20); await pending;
  expect(text(Toasts())).toContain('Device disconnected');
});

it('samples LED state with foreground input polls while keeping timer reads slower', async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  const conn = await connect();
  const runtime = vi.spyOn(conn.client, 'getRuntime');
  const timers = vi.spyOn(conn.client, 'getTimers');
  await vi.advanceTimersByTimeAsync(500);
  expect(runtime.mock.calls.length).toBeGreaterThanOrEqual(8);
  expect(timers.mock.calls.length).toBeLessThanOrEqual(3);
  expect(timers).toHaveBeenCalled();
});

it('uses the blue physical outline state for LED feedback and saved colors when browsing another layer', async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  const conn = await connect();
  const p = structuredClone(profile.value!);
  p.layers[0]!.indicatorColor = 10; p.layers[0]!.indicatorBehavior = 3; p.layers[0]!.indicatorFullBrightness = true;
  p.layers[0]!.leds.fill(1);
  p.layers[1]!.indicatorColor = 6; p.layers[1]!.indicatorFullBrightness = true;
  profile.value = p;
  const device = conn.transport as SimulatedDevice;
  device.runtime[16] = 3; device.runtime[17] = 3;
  device.liveStatus[1] = 1;
  await vi.advanceTimersByTimeAsync(100);
  expect(liveLighting.value?.colors.slice(0, 2)).toEqual(['#ff0000', '#0000ff']);
  let keys = nodes(DeviceView({ readOnly: true })).filter(n => String(n.props['aria-label']).startsWith('Key '));
  expect(keys[0]!.props.class).toContain('is-live-pressed');
  expect(keys[0]!.props.style).toContain('--led:#ff0000');
  expect(nodes(DeviceView({ readOnly: true })).some(n => String(n.props.class).includes('indicator-glow'))).toBe(false);
  selectedLayer.value = 1;
  expect(liveLighting.value?.colors.every(c => c === '#00ff00')).toBe(true);
  keys = nodes(DeviceView({ readOnly: true })).filter(n => String(n.props['aria-label']).startsWith('Key '));
  expect(keys[0]!.props.class).not.toContain('is-live-pressed');
  expect(keys[0]!.props.style).toContain('--led:#00ff00');
});

it('keeps dim physical LEDs visibly colored on screen and preserves off and bright states', async () => {
  await connect();
  await vi.advanceTimersByTimeAsync(100);
  const p = structuredClone(profile.value!);
  p.layers[0]!.indicatorBehavior = 3;
  p.layers[0]!.indicatorColor = 1;
  profile.value = p;
  const setBrightness = (indicatorPolicy: number) => {
    liveRuntime.value = { ...liveRuntime.value!, state: { ...liveRuntime.value!.state,
      indicatorPolicy, keyPolicy: 0, effect: 0, phases: 0 } };
  };
  const keyStyle = () => nodes(DeviceView({ readOnly: true }))
    .find(n => String(n.props['aria-label']).startsWith('Key '))!.props.style;
  setBrightness(1);
  expect(liveLighting.value!.colors[0]).toBe('#0f0000');
  expect(keyStyle()).toContain('--led:#800000');
  expect(keyStyle()).toContain('--led-glow:#800000');
  setBrightness(0);
  expect(keyStyle()).toContain('--led:#000000');
  expect(keyStyle()).toContain('--led-glow:transparent');
  setBrightness(2);
  expect(keyStyle()).toContain('--led:#ff0000');
});

async function rainbowHarness(reduced = false) {
  await connect();
  await vi.advanceTimersByTimeAsync(100);
  const p = structuredClone(profile.value!);
  p.layers[0]!.indicatorColor = 15; p.layers[0]!.indicatorBehavior = 3;
  p.layers[1] = structuredClone(p.layers[0]!);
  profile.value = p;
  liveRuntime.value = { ...liveRuntime.value!, state: { ...liveRuntime.value!.state,
    rainbowSpeed: 0, indicatorPolicy: 2, keyPolicy: 0, effect: 0, phases: 0 } };
  const media = { matches: reduced };
  vi.stubGlobal('window', { matchMedia: () => media });
  vi.stubGlobal('document', { hidden: false });
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  let now = performance.now();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  dispose = startLiveLighting();
  return {
    callbacks, media,
    tick(ms: number) {
      now += ms;
      const next = [...callbacks.entries()][0];
      if (!next) throw new Error('No animation frame scheduled');
      callbacks.delete(next[0]); next[1](now);
    },
    trigger(first: number, source = 0) {
      const activity = liveActivity.value!;
      liveActivity.value = { ...activity, sample: { ...activity.sample,
        first, source, sequence: (activity.sample.sequence + 1) & 255 } };
    },
  };
}

it('animates continuously in Always, freezes in Never, and still updates lighting and stale state', async () => {
  const { tick, callbacks } = await rainbowHarness();
  expect(rainbowAnimation.value).toBe('always');
  tick(20);
  expect(liveRainbowFrame.value).toBe(5);
  const color = liveLighting.value!.colors[0];
  tick(3000);
  expect(liveLighting.value!.colors[0]).not.toBe(color);
  setRainbowAnimation('never');
  const frame = liveRainbowFrame.value;
  expect(callbacks.size).toBe(0);
  expect(liveLighting.value!.colors.some(c => c !== '#000000')).toBe(true);
  liveRuntime.value = { ...liveRuntime.value!, state: { ...liveRuntime.value!.state, indicatorPolicy: 0 } };
  expect(liveLighting.value!.colors.every(c => c === '#000000')).toBe(true);
  expect(liveRainbowFrame.value).toBe(frame);
  setRainbowAnimation('always');
  expect(callbacks.size).toBe(1);
  liveRuntime.value = { ...liveRuntime.value!, state: { ...liveRuntime.value!.state, generation: 123 } };
  expect(liveRainbowFrame.value).toBe(0);
  liveClock.value = liveActivity.value!.receivedAt + 1001;
  expect(callbacks.size).toBe(0);
  liveClock.value = liveActivity.value!.receivedAt;
  expect(callbacks.size).toBe(1);
  dispose!(); dispose = undefined;
  expect(callbacks.size).toBe(0);
});

it('defaults to Never for Reduce Motion and persists an explicit override across mounts', async () => {
  const { callbacks, media } = await rainbowHarness(true);
  expect(rainbowAnimation.value).toBe('never');
  expect(callbacks.size).toBe(0);
  setRainbowAnimation('brief');
  expect(callbacks.size).toBe(1);
  expect(storage.get('macropad.liveView.rainbowAnimation')).toBe('brief');
  dispose!();
  dispose = startLiveLighting();
  expect(rainbowAnimation.value).toBe('brief');
  expect(callbacks.size).toBe(1);
  setRainbowAnimation('always');
  media.matches = true;
  dispose!(); dispose = startLiveLighting();
  expect(rainbowAnimation.value).toBe('always');
  expect(callbacks.size).toBe(1);
  setRainbowAnimation('never');
  media.matches = false;
  dispose!(); dispose = startLiveLighting();
  expect(rainbowAnimation.value).toBe('never');
  expect(callbacks.size).toBe(0);
});

it('freezes Brief after exactly 2500ms and ignores unchanged polls and unrelated bindings', async () => {
  const { tick, callbacks, trigger } = await rainbowHarness();
  setRainbowAnimation('brief');
  tick(2000);
  expect(liveRainbowFrame.value).toBe(500);
  liveRuntime.value = { ...liveRuntime.value!, receivedAt: performance.now() };
  trigger(1); // A normal key tap with no LED feedback.
  tick(1000); // A delayed frame must not animate beyond the deadline.
  expect(liveRainbowFrame.value).toBe(625);
  expect(callbacks.size).toBe(0);
  expect(liveLighting.value!.colors.some(c => c !== '#000000')).toBe(true);
});

it.each([0, 1] as const)('restarts Brief when any Live View key is clicked on variant %s', async variant => {
  const { tick, callbacks } = await rainbowHarness();
  profile.value = { ...profile.value!, variant };
  setRainbowAnimation('brief');
  tick(2500);
  expect(callbacks.size).toBe(0);
  const keys = nodes(DeviceView({ readOnly: true })).filter(n => n.type === 'button' && String(n.props.class).startsWith('keycap '));
  expect(keys).toHaveLength(variant === 0 ? 6 : 3);
  for (const key of keys) {
    (key.props.onClick as () => void)();
    expect(callbacks.size).toBe(1);
    const frame = liveRainbowFrame.value;
    tick(2000);
    expect(liveRainbowFrame.value).toBeGreaterThan(frame);
    (key.props.onClick as () => void)();
    tick(2000);
    expect(callbacks.size).toBe(1);
    tick(500);
    expect(callbacks.size).toBe(0);
  }
  setRainbowAnimation('never');
  (keys[0]!.props.onClick as () => void)();
  expect(callbacks.size).toBe(0);
});

it.each([
  ['self-referential layer selection', 0x0c, 0],
  ['identical LED command', 0x0d, 0],
  ['macro LED command', 0x0d, 0x8e],
  ['wake with unchanged brightness', 0x0d, 0x89],
] as const)('restarts Brief for %s even without a lighting-state difference', async (_, first, source) => {
  const { tick, callbacks, trigger } = await rainbowHarness();
  setRainbowAnimation('brief');
  tick(2500);
  expect(callbacks.size).toBe(0);
  trigger(first, source);
  expect(callbacks.size).toBe(1);
  tick(2000);
  trigger(first, source); // Repeating the same command renews the full window.
  tick(2000);
  expect(callbacks.size).toBe(1);
  tick(500);
  expect(callbacks.size).toBe(0);
});

it('restarts Brief for identical-color layers, runtime changes, and sleep/wake state changes', async () => {
  const { tick, callbacks } = await rainbowHarness();
  setRainbowAnimation('brief');
  tick(2500);
  selectedLayer.value = 1;
  expect(callbacks.size).toBe(1);
  tick(2500);
  liveRuntime.value = { ...liveRuntime.value!, state: { ...liveRuntime.value!.state, layer: 1, rainbowPhase: 3 } };
  expect(callbacks.size).toBe(1);
  tick(2500);
  const high = [...liveRuntime.value!.timers.high];
  high[0] = 1;
  liveRuntime.value = { ...liveRuntime.value!, timers: { ...liveRuntime.value!.timers, high } };
  expect(callbacks.size).toBe(1);
  tick(2500);
  high[0] = 0;
  liveRuntime.value = { ...liveRuntime.value!, timers: { ...liveRuntime.value!.timers, high: [...high] } };
  expect(callbacks.size).toBe(1);
});

it('shows a persistent three-way rainbow toggle inside Layer Settings without a description', async () => {
  await connect();
  const elements = nodes(ProfileViewer());
  const settings = elements.find(n => n.type === 'details' && String(n.props.class).includes('viewer-saved-settings'))!;
  const toggle = nodes(settings).find(n => n.props['aria-labelledby'] === 'rainbow-animation-label')!;
  const buttons = nodes(toggle).filter(n => n.type === 'button');
  expect(buttons.map(n => text(n))).toEqual(['Always', 'Brief', 'Never']);
  expect(nodes(settings).some(n => n.type === 'select')).toBe(false);
  expect(text(settings)).not.toContain('Brief animates');
  (buttons[1]!.props.onClick as () => void)();
  expect(rainbowAnimation.value).toBe('brief');
  expect(storage.get('macropad.liveView.rainbowAnimation')).toBe('brief');
  const updated = nodes(ProfileViewer()).find(n => n.props['aria-labelledby'] === 'rainbow-animation-label')!;
  expect(nodes(updated).filter(n => n.type === 'button').map(n => n.props['aria-pressed'])).toEqual([false, true, false]);
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
