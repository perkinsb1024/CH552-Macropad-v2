import { LED_COMMANDS, ledCommandSpec, isLedEffect, ledValueOptions, ledRelativeCycle, type LedCommand, type LedValue } from '../../model/ledControl';
import { useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ACTION_DESCRIPTORS, blankAction, isPreviousLayer, relativeTargetLayer } from '../../model/actions';
import { CONSUMER_GROUPS, CONSUMER_USAGES } from '../../keys/consumer';
import { MOUSE_LEFT, MOUSE_MIDDLE, MOUSE_RIGHT, PREVIOUS_LAYER, keyCount, maxLayers } from '../../model/constants';
import { PALETTE } from '../../model/palette';
import { normalizeText } from '../../model/strings';
import type { Action, ActionType } from '../../model/types';
import { actionProblem, slotLabel } from '../../model/validate';
import { getAction, layerName, profile, rememberedAction, rememberedCustomClickCount, removeChord, selectedSlot, setAction, updateProfile } from '../store';
import { ColorPreview } from './ColorPreview';
import { KeyPicker } from './KeyPicker';
import { IconTrash } from './Icons';
import { ScrollTest } from './ScrollTest';

const GROUPS = ['None', 'Keyboard', 'Mouse', 'Media', 'Text', 'Layers', 'LED control', 'Macros'] as const;

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

function DirectionalStep({ label, directionLabel, negativeLabel, positiveLabel, hint, value, onChange, onTest, children }: {
  label: string;
  directionLabel: string;
  negativeLabel: string;
  positiveLabel: string;
  hint: string;
  value: number;
  onChange(v: number): void;
  onTest?(): void;
  children?: ComponentChildren;
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
      {children}
      <div class="field scroll-direction">
        <span class="field-label">{directionLabel}</span>
        <div class="segmented" role="group" aria-label={directionLabel}>
          <button type="button" class={negative ? 'is-selected' : ''} aria-pressed={negative} onClick={() => setDirection(true)}>{negativeLabel}</button>
          <button type="button" class={!negative ? 'is-selected' : ''} aria-pressed={!negative} onClick={() => setDirection(false)}>{positiveLabel}</button>
        </div>
        {onTest && <span class="hint">Some computers may invert these settings, in which case you will need to swap {negativeLabel.toLowerCase()} and {positiveLabel.toLowerCase()}. <button type="button" class="inline-link" onClick={onTest}>Click here</button> to test the scrolling behavior.</span>}
      </div>
    </div>
  );
}

