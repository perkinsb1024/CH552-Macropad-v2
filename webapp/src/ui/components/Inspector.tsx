import { useMemo } from 'preact/hooks';
import { ACTION_DESCRIPTORS, blankAction, relativeTargetLayer } from '../../model/actions';
import { CONSUMER_GROUPS, CONSUMER_USAGES } from '../../keys/consumer';
import { MOUSE_LEFT, MOUSE_MIDDLE, MOUSE_RIGHT, keyCount } from '../../model/constants';
import { PALETTE } from '../../model/palette';
import { normalizeText } from '../../model/strings';
import type { Action, ActionType } from '../../model/types';
import { actionProblem, slotLabel } from '../../model/validate';
import { getAction, layerName, profile, rememberedAction, removeChord, selectedSlot, setAction, updateProfile } from '../store';
import { KeyPicker } from './KeyPicker';
import { IconTrash } from './Icons';

const GROUPS = ['Keyboard', 'Mouse', 'Media', 'Text', 'Layers', 'None'] as const;

function MouseButtons({ value, onChange }: { value: number; onChange(v: number): void }) {
  const buttons = [
    { bit: MOUSE_LEFT, label: 'Left' },
    { bit: MOUSE_MIDDLE, label: 'Middle' },
    { bit: MOUSE_RIGHT, label: 'Right' },
  ];
  return (
    <div class="field">
      <span class="field-label">Mouse buttons</span>
      <div class="chips">
        {buttons.map((b) => (
          <label key={b.bit} class={`chip ${value & b.bit ? 'chip-on' : ''}`}>
            <input type="checkbox" checked={!!(value & b.bit)} onChange={(e) => onChange((e.target as HTMLInputElement).checked ? value | b.bit : value & ~b.bit)} />
            {b.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function Delta({ label, value, onChange, hint }: { label: string; value: number; onChange(v: number): void; hint: string }) {
  return (
    <label class="field">
      <span class="field-label">{label} <output>{value > 0 ? `+${value}` : value}</output></span>
      <input type="range" min={-127} max={127} value={value} onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))} />
      <div class="row">
        <input type="number" min={-127} max={127} step={1} value={value} onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))} aria-label={label} />
        <span class="hint">{hint}</span>
      </div>
    </label>
  );
}

function ScrollStep({ value, onChange }: { value: number; onChange(v: number): void }) {
  const magnitude = Math.max(1, Math.min(127, Math.abs(value)));
  const up = value < 0;
  const setMagnitude = (next: number) => onChange((up ? -1 : 1) * Math.max(1, Math.min(127, Math.round(next))));
  const setDirection = (nextUp: boolean) => onChange((nextUp ? -1 : 1) * magnitude);
  return (
    <div class="field">
      <span class="field-label">Wheel step <output>{magnitude}</output></span>
      <input type="range" min={1} max={127} step={1} value={magnitude} onInput={(e) => setMagnitude(Number((e.target as HTMLInputElement).value))} />
      <div class="row">
        <input type="number" min={1} max={127} step={1} value={magnitude} onInput={(e) => setMagnitude(Number((e.target as HTMLInputElement).value))} aria-label="Wheel step" />
        <span class="hint">Wheel counts per press or encoder detent.</span>
      </div>
      <div class="field scroll-direction">
        <span class="field-label">Scroll direction</span>
        <div class="segmented" role="group" aria-label="Scroll direction">
          <button type="button" class={up ? 'is-selected' : ''} aria-pressed={up} onClick={() => setDirection(true)}>Up</button>
          <button type="button" class={!up ? 'is-selected' : ''} aria-pressed={!up} onClick={() => setDirection(false)}>Down</button>
        </div>
      </div>
    </div>
  );
}

