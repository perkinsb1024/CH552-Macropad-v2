import { decodeLiveAction } from '../../codec/decode';
import { RAINBOW_PHASE_LABELS, RAINBOW_SPEED_LABELS } from '../../model/constants';
import { timerRemaining, sourceKeys } from '../../protocol/live';
import { PALETTE } from '../../model/palette';
import { connection, deviceFlash, layerName, liveActivity, liveClock, liveRuntime, profile } from '../store';
import { ActionLabel } from './ActionLabel';

export function liveSource(source: number, keys: number, userTimers = -1): string {
  if (!(source & 128)) return sourceKeys(source).map(key => key === keys ? 'Encoder Button' : `Key ${key + 1}`).join(' + ');
  const input = source & 127;
  return input === 9 + userTimers ? 'Auto-Sleep' : input === 7 ? 'Clockwise' : input === 8 ? 'Counterclockwise' : input === 14 ? 'Macro Step' : `Timer ${input - 8}`;
}
const policy = (value: number) => ['Off', 'Dim', 'Bright', 'As Configured'][value] ?? 'Unknown';
export function countdown(seconds: number): string {
  const value = Math.ceil(seconds);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
export function LiveStatus() {
  const c = connection.value;
  const activity = liveActivity.value;
  const runtime = liveRuntime.value;
  const now = liveClock.value;
  const p = profile.value;
  if (c.kind !== 'connected' || !c.connection.status.live) return <p class="hint viewer-live-note">Connect firmware with Live View telemetry to see inputs and runtime state.</p>;
  if (!c.connection.status.flashValid) return <p class="notice notice-warn">Device profile is invalid. Live activity is unavailable.</p>;
  const stale = !activity || now - activity.receivedAt > 1000;
  const stateStale = !runtime || now - runtime.receivedAt > 1000;
  const state = !stateStale ? runtime?.state : undefined;
  const latest = activity?.latest;
  const image = deviceFlash.value;
  const action = latest && image ? decodeLiveAction(image, latest.first, latest.second) : null;
  const slots = p?.timedActions?.length ?? 0;
  const asleep = runtime && !!(runtime.timers.high[slots]! & 1);
  const sleepEnabled = state && p?.layers[state.layer]?.autoSleep;
  const sleepTicks = p ? [220, 440, 879, 1758][[15, 30, 60, 120].indexOf(p.sleepTimeoutMinutes)]! : 0;
  return <section class="viewer-live" aria-label="Live Device State">
    <header><h2>Live Activity</h2><span class={`pill ${stale ? 'warn' : ''}`}>{stale ? 'Updates Paused' : 'Connected'}</span></header>
    {stale && <p class="notice notice-warn">Live state is stale. Reconnecting or returning to this tab refreshes it.</p>}
    {!stale && latest && <div class="live-last-binding">
      <span class="muted">Latest Binding · {liveSource(latest.source, c.connection.info.keyCount, slots)} · {layerName(latest.bindingLayer)}</span>
      {action ? <ActionLabel action={action} /> : <span>{latest.source === 0x89 + slots ? latest.second === 15 ? 'Wake from Auto-Sleep' : 'Auto-Sleep' : 'Runtime Lighting Action'}</span>}
      {activity.bindingDelta > 1 && <span class="hint">{activity.bindingDelta} bindings since the previous update; showing the latest.</span>}
    </div>}
    {!stale && !latest && <p class="muted">Press a key or turn the encoder to see its binding.</p>}
    {state ? <dl class="live-state-grid">
      <div><dt>Auto-Sleep</dt><dd>{asleep ? 'Asleep' : sleepEnabled && runtime ? `Awake · ${countdown(timerRemaining(runtime.timers, slots, sleepTicks))} Remaining` : 'Disabled'}</dd></div>
      <div><dt>Brightness</dt><dd>Layers {policy(state.indicatorPolicy)} · Keys {policy(state.keyPolicy)}</dd></div>
      <div><dt>LED Effect</dt><dd>{state.colorPreview ? 'Color Preview' : state.effect ? `${PALETTE[state.effect >> 4]?.name ?? 'Unknown'} · ${state.phases ? `${Math.ceil(state.phases / 2)} Blinks Remaining` : 'Always On'}` : state.phases ? p?.layers[state.layer]?.indicatorBehavior === 1 ? `Layer Indication · Up to ${state.phases * 250}ms Remaining` : `Layer Indication · ${Math.ceil(state.phases / 2)} Blinks Remaining` : 'As Configured'}</dd></div>
      <div><dt>Rainbow</dt><dd>{RAINBOW_PHASE_LABELS[state.rainbowPhase]} · {RAINBOW_SPEED_LABELS[state.rainbowSpeed]}</dd></div>
      <div><dt>Layer State</dt><dd>Base {layerName(state.baseLayer)} · Previous {layerName(state.previousLayer)}{state.oneShotReturn !== 255 ? ` · One-Shot Armed, Returns to ${layerName(state.oneShotReturn)}` : ''}{state.pendingKey ? ` · Key ${state.pendingKey} Waiting for Chord` : ''}</dd></div>
      <div><dt>Playback</dt><dd>{state.macroBusy ? 'Macro Running' : state.actionBusy ? 'Action Running' : state.queued ? 'Waiting' : 'Idle'} · {state.queued} Queued</dd></div>
      {!!state.mouseButtons && <div><dt>Latched Mouse Buttons</dt><dd>{Array.from({ length: 8 }, (_, i) => state.mouseButtons & (1 << i) ? i + 1 : null).filter(Boolean).join(', ')}</dd></div>}
      {(c.connection.status.droppedButtonActions > 0 || c.connection.status.droppedRotationActions > 0) && <div><dt>Dropped Actions</dt><dd>{c.connection.status.droppedButtonActions} Button · {c.connection.status.droppedRotationActions} Rotation</dd></div>}
    </dl> : <p class="hint">{stateStale && runtime ? 'Runtime state is stale.' : 'Reading runtime state…'}</p>}
    <p class="hint">Blue shows physical input; green flashes show accepted bindings. A binding can wait in the output queue. This view shows the latest binding, not a complete history.</p>
  </section>;
}
