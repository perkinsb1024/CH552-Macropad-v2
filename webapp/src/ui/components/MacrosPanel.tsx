import { Fragment } from 'preact';
import { computeCapacity } from '../../model/capacity';
import { isMacroLayerSwitch, macroSwitchesLayer, removeMacro } from '../../model/macros';
import type { Action, Slot } from '../../model/types';
import { canInsertSlot, capacity, draggedMacro, macroDrop, moveMacro, draggedSlot, insertSlotAction, profile, selectedSlot, slotDrop, updateProfile } from '../store';
import { dropPosition, endShortcutDrag, startMacroDrag } from '../drag';
import { ActionLabel } from './ActionLabel';
import { IconChevron, IconClock, IconPlus, IconTrash } from './Icons';
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
  const macroGapTarget = (event: DragEvent) => {
    let closest: { index: number; position: 'before' | 'after'; distance: number } | null = null;
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-macro]').forEach((row, index) => {
      const rect = row.getBoundingClientRect();
      for (const position of ['before', 'after'] as const) {
        const distance = Math.abs(event.clientY - (position === 'before' ? rect.top : rect.bottom));
        if (!closest || distance < closest.distance) closest = { index, position, distance };
      }
    });
    return closest as { index: number; position: 'before' | 'after'; distance: number } | null;
  };
  const hoverMacro = (event: DragEvent, index: number, position: 'before' | 'after' | 'swap') => {
    const source = draggedMacro.value;
    if (source === null) return;
    event.stopPropagation();
    const valid = source !== index && !(position === 'before' && source === index - 1)
      && !(position === 'after' && source === index + 1);
    macroDrop.value = valid ? { index, position } : null;
    slotDrop.value = null;
    if (valid) event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'move' : 'none';
  };
  const dropMacro = (event: DragEvent, index: number, position: 'before' | 'after' | 'swap') => {
    const source = draggedMacro.value;
    if (source === null) return;
    event.preventDefault();
    event.stopPropagation();
    moveMacro(source, index, position);
    endShortcutDrag();
  };
  const insertionStep = (index: number) => {
    const actions = macros[index]!.actions;
    const firstSwitch = actions.findIndex(isMacroLayerSwitch);
    return firstSwitch < 0 ? actions.length : firstSwitch;
  };
  const canAddStep = (index: number) => computeCapacity({ ...p, macros: macros.map((macro, i) => i === index ? { actions: [...macro.actions, { type: 'pause', ticks: 0 }] } : macro) }).remaining >= 0;
  const addStep = (index: number, action: Action) => {
    const step = insertionStep(index);
    updateProfile(draft => { draft.macros![index]!.actions.splice(step, 0, action); });
    selectedSlot.value = { kind: 'macro', layer: 0, index, step };
  };
  return <details class="card macros-panel">
    <summary class="card-head"><h2>Macros ({macros.length})</h2><IconChevron /></summary>
    <p class="hint">Add steps, then assign <strong>Execute Macro</strong> to a key, encoder, chord, or timer. Macros that do not switch layers can be repeated up to 16 times. Pauses give applications time to respond.</p>
    <p class="hint">Drag a macro's header to rearrange them. Existing <strong>Execute Macro</strong> actions will be updated. Drop onto a key, encoder, chord, or timer action to assign it.</p>
    <div class="timer-list macro-list" onDragOver={(event) => {
      if (draggedMacro.value === null || (event.target as HTMLElement).closest('[data-macro]')) return;
      const target = macroGapTarget(event);
      if (target) hoverMacro(event, target.index, target.position);
    }} onDrop={(event) => {
      if (draggedMacro.value === null || (event.target as HTMLElement).closest('[data-macro]')) return;
      const target = macroGapTarget(event);
      if (target) dropMacro(event, target.index, target.position);
    }}>
      {macros.map((macro, index) => {
        const intent = macroDrop.value?.index === index ? macroDrop.value.position : null;
        return <article class={`timer-row macro-row ${draggedMacro.value === index ? 'is-dragging' : ''} ${intent === 'swap' ? 'is-drop-target' : ''}`} data-macro={index} tabIndex={-1} key={index}
          onDragOverCapture={(event) => {
            if (draggedMacro.value !== null) hoverMacro(event, index, dropPosition(event, 'vertical'));
          }} onDropCapture={(event) => {
            if (draggedMacro.value !== null) dropMacro(event, index, dropPosition(event, 'vertical'));
          }}>
        {intent === 'before' || intent === 'after' ? <span class={`drop-line drop-line-${intent}`} aria-hidden="true" /> : null}
        <header class="card-head macro-drag-handle" draggable title="Drag to reorder macros or assign this macro to an action"
          onDragStart={(event) => {
            if ((event.target as HTMLElement).closest('button')) { event.preventDefault(); return; }
            event.stopPropagation();
            startMacroDrag(event, index);
          }} onDragEnd={endShortcutDrag}><strong class="macro-drag-label">Macro {index + 1}</strong>
          <button class="btn btn-icon btn-danger" aria-label={`Remove Macro ${index + 1} and Its Bindings`} title="Remove macro and clear its bindings" onClick={() => {
            updateProfile(draft => removeMacro(draft, index));
            const slot = selectedSlot.value;
            if (slot?.kind === 'macro') selectedSlot.value = slot.index === index ? null : slot.index > index ? { ...slot, index: slot.index - 1 } : slot;
          }}><IconTrash /></button>
        </header>
        {macroSwitchesLayer(macro.actions) && <p class="hint">A layer switch must be the final step, and this macro cannot repeat. Changing layers from outside this macro also cancels pending steps.</p>}
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
          return <Fragment key={step}>
            {step === insertionStep(index) && <p class="hint macro-insertion-marker">New steps and pauses will be inserted here</p>}
            <div class={`macro-step ${selectedSlot.value?.kind === 'macro' && selectedSlot.value.index === index && selectedSlot.value.step === step ? 'is-selected' : ''} ${isMacroLayerSwitch(action) && step !== macro.actions.length - 1 ? 'has-problem' : ''}`}
            onDragOver={binding.onDragOver} onDrop={binding.onDrop}>
            {intent && intent !== 'swap' && <span class={`drop-line drop-line-${intent}`} aria-hidden="true" />}
            <button key="action" data-clipboard-target data-slot={JSON.stringify(slot)} {...binding} aria-label={`Edit Macro ${index + 1} Step ${step + 1}`} onClick={() => {
              const selected = selectedSlot.value;
              selectedSlot.value = selected?.kind === 'macro' && selected.index === index && selected.step === step ? null : slot;
            }}>
              <span class="field-label">Step {step + 1}</span><ActionLabel action={action} />
            </button>
            <button key="remove" class="btn btn-icon btn-danger-muted" aria-label={`Remove Step ${step + 1}`} onClick={() => {
              updateProfile(draft => { draft.macros![index]!.actions.splice(step, 1); });
              const selected = selectedSlot.value;
              if (selected?.kind === 'macro' && selected.index === index) selectedSlot.value = selected.step === step ? null : selected.step > step ? { ...selected, step: selected.step - 1 } : selected;
            }}><IconTrash /></button>
          </div></Fragment>;
        })}
        </div>
        <div class="row macro-step-actions">
          <button class="btn btn-ghost" disabled={!canAddStep(index)} onClick={() => addStep(index, { type: 'pause', ticks: 16 })}><IconClock /> Add Pause</button>
          <button class="btn macro-add-step" disabled={!canAddStep(index)} onClick={() => addStep(index, { type: 'keyTap', usage: 4, modifiers: 0 })}><IconPlus /> Add Step</button>
        </div>
      </article>; })}
    </div>
    <button class="btn btn-primary" disabled={(capacity.value?.remaining ?? 0) < 4} onClick={() => {
      updateProfile(draft => { (draft.macros ??= []).push({ actions: [{ type: 'keyTap', usage: 4, modifiers: 0 }] }); });
      selectedSlot.value = { kind: 'macro', layer: 0, index: macros.length, step: 0 };
    }}><IconPlus /> Add Macro</button>
    <p class="hint">Macros use 2 bytes per step, plus 1 additional byte, regardless of how many steps. Macros cannot use "hold" actions or execute a different macro. Some externally-triggered actions wait for macro playback to finish, while others do not. A layer change cancels playback. View <a href="https://github.com/perkinsb1024/CH552-Macropad-v2/blob/main/documentation/Configuration%20Overview.md#macros" target="_blank" rel="noopener noreferrer">Configuration Overview</a> for more information. If the queue is full, newly triggered actions that need to wait (including other macros) will be ignored.</p>
  </details>;
}
