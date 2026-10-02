import { LED_COMMANDS, ledCommandCode, ledValueOptions, type LedCommand, type LedValue } from '../../model/ledControl';
import { useMemo } from 'preact/hooks';
import { ACTION_DESCRIPTORS, blankAction, relativeTargetLayer } from '../../model/actions';
import { CONSUMER_GROUPS, CONSUMER_USAGES } from '../../keys/consumer';
import { MOUSE_LEFT, MOUSE_MIDDLE, MOUSE_RIGHT, keyCount, maxLayers } from '../../model/constants';
import { PALETTE } from '../../model/palette';
import { normalizeText } from '../../model/strings';
import type { Action, ActionType } from '../../model/types';
import { actionProblem, slotLabel } from '../../model/validate';
import { getAction, layerName, profile, rememberedAction, removeChord, selectedSlot, setAction, updateProfile } from '../store';
import { ColorPreview } from './ColorPreview';
import { KeyPicker } from './KeyPicker';
import { IconTrash } from './Icons';

const GROUPS = ['None', 'Keyboard', 'Mouse', 'Media', 'Text', 'Layers', 'LED control'] as const;

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

function DirectionalStep({ label, directionLabel, negativeLabel, positiveLabel, hint, value, onChange }: {
  label: string;
  directionLabel: string;
  negativeLabel: string;
  positiveLabel: string;
  hint: string;
  value: number;
  onChange(v: number): void;
}) {
  const magnitude = Math.max(1, Math.min(127, Math.abs(value)));
  const negative = value < 0;
  const setMagnitude = (next: number) => onChange((negative ? -1 : 1) * Math.max(1, Math.min(127, Math.round(next))));
  const setDirection = (nextNegative: boolean) => onChange((nextNegative ? -1 : 1) * magnitude);
  return (
    <div class="field">
      <span class="field-label">{label} <output>{magnitude}</output></span>
      <input type="range" min={1} max={127} step={1} value={magnitude} aria-label={label} onInput={(e) => setMagnitude(Number((e.target as HTMLInputElement).value))} />
      <span class="hint">{hint}</span>
      <div class="field scroll-direction">
        <span class="field-label">{directionLabel}</span>
        <div class="segmented" role="group" aria-label={directionLabel}>
          <button type="button" class={negative ? 'is-selected' : ''} aria-pressed={negative} onClick={() => setDirection(true)}>{negativeLabel}</button>
          <button type="button" class={!negative ? 'is-selected' : ''} aria-pressed={!negative} onClick={() => setDirection(false)}>{positiveLabel}</button>
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
    else if ('delta' in next && 'delta' in action) update({ ...next, delta: action.delta,
      ...((next.type === 'mouseX' || next.type === 'mouseY') && (action.type === 'mouseX' || action.type === 'mouseY') && action.hold ? { hold: true } : {}) });
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

      {action.type === 'ledControl' && <>
        <label class="field"><span class="field-label">LED command</span>
          <select value={action.command} onChange={(e) => {
            const command = (e.target as HTMLSelectElement).value as LedCommand;
            const spec = LED_COMMANDS[ledCommandCode(command)]!;
            update({ type: 'ledControl', command, value: spec.relative ? 1 : command === 'restoreAll' ? 0 : command === 'commonPresetSet' ? 0 : 'asConfigured' });
          }}>{LED_COMMANDS.map((c) => <option value={c.command}>{c.label}</option>)}</select>
        </label>
        {LED_COMMANDS[ledCommandCode(action.command)]?.relative ?
          <label class="field"><span class="field-label">Relative step</span>
            <select value={action.value} onChange={(e) => update({ ...action, value: Number((e.target as HTMLSelectElement).value) })}>
              {[-7,-6,-5,-4,-3,-2,-1,1,2,3,4,5,6,7].map((v) => <option value={v}>{v > 0 ? '+' : ''}{v}</option>)}
            </select>
            <span class="hint">Cycles with wraparound. Positive speed steps are faster; positive common-preset steps select the next darker preset, then return to configured.</span>
          </label>
          : action.command !== 'restoreAll' && <label class="field"><span class="field-label">LED setting</span>
            <select value={action.value} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; update({ ...action, value: v === 'asConfigured' ? v : Number(v) as LedValue }); }}>
              {ledValueOptions(action.command).map((o) => <option value={o.value}>{o.label}</option>)}
            </select>
          </label>}
        <p class="hint">Lighting overrides apply across layers. Key LEDs off lets the idle background show. Both-relative advances each brightness separately; common presets change both together and include configured behavior. Indicator brightness preserves its configured visibility mode.</p>
      </>}

      {(action.type === 'keyTap' || action.type === 'keyHold') && (
        <KeyPicker usage={action.usage} modifiers={action.modifiers} onChange={(usage, modifiers) => update({ ...action, usage, modifiers })} />
      )}

      {(action.type === 'mouseClick' || action.type === 'mouseDouble' || action.type === 'mouseHold' || action.type === 'mouseToggle') && (
        <MouseButtons value={action.buttons} onChange={(buttons) => update({ ...action, buttons })} />
      )}

      {action.type === 'scroll' && (
        <DirectionalStep label="Wheel step" directionLabel="Scroll direction" negativeLabel="Up" positiveLabel="Down" hint="Wheel counts per press or encoder detent." value={action.delta} onChange={(delta) => update({ ...action, delta })} />
      )}
      {action.type === 'mouseX' && (
        <DirectionalStep label="Horizontal move" directionLabel="Pointer direction" negativeLabel="Left" positiveLabel="Right" hint={action.hold ? 'Pixels per repeat.' : 'Pixels per press or encoder detent.'} value={action.delta} onChange={(delta) => update({ ...action, delta })} />
      )}
      {action.type === 'mouseY' && (
        <DirectionalStep label="Vertical move" directionLabel="Pointer direction" negativeLabel="Up" positiveLabel="Down" hint={action.hold ? 'Pixels per repeat.' : 'Pixels per press or encoder detent.'} value={action.delta} onChange={(delta) => update({ ...action, delta })} />
      )}

      {(action.type === 'mouseX' || action.type === 'mouseY') && (
        <div class="field">
          {!rotation && <>
            <span class="field-label">Movement behavior</span>
            <div class="segmented" role="group" aria-label="Movement behavior">
              <button type="button" class={!action.hold ? 'is-selected' : ''} aria-pressed={!action.hold} onClick={() => update({ ...action, hold: undefined })}>Tap</button>
              <button type="button" class={action.hold ? 'is-selected' : ''} aria-pressed={!!action.hold} onClick={() => update({ ...action, hold: true })}>Hold</button>
            </div>
          </>}
          <span class="hint">{rotation ? 'Encoder rotation sends one step per detent.' : action.hold ? 'Repeats every 8 ms while held; release to stop.' : 'Sends one step per press.'}</span>
        </div>
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

      {(action.type === 'setLayer' || action.type === 'oneShotSetLayer' || action.type === 'momentaryLayer') && (
        <label class="field">
          <span class="field-label">Target layer</span>
          <select value={action.layer} onChange={(e) => update({ ...action, layer: Number((e.target as HTMLSelectElement).value) })}>
            {p.layers.map((_, i) => <option key={i} value={i}>{layerName(i)}{i === slot.layer ? ' (this layer)' : ''}</option>)}
            {action.layer >= layerCount && <option value={action.layer}>Layer {action.layer + 1} (missing)</option>}
          </select>
        </label>
      )}

      {(action.type === 'relativeLayer' || action.type === 'oneShotRelativeLayer') && (
        <label class="field">
          <span class="field-label">Relative offset <output>{action.offset > 0 ? `+${action.offset}` : action.offset}</output></span>
          <input type="range" min={1 - maxLayers(p.variant)} max={maxLayers(p.variant) - 1} step={1} value={action.offset} aria-label="Relative offset" onInput={(e) => update({ ...action, offset: Number((e.target as HTMLInputElement).value) })} />
          <span class="hint">Layer {slot.layer + 1} → Layer {relativeTargetLayer(slot.layer, action.offset, layerCount) + 1}</span>
        </label>
      )}

      {(((action.type === 'setLayer' || action.type === 'oneShotSetLayer' || action.type === 'momentaryLayer') && action.layer === slot.layer) ||
        ((action.type === 'relativeLayer' || action.type === 'oneShotRelativeLayer') && relativeTargetLayer(slot.layer, action.offset, layerCount) === slot.layer)) && (
        <div class="notice notice-info">Changing to the same layer is useful to display the current layer's indicator</div>
      )}

      {problem && <p class="problem" role="alert">{problem}</p>}

      {keyIndex !== null && (
        <div class="field led-color-field">
          <span class="field-label">LED color on this layer</span>
          <div class="color-toolbar">
            <span class="color-selection">
              <span class={`color-selection-dot ${layer.leds[keyIndex] === 15 ? 'swatch-off' : ''}`} style={`--c:${PALETTE[layer.leds[keyIndex]!]?.hex ?? '#000000'}`} aria-hidden="true" />
              {PALETTE[layer.leds[keyIndex]!]?.name ?? 'Unknown'}
            </span>
            {keyCount(p.variant) > 1 && (
              <button type="button" class="btn btn-small color-apply" title="Apply this color to every key on the current layer" onClick={() => updateProfile((d) => { d.layers[slot.layer]!.leds = d.layers[slot.layer]!.leds.map(() => layer.leds[keyIndex]!); })}>
                Apply to layer
              </button>
            )}
          </div>
          <div class="palette" role="radiogroup" aria-label="LED color">
            {PALETTE.map((c) => (
              <button
                key={c.index}
                type="button"
                role="radio"
                aria-label={c.name}
                aria-checked={layer.leds[keyIndex] === c.index}
                class={`swatch-btn ${layer.leds[keyIndex] === c.index ? 'is-selected' : ''} ${c.index === 15 ? 'swatch-off' : ''}`}
                style={`--c:${c.hex}`}
                title={c.name}
                onClick={() => updateProfile((d) => { d.layers[slot.layer]!.leds[keyIndex] = c.index; }, `led:${slot.layer}:${keyIndex}`)}
              />
            ))}
          </div>
          <ColorPreview color={layer.leds[keyIndex]!} />
        </div>
      )}
    </section>
  );
}