export function Inspector() {
  const [showScrollTest, setShowScrollTest] = useState(false);
  const p = profile.value;
  const slot = selectedSlot.value;
  const action = p && slot ? getAction(p, slot) : undefined;
  const timed = slot?.kind === 'timed';
  const macro = slot?.kind === 'macro';
  const rotation = slot?.kind === 'macro' || slot?.kind === 'timed' || slot?.kind === 'clockwise' || slot?.kind === 'counterclockwise';
  const layerCount = p?.layers.length ?? 0;
  const problem = action ? actionProblem(action, { layerCount, rotation: !!rotation, timed, macro, macroCount: p?.macros?.length ?? 0 }) : null;
  const actionDescriptor = action && ACTION_DESCRIPTORS.find((candidate) => candidate.type === action.type);
  const custom = useMemo(() => (action?.type === 'consumer' || action?.type === 'consumerHold') && !CONSUMER_USAGES.some((c) => c.usage === action.usage), [action]);
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
    p.timedActions?.forEach((timer) => { add(timer.action); add(timer.resumeAction); });
    p.macros?.forEach(macro => macro.actions.forEach(add));
    return [...strings];
  }, [p]);

  if (!p || !slot || !action) {
    return (
      <section class="card inspector inspector-empty">
        <h2>Action editor</h2>
        <p class="muted">Select a key, the encoder, a chord, a timed action, or a macro step on the left to edit what it does.</p>
      </section>
    );
  }

  const update = (next: Action) => setAction(slot, next);
  const ledRelativeSteps = action.type === 'ledControl' &&
    (action.command === 'rainbowPhaseRelative' || action.command === 'rainbowSpeedRelative')
    ? [-2, -1, 1, 2] : [-1, 1];
  const setType = (type: ActionType) => {
    if (type === action.type) return;
    setAction(slot, action);
    const remembered = rememberedAction(slot, type);
    if (remembered) { update(remembered); return; }
    const next = blankAction(type);
    // Carry over compatible fields so switching Tap ↔ Hold keeps the key.
    if ('usage' in next && 'usage' in action && 'modifiers' in next && 'modifiers' in action) update({ ...next, usage: action.usage, modifiers: action.modifiers });
    else if ((next.type === 'consumer' || next.type === 'consumerHold') && (action.type === 'consumer' || action.type === 'consumerHold')) update({ ...next, usage: action.usage });
    else if ('buttons' in next && 'buttons' in action) update({ ...next, buttons: action.buttons });
    else if ('layer' in next && 'layer' in action) update({ ...next, layer: action.layer });
    else if ('delta' in next && 'delta' in action) update({ ...next, delta: action.delta,
      ...('hold' in action && action.hold && !rotation ? { hold: true } : {}) });
    else if ('offset' in next && 'offset' in action) update({ ...next, offset: action.offset });
    else update(next);
  };

  const selectableActions = ACTION_DESCRIPTORS.filter(d => !macro || (d.type !== 'macro' && d.type !== 'none' && !d.needsRelease));
  const keyIndex = slot.kind === 'key' ? slot.index : null;
  const layer = p.layers[slot.layer]!;

  return (
    <section class="card inspector">
      <header class="card-head">
        <div class="inspector-title">
          <h2>{slot.kind === 'timed' || slot.kind === 'macro' ? slotLabel(slot) : slotLabel(slot).split(' · ')[1]}</h2>
          <span class="muted">{slot.kind === 'timed' || slot.kind === 'macro' ? 'Across all layers' : layerName(slot.layer)}</span>
        </div>
        {slot.kind === 'chord' && (
          <button class="btn btn-icon btn-ghost" aria-label="Remove chord" onClick={() => removeChord(slot)}><IconTrash /></button>
        )}
      </header>

      <label class="field">
        <span class="field-label">Action</span>
        <select value={action.type} onChange={(e) => setType((e.target as HTMLSelectElement).value as ActionType)}>
          {!actionDescriptor && <option value={action.type} disabled>Unsupported saved action</option>}
          {GROUPS.filter(group => selectableActions.some(d => d.group === group)).map((group) => (
            <optgroup key={group} label={group}>
              {selectableActions.filter(d => d.group === group).map((d) => (
                <option key={d.type} value={d.type} disabled={rotation && d.needsRelease}>
                  {d.label}{rotation && d.needsRelease ? ' (buttons only)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span class="hint">{actionDescriptor?.hint ?? 'This saved action is no longer supported. Choose another action.'}</span>
      </label>

      {action.type === 'macro' && <>
        <label class="field"><span class="field-label">Macro</span>
          <select aria-label="Macro" value={action.macro} onChange={e => update({ ...action, macro: Number((e.target as HTMLSelectElement).value) })}>
            {!p.macros?.[action.macro] && <option value={action.macro}>Choose a macro — add one in Macros</option>}
            {p.macros?.map((macro, index) => <option value={index}>Macro {index + 1} · {macro.actions.length} step{macro.actions.length === 1 ? '' : 's'}</option>)}
          </select>
        </label>
        <label class="field"><span class="field-label">Repeat count</span>
          <input type="number" aria-label="Repeat count" min={1} max={16} value={action.repeats} onInput={e => update({ ...action, repeats: Math.max(1, Math.min(16, Math.round(Number((e.target as HTMLInputElement).value) || 1))) })} />
        </label>
      </>}
      {action.type === 'pause' && <label class="field"><span class="field-label">Pause duration <output>{action.ticks * 16} ms</output></span>
        <input type="range" aria-label="Pause duration" min={0} max={255} value={action.ticks} onInput={e => update({ ...action, ticks: Number((e.target as HTMLInputElement).value) })} />
        <span class="hint">16 ms steps. Add consecutive pauses for longer waits.</span>
      </label>}
      {action.type === 'ledControl' && <>
        <label class="field"><span class="field-label">LED command</span>
          <select value={isLedEffect(action.command) ? 'temporaryEffect' : action.command} onChange={(e) => {
            const selection = (e.target as HTMLSelectElement).value;
            const command = (selection === 'temporaryEffect' ? 'effectRestore' : selection) as LedCommand;
            const spec = ledCommandSpec(command);
            if (!spec) return;
            update({ type: 'ledControl', command, value: spec.relative ? 1 : command === 'restoreAll' || command === 'effectRestore' ? 0 : command === 'commonPresetSet' ? 0 : command === 'commonPresetToggle' ? 3 : 'asConfigured' });
          }}>
            {LED_COMMANDS.filter((c) => c.command !== 'restoreAll' && !isLedEffect(c.command)).map((c) => <option value={c.command}>{c.label}</option>)}
            <option value="temporaryEffect">Set all LEDs</option>
            <option value="" disabled>────────────────────</option>
            {LED_COMMANDS.filter((c) => c.command === 'restoreAll').map((c) => <option value={c.command}>{c.label}</option>)}
          </select>
        </label>
        {isLedEffect(action.command) ? <>
          <label class="field"><span class="field-label">Effect</span>
            <select value={action.command.startsWith('effectBlink') ? 'blink' : action.command} onChange={(e) => {
              const selection = (e.target as HTMLSelectElement).value;
              if (!['effectRestore', 'effectOn', 'blink'].includes(selection)) return;
              const command = (selection === 'blink' ? 'effectBlink1' : selection) as LedCommand;
              update({ type: 'ledControl', command, value: command === 'effectRestore' ? 0 : action.command === 'effectRestore' ? 15 : action.value,
                ...(command !== 'effectRestore' && action.brightness === 'dim' ? { brightness: 'dim' as const } : {}) });
            }}>
              <option value="effectRestore">As configured</option>
              <option value="effectOn">Always on</option>
              <option value="blink">Blink</option>
            </select>
          </label>
          {action.command.startsWith('effectBlink') && <label class="field">
            <span class="field-label">Blink count <output>{ledCommandSpec(action.command)!.code - 0x81} {action.command === 'effectBlink1' ? 'time' : 'times'}</output></span>
            <input type="range" min={1} max={8} step={1} value={ledCommandSpec(action.command)!.code - 0x81} aria-label="Blink count" onInput={(e) => {
              const count = Number((e.target as HTMLInputElement).value);
              if (Number.isInteger(count) && count >= 1 && count <= 8) update({ ...action, command: `effectBlink${count}` as LedCommand });
            }} />
          </label>}
          {action.command !== 'effectRestore' && <div class="field led-color-field">
            <span class="field-label">Color</span>
            <div class="palette" role="radiogroup" aria-label="Temporary LED effect color">
              {PALETTE.map(c => <button type="button" role="radio" aria-checked={action.value === c.index}
                aria-label={c.index === 15 ? 'Rainbow' : c.name} title={c.index === 15 ? 'Rainbow' : c.name}
                class={`swatch-btn ${action.value === c.index ? 'is-selected' : ''}`}
                style={c.index === 15 ? 'background:linear-gradient(135deg, red, yellow, lime, cyan, blue, magenta)' : `--c:${c.hex}`}
                onClick={() => update({ ...action, value: c.index })} />)}
            </div>
            <div class="segmented" role="group" aria-label="Temporary LED effect brightness">
              <button type="button" class={action.brightness !== 'dim' ? 'is-selected' : ''}
                aria-pressed={action.brightness !== 'dim'} onClick={() => {
                  const { brightness, ...brightAction } = action;
                  update(brightAction);
                }}>Full Brightness</button>
              <button type="button" class={action.brightness === 'dim' ? 'is-selected' : ''}
                aria-pressed={action.brightness === 'dim'} onClick={() => update({ ...action, brightness: 'dim' })}>Dim</button>
            </div>
          </div>}
          <p class="hint">Always on persists until replaced, restored, or the layer changes. Key feedback can cover it. Blinking covers key feedback. Clearing or finishing an effect restores normal lighting without replaying the layer's blink or timed indication; brightness overrides remain in effect.</p>
        </> : ledCommandSpec(action.command)?.relative ?
          <label class="field"><span class="field-label">Relative step</span>
            <select value={action.value} onChange={(e) => {
              const value = Number((e.target as HTMLSelectElement).value);
              if (ledRelativeSteps.includes(value)) update({ ...action, value });
            }}>
              {(typeof action.value !== 'number' || !ledRelativeSteps.includes(action.value)) &&
                <option value={action.value} disabled>Current: {typeof action.value === 'number' && action.value > 0 ? '+' : ''}{action.value}</option>}
              {ledRelativeSteps.map((v) => <option value={v}>{v > 0 ? '+' : ''}{v}</option>)}
            </select>
            <span class="hint">{ledRelativeCycle(action.command, action.value)}</span>
          </label>
          : action.command !== 'restoreAll' && <label class="field"><span class="field-label">{action.command === 'commonPresetToggle' ? 'Preset' : 'LED setting'}</span>
            <select value={action.value} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; update({ ...action, value: v === 'asConfigured' ? v : Number(v) as LedValue }); }}>
              {ledValueOptions(action.command).map((o) => <option value={o.value}>{o.label}</option>)}
            </select>
            {action.command === 'commonPresetToggle' && <span class="hint">Press to apply this preset. When it is active, press again to restore configured layer and key brightness. Rainbow speed and phase stay unchanged.</span>}
          </label>}
        {!isLedEffect(action.command) && <p class="hint">{action.command === 'commonPresetToggle'
          ? 'Lighting overrides apply across layers. Indicator brightness preserves its configured visibility mode.'
          : 'Lighting overrides apply across layers. Key LEDs off lets the idle background show. Both-relative starts from the brighter current brightness, applies the step once, and sets both to the result. As configured resolves to the current layer indicator brightness and bright key feedback. Common presets include configured behavior. Indicator brightness preserves its configured visibility mode.'}</p>}
      </>}

      {(action.type === 'keyTap' || action.type === 'keyHold') && (
        <KeyPicker usage={action.usage} modifiers={action.modifiers} onChange={(usage, modifiers) => update({ ...action, usage, modifiers })} />
      )}

      {(action.type === 'mouseClick' || action.type === 'mouseHold' || action.type === 'mouseToggle') && (
        <MouseButtons value={action.buttons} onChange={(buttons) => update({ ...action, buttons })} />
      )}

      {action.type === 'mouseClick' && (
        <div class="field">
          <span class="field-label">Clicks</span>
          <div class="segmented" role="group" aria-label="Click behavior">
            <button type="button" class={(action.clicks ?? 1) === 1 ? 'is-selected' : ''} aria-pressed={(action.clicks ?? 1) === 1} onClick={() => update({ type: 'mouseClick', buttons: action.buttons })}>Single</button>
            <button type="button" class={action.clicks === 2 ? 'is-selected' : ''} aria-pressed={action.clicks === 2} onClick={() => update({ ...action, clicks: 2 })}>Double</button>
            <button type="button" class={(action.clicks ?? 1) >= 3 ? 'is-selected' : ''} aria-pressed={(action.clicks ?? 1) >= 3} onClick={() => update({ ...action, clicks: (action.clicks ?? 1) >= 3 ? action.clicks : rememberedCustomClickCount(slot) })}>Custom</button>
          </div>
          {(action.clicks ?? 1) >= 3 && <label class="field click-count-field">
            <span class="field-label">Click count <output>{action.clicks}</output></span>
            <input type="range" min={3} max={16} step={1} value={action.clicks} aria-label="Click count" onInput={(e) => update({ ...action, clicks: Math.max(3, Math.min(16, Math.round(Number((e.target as HTMLInputElement).value)))) })} />
            <span class="hint">This click action will take about {(((action.clicks ?? 1) * 8 + ((action.clicks ?? 1) - 1) * 200) / 1000).toFixed(1)} seconds, delaying subsequent queued actions.</span>
          </label>}
        </div>
      )}

      {(action.type === 'mouseClick' || action.type === 'mouseHold' || action.type === 'mouseToggle') && (
        <p class="hint"><button type="button" class="inline-link" onClick={() => setShowScrollTest(true)}>Click here</button> to test your configured mouse events.</p>
      )}

      {action.type === 'scroll' && (
        <DirectionalStep onTest={() => setShowScrollTest(true)} label="Wheel step" directionLabel="Scroll direction" negativeLabel={action.horizontal ? 'Left' : 'Up'} positiveLabel={action.horizontal ? 'Right' : 'Down'} hint={action.hold ? 'Wheel counts per repeat.' : 'Wheel counts per press or encoder detent.'} value={action.delta} onChange={(delta) => update({ ...action, delta })}>
          <div class="field">
            <span class="field-label">Scroll axis</span>
            <div class="segmented" role="group" aria-label="Scroll axis">
              <button type="button" class={!action.horizontal ? 'is-selected' : ''} aria-pressed={!action.horizontal} onClick={() => update({ ...action, horizontal: false })}>Vertical</button>
              <button type="button" class={action.horizontal ? 'is-selected' : ''} aria-pressed={!!action.horizontal} onClick={() => update({ ...action, horizontal: true })}>Horizontal</button>
            </div>
          </div>
        </DirectionalStep>
      )}
      {action.type === 'mouseX' && (
        <DirectionalStep label="Horizontal move" directionLabel="Pointer direction" negativeLabel="Left" positiveLabel="Right" hint={action.hold ? 'Pixels per repeat.' : 'Pixels per press or encoder detent.'} value={action.delta} onChange={(delta) => update({ ...action, delta })} />
      )}
      {action.type === 'mouseY' && (
        <DirectionalStep label="Vertical move" directionLabel="Pointer direction" negativeLabel="Up" positiveLabel="Down" hint={action.hold ? 'Pixels per repeat.' : 'Pixels per press or encoder detent.'} value={action.delta} onChange={(delta) => update({ ...action, delta })} />
      )}

      {(action.type === 'scroll' || action.type === 'mouseX' || action.type === 'mouseY') && (
        <div class="field">
          {!rotation && <>
            <span class="field-label">{action.type === 'scroll' ? 'Scroll behavior' : 'Movement behavior'}</span>
            <div class="segmented" role="group" aria-label={action.type === 'scroll' ? 'Scroll behavior' : 'Movement behavior'}>
              <button type="button" class={!action.hold ? 'is-selected' : ''} aria-pressed={!action.hold} onClick={() => update({ ...action, hold: undefined })}>Tap</button>
              <button type="button" class={action.hold ? 'is-selected' : ''} aria-pressed={!!action.hold} onClick={() => update({ ...action, hold: true })}>Hold</button>
            </div>
          </>}
          <span class="hint">{timed ? 'Sends one step when this timed action runs.' : rotation ? 'Encoder rotation sends one step per detent.' : action.hold ? action.type === 'scroll' ? 'Repeats with 100 ms between steps while held. Release stops new repeats; a step already started finishes.' : 'Repeats every 8 ms while held; release to stop.' : 'Sends one step per press.'}</span>
        </div>
      )}

      {(action.type === 'consumer' || action.type === 'consumerHold') && (
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
          {action.type === 'consumerHold' && <span class="hint">The host decides whether a held control repeats. The newest media action wins; previous holds are not restored. Holds continue across layer changes until release.</span>}
        </div>
      )}

      {action.type === 'string' && (
        <label class="field">
          <span class="field-label">Text <output>{action.text.length + 1} byte{action.text.length === 0 ? '' : 's'}</output></span>
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
            {p.layers.map((_, i) => <option key={i} value={i}>{layerName(i)}{slot.kind !== 'timed' && i === slot.layer ? ' (this layer)' : ''}</option>)}
            {action.type !== 'momentaryLayer' && <option value={PREVIOUS_LAYER}>Previous layer</option>}
            {action.layer >= layerCount && !isPreviousLayer(action) && <option value={action.layer}>Layer {action.layer + 1} (missing)</option>}
          </select>
          {isPreviousLayer(action) && <span class="hint">{action.type === 'oneShotSetLayer'
            ? 'Visit the previous base layer for one action, then return. This does not change layer history.'
            : 'Return to the previous base layer. Repeating this action toggles between the two layers.'} Momentary and one-shot visits do not replace history.</span>}
        </label>
      )}

      {(action.type === 'relativeLayer' || action.type === 'oneShotRelativeLayer') && (
        <label class="field">
          <span class="field-label">Relative offset <output>{action.offset > 0 ? `+${action.offset}` : action.offset}</output></span>
          <input type="range" min={1 - maxLayers(p.variant)} max={maxLayers(p.variant) - 1} step={1} value={action.offset} aria-label="Relative offset" onInput={(e) => update({ ...action, offset: Number((e.target as HTMLInputElement).value) })} />
          <span class="hint">{slot.kind === 'timed' ? 'Relative to the active layer when the timer fires.' : `Layer ${slot.layer + 1} → Layer ${relativeTargetLayer(slot.layer, action.offset, layerCount) + 1}`}</span>
        </label>
      )}

      {slot.kind !== 'timed' && (((action.type === 'setLayer' || action.type === 'oneShotSetLayer' || action.type === 'momentaryLayer') && action.layer === slot.layer) ||
        ((action.type === 'relativeLayer' || action.type === 'oneShotRelativeLayer') && relativeTargetLayer(slot.layer, action.offset, layerCount) === slot.layer)) && (
        <div class="notice notice-info">Changing to the same layer is useful to display the current layer's indicator</div>
      )}

      {problem && <p class="problem" role="alert">{problem}</p>}

      {keyIndex !== null && (
        <div class="field led-color-field">
          <span class="field-label">LED color on key press</span>
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
      {showScrollTest && <ScrollTest onClose={() => setShowScrollTest(false)} />}
    </section>
  );
}
