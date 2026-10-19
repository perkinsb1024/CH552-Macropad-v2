import { SLEEP_TIMEOUT_MINUTES, SLEEP_TIMEOUT_LABELS, DEFAULT_RAINBOW_SPEED, RAINBOW_SPEED_LABELS, DEFAULT_RAINBOW_PHASE, RAINBOW_PHASE_LABELS, LayerIndicatorBehavior } from '../../model/constants';
import { autoSleepMode, baseline, layerName, profile, setAutoSleepMode, updateProfile } from '../store';
import { IconChevron } from './Icons';
import { branches, holdBindings, holdThreshold, HOLD_THRESHOLDS, setHoldThreshold } from '../../model/tapHold';

const PHASE_LABELS = ['All LEDs Together', 'Gentle Color Wave', 'Rainbow Sweep', 'Scattered Colors'];

/** Open the shared setting and briefly dim the rest of the page. */
export function spotlightHoldThreshold() {
  const field = document.getElementById('hold-threshold');
  const panel = field?.closest('details');
  if (!field || !panel) return;
  panel.open = true;
  field.scrollIntoView({ block: 'center', behavior: 'instant' });
  field.querySelector('input')?.focus({ preventScroll: true });
  field.classList.remove('setting-spotlight');
  void field.offsetWidth;
  field.classList.add('setting-spotlight');
  field.addEventListener('animationend', () => field.classList.remove('setting-spotlight'), { once: true });
}

