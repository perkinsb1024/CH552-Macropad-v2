import { MAX_TIMED_TICKS, MAX_TIMED_ACTIONS, TIMED_ENTRY_SIZE, TIMED_TICK_SECONDS } from '../../model/constants';
import type { Slot } from '../../model/types';
import { bindingDrag as timedBindingDrag } from '../bindingDrag';
export { bindingDrag as timedBindingDrag } from '../bindingDrag';
import { capacity, draggedTimer, timerDrop, moveTimer, slotDrop, profile, selectedSlot, updateProfile } from '../store';
import { dropPosition, endShortcutDrag, startTimerDrag } from '../drag';
import { ActionLabel } from './ActionLabel';
import { IconChevron, IconPlus, IconTrash } from './Icons';

// Let native details retain the user's choice across configuration edits.
const initializedResumeSections = new WeakSet<HTMLDetailsElement>();


export function duration(seconds: number): string {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  return `${hours ? `${hours} hour${hours === 1 ? '' : 's'} ` : ''}${minutes ? `${minutes} minute${minutes === 1 ? '' : 's'} ` : ''}${remainder} second${remainder === 1 ? '' : 's'}`;
}
export function approximateDuration(ticks: number): string {
  return `≈ ${duration(ticks * TIMED_TICK_SECONDS)}`;
}
export function clampTicks(value: string): number {
  const number = Number(value);
  return Math.max(1, Math.min(MAX_TIMED_TICKS, Number.isNaN(number) ? 1 : Math.round(number)));
}

