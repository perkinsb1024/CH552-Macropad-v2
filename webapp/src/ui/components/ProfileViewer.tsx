import { useEffect, useRef } from 'preact/hooks';
import { connection, connectSimulator, layerName, liveClock, liveRuntime, profile, selectedLayer } from '../store';
import { followDeviceLayer } from '../profileViewer';
import { ActionLabel } from './ActionLabel';
import { ArchivedFirmwareNotice } from './ArchivedFirmwareNotice';
import { DeviceView } from './DeviceView';
import { TopBar } from './TopBar';
import { LiveStatus, countdown } from './LiveStatus';
import { timerRemaining } from '../../protocol/live';
import { Toasts } from './Toasts';
import { SLEEP_TIMEOUT_LABELS, SLEEP_TIMEOUT_MINUTES, MAX_TIMED_ACTIONS, TIMED_TICK_SECONDS } from '../../model/constants';
import { viewerSection } from '../viewerSections';
import { IconChevron } from './Icons';
import { rainbowAnimation, setRainbowAnimation, startLiveLighting } from '../liveLighting';

export function ViewerChords() {
  const p = profile.value!;
  const chords = p.chords.filter(c => c.global || c.layer === selectedLayer.value)
    .sort((a, b) => a.keyA - b.keyA || a.keyB - b.keyB);
  return <details class="card viewer-bindings viewer-section" {...viewerSection('chords')}>
    <summary class="card-head"><h2>Chords ({chords.length})</h2><IconChevron /></summary>
    {chords.length ? <ul class="viewer-binding-list">
      {chords.map(c => <li key={`${c.layer}-${c.keyA}-${c.keyB}-${!!c.global}`}>
        <span class="chord-keys"><kbd>{c.keyA + 1}</kbd><span>+</span><kbd>{c.keyB + 1}</kbd></span>
        <ActionLabel action={c.action} />
        {c.global && <span class="tab-badge viewer-all-layers">All Layers</span>}
      </li>)}
    </ul> : <p class="muted">No chords on this layer.</p>}
    {chords.length > 0 && p.chordWindow === 0 && <p class="hint warn">These imported chords need a Chord Window selected before saving.</p>}
  </details>;
}

export function ViewerTimers() {
  const timers = profile.value!.timedActions ?? [];
  return <details class="card viewer-bindings viewer-section viewer-timed-actions" {...viewerSection('timers')}>
    <summary class="card-head"><h2>Timed Actions ({timers.length}/{MAX_TIMED_ACTIONS})</h2><IconChevron /></summary>
    {!timers.length && <p class="muted">No timed actions in this profile.</p>}
    <ul class="viewer-binding-list viewer-timers">
      {timers.map((timer, index) => {
        const runtime = liveRuntime.value;
        const fresh = runtime && liveClock.value - runtime.receivedAt < 1000;
        const paused = fresh && timer.layer !== undefined && timer.layer !== runtime.state.layer;
        return <li key={index}>
          <div class="viewer-item-heading"><h3>Timer {index + 1}</h3><span class={timer.layer === undefined ? 'tab-badge viewer-all-layers' : 'viewer-scope'}>{timer.layer === undefined ? 'All Layers' : layerName(timer.layer)}</span></div>
          <dl class="viewer-facts">
            <div><dt>Trigger</dt><dd>{timer.resetOnInput ? 'After ' : 'Every '}<span class="live-countdown">{countdown(timer.ticks * TIMED_TICK_SECONDS)}</span>{timer.resetOnInput ? ' of inactivity' : ''}</dd></div>
            {fresh && <div><dt>Next Fire</dt><dd>{paused ? 'Paused Outside Its Layer' : <span class="live-countdown">{countdown(timerRemaining(runtime.timers, index, timer.ticks))}</span>}</dd></div>}
            {fresh && !!(runtime.timers.high[index]! & 1) && <div><dt>Status</dt><dd>Next Input Action Armed</dd></div>}
            <div><dt>When Fired</dt><dd><ActionLabel action={timer.action} /></dd></div>
            {(timer.resumeAction.type !== 'none' || timer.consumeInput) && <div><dt>Next Input</dt><dd><ActionLabel action={timer.resumeAction} /></dd></div>}
            {timer.consumeInput && <div><dt>Input Policy</dt><dd>Consumed</dd></div>}
          </dl>
        </li>;
      })}
    </ul>
  </details>;
}

