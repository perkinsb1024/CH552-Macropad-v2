import { decodeLiveAction } from '../../codec/decode';
import { RAINBOW_PHASE_LABELS, RAINBOW_SPEED_LABELS } from '../../model/constants';
import { timerRemaining } from '../../protocol/live';
import { PALETTE } from '../../model/palette';
import { connection, deviceFlash, layerName, liveActivity, liveClock, liveRuntime, profile } from '../store';
import { ActionLabel } from './ActionLabel';
import { IconChevron } from './Icons';

import { liveSource, runtimeAction } from '../liveTrigger';
import { viewerSection } from '../viewerSections';
export { liveSource } from '../liveTrigger';

const policy = (value: number) => ['Off', 'Dim', 'Bright', 'As Configured'][value] ?? 'Unknown';
export function countdown(seconds: number): string {
  const value = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  const pad = (value: number) => String(value).padStart(2, '0');
  return [hours && `${hours}hr`, (hours || minutes) && `${hours ? pad(minutes) : minutes}m`, `${hours || minutes ? pad(value % 60) : value % 60}s`].filter(Boolean).join(' ');
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
  return <details class="card viewer-live viewer-section" aria-label="Live Device State" {...viewerSection('activity')}>
    <summary class="card-head"><h2>Live Activity</h2><span class={`pill ${stale ? 'pill-warn' : 'pill-ok'}`}><span class="dot" aria-hidden="true" />{stale ? 'Updates Paused' : 'Connected'}</span><IconChevron /></summary>
    {stale && <p class="notice notice-warn">Live state is stale. Return to this tab or reconnect your macropad to resume updates.</p>}
    {!stale && latest && <div class="live-last-binding">
      <div class="live-binding-context"><span class="muted">Latest Trigger</span><span>{liveSource(latest.source, c.connection.info.keyCount, slots)}</span><span class="tab-badge">{layerName(latest.bindingLayer)}</span></div>
      {action ? <ActionLabel action={action} /> : <span>{runtimeAction(latest.source, latest.second, slots)}</span>}
      {activity.bindingDelta > 1 && <span class="hint">{activity.bindingDelta} triggers since the previous update; showing the latest.</span>}
    </div>}
    {state ? <dl class="live-state-grid">
      <div><dt>Auto-Sleep</dt><dd>{asleep ? 'Asleep' : sleepEnabled && runtime ? <>Awake<span class="live-detail"><span class="live-countdown">{countdown(timerRemaining(runtime.timers, slots, sleepTicks))}</span> Remaining</span></> : 'Disabled'}</dd></div>
      <div><dt>Brightness</dt><dd><span>Layers {policy(state.indicatorPolicy)}</span><span class="live-detail">Keys {policy(state.keyPolicy)}</span></dd></div>
      <div><dt>LED Effect</dt><dd>{state.colorPreview ? 'Color Preview' : state.effect ? <>{PALETTE[state.effect >> 4]?.name ?? 'Unknown'}<span class="live-detail">{state.phases ? `${Math.ceil(state.phases / 2)} Blinks Remaining` : 'Always On'}</span></> : state.phases ? <>Layer Indication<span class="live-detail">{p?.layers[state.layer]?.indicatorBehavior === 1 ? `Up to ${state.phases * 250}ms Remaining` : `${Math.ceil(state.phases / 2)} Blinks Remaining`}</span></> : 'As Configured'}</dd></div>
      <div><dt>Rainbow</dt><dd>{RAINBOW_PHASE_LABELS[state.rainbowPhase]}<span class="live-detail">{RAINBOW_SPEED_LABELS[state.rainbowSpeed]}</span></dd></div>
      <div><dt>Layer State</dt><dd>Base: {layerName(state.baseLayer)}<span class="live-detail">Previous: {layerName(state.previousLayer)}</span>{state.oneShotReturn !== 255 && <span class="live-detail">One-Shot Armed, Returns to {layerName(state.oneShotReturn)}</span>}{!!state.pendingKey && <span class="live-detail">Key {state.pendingKey} Waiting for Chord</span>}</dd></div>
      <div><dt>Playback</dt><dd>{state.macroBusy ? 'Macro Running' : state.actionBusy ? 'Action Running' : state.queued ? 'Waiting' : 'Idle'}<span class="live-detail">{state.queued} Queued</span></dd></div>
      {!!state.mouseButtons && <div><dt>Latched Mouse Buttons</dt><dd>{Array.from({ length: 8 }, (_, i) => state.mouseButtons & (1 << i) ? i + 1 : null).filter(Boolean).join(', ')}</dd></div>}
      {(c.connection.status.droppedButtonActions > 0 || c.connection.status.droppedRotationActions > 0) && <div><dt>Dropped Actions</dt><dd>{c.connection.status.droppedButtonActions} Button<span class="live-detail">{c.connection.status.droppedRotationActions} Rotation</span></dd></div>}
    </dl> : <p class="hint">{stateStale && runtime ? 'Runtime state is stale.' : 'Reading runtime state…'}</p>}
    <p class="hint live-input-note"><span>Blue outlines on the device preview show physical input and green outlines show accepted triggers.</span>{' '}<span>Accepted triggers may still wait behind long running actions.</span></p>
  </details>;
}
