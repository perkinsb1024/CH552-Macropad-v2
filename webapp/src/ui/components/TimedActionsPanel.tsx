import { MAX_TIMED_TICKS, MAX_TIMED_ACTIONS, TIMED_ENTRY_SIZE, TIMED_TICK_SECONDS } from '../../model/constants';
import type { Slot } from '../../model/types';
import { canSwapSlots, capacity, draggedSlot, profile, selectedSlot, slotDrop, swapSlotActions, updateProfile } from '../store';
import { canApplyShortcut, draggedShortcut, endShortcutDrag, setRoundedDragImage, shortcutDragOver, shortcutDrop } from '../drag';
import { ActionLabel } from './ActionLabel';
import { IconPlus, IconTrash } from './Icons';

// Let native details retain the user's choice across configuration edits.
const initializedResumeSections = new WeakSet<HTMLDetailsElement>();

function timedBindingDrag(slot: Slot) {
  const same = (other: Slot | null) => other !== null && JSON.stringify(other) === JSON.stringify(slot);
  const invalid = draggedShortcut.value ? !canApplyShortcut(draggedShortcut.value, slot)
    : draggedSlot.value && !same(draggedSlot.value) && !canSwapSlots(draggedSlot.value, slot);
  const end = () => { draggedSlot.value = null; slotDrop.value = null; };
  return {
    draggable: true,
    class: `timer-action ${same(selectedSlot.value) ? 'is-selected' : ''} ${same(draggedSlot.value) ? 'is-dragging' : ''} ${same(slotDrop.value?.slot ?? null) ? 'is-drop-target' : ''} ${invalid ? 'drag-invalid' : ''}`,
    onDragStart: (event: DragEvent) => {
      setRoundedDragImage(event);
      endShortcutDrag();
      draggedSlot.value = slot;
      event.dataTransfer?.setData('application/x-macropad-slot', 'move');
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: end,
    onDragOver: (event: DragEvent) => {
      if (shortcutDragOver(event, slot)) return;
      event.stopPropagation();
      const source = draggedSlot.value;
      const valid = source && canSwapSlots(source, slot);
      slotDrop.value = valid ? { slot, position: 'swap' } : null;
      if (valid) event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'move' : 'none';
    },
    onDrop: (event: DragEvent) => {
      if (shortcutDrop(event, slot)) return;
      event.preventDefault();
      event.stopPropagation();
      if (draggedSlot.value) swapSlotActions(draggedSlot.value, slot);
      end();
    },
  };
}

export function duration(seconds: number): string {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes ? `${minutes} minute${minutes === 1 ? '' : 's'} ` : ''}${remainder} second${remainder === 1 ? '' : 's'}`;
}
export function approximateDuration(ticks: number): string {
  return `≈ ${duration(ticks * TIMED_TICK_SECONDS)}`;
}
export function firingRange(ticks: number): string {
  return `${duration((ticks - 1) * TIMED_TICK_SECONDS)} – ${duration(ticks * TIMED_TICK_SECONDS)}`;
}
export function clampTicks(value: string): number {
  const number = Number(value);
  return Math.max(1, Math.min(MAX_TIMED_TICKS, Number.isNaN(number) ? 1 : Math.round(number)));
}

export function TimedActionsPanel() {
  const p = profile.value!;
  const timers = p.timedActions ?? [];
  const unavailable = timers.length >= MAX_TIMED_ACTIONS ? `Maximum ${MAX_TIMED_ACTIONS} timed actions.`
    : (capacity.value?.remaining ?? 0) < TIMED_ENTRY_SIZE ? 'Not enough storage (5 bytes needed).' : '';
  const add = () => {
    if (unavailable) return;
    updateProfile((draft) => {
      (draft.timedActions ??= []).push({ ticks: 1, resetOnInput: true, consumeInput: false, action: { type: 'none' }, resumeAction: { type: 'none' } });
    });
    selectedSlot.value = { kind: 'timed', layer: 0, index: timers.length, resume: false };
  };
  return <section class="card timed-actions">
    <header class="card-head"><h2>Timed actions</h2><span class="muted">Across all layers · {timers.length}/{MAX_TIMED_ACTIONS}</span></header>
    {!timers.length && <p class="empty">Repeat an action on a timer, or after inactivity. Each timer uses 5 bytes.</p>}
    <div class="timer-list">
      {timers.map((timer, index) => {
        const select = (resume: boolean): Slot => ({ kind: 'timed', layer: 0, index, resume });
        const active = (resume: boolean) => selectedSlot.value?.kind === 'timed' && selectedSlot.value.index === index && selectedSlot.value.resume === resume;
        return <article class="timer-row" key={index}>
          <header class="card-head"><strong>Timer {index + 1}</strong>
            <button class="btn btn-icon btn-danger" aria-label={`Remove timer ${index + 1}`} onClick={() => {
              updateProfile((draft) => { draft.timedActions!.splice(index, 1); if (!draft.timedActions!.length) delete draft.timedActions; });
              const slot = selectedSlot.value;
              if (slot?.kind === 'timed') selectedSlot.value = slot.index === index ? null : slot.index > index ? { ...slot, index: slot.index - 1 } : slot;
            }}><IconTrash /></button>
          </header>
          <label class="field"><span class="field-label">Interval <output title={firingRange(timer.ticks)}>{approximateDuration(timer.ticks)}</output></span>
            <input type="range" min={1} max={MAX_TIMED_TICKS} step={1} value={timer.ticks} aria-label={`Timer ${index + 1} interval ticks`} onInput={(event) => {
              const input = event.target as HTMLInputElement;
              const ticks = clampTicks(input.value);
              input.value = String(ticks);
              updateProfile((draft) => { draft.timedActions![index]!.ticks = ticks; }, `timer:${index}:ticks`);
            }} />
            <span class="muted">{timer.ticks} × 131 seconds</span>
          </label>
          <label class="timer-reset"><input type="checkbox" checked={timer.resetOnInput} onChange={(event) => {
            const reset = (event.target as HTMLInputElement).checked;
            updateProfile((draft) => { draft.timedActions![index]!.resetOnInput = reset; });
          }} /> Restart on key / encoder input</label>
          <button data-clipboard-target {...timedBindingDrag(select(false))} aria-label={`Edit timer ${index + 1} action`} aria-pressed={active(false)} onClick={() => { selectedSlot.value = select(false); }}>
            <span class="field-label">When timer fires</span><ActionLabel action={timer.action} />
          </button>
          <details class="timer-resume" ref={(element) => {
            if (!element) return;
            if (!initializedResumeSections.has(element)) {
              element.open = timer.consumeInput || timer.resumeAction.type !== 'none';
              initializedResumeSections.add(element);
            }
            if (active(true)) element.open = true;
          }}>
            <summary>On next input <span class="muted">{timer.resumeAction.type === 'none' ? '(optional)' : '· assigned'}</span></summary>
            <p class="hint">Runs once on the next key press, encoder button press, or completed encoder turn after this timer fires.</p>
            <button data-clipboard-target {...timedBindingDrag(select(true))} aria-label={`Edit timer ${index + 1} resume action`} aria-pressed={active(true)} onClick={() => { selectedSlot.value = select(true); }}>
              <ActionLabel action={timer.resumeAction} />
            </button>
            <label class="timer-reset"><input type="checkbox" checked={timer.consumeInput} onChange={(event) => {
              const consume = (event.target as HTMLInputElement).checked;
              updateProfile((draft) => { draft.timedActions![index]!.consumeInput = consume; });
            }} /> Consume this input</label>
            <p class="hint">When enabled, this input dismisses the timer without running its normal binding. Otherwise, the binding runs after the next-input action. This also works with no next-input action assigned.</p>
          </details>
        </article>;
      })}
    </div>
    <button class="btn" disabled={!!unavailable} title={unavailable || 'Add a timed action'} onClick={add}><IconPlus /> Add timed action</button>
    {unavailable && <p class="hint">{unavailable}</p>}
    <p class="hint">Timers repeat. Restarting on input makes them inactivity timers. Intervals use a shared clock; the first firing can be up to 131 seconds early. Held actions are unavailable.</p>
  </section>;
}
