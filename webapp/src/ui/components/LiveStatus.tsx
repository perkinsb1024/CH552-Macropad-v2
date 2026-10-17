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
  const stateStale = !runtime || now - runtime.receivedAt > 1000;
  const stale = !activity || now - activity.receivedAt > 1000 || stateStale;
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
    {!stale && latest && <section class="viewer-stat-group live-last-binding"><h3>Latest Trigger</h3>
      <dl class="viewer-facts live-trigger-facts">
        <div><dt>Source</dt><dd>{liveSource(latest.source, c.connection.info.keyCount, slots)}</dd></div>
        <div><dt>Layer</dt><dd>{layerName(latest.bindingLayer)}</dd></div>
        <div><dt>Action</dt><dd>{action ? <ActionLabel action={action} /> : runtimeAction(latest.source, latest.second, slots)}</dd></div>
      </dl>
      {activity.bindingDelta > 1 && <span class="hint">{activity.bindingDelta} triggers since the previous update; showing the latest.</span>}
    </section>}
    {state ? <div class="live-state-grid">
      <section class="viewer-stat-group"><h3>Auto-Sleep</h3><dl class="viewer-facts">
        <div><dt>Status</dt><dd>{asleep ? 'Asleep' : sleepEnabled ? 'Awake' : 'Disabled'}</dd></div>
        {!asleep && sleepEnabled && runtime && <div><dt>Remaining</dt><dd class="live-countdown">{countdown(timerRemaining(runtime.timers, slots, sleepTicks))}</dd></div>}
      </dl></section>
      <section class="viewer-stat-group"><h3>Brightness</h3><dl class="viewer-facts">
        <div><dt>Layers</dt><dd>{policy(state.indicatorPolicy)}</dd></div>
        <div><dt>Keys</dt><dd>{policy(state.keyPolicy)}</dd></div>
      </dl></section>
      <section class="viewer-stat-group"><h3>LED Effect</h3><dl class="viewer-facts">
        <div><dt>Current</dt><dd>{state.colorPreview ? 'Color Preview' : state.effect ? PALETTE[state.effect >> 4]?.name ?? 'Unknown' : state.phases ? 'Layer Indication' : 'As Configured'}</dd></div>
        {!state.colorPreview && (!!state.effect || !!state.phases) && <div><dt>Duration</dt><dd>{state.effect ? state.phases ? `${Math.ceil(state.phases / 2)} Blinks Remaining` : 'Always On' : p?.layers[state.layer]?.indicatorBehavior === 1 ? `Up to ${state.phases * 250}ms Remaining` : `${Math.ceil(state.phases / 2)} Blinks Remaining`}</dd></div>}
      </dl></section>
      <section class="viewer-stat-group"><h3>Rainbow</h3><dl class="viewer-facts">
        <div><dt>Phase</dt><dd>{RAINBOW_PHASE_LABELS[state.rainbowPhase]}</dd></div>
        <div><dt>Speed</dt><dd>{RAINBOW_SPEED_LABELS[state.rainbowSpeed]}</dd></div>
      </dl></section>
      <section class="viewer-stat-group"><h3>Layer State</h3><dl class="viewer-facts">
        <div><dt>Base</dt><dd>{layerName(state.baseLayer)}</dd></div>
        <div><dt>Previous</dt><dd>{layerName(state.previousLayer)}</dd></div>
        {state.oneShotReturn !== 255 && <div><dt>One-Shot</dt><dd>Armed, Returns to {layerName(state.oneShotReturn)}</dd></div>}
        {!!state.pendingKey && <div><dt>Chord</dt><dd>Key {state.pendingKey} Waiting</dd></div>}
      </dl></section>
      <section class="viewer-stat-group"><h3>Playback</h3><dl class="viewer-facts">
        <div><dt>Status</dt><dd>{state.macroBusy ? 'Macro Running' : state.actionBusy ? 'Action Running' : state.queued ? 'Waiting' : 'Idle'}</dd></div>
        <div><dt>Queued</dt><dd>{state.queued}</dd></div>
      </dl></section>
      {!!state.mouseButtons && <section class="viewer-stat-group"><h3>Latched Mouse Buttons</h3><dl class="viewer-facts">
        <div><dt>Buttons</dt><dd>{Array.from({ length: 8 }, (_, i) => state.mouseButtons & (1 << i) ? i + 1 : null).filter(Boolean).join(', ')}</dd></div>
      </dl></section>}
      {(c.connection.status.droppedButtonActions > 0 || c.connection.status.droppedRotationActions > 0) && <section class="viewer-stat-group"><h3>Dropped Actions</h3><dl class="viewer-facts">
        <div><dt>Button</dt><dd>{c.connection.status.droppedButtonActions}</dd></div>
        <div><dt>Rotation</dt><dd>{c.connection.status.droppedRotationActions}</dd></div>
      </dl></section>}
    </div> : <p class="hint">{stateStale && runtime ? 'Runtime state is stale.' : 'Reading runtime state…'}</p>}
    <p class="hint live-input-note"><span>Blue outlines on the device preview show physical input and green outlines show accepted triggers.</span>{' '}<span>Accepted triggers may still wait behind long running actions.</span></p>
  </details>;
}
