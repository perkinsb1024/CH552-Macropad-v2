import { MAX_LAYERS } from '../../model/constants';
import { addLayer, ask, closeDialog, layerName, layerReferences, profile, removeLayer, selectedLayer, updateProfile } from '../store';
import { IconPlus, IconTrash } from './Icons';

export function ProfilePanel() {
  const p = profile.value!;
  const layers = p.layers.length;
  const current = selectedLayer.value;

  const confirmRemove = (index: number) => {
    const refs = layerReferences(p, index);
    const parts: string[] = [];
    if (refs.chords) parts.push(`${refs.chords} chord${refs.chords > 1 ? 's' : ''} on this layer will be deleted`);
    if (refs.actions) parts.push(`${refs.actions} binding${refs.actions > 1 ? 's' : ''} elsewhere point${refs.actions > 1 ? '' : 's'} to it and will need a new target`);
    if (p.startupLayer === index) parts.push('it is the startup layer, which will move');
    ask({
      title: `Remove ${layerName(index)}?`,
      body: parts.length ? `Removing this layer: ${parts.join('; ')}.` : 'All bindings on this layer will be removed from the editor. Nothing changes on the device until you save.',
      actions: [
        { label: 'Cancel', tone: 'neutral', onSelect: closeDialog },
        { label: 'Remove layer', tone: 'danger', onSelect: () => { removeLayer(index); closeDialog(); } },
      ],
    });
  };

  return (
    <section class="card">
      <header class="card-head">
        <h2>Profile</h2>
        <span class="muted">Applies to every layer</span>
      </header>
      <div class="field-grid">
        <label class="field">
          <span class="field-label">Layers</span>
          <div class="stepper">
            <button class="btn btn-icon" aria-label="Remove current layer" disabled={layers <= 1} onClick={() => confirmRemove(current)} title={`Remove ${layerName(current)}`}><IconTrash /></button>
            <output>{layers} / {MAX_LAYERS}</output>
            <button class="btn btn-icon" aria-label="Add layer" disabled={layers >= MAX_LAYERS} onClick={addLayer} title="Add an empty layer"><IconPlus /></button>
          </div>
        </label>
        <label class="field">
          <span class="field-label">Startup layer</span>
          <select value={p.startupLayer} onChange={(e) => updateProfile((d) => { d.startupLayer = Number((e.target as HTMLSelectElement).value); })}>
            {p.layers.map((_, i) => <option key={i} value={i}>{layerName(i)}</option>)}
            {p.startupLayer >= layers && <option value={p.startupLayer}>Layer {p.startupLayer + 1} (missing)</option>}
          </select>
        </label>
        <label class="field field-wide">
          <span class="field-label">
            Chord window <output>{p.chordWindow === 0 ? 'off' : `${p.chordWindow * 5} ms`}</output>
          </span>
          <input type="range" min={0} max={15} step={1} value={p.chordWindow} onInput={(e) => updateProfile((d) => { d.chordWindow = Number((e.target as HTMLInputElement).value); })} />
          <span class="hint">
            {p.chordWindow === 0
              ? 'Chord recognition is disabled. Saved chords are kept but never trigger, and keys act immediately.'
              : `A key that belongs to a chord waits up to ${p.chordWindow * 5} ms for its partner before acting alone. Keys without chords are not delayed.`}
          </span>
        </label>
      </div>
    </section>
  );
}
