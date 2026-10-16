import { LayerIndicatorBehavior } from '../../model/constants';
import { usePerKeyColors } from '../../model/layerPalette';
import { PALETTE } from '../../model/palette';
import { profile, selectedLayer, updateProfile } from '../store';

import { ColorPreview } from './ColorPreview';
import { IconChevron } from './Icons';

const initializedLayerOptions = new WeakSet<HTMLDetailsElement>();

const BEHAVIORS = [
  { value: LayerIndicatorBehavior.None, label: 'Do Not Indicate' },
  { value: LayerIndicatorBehavior.TimedOn, label: 'On for 1.5 Seconds' },
  { value: LayerIndicatorBehavior.BlinkByLayer, label: 'Blink by Layer Number' },
  { value: LayerIndicatorBehavior.AlwaysOn, label: 'Always On' },
];
const BLINK_COUNTS = ['once', 'twice', 'three times', 'four times', 'five times', 'six times', 'seven times'];

export function LayerOptions() {
  const p = profile.value!;
  const li = selectedLayer.value;
  const layer = p.layers[li]!;
  const rainbow = layer.indicatorBehavior !== LayerIndicatorBehavior.None;
  const miniKeys = () => (
    <span class="palette-mini-keys" aria-hidden="true">
      {layer.leds.map((_, index) => <span key={index} class="palette-mini-key" />)}
    </span>
  );
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
          <span class="field-label">Layer Indicator Mode</span>
          <select
            id="layer-indicator-behavior"
            value={layer.indicatorBehavior}
            onChange={(e) => updateProfile((d) => {
              const layer = d.layers[li]!;
              layer.indicatorBehavior = Number((e.target as HTMLSelectElement).value) as LayerIndicatorBehavior;
              if (layer.indicatorBehavior === LayerIndicatorBehavior.None && layer.indicatorColor === 0 &&
                  layer.idleLeds?.every(color => color === 0)) layer.indicatorColor = 1;
            })}
          >
            {BEHAVIORS.map((behavior) => <option value={behavior.value}>{behavior.label}{behavior.value === LayerIndicatorBehavior.BlinkByLayer ? ` (${BLINK_COUNTS[li]})` : ''}</option>)}
          </select>
          {layer.indicatorBehavior === LayerIndicatorBehavior.AlwaysOn && <span class="hint">Idle keys show the selected uniform or per-key colors; pressed keys show their per-key color.</span>}
          {layer.indicatorBehavior === LayerIndicatorBehavior.TimedOn && <span class="hint">Shows the uniform or per-key layer colors for 1.5 seconds after switching. Overrides pressed-key colors.</span>}
          {layer.indicatorBehavior === LayerIndicatorBehavior.BlinkByLayer && <span class="hint">Blinks once per layer number: 0.25 seconds on, 0.25 seconds off. Overrides key colors throughout the indication.</span>}
        </label>
        {layer.indicatorBehavior !== LayerIndicatorBehavior.None && (
          <div class="field led-color-field">
            <span class="field-label">Layer Indicator Color</span>
            <div class="color-toolbar">
              <span class="color-selection">
                <span
                  class={`color-selection-dot ${layer.indicatorColor === 0 ? 'swatch-per-key' : layer.indicatorColor === 15 ? (rainbow ? 'swatch-rainbow' : 'swatch-off') : ''}`}
                  style={`--c:${PALETTE[layer.indicatorColor]?.hex ?? '#000000'};filter:brightness(${layer.indicatorColor === 0 || layer.indicatorFullBrightness ? 1 : 0.5})`}
                  aria-hidden="true"
                >{layer.indicatorColor === 0 && miniKeys()}</span>
                {layer.indicatorColor === 0 ? 'Per-Key Colors' : rainbow && layer.indicatorColor === 15 ? 'Rainbow' : PALETTE[layer.indicatorColor]?.name ?? 'Unknown'}
                {!layer.indicatorFullBrightness && ' (Dim)'}
              </span>
            </div>
            <div class="palette" role="radiogroup" aria-label="Layer Indicator Color">
              {PALETTE.map((color) => {
                const name = color.index === 0 ? 'Per-Key Colors' : color.name;
                return (
                  <button
                    key={color.index}
                    type="button"
                    role="radio"
                    aria-label={name}
                    aria-checked={layer.indicatorColor === color.index}
                    title={name}
                    class={`swatch-btn ${layer.indicatorColor === color.index ? 'is-selected' : ''} ${color.index === 0 ? 'swatch-per-key' : color.index === 15 ? (rainbow ? 'swatch-rainbow' : 'swatch-off') : ''}`}
                    style={`--c: ${color.hex}`}
                    onClick={() => updateProfile((d) => { if (color.index === 0) usePerKeyColors(d.layers[li]!); else d.layers[li]!.indicatorColor = color.index; })}
                  >{color.index === 0 && miniKeys()}</button>
                );
              })}
            </div>
            {layer.indicatorColor === 0 && <span class="hint">Select a key to edit its LED Idle Color. Per-key colors are retained when a uniform color is selected.</span>}
            <div class="layer-indicator-controls">
              <div class="segmented" role="group" aria-label="Layer Indicator Brightness">
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
              {layer.indicatorColor !== 0 && <ColorPreview color={layer.indicatorColor} fullBrightness={layer.indicatorFullBrightness} rainbow={layer.indicatorColor === 15} />}
            </div>
          </div>
        )}
      </div>

      <details class="layer-advanced">
        <summary>Advanced</summary>
        <label class="check">
          <input type="checkbox" checked={layer.autoSleep}
            onChange={(e) => updateProfile((d) => { d.layers[li]!.autoSleep = (e.target as HTMLInputElement).checked; })} />
          Auto-Sleep
        </label>
        <p class="hint">Use the Sleep Timeout and wake settings in Profile Settings for this layer. The next press or complete encoder turn restores configured lighting.</p>
      </details>
    </details>
  );
}
