import { SLEEP_TIMEOUT_MINUTES, SLEEP_TIMEOUT_LABELS, DEFAULT_RAINBOW_SPEED, RAINBOW_SPEED_LABELS, DEFAULT_RAINBOW_PHASE, RAINBOW_PHASE_LABELS, LayerIndicatorBehavior } from '../../model/constants';
import { autoSleepMode, baseline, layerName, profile, setAutoSleepMode, updateProfile } from '../store';
import { IconChevron } from './Icons';

const PHASE_LABELS = ['All LEDs Together', 'Gentle Color Wave', 'Rainbow Sweep', 'Scattered Colors'];

export function ProfilePanel() {
  const p = profile.value!;
  const phaseUnsaved = p.rainbowPhase !== (baseline.value?.rainbowPhase ?? DEFAULT_RAINBOW_PHASE);
  const speedUnsaved = p.rainbowSpeed !== (baseline.value?.rainbowSpeed ?? DEFAULT_RAINBOW_SPEED);
  const showRainbowSettings = p.layers.some((layer) =>
    layer.indicatorBehavior !== LayerIndicatorBehavior.None && layer.indicatorColor === 15);
  const showOffBehavior = p.layers.some((layer) => layer.indicatorBehavior === LayerIndicatorBehavior.AlwaysOn) &&
    p.layers.some((layer) => layer.leds.includes(15));
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
            When enabled, LEDs turn off or dim after the selected period of inactivity. On or Off applies to all layers.<br />
            Configuring this setting Per Layer can be done by clicking Advanced under Layer Options.
          </span>
        </div>
        {p.layers.some(layer => layer.autoSleep) && <>
          <label class="field field-wide">
            <span class="field-label">Sleep Timeout</span>
            <select aria-label="Sleep Timeout" value={p.sleepTimeoutMinutes} onChange={e => updateProfile(d => {
              d.sleepTimeoutMinutes = Number((e.target as HTMLSelectElement).value);
            })}>
              {SLEEP_TIMEOUT_MINUTES.map((minutes, i) => <option key={minutes} value={minutes}>{SLEEP_TIMEOUT_LABELS[i]}</option>)}
            </select>
          </label>
          {([
            ['consumeWakeInput', 'Consume Wake Input', 'The first press or complete encoder turn wakes the pad without executing its binding. Turn off to wake and execute the binding.'],
            ['showLayerIndicatorOnWake', 'Show Layer Indicator', 'Restart the current layer’s timed or blink indication on wake. Always On and Do Not Indicate keep their configured behavior.'],
            ['dimInsteadOfOff', 'Dim Instead of Off', 'Use the existing dim brightness for layer indicators and pressed-key feedback during sleep. This keeps configured lighting behavior; it does not turn an inactive indicator on.'],
          ] as const).map(([field, label, hint]) => <label key={field} class="field field-wide">
            <span class="check"><input type="checkbox" aria-label={label} checked={p[field]} onChange={e => updateProfile(d => {
              d[field] = (e.target as HTMLInputElement).checked;
            })} />{label}</span>
            <span class="hint">{hint}</span>
          </label>)}
        </>}
      </div>
    </details>
  );
}
