import { layerName, profile, updateProfile } from '../store';

export function ProfilePanel() {
  const p = profile.value!;
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
      </div>
    </section>
  );
}