export function ViewerMacros() {
  const p = profile.value!;
  const macros = p.macros ?? [];
  const layerIndex = selectedLayer.value;
  const layer = p.layers[layerIndex]!;
  const triggers = [
    ...layer.keys, layer.encoderButton, layer.clockwise, layer.counterclockwise,
    ...p.chords.filter(chord => chord.global || chord.layer === layerIndex).map(chord => chord.action),
    ...(p.timedActions ?? []).filter(timer => timer.layer === undefined || timer.layer === layerIndex)
      .flatMap(timer => [timer.action, timer.resumeAction]),
  ];
  const triggeredMacros = new Set(triggers.filter(action => action.type === 'macro').map(action => action.macro));
  return <details class="card viewer-bindings viewer-section viewer-macros" {...viewerSection('macros')}><summary class="card-head"><h2>Macros ({macros.length})</h2><IconChevron /></summary>
    {!macros.length && <p class="muted">No macros in this profile.</p>}
    {macros.map((macro, index) => <div class="viewer-macro" key={index}>
      <div class="viewer-item-heading"><h3>Macro {index + 1}</h3><span class="viewer-meta">{macro.actions.length} {macro.actions.length === 1 ? 'Step' : 'Steps'}</span></div>
      {!triggeredMacros.has(index) && <p class="viewer-meta viewer-macro-usage">Not Used on This Layer</p>}
      <ol>{macro.actions.map((action, step) => <li key={step}><ActionLabel action={action} /></li>)}</ol>
    </div>)}
  </details>;
}

// Compare all cards at the same column width, including the normally full-width timers.
export function tallestViewerSection(heights: number[], gap: number): number | null {
  const tallest = heights.indexOf(Math.max(...heights));
  const stacked = heights.reduce((sum, height, index) => sum + (index === tallest ? 0 : height), gap);
  return heights[tallest]! >= stacked * 0.85 ? tallest : null;
}

export function ViewerExtras() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const cards = Array.from(element.children) as HTMLElement[];
    const names = ['chords', 'macros', 'timers'];
    let frame = 0;
    const update = () => {
      frame = 0;
      const gap = parseFloat(getComputedStyle(element).columnGap);
      const width = element.clientWidth;
      if (width < 320 * 2 + gap) {
        delete element.dataset.tallest;
        element.style.removeProperty('--viewer-first-row-height');
        return;
      }
      const columnWidth = (width - gap) / 2;
      const heights = cards.map(card => {
        const measurement = card.cloneNode(true) as HTMLElement;
        measurement.setAttribute('aria-hidden', 'true');
        measurement.setAttribute('inert', '');
        Object.assign(measurement.style, {
          position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
          width: `${columnWidth}px`, boxSizing: 'border-box', top: '0', left: '0',
        });
        element.appendChild(measurement);
        const height = measurement.getBoundingClientRect().height;
        measurement.remove();
        return height;
      });
      const tallest = tallestViewerSection(heights, gap);
      if (tallest === null) {
        delete element.dataset.tallest;
        element.style.removeProperty('--viewer-first-row-height');
      } else {
        element.dataset.tallest = names[tallest];
        const firstStacked = heights.findIndex((_, index) => index !== tallest);
        element.style.setProperty('--viewer-first-row-height', `${heights[firstStacked]}px`);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    cards.forEach(card => {
      observer.observe(card);
      Array.from(card.children).forEach(child => observer.observe(child));
    });
    element.addEventListener('toggle', schedule, true);
    schedule();
    return () => {
      observer.disconnect();
      element.removeEventListener('toggle', schedule, true);
      cancelAnimationFrame(frame);
    };
  }, []);
  return <div class="viewer-extras" ref={container}><ViewerChords /><ViewerMacros /><ViewerTimers /></div>;
}