export function Inspector() {
  const p = profile.value;
  const slot = selectedSlot.value;
  const action = p && slot ? getAction(p, slot) : undefined;
  const rotation = slot?.kind === 'clockwise' || slot?.kind === 'counterclockwise';
  const layerCount = p?.layers.length ?? 0;
  const problem = action ? actionProblem(action, { layerCount, rotation: !!rotation }) : null;
  const actionDescriptor = action && ACTION_DESCRIPTORS.find((candidate) => candidate.type === action.type);
  const custom = useMemo(() => action?.type === 'consumer' && !CONSUMER_USAGES.some((c) => c.usage === action.usage), [action]);
  const savedStrings = useMemo(() => {
    if (!p) return [];
    const strings = new Set<string>();
    const add = (candidate: Action) => {
      if (candidate.type === 'string' && candidate.text.length > 0) strings.add(candidate.text);
    };
    for (const savedLayer of p.layers) {
      savedLayer.keys.forEach(add);
      add(savedLayer.encoderButton);
      add(savedLayer.clockwise);
      add(savedLayer.counterclockwise);
    }
    p.chords.forEach((chord) => add(chord.action));
    return [...strings];
  }, [p]);

  if (!p || !slot || !action) {
    return (
      <section class="card inspector inspector-empty">
        <h2>Action editor</h2>
        <p class="muted">Select a key, the encoder, or a chord on the left to edit what it does.</p>
      </section>
    );
  }

  const update = (next: Action) => setAction(slot, next);
  const setType = (type: ActionType) => {
    if (type === action.type) return;
    setAction(slot, action);
    const remembered = rememberedAction(slot, type);
    if (remembered) { update(remembered); return; }
    const next = blankAction(type);
    // Carry over compatible fields so switching Tap ↔ Hold keeps the key.
    if ('usage' in next && 'usage' in action && 'modifiers' in next && 'modifiers' in action) update({ ...next, usage: action.usage, modifiers: action.modifiers });
    else if ('buttons' in next && 'buttons' in action) update({ ...next, buttons: action.buttons });
    else if ('layer' in next && 'layer' in action) update({ ...next, layer: action.layer });
    else if ('delta' in next && 'delta' in action) update({ ...next, delta: action.delta });
    else if ('offset' in next && 'offset' in action) update({ ...next, offset: action.offset });
    else update(next);
  };

  const keyIndex = slot.kind === 'key' ? slot.index : null;
  const layer = p.layers[slot.layer]!;

  return (
    <section class="card inspector">
      <header class="card-head">
        <div class="inspector-title">
          <h2>{slotLabel(slot).split(' · ')[1]}</h2>
          <span class="muted">{layerName(slot.layer)}</span>
        </div>
        {slot.kind === 'chord' && (
          <button class="btn btn-icon btn-ghost" aria-label="Remove chord" onClick={() => removeChord(slot)}><IconTrash /></button>
        )}
      </header>

      <label class="field">
        <span class="field-label">Action</span>
        <select value={action.type} onChange={(e) => setType((e.target as HTMLSelectElement).value as ActionType)}>
          {!actionDescriptor && <option value={action.type} disabled>Unsupported saved action</option>}
          {GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {ACTION_DESCRIPTORS.filter((d) => d.group === group).map((d) => (
                <option key={d.type} value={d.type} disabled={rotation && d.needsRelease}>
                  {d.label}{rotation && d.needsRelease ? ' (buttons only)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span class="hint">{actionDescriptor?.hint ?? 'This saved action is no longer supported. Choose another action.'}</span>
      </label>

      {(action.type === 'keyTap' || action.type === 'keyHold') && (
        <KeyPicker usage={action.usage} modifiers={action.modifiers} onChange={(usage, modifiers) => update({ ...action, usage, modifiers })} />
      )}

      {(action.type === 'mouseClick' || action.type === 'mouseDouble' || action.type === 'mouseHold' || action.type === 'mouseToggle') && (
        <MouseButtons value={action.buttons} onChange={(buttons) => update({ ...action, buttons })} />
      )}

      {action.type === 'scroll' && (
        <ScrollStep value={action.delta} onChange={(delta) => update({ ...action, delta })} />
      )}
      {action.type === 'mouseX' && (
        <Delta label="Horizontal move" value={action.delta} onChange={(delta) => update({ ...action, delta })} hint="Pixels per step; negative moves left." />
      )}
      {action.type === 'mouseY' && (
        <Delta label="Vertical move" value={action.delta} onChange={(delta) => update({ ...action, delta })} hint="Pixels per step; negative moves up." />
      )}

      {action.type === 'consumer' && (
        <div class="field">
          <span class="field-label">Control</span>
          <select value={custom ? 'custom' : action.usage} onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            update({ ...action, usage: v === 'custom' ? 0x001 : Number(v) });
          }}>
            {CONSUMER_GROUPS.map((group) => (
              <optgroup key={group} label={group}>
                {CONSUMER_USAGES.filter((c) => c.group === group).map((c) => <option key={c.usage} value={c.usage}>{c.name}</option>)}
              </optgroup>
            ))}
            <optgroup label="Advanced"><option value="custom">Custom usage…</option></optgroup>
          </select>
          {custom && (
            <div class="row">
              <span class="mono">0x</span>
              <input class="mono" value={action.usage.toString(16).toUpperCase().padStart(3, '0')} maxLength={3} aria-label="Consumer usage in hex" onInput={(e) => {
                const n = parseInt((e.target as HTMLInputElement).value, 16);
                if (!Number.isNaN(n)) update({ ...action, usage: n & 0xfff });
              }} />
              <span class="hint">12-bit HID Consumer Page usage</span>
            </div>
          )}
          <span class="hint">Brightness controls are honored by some hosts and monitors only.</span>
        </div>
      )}

      {action.type === 'string' && (
        <label class="field">
          <span class="field-label">Text <output>{action.text.length + 1} bytes</output></span>
          <textarea rows={4} value={action.text} spellcheck={false} onInput={(e) => update({ ...action, text: normalizeText((e.target as HTMLTextAreaElement).value) })} placeholder="Typed with the US keyboard layout" />
          {savedStrings.length > 0 && (
            <select aria-label="Reuse an existing string" value="" onChange={(e) => {
              const text = (e.target as HTMLSelectElement).value;
              if (text) update({ ...action, text });
            }}>
              <option value="">Reuse an existing string…</option>
              {savedStrings.map((text) => <option key={text} value={text}>{text}</option>)}
            </select>
          )}
          <span class="hint">Printable ASCII, tab and newline only. Identical strings across layers and chords share one copy in device storage. Output depends on the host's keyboard layout.</span>
        </label>
      )}

      {(action.type === 'setLayer' || action.type === 'momentaryLayer') && (
        <label class="field">
          <span class="field-label">Target layer</span>
          <select value={action.layer} onChange={(e) => update({ ...action, layer: Number((e.target as HTMLSelectElement).value) })}>
            {p.layers.map((_, i) => <option key={i} value={i}>{layerName(i)}{i === slot.layer ? ' (this layer)' : ''}</option>)}
            {action.layer >= layerCount && <option value={action.layer}>Layer {action.layer + 1} (missing)</option>}
          </select>
        </label>
      )}

      {action.type === 'relativeLayer' && (
        <label class="field">
          <span class="field-label">Relative offset</span>
          <select value={action.offset} onChange={(e) => update({ ...action, offset: Number((e.target as HTMLSelectElement).value) })}>
            {[-3, -2, -1, 0, 1, 2, 3].filter((offset) => offset !== 0 || action.offset === 0).map((offset) => <option key={offset} value={offset}>{offset > 0 ? `+${offset}` : offset}{offset === 0 ? ' (no effect)' : ''}</option>)}
          </select>
          <span class="hint">Layer {slot.layer + 1} → Layer {relativeTargetLayer(slot.layer, action.offset, layerCount) + 1}{action.offset === 0 ? ' (no effect)' : ''}</span>
        </label>
      )}

      {problem && <p class="problem" role="alert">{problem}</p>}

      {keyIndex !== null && (
        <div class="field">
          <span class="field-label">LED color on this layer</span>
          <div class="palette" role="radiogroup" aria-label="LED color">
            {PALETTE.map((c) => (
              <button
                key={c.index}
                role="radio"
                aria-checked={layer.leds[keyIndex] === c.index}
                class={`swatch-btn ${layer.leds[keyIndex] === c.index ? 'is-selected' : ''} ${c.index === 15 ? 'swatch-off' : ''}`}
                style={`--c:${c.hex}`}
                title={c.name}
                onClick={() => updateProfile((d) => { d.layers[slot.layer]!.leds[keyIndex] = c.index; }, `led:${slot.layer}:${keyIndex}`)}
              />
            ))}
          </div>
          <div class="row">
            <span class="hint">{PALETTE[layer.leds[keyIndex]!]?.name ?? 'Unknown'}</span>
            {keyCount(p.variant) > 1 && (
              <button class="btn btn-small" onClick={() => updateProfile((d) => { d.layers[slot.layer]!.leds = d.layers[slot.layer]!.leds.map(() => layer.leds[keyIndex]!); })}>
                Apply to all keys
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
