import { LayerIndicatorBehavior } from '../../model/constants';
import { PALETTE } from '../../model/palette';
import { connection, profile, selectedLayer, updateProfile } from '../store';

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
  const rainbowAvailable = connection.value.kind !== 'connected' || connection.value.connection.info.paletteVersion >= 3;
  const rainbow = layer.indicatorBehavior === LayerIndicatorBehavior.AlwaysOn;
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
          {layer.indicatorBehavior === LayerIndicatorBehavior.AlwaysOn && <span class="hint">Idle keys use a dim background color; pressed keys show their per-key color at full brightness. {rainbowAvailable ? 'Choose Rainbow for a slowly cycling color on idle keys.' : 'Rainbow requires palette version 3 firmware; older firmware displays Off.'}</span>}
          {layer.indicatorBehavior === LayerIndicatorBehavior.BlinkByLayer && <span class="hint">Blinks once per layer number when switching to this layer.</span>}
        </label>
        {layer.indicatorBehavior !== LayerIndicatorBehavior.None && (
          <div class="field">
            <span class="field-label">Layer indicator color</span>
            <div class="palette" role="radiogroup" aria-label="Layer indicator color">
              {PALETTE.map((color) => {
                const name = rainbow && color.index === 15 ? 'Rainbow' : color.name;
                return (
                  <button
                    key={color.index}
                    type="button"
                    role="radio"
                    aria-label={name}
                    aria-checked={layer.indicatorColor === color.index}
                    title={name}
                    class={`swatch-btn ${layer.indicatorColor === color.index ? 'is-selected' : ''} ${color.index === 15 ? (rainbow ? 'swatch-rainbow' : 'swatch-off') : ''}`}
                    style={`--c: ${color.hex}`}
                    onClick={() => updateProfile((d) => { d.layers[li]!.indicatorColor = color.index; })}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
