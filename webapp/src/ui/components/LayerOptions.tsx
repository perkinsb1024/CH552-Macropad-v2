import { LayerIndicatorBehavior } from '../../model/constants';
import { PALETTE } from '../../model/palette';
import { profile, selectedLayer, updateProfile } from '../store';

const BEHAVIORS = [
  { value: LayerIndicatorBehavior.None, label: 'Do not indicate' },
  { value: LayerIndicatorBehavior.BlinkOnce, label: 'Blink once' },
  { value: LayerIndicatorBehavior.BlinkByLayer, label: 'Blink by layer number' },
  { value: LayerIndicatorBehavior.AlwaysOn, label: 'Dim background' },
];

export function LayerOptions() {
  const p = profile.value!;
  const li = selectedLayer.value;
  const layer = p.layers[li]!;
  const toggle = (key: 'bootloaderFromRun') => (e: Event) =>
    updateProfile((d) => { d.layers[li]![key] = (e.target as HTMLInputElement).checked; });
  return (
    <section class="card">
      <header class="card-head">
        <h2>Layer options</h2>
      </header>
      <label class="check">
        <input type="checkbox" checked={layer.bootloaderFromRun} onChange={toggle('bootloaderFromRun')} />
        <span>
          <strong>Allow bootloader entry by holding the encoder</strong>
          <span class="hint">Uses the layer active when the hold begins.</span>
        </span>
      </label>

      <div class="field layer-indicator-options">
        <label class="field" htmlFor="layer-indicator-behavior">
          <span class="field-label">Layer selection LEDs</span>
          <select
            id="layer-indicator-behavior"
            value={layer.indicatorBehavior}
            onChange={(e) => updateProfile((d) => { d.layers[li]!.indicatorBehavior = Number((e.target as HTMLSelectElement).value) as LayerIndicatorBehavior; })}
          >
            {BEHAVIORS.map((behavior) => <option value={behavior.value}>{behavior.label}</option>)}
          </select>
          {layer.indicatorBehavior === LayerIndicatorBehavior.AlwaysOn && <span class="hint">Idle keys use a dim background color; pressed keys show their per-key color at full brightness.</span>}
          {layer.indicatorBehavior === LayerIndicatorBehavior.BlinkByLayer && <span class="hint">Blinks once per layer number when switching to this layer.</span>}
        </label>
        {layer.indicatorBehavior !== LayerIndicatorBehavior.None && (
          <div class="field">
            <span class="field-label">Layer indicator color</span>
            <div class="palette" role="radiogroup" aria-label="Layer indicator color">
              {PALETTE.map((color) => (
                <button
                  key={color.index}
                  type="button"
                  role="radio"
                  aria-label={color.name}
                  aria-checked={layer.indicatorColor === color.index}
                  title={color.name}
                  class={`swatch-btn ${layer.indicatorColor === color.index ? 'is-selected' : ''} ${color.index === 6 ? 'swatch-off' : ''}`}
                  style={`--c: ${color.hex}`}
                  onClick={() => updateProfile((d) => { d.layers[li]!.indicatorColor = color.index; })}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
