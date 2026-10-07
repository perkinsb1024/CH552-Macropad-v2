import { computeCapacity } from '../../model/capacity';
import { removeMacro } from '../../model/macros';
import type { Slot } from '../../model/types';
import { capacity, profile, selectedSlot, updateProfile } from '../store';
import { ActionLabel } from './ActionLabel';
import { IconChevron, IconPlus, IconTrash } from './Icons';
import { timedBindingDrag } from './TimedActionsPanel';

export function MacrosPanel() {
  const p = profile.value!;
  const macros = p.macros ?? [];
  const canAddStep = (index: number) => computeCapacity({ ...p, macros: macros.map((macro, i) => i === index ? { actions: [...macro.actions, { type: 'pause', ticks: 0 }] } : macro) }).remaining >= 0;
  return <details class="card macros-panel">
    <summary class="card-head"><h2>Macros</h2><span class="muted">Ordered actions · {macros.length}</span><IconChevron /></summary>
    <p class="hint">Add steps, then assign Execute macro to a key, encoder, chord, or timer. Each invocation can repeat 1–16 times. Pauses give applications time to respond.</p>
    <div class="timer-list">
      {macros.map((macro, index) => <article class="timer-row" key={index}>
        <header class="card-head"><strong>Macro {index + 1}</strong>
          <button class="btn btn-icon btn-danger" aria-label={`Remove macro ${index + 1} and its bindings`} title="Remove macro and clear its bindings" onClick={() => {
            updateProfile(draft => removeMacro(draft, index));
            const slot = selectedSlot.value;
            if (slot?.kind === 'macro') selectedSlot.value = slot.index === index ? null : slot.index > index ? { ...slot, index: slot.index - 1 } : slot;
          }}><IconTrash /></button>
        </header>
        {!macro.actions.length && <p class="empty">No steps yet.</p>}
        {macro.actions.map((action, step) => {
          const slot: Slot = { kind: 'macro', layer: 0, index, step };
          const move = (direction: number) => {
            updateProfile(draft => {
              const actions = draft.macros![index]!.actions;
              [actions[step], actions[step + direction]] = [actions[step + direction]!, actions[step]!];
            });
            selectedSlot.value = { ...slot, step: step + direction };
          };
          return <div class="macro-step" key={step}>
            <button data-clipboard-target data-slot={JSON.stringify(slot)} {...timedBindingDrag(slot)} aria-label={`Edit macro ${index + 1} step ${step + 1}`} onClick={() => { selectedSlot.value = slot; }}>
              <span class="field-label">Step {step + 1}</span><ActionLabel action={action} />
            </button>
            <div class="macro-step-controls">
              <button class="btn btn-icon" aria-label={`Move step ${step + 1} up`} disabled={!step} onClick={() => move(-1)}>↑</button>
              <button class="btn btn-icon" aria-label={`Move step ${step + 1} down`} disabled={step === macro.actions.length - 1} onClick={() => move(1)}>↓</button>
              <button class="btn btn-icon btn-danger" aria-label={`Remove step ${step + 1}`} onClick={() => {
                updateProfile(draft => { draft.macros![index]!.actions.splice(step, 1); });
                const selected = selectedSlot.value;
                if (selected?.kind === 'macro' && selected.index === index) selectedSlot.value = selected.step === step ? null : selected.step > step ? { ...selected, step: selected.step - 1 } : selected;
              }}><IconTrash /></button>
            </div>
          </div>;
        })}
        <button class="btn" disabled={!canAddStep(index)} onClick={() => {
          updateProfile(draft => { draft.macros![index]!.actions.push({ type: 'keyTap', usage: 4, modifiers: 0 }); });
          selectedSlot.value = { kind: 'macro', layer: 0, index, step: macro.actions.length };
        }}><IconPlus /> Add step</button>
      </article>)}
    </div>
    <button class="btn" disabled={(capacity.value?.remaining ?? 0) < 4} onClick={() => {
      updateProfile(draft => { (draft.macros ??= []).push({ actions: [{ type: 'keyTap', usage: 4, modifiers: 0 }] }); });
      selectedSlot.value = { kind: 'macro', layer: 0, index: macros.length, step: 0 };
    }}><IconPlus /> Add macro</button>
    <p class="hint">Steps use 2 bytes each plus a 2-byte terminator per macro, sharing the 128-byte profile. Held actions and nested macros are unavailable. A layer change cancels playback. Other queued actions wait for the active macro; immediate actions can interleave. If the queue fills, new invocations are dropped.</p>
  </details>;
}
