import { LayerIndicatorBehavior } from '../../model/constants';
import { PALETTE } from '../../model/palette';
import { bootloaderWarnings, connection, profile, selectedLayer, updateProfile } from '../store';

import { ColorPreview } from './ColorPreview';
import { IconChevron } from './Icons';

const initializedLayerOptions = new WeakSet<HTMLDetailsElement>();

const BEHAVIORS = [
  { value: LayerIndicatorBehavior.None, label: 'Do not indicate' },
  { value: LayerIndicatorBehavior.TimedOn, label: 'On for 1.5 seconds' },
  { value: LayerIndicatorBehavior.BlinkByLayer, label: 'Blink by layer number' },
  { value: LayerIndicatorBehavior.AlwaysOn, label: 'Always on' },
];
const BLINK_COUNTS = ['once', 'twice', 'three times', 'four times', 'five times', 'six times', 'seven times'];

export function LayerOptions() {
  const p = profile.value!;
  const li = selectedLayer.value;
  const layer = p.layers[li]!;
  const bootloaderWarning = bootloaderWarnings.value.find((warning) => warning.slot?.layer === li);
  const rainbowAvailable = connection.value.kind !== 'connected' || connection.value.connection.info.paletteVersion >= 3;
  const rainbow = rainbowAvailable && layer.indicatorBehavior !== LayerIndicatorBehavior.None;
  const toggle = (key: 'bootloaderFromRun') => (e: Event) =>
    updateProfile((d) => { d.layers[li]![key] = (e.target as HTMLInputElement).checked; });
  return (
    <details class="card layer-options" ref={element => {
      if (element && !initializedLayerOptions.has(element)) {
        element.open = true;
        initializedLayerOptions.add(element);
      }
    }}>
      <summary class="card-head">
        <h2>Layer Options</h2>
        <IconChevron />
      </summary>
      <div class="field layer-indicator-options">
        <label class="field" htmlFor="layer-indicator-behavior">
          <span class="field-label">Layer indicator mode</span>
          <select
            id="layer-indicator-behavior"
            value={layer.indicatorBehavior}
            onChange={(e) => updateProfile((d) => { d.layers[li]!.indicatorBehavior = Number((e.target as HTMLSelectElement).value) as LayerIndicatorBehavior; })}
          >
            {BEHAVIORS.map((behavior) => <option value={behavior.value}>{behavior.label}{behavior.value === LayerIndicatorBehavior.BlinkByLayer ? ` (${BLINK_COUNTS[li]})` : ''}</option>)}
          </select>
          {layer.indicatorBehavior === LayerIndicatorBehavior.AlwaysOn && <span class="hint">Idle keys show the selected color or rainbow; pressed keys show their per-key color. {rainbowAvailable ? '' : 'Rainbow requires palette version 3 firmware; older firmware displays Off.'}</span>}
          {layer.indicatorBehavior === LayerIndicatorBehavior.TimedOn && <span class="hint">Shows the layer color or Rainbow for 1.5 seconds after switching. Overrides pressed-key colors.</span>}
          {layer.indicatorBehavior === LayerIndicatorBehavior.BlinkByLayer && <span class="hint">Blinks once per layer number: 0.25 seconds on, 0.25 seconds off. Overrides key colors throughout the indication.</span>}
        </label>
        {layer.indicatorBehavior !== LayerIndicatorBehavior.None && (
          <div class="field led-color-field">
            <span class="field-label">Layer indicator color</span>
            <div class="color-toolbar">
              <span class="color-selection">
                <span
                  class={`color-selection-dot ${layer.indicatorColor === 15 ? (rainbow ? 'swatch-rainbow' : 'swatch-off') : ''}`}
                  style={`--c:${PALETTE[layer.indicatorColor]?.hex ?? '#000000'};filter:brightness(${layer.indicatorFullBrightness ? 1 : 0.5})`}
                  aria-hidden="true"
                />
                {rainbow && layer.indicatorColor === 15 ? 'Rainbow' : PALETTE[layer.indicatorColor]?.name ?? 'Unknown'}
                {!layer.indicatorFullBrightness && ' (dim)'}
              </span>
            </div>
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
            <div class="layer-indicator-controls">
              <div class="segmented" role="group" aria-label="Layer indicator brightness">
                <button
                  type="button"
                  class={layer.indicatorFullBrightness ? 'is-selected' : ''}
                  aria-pressed={layer.indicatorFullBrightness}
                  onClick={() => updateProfile((d) => { d.layers[li]!.indicatorFullBrightness = true; })}
                >Full Brightness</button>
                <button
                  type="button"
                  class={!layer.indicatorFullBrightness ? 'is-selected' : ''}
                  aria-pressed={!layer.indicatorFullBrightness}
                  onClick={() => updateProfile((d) => { d.layers[li]!.indicatorFullBrightness = false; })}
                >Dim</button>
              </div>
              <ColorPreview color={layer.indicatorColor} fullBrightness={layer.indicatorFullBrightness} rainbow={rainbow} />
            </div>
          </div>
        )}
      </div>

      <details class="layer-advanced">
        <summary>Advanced</summary>
        <label class="check">
          <input type="checkbox" checked={layer.bootloaderFromRun} onChange={toggle('bootloaderFromRun')} />
          <span>
            <strong>Allow bootloader entry by long-pressing the encoder button</strong>
            <span class="hint">Hold for three seconds. Uses the layer active when the hold begins.</span>
          </span>
        </label>
        {bootloaderWarning && <p class="hint warn" role="status">{bootloaderWarning.message}</p>}
      </details>
    </details>
  );
}
