import { profile, selectedLayer, updateProfile } from '../store';

export function LayerOptions() {
  const p = profile.value!;
  const li = selectedLayer.value;
  const layer = p.layers[li]!;
  const toggle = (key: 'invertScroll' | 'bootloaderFromBoot' | 'bootloaderFromRun') => (e: Event) =>
    updateProfile((d) => { d.layers[li]![key] = (e.target as HTMLInputElement).checked; });
  return (
    <section class="card">
      <header class="card-head">
        <h2>Layer options</h2>
      </header>
      <label class="check">
        <input type="checkbox" checked={layer.invertScroll} onChange={toggle('invertScroll')} />
        <span>
          <strong>Invert encoder scrolling</strong>
          <span class="hint">Negates scroll actions produced by rotation on this layer. Keyboard and media actions are unaffected.</span>
        </span>
      </label>
      <label class="check">
        <input type="checkbox" checked={layer.bootloaderFromBoot} disabled={li !== p.startupLayer} onChange={toggle('bootloaderFromBoot')} />
        <span>
          <strong>Allow bootloader entry at power-up</strong>
          <span class="hint">{li === p.startupLayer ? 'Only the startup layer can enable this.' : `Available only on ${p.layers[p.startupLayer] ? `the startup layer (${p.startupLayer + 1})` : 'the startup layer'}.`}</span>
        </span>
      </label>
      <label class="check">
        <input type="checkbox" checked={layer.bootloaderFromRun} onChange={toggle('bootloaderFromRun')} />
        <span>
          <strong>Allow bootloader entry by holding the encoder</strong>
          <span class="hint">Uses the layer active when the hold begins.</span>
        </span>
      </label>
    </section>
  );
}
