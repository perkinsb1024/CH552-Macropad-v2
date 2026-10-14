import { DEFAULT_RAINBOW_SPEED, RAINBOW_SPEED_LABELS, DEFAULT_RAINBOW_PHASE, RAINBOW_PHASE_LABELS, LayerIndicatorBehavior } from '../../model/constants';
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
          <span class="hint">On or Off applies to every layer. Per Layer keeps the current settings so you can adjust each layer under Advanced.</span>
        </div>
      </div>
    </details>
  );
}
