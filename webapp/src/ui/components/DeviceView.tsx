import { keyCount } from '../../model/constants';
import { paletteHex } from '../../model/palette';
import { summarize } from '../../model/actions';
import type { Slot } from '../../model/types';
import { actionProblem } from '../../model/validate';
import { canInsertSlot, canSwapSlots, draggedSlot, insertSlotAction, profile, selectedLayer, selectedSlot, slotDrop, swapSlotActions, type DropPosition } from '../store';
import { dropPosition, endShortcutDrag, setRoundedDragImage, shortcutDragOver, shortcutDrop } from '../drag';
import { IconRotate } from './Icons';
import { ActionLabel } from './ActionLabel';

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
  for (const c of p.chords) if (c.global || c.layer === li) { chordKeys.add(c.keyA); chordKeys.add(c.keyB); }

  const select = (slot: Slot) => { selectedSlot.value = slot; };
  const dragStart = (event: DragEvent, slot: Slot) => {
    setRoundedDragImage(event);
    endShortcutDrag();
    draggedSlot.value = slot;
    event.dataTransfer?.setData('application/x-macropad-slot', 'move');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  };
  const dragEnd = () => { draggedSlot.value = null; slotDrop.value = null; };
  const valid = (source: Slot, target: Slot, position: DropPosition) => position === 'swap'
    ? canSwapSlots(source, target)
    : canInsertSlot(source, target, position);
  const drop = (event: DragEvent, target: Slot, orientation: 'horizontal' | 'vertical') => {
    if (shortcutDrop(event, target)) return;
    event.preventDefault();
    const source = draggedSlot.value;
    const position = slotDrop.value && sameSlot(slotDrop.value.slot, target)
      ? slotDrop.value.position : dropPosition(event, orientation);
    if (source && valid(source, target, position)) {
      if (position === 'swap') swapSlotActions(source, target);
      else insertSlotAction(source, target, position);
    }
    dragEnd();
  };
  const dragOver = (event: DragEvent, target: Slot, orientation: 'horizontal' | 'vertical') => {
    if (shortcutDragOver(event, target)) return;
    const source = draggedSlot.value;
    const position = dropPosition(event, orientation);
    if (!source || !valid(source, target, position)) {
      slotDrop.value = null;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      return;
    }
    event.preventDefault();
    if (!slotDrop.value || !sameSlot(slotDrop.value.slot, target) || slotDrop.value.position !== position || slotDrop.value.rowBoundary) slotDrop.value = { slot: target, position };
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  };
  const gridGapTarget = (event: DragEvent): { slot: Slot; position: 'before' | 'after'; rowBoundary?: boolean } | null => {
    const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.keycap'));
    if (buttons.length === 6) {
      const topRow = buttons[0]!.getBoundingClientRect();
      const bottomRow = buttons[3]!.getBoundingClientRect();
      if (event.clientY > topRow.bottom && event.clientY < bottomRow.top) {
        return { slot: { kind: 'key', layer: li, index: 2 }, position: 'after', rowBoundary: true };
      }
    }
    let closest: { index: number; position: 'before' | 'after'; distance: number } | null = null;
    buttons.forEach((button, index) => {
      const rect = button.getBoundingClientRect();
      for (const position of ['before', 'after'] as const) {
        const x = position === 'before' ? rect.left : rect.right;
        const y = Math.max(rect.top, Math.min(event.clientY, rect.bottom));
        const distance = Math.hypot(event.clientX - x, event.clientY - y);
        if (!closest || distance < closest.distance) closest = { index, position, distance };
      }
    });
    if (!closest) return null;
    const { index, position } = closest as { index: number; position: 'before' | 'after' };
    return { slot: { kind: 'key', layer: li, index }, position };
  };
  const gridDragOver = (event: DragEvent) => {
    if ((event.target as HTMLElement).closest('.keycap')) return;
    const source = draggedSlot.value;
    const target = gridGapTarget(event);
    if (source && target && canInsertSlot(source, target.slot, target.position)) {
      event.preventDefault();
      slotDrop.value = target;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    } else slotDrop.value = null;
  };
  const gridDrop = (event: DragEvent) => {
    if ((event.target as HTMLElement).closest('.keycap')) return;
    event.preventDefault();
    const source = draggedSlot.value;
    const target = gridGapTarget(event);
    if (source && target) insertSlotAction(source, target.slot, target.position);
    dragEnd();
  };
  const encoderGapTarget = (event: DragEvent): { slot: Slot; position: 'before' | 'after' } | null => {
    const parts = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.enc-part'));
    let closest: { index: number; position: 'before' | 'after'; distance: number } | null = null;
    parts.forEach((part, index) => {
      const rect = part.getBoundingClientRect();
      for (const position of ['before', 'after'] as const) {
        const y = position === 'before' ? rect.top : rect.bottom;
        const x = Math.max(rect.left, Math.min(event.clientX, rect.right));
        const distance = Math.hypot(event.clientX - x, event.clientY - y);
        if (!closest || distance < closest.distance) closest = { index, position, distance };
      }
    });
    if (!closest) return null;
    const { index, position } = closest as { index: number; position: 'before' | 'after' };
    return { slot: { kind: (['clockwise', 'encoderButton', 'counterclockwise'] as const)[index]!, layer: li }, position };
  };
  const encoderGapDragOver = (event: DragEvent) => {
    if ((event.target as HTMLElement).closest('.enc-part')) return;
    const source = draggedSlot.value;
    const target = encoderGapTarget(event);
    if (source && target && canInsertSlot(source, target.slot, target.position)) {
      event.preventDefault();
      slotDrop.value = target;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    } else slotDrop.value = null;
  };
  const encoderGapDrop = (event: DragEvent) => {
    if ((event.target as HTMLElement).closest('.enc-part')) return;
    event.preventDefault();
    const source = draggedSlot.value;
    const target = encoderGapTarget(event);
    if (source && target) insertSlotAction(source, target.slot, target.position);
    dragEnd();
  };

  const KeyCap = ({ index }: { index: number }) => {
    const slot: Slot = { kind: 'key', layer: li, index };
    const action = layer.keys[index]!;
    const problem = actionProblem(action, { layerCount, rotation: false });
    const color = paletteHex(layer.leds[index]!);
    const off = layer.leds[index] === 15;
    const dragged = draggedSlot.value;
    const invalidDrop = !!dragged && !canSwapSlots(dragged, slot) && !canInsertSlot(dragged, slot, 'before') && !canInsertSlot(dragged, slot, 'after');
    const intent = slotDrop.value && sameSlot(slotDrop.value.slot, slot) ? slotDrop.value.position : null;
    return (
      <button
        class={`keycap ${sameSlot(selectedSlot.value, slot) ? 'is-selected' : ''} ${problem ? 'has-problem' : ''} ${sameSlot(dragged, slot) ? 'is-dragging' : ''} ${intent === 'swap' ? 'is-drop-target' : ''} ${intent === 'before' ? 'drop-before' : ''} ${intent === 'after' ? 'drop-after' : ''} ${invalidDrop ? 'drag-invalid' : ''}`}
        style={`--led:${color}; --led-glow:${off ? 'transparent' : color}`}
        onClick={() => select(slot)}
        draggable
        onDragStart={(event) => dragStart(event, slot)}
        onDragEnd={dragEnd}
        onDragOver={(event) => dragOver(event, slot, 'horizontal')}
        onDrop={(event) => drop(event, slot, 'horizontal')}
        aria-label={`Key ${index + 1}: ${summarize(action)}`}
      >
        <span class="keycap-led" aria-hidden="true" />
        <span class="keycap-index">{index + 1}</span>
        <span class="keycap-label"><ActionLabel action={action} /></span>
        {chordKeys.has(index) && <span class="keycap-chord" title="Part of a chord on this layer">chord</span>}
        {intent === 'before' || intent === 'after' ? <span class={`drop-line ${slotDrop.value?.rowBoundary ? 'drop-line-row' : `drop-line-${intent}`}`} aria-hidden="true" /> : null}
      </button>
    );
  };

  const EncoderPart = ({ slot, label, icon }: { slot: Slot; label: string; icon?: preact.ComponentChildren }) => {
    const action = slot.kind === 'encoderButton' ? layer.encoderButton : slot.kind === 'clockwise' ? layer.clockwise : layer.counterclockwise;
    const problem = actionProblem(action, { layerCount, rotation: slot.kind !== 'encoderButton' });
    const dragged = draggedSlot.value;
    const invalidDrop = !!dragged && !canSwapSlots(dragged, slot) && !canInsertSlot(dragged, slot, 'before') && !canInsertSlot(dragged, slot, 'after');
    const intent = slotDrop.value && sameSlot(slotDrop.value.slot, slot) ? slotDrop.value.position : null;
    return (
      <button class={`enc-part ${sameSlot(selectedSlot.value, slot) ? 'is-selected' : ''} ${problem ? 'has-problem' : ''} ${sameSlot(dragged, slot) ? 'is-dragging' : ''} ${intent === 'swap' ? 'is-drop-target' : ''} ${invalidDrop ? 'drag-invalid' : ''}`} onClick={() => select(slot)} draggable onDragStart={(event) => dragStart(event, slot)} onDragEnd={dragEnd} onDragOver={(event) => dragOver(event, slot, 'vertical')} onDrop={(event) => drop(event, slot, 'vertical')}>
        <span class="enc-part-label">{icon}{label}</span>
        <span class="enc-part-value"><ActionLabel action={action} /></span>
        {intent === 'before' || intent === 'after' ? <span class={`drop-line drop-line-${intent}`} aria-hidden="true" /> : null}
      </button>
    );
  };

  return (
    <div class={`device device-${keys}`}>
      <div class="device-body">
        <div class="keygrid" style={`--cols:${keys === 6 ? 3 : 3}`} onDragOver={gridDragOver} onDrop={gridDrop}>
          {Array.from({ length: keys }, (_, i) => <KeyCap key={i} index={i} />)}
        </div>
        <div class="encoder">
          <div class="knob" aria-hidden="true"><div class="knob-mark" /></div>
          <div class="enc-parts" onDragOver={encoderGapDragOver} onDrop={encoderGapDrop}>
            <EncoderPart slot={{ kind: 'clockwise', layer: li }} label="Turn left" icon={<IconRotate />} />
            <EncoderPart slot={{ kind: 'encoderButton', layer: li }} label="Press" />
            <EncoderPart slot={{ kind: 'counterclockwise', layer: li }} label="Turn right" icon={<IconRotate ccw />} />
          </div>
        </div>
      </div>
    </div>
  );
}
