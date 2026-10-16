import { PALETTE } from '../../model/palette';
import { applyIdleColorToLayer } from '../../model/layerPalette';
import { profile, updateProfile } from '../store';
import { ColorPreview } from './ColorPreview';

export function IdleColor({ layerIndex, keyIndex }: { layerIndex: number; keyIndex: number }) {
  const layer = profile.value!.layers[layerIndex]!;
  if (layer.indicatorColor !== 0) return null;
  const color = layer.idleLeds![keyIndex]!;
  return <div class="field led-color-field">
    <span class="field-label">LED Idle Color</span>
    <div class="color-toolbar">
      <span class="color-selection"><span class={`color-selection-dot ${color === 0 ? 'swatch-off' : color === 15 ? 'swatch-rainbow' : ''}`} style={`--c:${PALETTE[color]!.hex}`} aria-hidden="true" />{PALETTE[color]!.name}</span>
      <button type="button" class="btn btn-small color-apply" title="Apply this idle color to every key on the current layer" onClick={() => updateProfile(d => applyIdleColorToLayer(d.layers[layerIndex]!, color))}>Apply to Layer</button>
    </div>
    <div class="palette" role="radiogroup" aria-label="LED Idle Color">
      {PALETTE.map(c => <button key={c.index} type="button" role="radio" aria-label={c.name} aria-checked={color === c.index} title={c.name}
        class={`swatch-btn ${color === c.index ? 'is-selected' : ''} ${c.index === 0 ? 'swatch-off' : c.index === 15 ? 'swatch-rainbow' : ''}`} style={`--c:${c.hex}`}
        onClick={() => updateProfile(d => { d.layers[layerIndex]!.idleLeds![keyIndex] = c.index; }, `idle:${layerIndex}:${keyIndex}`)} />)}
    </div>
    <span class="hint">Uses Layer Indicator Mode and Layer Indicator Brightness, including timed and blinking indications.</span>
    <ColorPreview color={color} fullBrightness={layer.indicatorFullBrightness} rainbow={color === 15} />
  </div>;
}
