import { DEFAULT_RAINBOW_SPEED, RAINBOW_SPEED_LABELS, DEFAULT_RAINBOW_PHASE, RAINBOW_PHASE_DEGREES, LayerIndicatorBehavior } from '../../model/constants';
import { baseline, layerName, profile, updateProfile } from '../store';

const PHASE_LABELS = ['All LEDs together', 'Gentle color wave', 'Rainbow sweep', 'Scattered colors'];

export function ProfilePanel() {
  const p = profile.value!;
  const phaseUnsaved = p.rainbowPhase !== (baseline.value?.rainbowPhase ?? DEFAULT_RAINBOW_PHASE);
  const speedUnsaved = p.rainbowSpeed !== (baseline.value?.rainbowSpeed ?? DEFAULT_RAINBOW_SPEED);
  const showRainbowSettings = p.layers.some((layer) =>
    layer.indicatorBehavior !== LayerIndicatorBehavior.None && layer.indicatorColor === 15);
  const showOffBehavior = p.layers.some((layer) => layer.indicatorBehavior === LayerIndicatorBehavior.AlwaysOn) &&
    p.layers.some((layer) => layer.leds.includes(15));
  return (
    <section class="card">
      <header class="card-head">
        <h2>Profile</h2>
        <span class="muted">Applies to every layer</span>
      </header>
      <div class="field-grid">
        <label class="field">
          <span class="field-label">Startup layer</span>
          <select value={p.startupLayer} onChange={(e) => updateProfile((d) => { d.startupLayer = Number((e.target as HTMLSelectElement).value); })}>
            {p.layers.map((_, i) => <option key={i} value={i}>{layerName(i)}</option>)}
            {p.startupLayer >= p.layers.length && <option value={p.startupLayer}>Layer {p.startupLayer + 1} (missing)</option>}
          </select>
        </label>
        <label class="field field-wide">
          <span class="field-label">
            Chord window <output>{p.chordWindow === 0 ? 'off' : `${p.chordWindow * 5} ms`}</output>
          </span>
          <input type="range" min={0} max={15} step={1} value={p.chordWindow} onInput={(e) => updateProfile((d) => { d.chordWindow = Number((e.target as HTMLInputElement).value); }, 'chord-window')} />
          <span class="hint">
            {p.chordWindow === 0
              ? 'Chord recognition is disabled. Saved chords are kept but never trigger, and keys act immediately.'
              : `A key that belongs to a chord waits up to ${p.chordWindow * 5}ms for its partner before acting alone. Keys without chords are not delayed.`}
          </span>
        </label>
        {showRainbowSettings && <div class="field">
          <label class="field-label" htmlFor="rainbow-phase">Rainbow phase spacing</label>
          <select id="rainbow-phase" value={p.rainbowPhase} onChange={(e) => updateProfile((d) => { d.rainbowPhase = Number((e.target as HTMLSelectElement).value); })}>
            {RAINBOW_PHASE_DEGREES.map((degrees, i) => <option key={i} value={i}>{`${degrees}° — ${PHASE_LABELS[i]}`}</option>)}
          </select>
          <span class="hint">Color spacing between LEDs along the rainbow path. Smaller angles make neighboring colors more similar.</span>
          {phaseUnsaved && <span class="notice notice-info" role="status">Color previews will not use this setting until it is saved to the device</span>}
        </div>}
        {showRainbowSettings && <div class="field">
          <label class="field-label" htmlFor="rainbow-speed">Rainbow speed</label>
          <select id="rainbow-speed" value={p.rainbowSpeed} onChange={(e) => updateProfile((d) => { d.rainbowSpeed = Number((e.target as HTMLSelectElement).value); })}>
            {RAINBOW_SPEED_LABELS.map((label, i) => <option key={i} value={i}>{label}</option>)}
          </select>
          <span class="hint">Controls how quickly the rainbow cycles through colors on every layer.</span>
          {speedUnsaved && <span class="notice notice-info" role="status">Color previews will not use this setting until it is saved to the device</span>}
        </div>}
        {showOffBehavior && <div class="field field-wide">
          <span class="field-label">For key LEDs, "Off" means:</span>
          <div class="segmented" role="group" aria-label={'For key LEDs, "Off" means'}>
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
      </div>
    </section>
  );
}