export function ProfileViewer() {
  useEffect(followDeviceLayer, []);
  useEffect(startLiveLighting, []);
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
  const viewedLayer = p?.layers[selectedLayer.value];
  const indicatorMode = viewedLayer && ['Off', '1.5 Seconds', `Blink ${selectedLayer.value + 1} Times`, 'Always On'][viewedLayer.indicatorBehavior];
  return <div class="app profile-viewer">
    <TopBar readOnly />
    <ArchivedFirmwareNotice />
    <main class="viewer-workspace">
      {!p ? <section class="card viewer-empty"><h2>Learn Your Macropad Profile</h2>
        <p class="muted">Connect your macropad to display its saved shortcuts and follow layer changes.</p>
        {c.kind === 'connected' && <p class="warn">There is no valid saved profile to display. Open the configurator to repair it.</p>}
      </section> : <>
        <section class="card card-device">
          <div class="tabs" role="tablist" aria-label="Layers">
            {p.layers.map((_, i) => <button key={i} class={`tab ${selectedLayer.value === i ? 'tab-active' : ''}`}
              role="tab" aria-selected={selectedLayer.value === i} onClick={() => { selectedLayer.value = i; }}>
              <span class="tab-name">{layerName(i)}</span>
              {deviceLayer === i && <span class="tab-badge">active</span>}
            </button>)}
          </div>
          {(mismatch || !knownLayer) && <div class="viewer-layer-status" aria-live="polite">
            {mismatch ? <div class="notice notice-warn" role="status">
              Viewing {layerName(selectedLayer.value)}. Your macropad is on {layerName(deviceLayer!)}. Showing saved layer colors only; these do not match the device's current LEDs.
              <button class="btn" onClick={() => { selectedLayer.value = deviceLayer!; }}>Follow Device</button>
            </div> : <p class="muted">Device disconnected or layer unavailable. Showing the last loaded profile and saved layer colors.</p>}
          </div>}
          <DeviceView readOnly />
          <details class="viewer-section viewer-saved-settings" {...viewerSection('layer-settings', false)}>
            <summary class="card-head"><h2>Layer Settings</h2><IconChevron /></summary>
            <div class="viewer-settings-grid" aria-label="Layer Settings">
              <section class="viewer-stat-group"><h3>Layer Indicator</h3><dl class="viewer-facts">
                <div><dt>Mode</dt><dd>{indicatorMode}</dd></div>
                <div><dt>Brightness</dt><dd>{viewedLayer?.indicatorFullBrightness ? 'Full Brightness' : 'Dim'}</dd></div>
              </dl></section>
              <section class="viewer-stat-group"><h3>Auto-Sleep</h3><dl class="viewer-facts">
                {viewedLayer?.autoSleep ? <>
                  <div><dt>Timeout</dt><dd>{SLEEP_TIMEOUT_LABELS[SLEEP_TIMEOUT_MINUTES.findIndex(minutes => minutes === p.sleepTimeoutMinutes)]}</dd></div>
                  <div><dt>LEDs</dt><dd>{p.dimInsteadOfOff ? 'Dim' : 'Off'}</dd></div>
                  <div><dt>Wake Input</dt><dd>{p.consumeWakeInput ? 'Consumed' : 'Wake and Execute'}</dd></div>
                  <div><dt>Layer Reminder</dt><dd>{p.showLayerIndicatorOnWake ? 'On' : 'Off'}</dd></div>
                </> : <div><dt>Status</dt><dd>Disabled</dd></div>}
              </dl></section>
            </div>
            <div class="viewer-animation-setting">
              <span id="rainbow-animation-label">Rainbow Animation Visualization</span>
              <div class="segmented" role="group" aria-labelledby="rainbow-animation-label">
                {(['always', 'brief', 'never'] as const).map(mode => <button type="button" key={mode}
                  class={rainbowAnimation.value === mode ? 'is-selected' : ''}
                  aria-pressed={rainbowAnimation.value === mode} onClick={() => setRainbowAnimation(mode)}>
                  {mode === 'always' ? 'Always' : mode === 'brief' ? 'Brief' : 'Never'}
                </button>)}
              </div>
            </div>
          </details>
        </section>
        <ViewerExtras />
        <LiveStatus />
      </>}
    </main>
    <Toasts />
  </div>;
}
