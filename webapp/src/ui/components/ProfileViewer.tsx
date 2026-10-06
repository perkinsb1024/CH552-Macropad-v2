import { useEffect } from 'preact/hooks';
import { connection, connectSimulator, layerName, profile, selectedLayer } from '../store';
import { followDeviceLayer } from '../profileViewer';
import { ActionLabel } from './ActionLabel';
import { ArchivedFirmwareNotice } from './ArchivedFirmwareNotice';
import { DeviceView } from './DeviceView';
import { TopBar } from './TopBar';
import { Toasts } from './Toasts';
import { TIMED_TICK_SECONDS } from '../../model/constants';
import { duration } from './TimedActionsPanel';

export function ViewerChords() {
  const p = profile.value!;
  const chords = p.chords.filter(c => c.global || c.layer === selectedLayer.value)
    .sort((a, b) => a.keyA - b.keyA || a.keyB - b.keyB);
  return <section class="card viewer-bindings">
    <header class="card-head"><h2>Chords</h2><span class="muted">Two keys together</span></header>
    {!chords.length ? <p class="muted">No chords on this layer.</p> : <ul class="viewer-binding-list">
      {chords.map(c => <li key={`${c.layer}-${c.keyA}-${c.keyB}-${!!c.global}`}>
        <span class="chord-keys"><kbd>{c.keyA + 1}</kbd><span>+</span><kbd>{c.keyB + 1}</kbd></span>
        <ActionLabel action={c.action} />
        {c.global && <span class="tab-badge">all layers</span>}
      </li>)}
    </ul>}
    {p.chordWindow === 0 && chords.length > 0 && <p class="hint warn">Chords are disabled in this profile.</p>}
  </section>;
}

export function ViewerTimers() {
  const timers = profile.value!.timedActions ?? [];
  if (!timers.length) return null;
  return <section class="card viewer-bindings">
    <header class="card-head"><h2>Timed actions</h2><span class="muted">Global or per layer</span></header>
    <ul class="viewer-binding-list viewer-timers">
      {timers.map((timer, index) => <li key={index}>
        <div><strong>Timer {index + 1}</strong><span class="muted">{timer.layer === undefined ? 'All layers' : layerName(timer.layer)}</span><span class="muted">
          {timer.resetOnInput ? 'After ' : 'Repeats every '}{duration(timer.ticks * TIMED_TICK_SECONDS)}{timer.resetOnInput ? ' of inactivity' : ''}
        </span></div>
        <div><span class="muted">When fired</span><ActionLabel action={timer.action} /></div>
        {(timer.resumeAction.type !== 'none' || timer.consumeInput) && <div>
          <span class="muted">Next input</span><ActionLabel action={timer.resumeAction} />
          {timer.consumeInput && <span class="tab-badge">consumed</span>}
        </div>}
      </li>)}
    </ul>
  </section>;
}

export function ProfileViewer() {
  useEffect(followDeviceLayer, []);
  useEffect(() => {
    const sim = new URLSearchParams(location.search).get('sim');
    if (sim === 'six') void connectSimulator(0);
    else if (sim === 'three') void connectSimulator(1);
    else if (sim === 'blank') void connectSimulator(0, true);
  }, []);
  const p = profile.value;
  const c = connection.value;
  const deviceLayer = c.kind === 'connected' && c.connection.status.flashValid ? c.connection.status.currentLayer : null;
  const knownLayer = deviceLayer !== null && p && deviceLayer >= 0 && deviceLayer < p.layers.length;
  const mismatch = knownLayer && selectedLayer.value !== deviceLayer;
  return <div class="app profile-viewer">
    <TopBar readOnly />
    <ArchivedFirmwareNotice />
    <main class="viewer-workspace">
      {!p ? <section class="card viewer-empty"><h2>Learn your macropad profile</h2>
        <p class="muted">Connect your macropad to display its saved shortcuts and follow layer changes.</p>
        {c.kind === 'connected' && <p class="warn">There is no valid saved profile to display. Open the configurator to repair it.</p>}
      </section> : <>
        <section class="card card-device">
          <div class="tabs" role="tablist" aria-label="Layers">
            {p.layers.map((_, i) => <button key={i} class={`tab ${selectedLayer.value === i ? 'tab-active' : ''}`}
              role="tab" aria-selected={selectedLayer.value === i} onClick={() => { selectedLayer.value = i; }}>
              <span class="tab-index">{i + 1}</span><span class="tab-name">{layerName(i)}</span>
              {deviceLayer === i && <span class="tab-badge">device</span>}
            </button>)}
          </div>
          {(mismatch || !knownLayer) && <div class="viewer-layer-status" aria-live="polite">
            {mismatch ? <div class="notice notice-warn" role="status">
              Viewing {layerName(selectedLayer.value)}. Your macropad is on {layerName(deviceLayer!)}.
              <button class="btn" onClick={() => { selectedLayer.value = deviceLayer!; }}>Follow device</button>
            </div> : <p class="muted">Device disconnected or layer unavailable · showing the last loaded profile</p>}
          </div>}
          <DeviceView readOnly />
        </section>
        <div class="viewer-extras"><ViewerChords /><ViewerTimers /></div>
      </>}
    </main>
    <Toasts />
  </div>;
}
