import { keyCount } from '../../model/constants';
import { paletteHex } from '../../model/palette';
import { summarize } from '../../model/actions';
import type { Slot } from '../../model/types';
import { actionProblem } from '../../model/validate';
import { profile, selectedLayer, selectedSlot } from '../store';
import { IconRotate } from './Icons';

function sameSlot(a: Slot | null, b: Slot): boolean {
  return !!a && JSON.stringify(a) === JSON.stringify(b);
}

export function DeviceView() {
  const p = profile.value!;
  const li = selectedLayer.value;
  const layer = p.layers[li]!;
  const keys = keyCount(p.variant);
  const layerCount = p.layers.length;
  const chordKeys = new Set<number>();
  for (const c of p.chords) if (c.layer === li) { chordKeys.add(c.keyA); chordKeys.add(c.keyB); }

  const select = (slot: Slot) => { selectedSlot.value = slot; };

  const KeyCap = ({ index }: { index: number }) => {
    const slot: Slot = { kind: 'key', layer: li, index };
    const action = layer.keys[index]!;
    const problem = actionProblem(action, { layerCount, rotation: false });
    const color = paletteHex(layer.leds[index]!);
    const off = layer.leds[index] === 15;
    return (
      <button
        class={`keycap ${sameSlot(selectedSlot.value, slot) ? 'is-selected' : ''} ${problem ? 'has-problem' : ''}`}
        style={`--led:${color}; --led-glow:${off ? 'transparent' : color}`}
        onClick={() => select(slot)}
        aria-label={`Key ${index + 1}: ${summarize(action)}`}
      >
        <span class="keycap-led" aria-hidden="true" />
        <span class="keycap-index">{index + 1}</span>
        <span class="keycap-label">{summarize(action)}</span>
        {chordKeys.has(index) && <span class="keycap-chord" title="Part of a chord on this layer">chord</span>}
      </button>
    );
  };

  const EncoderPart = ({ slot, label, icon }: { slot: Slot; label: string; icon?: preact.ComponentChildren }) => {
    const action = slot.kind === 'encoderButton' ? layer.encoderButton : slot.kind === 'clockwise' ? layer.clockwise : layer.counterclockwise;
    const problem = actionProblem(action, { layerCount, rotation: slot.kind !== 'encoderButton' });
    return (
      <button class={`enc-part ${sameSlot(selectedSlot.value, slot) ? 'is-selected' : ''} ${problem ? 'has-problem' : ''}`} onClick={() => select(slot)}>
        <span class="enc-part-label">{icon}{label}</span>
        <span class="enc-part-value">{summarize(action)}</span>
      </button>
    );
  };

  return (
    <div class={`device device-${keys}`}>
      <div class="device-body">
        <div class="keygrid" style={`--cols:${keys === 6 ? 3 : 3}`}>
          {Array.from({ length: keys }, (_, i) => <KeyCap key={i} index={i} />)}
        </div>
        <div class="encoder">
          <div class="knob" aria-hidden="true"><div class="knob-mark" /></div>
          <div class="enc-parts">
            <EncoderPart slot={{ kind: 'clockwise', layer: li }} label="Turn left" icon={<IconRotate />} />
            <EncoderPart slot={{ kind: 'encoderButton', layer: li }} label="Press" />
            <EncoderPart slot={{ kind: 'counterclockwise', layer: li }} label="Turn right" icon={<IconRotate ccw />} />
          </div>
        </div>
      </div>
    </div>
  );
}
