import { useState } from 'preact/hooks';
import { keyCount } from '../../model/constants';
import { allPairs } from '../../model/pairs';
import { summarize } from '../../model/actions';
import type { Slot } from '../../model/types';
import { actionProblem } from '../../model/validate';
import { addChord, canInsertSlot, canSwapSlots, draggedSlot, insertSlotAction, profile, removeChord, selectedLayer, selectedSlot, slotDrop, swapSlotActions } from '../store';
import { dropPosition } from '../drag';
import { IconPlus, IconTrash } from './Icons';

export function ChordPanel() {
  const p = profile.value!;
  const li = selectedLayer.value;
  const keys = keyCount(p.variant);
  const chords = p.chords.filter((c) => c.layer === li).sort((a, b) => a.keyA - b.keyA || a.keyB - b.keyB);
  const used = new Set(chords.map((c) => `${c.keyA}-${c.keyB}`));
  const available = allPairs(keys).filter(([a, b]) => !used.has(`${a}-${b}`));
  const [pick, setPick] = useState('');
  const first = available[0];
  const gapTarget = (event: DragEvent): { slot: Slot; position: 'before' | 'after' } | null => {
    let closest: { index: number; position: 'before' | 'after'; distance: number } | null = null;
    const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.chord-main'));
    buttons.forEach((button, index) => {
      const rect = button.getBoundingClientRect();
      for (const position of ['before', 'after'] as const) {
        const y = position === 'before' ? rect.top : rect.bottom;
        const x = Math.max(rect.left, Math.min(event.clientX, rect.right));
        const distance = Math.hypot(event.clientX - x, event.clientY - y);
        if (!closest || distance < closest.distance) closest = { index, position, distance };
      }
    });
    if (!closest) return null;
    const { index, position } = closest as { index: number; position: 'before' | 'after' };
    const chord = chords[index]!;
    return { slot: { kind: 'chord', layer: li, keyA: chord.keyA, keyB: chord.keyB }, position };
  };

  return (
    <section class="card">
      <header class="card-head">
        <h2>Chords</h2>
        <span class="muted">Two keys pressed together</span>
      </header>
      {chords.length === 0 && <p class="empty">No chords on this layer. Each chord uses 3 bytes of device storage.</p>}
      {chords.length > 0 && (
        <ul class="chord-list" onDragOver={(event) => {
          if ((event.target as HTMLElement).closest('.chord')) return;
          const source = draggedSlot.value;
          const target = gapTarget(event);
          if (source && target && canInsertSlot(source, target.slot, target.position)) {
            event.preventDefault();
            slotDrop.value = target;
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          } else slotDrop.value = null;
        }} onDrop={(event) => {
          if ((event.target as HTMLElement).closest('.chord')) return;
          event.preventDefault();
          const source = draggedSlot.value;
          const target = gapTarget(event);
          if (source && target) insertSlotAction(source, target.slot, target.position);
          draggedSlot.value = null;
          slotDrop.value = null;
        }}>
          {chords.map((c) => {
            const slot: Slot = { kind: 'chord', layer: li, keyA: c.keyA, keyB: c.keyB };
            const selected = JSON.stringify(selectedSlot.value) === JSON.stringify(slot);
            const problem = actionProblem(c.action, { layerCount: p.layers.length, rotation: false });
            const dragged = draggedSlot.value;
            const invalidDrop = !!dragged && !canSwapSlots(dragged, slot) && !canInsertSlot(dragged, slot, 'before') && !canInsertSlot(dragged, slot, 'after');
            const intent = slotDrop.value && JSON.stringify(slotDrop.value.slot) === JSON.stringify(slot) ? slotDrop.value.position : null;
            return (
              <li key={`${c.keyA}-${c.keyB}`} class={`chord ${selected ? 'is-selected' : ''} ${problem ? 'has-problem' : ''} ${intent === 'swap' ? 'is-drop-target' : ''} ${invalidDrop ? 'drag-invalid' : ''}`}>
                <button class="chord-main" onClick={() => { selectedSlot.value = slot; }} draggable onDragStart={(event) => { draggedSlot.value = slot; event.dataTransfer?.setData('application/x-macropad-slot', 'move'); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { draggedSlot.value = null; slotDrop.value = null; }} onDragOver={(event) => {
                  const source = draggedSlot.value;
                  const position = dropPosition(event, 'vertical');
                  const valid = source && (position === 'swap' ? canSwapSlots(source, slot) : canInsertSlot(source, slot, position));
                  if (!valid) { slotDrop.value = null; if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'; return; }
                  event.preventDefault();
                  slotDrop.value = { slot, position };
                  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                }} onDrop={(event) => {
                  event.preventDefault();
                  const source = draggedSlot.value;
                  const position = slotDrop.value && JSON.stringify(slotDrop.value.slot) === JSON.stringify(slot) ? slotDrop.value.position : dropPosition(event, 'vertical');
                  if (source) {
                    if (position === 'swap') swapSlotActions(source, slot);
                    else insertSlotAction(source, slot, position);
                  }
                  draggedSlot.value = null;
                  slotDrop.value = null;
                }}>
                  <span class="chord-keys"><kbd>{c.keyA + 1}</kbd><span>+</span><kbd>{c.keyB + 1}</kbd></span>
                  <span class="chord-action">{summarize(c.action)}</span>
                  {intent === 'before' || intent === 'after' ? <span class={`drop-line drop-line-${intent}`} aria-hidden="true" /> : null}
                </button>
                <button class="btn btn-icon btn-ghost" aria-label="Remove chord" onClick={() => removeChord(c)}><IconTrash /></button>
              </li>
            );
          })}
        </ul>
      )}
      {available.length > 0 && (
        <div class="chord-add">
          <select value={pick || (first ? `${first[0]}-${first[1]}` : '')} onChange={(e) => setPick((e.target as HTMLSelectElement).value)} aria-label="Key pair">
            {available.map(([a, b]) => <option key={`${a}-${b}`} value={`${a}-${b}`}>Keys {a + 1} + {b + 1}</option>)}
          </select>
          <button class="btn" onClick={() => {
            const [a, b] = (pick || `${first![0]}-${first![1]}`).split('-').map(Number) as [number, number];
            addChord(li, a, b);
            setPick('');
          }}><IconPlus /> Add chord</button>
        </div>
      )}
      {p.chordWindow === 0 && chords.length > 0 && <p class="hint warn">The chord window is set to off, so these chords will not trigger.</p>}
    </section>
  );
}