export function TimedActionsPanel() {
  const p = profile.value!;
  const timers = p.timedActions ?? [];
  const gapTarget = (event: DragEvent) => {
    let closest: { index: number; position: 'before' | 'after'; distance: number } | null = null;
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-timer]').forEach((row, index) => {
      const rect = row.getBoundingClientRect();
      for (const position of ['before', 'after'] as const) {
        const distance = Math.abs(event.clientY - (position === 'before' ? rect.top : rect.bottom));
        if (!closest || distance < closest.distance) closest = { index, position, distance };
      }
    });
    return closest as { index: number; position: 'before' | 'after'; distance: number } | null;
  };
  const hoverTimer = (event: DragEvent, index: number, position: 'before' | 'after' | 'swap') => {
    const source = draggedTimer.value;
    if (source === null) return;
    event.stopPropagation();
    const valid = source !== index && !(position === 'before' && source === index - 1)
      && !(position === 'after' && source === index + 1);
    timerDrop.value = valid ? { index, position } : null;
    slotDrop.value = null;
    if (valid) event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'move' : 'none';
  };
  const dropTimer = (event: DragEvent, index: number, position: 'before' | 'after' | 'swap') => {
    const source = draggedTimer.value;
    if (source === null) return;
    event.preventDefault();
    event.stopPropagation();
    moveTimer(source, index, position);
    endShortcutDrag();
  };
  const unavailable = timers.length >= MAX_TIMED_ACTIONS ? `Maximum ${MAX_TIMED_ACTIONS} timed actions.`
    : (capacity.value?.remaining ?? 0) < TIMED_ENTRY_SIZE ? 'Not enough storage (6 bytes needed).' : '';
  const add = () => {
    if (unavailable) return;
    updateProfile((draft) => {
      (draft.timedActions ??= []).push({ ticks: 1, resetOnInput: true, consumeInput: false, action: { type: 'none' }, resumeAction: { type: 'none' } });
    });
    selectedSlot.value = { kind: 'timed', layer: 0, index: timers.length, resume: false };
  };
  return <details class="card timed-actions">
    <summary class="card-head"><h2>Timed Actions ({timers.length}/{MAX_TIMED_ACTIONS})</h2><IconChevron /></summary>
    {!timers.length && <p class="empty">Repeat an action on a timer, or after inactivity. Each timer uses 6 bytes.</p>}
    <p class="hint">Drag a timer's header to rearrange them. Each timer keeps its settings and actions.</p>
    <div class="timer-list timed-list" onDragOver={(event) => {
      if (draggedTimer.value === null || (event.target as HTMLElement).closest('[data-timer]')) return;
      const target = gapTarget(event);
      if (target) hoverTimer(event, target.index, target.position);
    }} onDrop={(event) => {
      if (draggedTimer.value === null || (event.target as HTMLElement).closest('[data-timer]')) return;
      const target = gapTarget(event);
      if (target) dropTimer(event, target.index, target.position);
    }}>
      {timers.map((timer, index) => {
        const select = (resume: boolean): Slot => ({ kind: 'timed', layer: 0, index, resume });
        const active = (resume: boolean) => selectedSlot.value?.kind === 'timed' && selectedSlot.value.index === index && selectedSlot.value.resume === resume;
        const intent = timerDrop.value?.index === index ? timerDrop.value.position : null;
        return <article class={`timer-row timed-row ${draggedTimer.value === index ? 'is-dragging' : ''} ${intent === 'swap' ? 'is-drop-target' : ''}`} data-timer={index} key={index}
          onDragOverCapture={(event) => {
            if (draggedTimer.value !== null) hoverTimer(event, index, dropPosition(event, 'vertical'));
          }} onDropCapture={(event) => {
            if (draggedTimer.value !== null) dropTimer(event, index, dropPosition(event, 'vertical'));
          }}>
          {intent === 'before' || intent === 'after' ? <span class={`drop-line drop-line-${intent}`} aria-hidden="true" /> : null}
          <header class="card-head timer-drag-handle" draggable title="Drag to reorder timers"
            onDragStart={(event) => {
              if ((event.target as HTMLElement).closest('button')) { event.preventDefault(); return; }
              event.stopPropagation();
              startTimerDrag(event, index);
            }} onDragEnd={endShortcutDrag}><strong class="timer-drag-label">Timer {index + 1}</strong>
            <button class="btn btn-icon btn-danger" aria-label={`Remove Timer ${index + 1}`} onClick={() => {
              updateProfile((draft) => { draft.timedActions!.splice(index, 1); if (!draft.timedActions!.length) delete draft.timedActions; });
              const slot = selectedSlot.value;
              if (slot?.kind === 'timed') selectedSlot.value = slot.index === index ? null : slot.index > index ? { ...slot, index: slot.index - 1 } : slot;
            }}><IconTrash /></button>
          </header>
          <div class="timer-settings">
          <label class="field"><span class="field-label">Run On</span>
            <select aria-label={`Timer ${index + 1} Layer`} value={timer.layer === undefined ? 'global' : String(timer.layer)} onChange={(event) => {
              const value = (event.target as HTMLSelectElement).value;
              updateProfile(draft => {
                if (value === 'global') delete draft.timedActions![index]!.layer;
                else draft.timedActions![index]!.layer = Number(value);
              });
            }}>
              <option value="global">All Layers</option>
              {timer.layer !== undefined && !p.layers[timer.layer] && <option value={String(timer.layer)}>Removed Layer — Choose a Layer</option>}
              {p.layers.map((_, layer) => <option value={String(layer)}>Layer {layer + 1}</option>)}
            </select>
          </label>
          <div class="field"><span class="field-label">Reset Timer on Input</span>
            <div class="segmented" role="group" aria-label={`Timer ${index + 1} Reset Timer on Input`}>
              {[true, false].map(reset => <button type="button" class={timer.resetOnInput === reset ? 'is-selected' : ''}
                aria-pressed={timer.resetOnInput === reset} onClick={() => {
                  updateProfile(draft => { draft.timedActions![index]!.resetOnInput = reset; });
                }}>{reset ? 'Yes' : 'No'}</button>)}
            </div>
          </div>
          </div>
          {timer.layer !== undefined && <p class="hint">Runs while its assigned layer is active. Changing layers restarts its interval. An armed next-input action remains available on any layer.</p>}
          <label class="field timer-interval"><span class="field-label">Interval <output>{approximateDuration(timer.ticks)}</output></span>
            <input type="range" min={1} max={MAX_TIMED_TICKS} step={1} value={timer.ticks} aria-label={`Timer ${index + 1} Interval Ticks`} onInput={(event) => {
              const input = event.target as HTMLInputElement;
              const ticks = clampTicks(input.value);
              input.value = String(ticks);
              updateProfile((draft) => { draft.timedActions![index]!.ticks = ticks; }, `timer:${index}:ticks`);
            }} />
          </label>
          <button data-clipboard-target data-slot={JSON.stringify(select(false))} {...timedBindingDrag(select(false))} aria-label={`Edit Timer ${index + 1} Action`} aria-pressed={active(false)} onClick={() => { selectedSlot.value = select(false); }}>
            <span class="field-label">When Timer Fires</span><ActionLabel action={timer.action} />
          </button>
          <details class="timer-resume" ref={(element) => {
            if (!element) return;
            if (!initializedResumeSections.has(element)) {
              element.open = timer.consumeInput || timer.resumeAction.type !== 'none';
              initializedResumeSections.add(element);
            }
            if (active(true)) element.open = true;
          }}>
            <summary>On Next Input <span class="muted">{timer.resumeAction.type === 'none' ? '(optional)' : '· assigned'}</span></summary>
            <p class="hint">Runs once on the next key press, encoder button press, or completed encoder turn after this timer fires.</p>
            <button data-clipboard-target data-slot={JSON.stringify(select(true))} {...timedBindingDrag(select(true))} aria-label={`Edit Timer ${index + 1} Resume Action`} aria-pressed={active(true)} onClick={() => { selectedSlot.value = select(true); }}>
              <ActionLabel action={timer.resumeAction} />
            </button>
            <label class="timer-reset"><input type="checkbox" checked={timer.consumeInput} onChange={(event) => {
              const consume = (event.target as HTMLInputElement).checked;
              updateProfile((draft) => { draft.timedActions![index]!.consumeInput = consume; });
            }} /> Consume This Input</label>
            <p class="hint">When enabled, this input dismisses the timer without running its normal binding. Otherwise, the binding runs after the next-input action. This also works with no next-input action assigned.</p>
          </details>
        </article>;
      })}
    </div>
    <button class="btn" disabled={!!unavailable} title={unavailable || 'Add a timed action'} onClick={add}><IconPlus /> Add Timed Action</button>
    {unavailable && <p class="hint">{unavailable}</p>}
    <p class="hint">Timers repeat. Restarting on input makes them inactivity timers. Each timer measures from its own start or restart, with less than 16ms of clock quantization. Queued output may run later. Held actions are unavailable.</p>
  </details>;
}