export function ProfilePanel() {
  const p = profile.value!;
  const holds = holdBindings(p);
  const mixedHolds = holds.some(a => holdThreshold(p, a) !== holdThreshold(p));
  const phaseUnsaved = p.rainbowPhase !== (baseline.value?.rainbowPhase ?? DEFAULT_RAINBOW_PHASE);
  const speedUnsaved = p.rainbowSpeed !== (baseline.value?.rainbowSpeed ?? DEFAULT_RAINBOW_SPEED);
  const showRainbowSettings = p.layers.some((layer) =>
    layer.leds.includes(15) || (layer.indicatorBehavior !== LayerIndicatorBehavior.None &&
      (layer.indicatorColor === 15 || (layer.indicatorColor === 0 && layer.idleLeds?.includes(15))))) ||
    [...p.layers.flatMap(l => [...l.keys, l.encoderButton, l.clockwise, l.counterclockwise]), ...p.chords.map(c => c.action),
      ...(p.timedActions ?? []).flatMap(t => [t.action, t.resumeAction]), ...(p.macros ?? []).flatMap(m => m.actions)]
      .flatMap(branches).some(a => a.type === 'ledControl' && /^effect(On|Blink[1-8])$/.test(a.command) && a.value === 15);
  const showOffBehavior = p.layers.some((layer) => layer.indicatorBehavior === LayerIndicatorBehavior.AlwaysOn) &&
    p.layers.some((layer) => layer.leds.includes(0));
  return (
    <details class="card profile-settings">
      <summary class="card-head">
        <h2>Profile Settings</h2>
        <span class="muted">Applies to every layer</span>
        <IconChevron />
      </summary>
      <div class="field-grid">
        <label class="field field-wide">
          <span class="field-label">Startup Layer</span>
          <select value={p.startupLayer} onChange={(e) => updateProfile((d) => { d.startupLayer = Number((e.target as HTMLSelectElement).value); })}>
            {p.layers.map((_, i) => <option key={i} value={i}>{layerName(i)}</option>)}
            {p.startupLayer >= p.layers.length && <option value={p.startupLayer}>Layer {p.startupLayer + 1} (missing)</option>}
          </select>
        </label>
        {(p.chords.length > 0 || p.chordWindow === 0) && <label class="field field-wide">
          <span class="field-label">
            Chord Window <output>{p.chordWindow === 0 ? 'Selection Required' : `${p.chordWindow * 5}ms`}</output>
          </span>
          <input type="range" min={4} max={18} step={2} value={p.chordWindow || 8} onInput={(e) => updateProfile((d) => { d.chordWindow = Number((e.target as HTMLInputElement).value); }, 'chord-window')} />
          {p.chordWindow === 0 && <button type="button" class="btn" onClick={() => updateProfile(d => { d.chordWindow = 8; })}>Use 40ms</button>}
          <span class="hint">
            {p.chordWindow === 0
              ? 'These imported chords were disabled. Their bindings are retained; select a window before saving to enable them.'
              : `A key that belongs to a chord waits up to ${p.chordWindow * 5}ms for its partner before acting alone. Keys without chords are not delayed.`}
          </span>
        </label>}
        {holds.length > 0 && <label id="hold-threshold" class="field field-wide">
          <span class="field-label">Hold Threshold <output>{mixedHolds ? 'Mixed (Saved Values)' : `${holdThreshold(p)}ms`}</output></span>
          <input type="range" aria-label="Hold Threshold" min={32} max={512} step={32} value={holdThreshold(p)} onInput={e => {
            const value = Number((e.target as HTMLInputElement).value);
            if (HOLD_THRESHOLDS.includes(value)) updateProfile(d => setHoldThreshold(d, value), 'hold-threshold');
          }} />
          <span class="hint">Applies to every Hold gesture. Release before the threshold for Tap; reaching it runs Hold. Tap actions run on release.</span>
          {mixedHolds && <span class="hint">This profile has different saved thresholds. Move the slider to apply one value to every Hold gesture.</span>}
        </label>}
        {showRainbowSettings && <div class="field">
          <label class="field-label" htmlFor="rainbow-phase">Rainbow Phase Spacing</label>
          <select id="rainbow-phase" value={p.rainbowPhase} onChange={(e) => updateProfile((d) => { d.rainbowPhase = Number((e.target as HTMLSelectElement).value); })}>
            {RAINBOW_PHASE_LABELS.map((label, i) => <option key={i} value={i}>{`${label} — ${PHASE_LABELS[i]}`}</option>)}
          </select>
          <span class="hint">Color spacing between LEDs along the rainbow path. Smaller angles make neighboring colors more similar.</span>
          {phaseUnsaved && <span class="notice notice-info" role="status">Color previews will not use this setting until it is saved to the device</span>}
        </div>}
        {showRainbowSettings && <div class="field">
          <label class="field-label" htmlFor="rainbow-speed">Rainbow Speed</label>
          <select id="rainbow-speed" value={p.rainbowSpeed} onChange={(e) => updateProfile((d) => { d.rainbowSpeed = Number((e.target as HTMLSelectElement).value); })}>
            {RAINBOW_SPEED_LABELS.map((label, i) => <option key={i} value={i}>{label}</option>)}
          </select>
          <span class="hint">Controls how quickly the rainbow cycles through colors on every layer.</span>
          {speedUnsaved && <span class="notice notice-info" role="status">Color previews will not use this setting until it is saved to the device</span>}
        </div>}
        {showOffBehavior && <div class="field field-wide">
          <span class="field-label">For Key LEDs, "Off" Means:</span>
          <div class="segmented" role="group" aria-label={'For Key LEDs, "Off" Means'}>
            <button
              type="button"
              class={p.transparentBlack ? 'is-selected' : ''}
              aria-pressed={p.transparentBlack}
              onClick={() => updateProfile((d) => { d.transparentBlack = true; })}
            >Transparent</button>
            <button
              type="button"
              class={!p.transparentBlack ? 'is-selected' : ''}
              aria-pressed={!p.transparentBlack}
              onClick={() => updateProfile((d) => { d.transparentBlack = false; })}
            >Black</button>
          </div>
          <span class="hint">
            <strong>Transparent:</strong> The idle color (including rainbow) is not affected<br />
            <strong>Black:</strong> The key will override the idle color<br />
            This only applies to "Always On" - Timed and Blink layer indications will override a "Black" key
          </span>
        </div>}
        <div class="field field-wide">
          <span class="field-label">Auto-Sleep</span>
          <div class="segmented" role="group" aria-label="Profile Auto-Sleep">
            {(['On', 'Per Layer', 'Off'] as const).map(mode => <button
              key={mode}
              type="button"
              class={autoSleepMode.value === mode ? 'is-selected' : ''}
              aria-pressed={autoSleepMode.value === mode}
              onClick={() => setAutoSleepMode(mode)}
            >{mode}</button>)}
          </div>
          <span class="hint">
            On or Off applies to all layers. Choose Per Layer to configure Auto-Sleep under Layer Options → Advanced.<br />
            The below settings will apply to all layers that have Auto-Sleep enabled.
          </span>
        </div>
        {p.layers.some(layer => layer.autoSleep) && <div class="sleep-settings field-wide" role="group" aria-label="Auto-Sleep Settings">
          <label class="field">
            <span class="field-label">Auto-Sleep Timeout</span>
            <select aria-label="Auto-Sleep Timeout" value={p.sleepTimeoutMinutes} onChange={e => updateProfile(d => {
              d.sleepTimeoutMinutes = Number((e.target as HTMLSelectElement).value);
            })}>
              {SLEEP_TIMEOUT_MINUTES.map((minutes, i) => <option key={minutes} value={minutes}>{SLEEP_TIMEOUT_LABELS[i]}</option>)}
            </select>
            <span class="hint">The macropad will sleep after {SLEEP_TIMEOUT_LABELS[SLEEP_TIMEOUT_MINUTES.findIndex(minutes => minutes === p.sleepTimeoutMinutes)]?.toLowerCase()} of inactivity.</span>
          </label>
          {([
            ['consumeWakeInput', 'Consume Wake Input', 'When enabled, the first input after sleep will only wake the device, it will not run the assigned action.'],
            ['showLayerIndicatorOnWake', 'Show Layer Indicator on Wake', 'Repeat the current layer’s timed or blink indication on wake.'],
            ['dimInsteadOfOff', 'Sleep Behavior', 'How layer indicators should behave during sleep. Choosing "Dim" will not turn on LEDs that are already off.'],
          ] as const).map(([field, label, hint]) => <div key={field} class="field">
            <span class="field-label" id={`sleep-${field}`}>{label}</span>
            <div class="segmented" role="group" aria-labelledby={`sleep-${field}`}>
              {([true, false] as const).map(enabled => <button
                key={String(enabled)}
                type="button"
                class={p[field] === enabled ? 'is-selected' : ''}
                aria-pressed={p[field] === enabled}
                onClick={() => updateProfile(d => { d[field] = enabled; })}
              >{enabled ? (field === 'dimInsteadOfOff' ? 'Dim' : 'On') : 'Off'}</button>)}
            </div>
            <span class="hint">{hint}</span>
          </div>)}
        </div>}
      </div>
    </details>
  );
}
