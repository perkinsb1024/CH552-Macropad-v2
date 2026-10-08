import { computeCapacity } from '../../model/capacity';
import { macroSwitchesLayer, removeMacro } from '../../model/macros';
import type { Slot } from '../../model/types';
import { canInsertSlot, capacity, draggedSlot, insertSlotAction, profile, selectedSlot, slotDrop, updateProfile } from '../store';
import { ActionLabel } from './ActionLabel';
import { IconChevron, IconPlus, IconTrash } from './Icons';
import { timedBindingDrag } from './TimedActionsPanel';

export function MacrosPanel() {
  const p = profile.value!;
  const macros = p.macros ?? [];
  const gapTarget = (event: DragEvent, index: number) => {
    let closest: { slot: Slot; position: 'before' | 'after'; distance: number } | null = null;
    const rows = (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.macro-step');
    rows.forEach((row, step) => {
      const rect = row.getBoundingClientRect();
      for (const position of ['before', 'after'] as const) {
        const distance = Math.abs(event.clientY - (position === 'before' ? rect.top : rect.bottom));
        if (!closest || distance < closest.distance) closest = { slot: { kind: 'macro', layer: 0, index, step }, position, distance };
      }
    });
    return closest as { slot: Slot; position: 'before' | 'after'; distance: number } | null;
  };
  const canAddStep = (index: number) => !macroSwitchesLayer(macros[index]!.actions) && computeCapacity({ ...p, macros: macros.map((macro, i) => i === index ? { actions: [...macro.actions, { type: 'pause', ticks: 0 }] } : macro) }).remaining >= 0;
  return <details class="card macros-panel">
    <summary class="card-head"><h2>Macros ({macros.length})</h2><IconChevron /></summary>
    <p class="hint">Add steps, then assign <strong>Execute macro</strong> to a key, encoder, chord, or timer. Macros that do not switch layers can be repeated up to 16 times. Pauses give applications time to respond.</p>
    <div class="timer-list">
      {macros.map((macro, index) => <article class="timer-row" data-macro={index} tabIndex={-1} key={index}>
        <header class="card-head"><strong>Macro {index + 1}</strong>
          <button class="btn btn-icon btn-danger" aria-label={`Remove macro ${index + 1} and its bindings`} title="Remove macro and clear its bindings" onClick={() => {
            updateProfile(draft => removeMacro(draft, index));
            const slot = selectedSlot.value;
            if (slot?.kind === 'macro') selectedSlot.value = slot.index === index ? null : slot.index > index ? { ...slot, index: slot.index - 1 } : slot;
          }}><IconTrash /></button>
        </header>
        {macroSwitchesLayer(macro.actions) && <p class="hint">Macro steps are not permitted after a layer switch, and repeat will be disabled. Temporarily remove the layer switch step to add more steps. Changing layers from outside this macro will also cancel any pending steps.</p>}
        {!macro.actions.length && <p class="empty">No steps yet.</p>}
        <div class="macro-steps" onDragOver={(event) => {
          if ((event.target as HTMLElement).closest('.macro-step')) return;
          const source = draggedSlot.value;
          const target = gapTarget(event, index);
          if (source && target && canInsertSlot(source, target.slot, target.position)) {
            event.preventDefault();
            slotDrop.value = { slot: target.slot, position: target.position };
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          } else slotDrop.value = null;
        }} onDrop={(event) => {
          if ((event.target as HTMLElement).closest('.macro-step')) return;
          event.preventDefault();
          const source = draggedSlot.value;
          const target = gapTarget(event, index);
          if (source && target) insertSlotAction(source, target.slot, target.position);
          draggedSlot.value = null;
          slotDrop.value = null;
        }}>
        {macro.actions.map((action, step) => {
          const slot: Slot = { kind: 'macro', layer: 0, index, step };
          const binding = timedBindingDrag(slot, true);
          const drop = slotDrop.value;
          const intent = drop?.slot.kind === 'macro' && drop.slot.index === index && drop.slot.step === step ? drop.position : null;
          return <div class={`macro-step ${selectedSlot.value?.kind === 'macro' && selectedSlot.value.index === index && selectedSlot.value.step === step ? 'is-selected' : ''}`}
            key={step} onDragOver={binding.onDragOver} onDrop={binding.onDrop}>
            {intent && intent !== 'swap' && <span class={`drop-line drop-line-${intent}`} aria-hidden="true" />}
            <button key="action" data-clipboard-target data-slot={JSON.stringify(slot)} {...binding} aria-label={`Edit macro ${index + 1} step ${step + 1}`} onClick={() => {
              const selected = selectedSlot.value;
              selectedSlot.value = selected?.kind === 'macro' && selected.index === index && selected.step === step ? null : slot;
            }}>
              <span class="field-label">Step {step + 1}</span><ActionLabel action={action} />
            </button>
            <button key="remove" class="btn btn-icon btn-danger-muted" aria-label={`Remove step ${step + 1}`} onClick={() => {
              updateProfile(draft => { draft.macros![index]!.actions.splice(step, 1); });
              const selected = selectedSlot.value;
              if (selected?.kind === 'macro' && selected.index === index) selectedSlot.value = selected.step === step ? null : selected.step > step ? { ...selected, step: selected.step - 1 } : selected;
            }}><IconTrash /></button>
          </div>;
        })}
        </div>
        <div class="row">
          <button class="btn" disabled={!canAddStep(index)} onClick={() => {
            updateProfile(draft => { draft.macros![index]!.actions.push({ type: 'keyTap', usage: 4, modifiers: 0 }); });
            selectedSlot.value = { kind: 'macro', layer: 0, index, step: macro.actions.length };
          }}><IconPlus /> Add step</button>
          <button class="btn" disabled={!canAddStep(index)} onClick={() => {
            updateProfile(draft => { draft.macros![index]!.actions.push({ type: 'pause', ticks: 16 }); });
            selectedSlot.value = { kind: 'macro', layer: 0, index, step: macro.actions.length };
          }}><IconPlus /> Add pause</button>
        </div>
      </article>)}
    </div>
    <button class="btn" disabled={(capacity.value?.remaining ?? 0) < 4} onClick={() => {
      updateProfile(draft => { (draft.macros ??= []).push({ actions: [{ type: 'keyTap', usage: 4, modifiers: 0 }] }); });
      selectedSlot.value = { kind: 'macro', layer: 0, index: macros.length, step: 0 };
    }}><IconPlus /> Add macro</button>
    <p class="hint">Macros use 2 bytes per step, plus 1 additional byte, regardless of how many steps. Macros cannot use "hold" actions or execute a different macro. Some externally-triggered actions wait for macro playback to finish, while others do not. A layer change cancels playback. View <a href="https://github.com/perkinsb1024/CH552-Macropad-v2/blob/main/documentation/Configuration%20Overview.md#macros" target="_blank" rel="noopener noreferrer">Configuration Overview</a> for more information. If the queue is full, newly triggered actions that need to wait (including other macros) will be ignored.</p>
  </details>;
}
