import type { Slot } from '../model/types';
import { canInsertSlot, insertSlotAction, canSwapSlots, draggedMacro, draggedSlot, selectedSlot, slotDrop, swapSlotActions } from './store';
import { canApplyDraggedMacro, canApplyShortcut, dropPosition, draggedShortcut, endShortcutDrag, setRoundedDragImage, shortcutDragOver, shortcutDrop } from './drag';

export function bindingDrag(slot: Slot, insertion = false) {
  const same = (other: Slot | null) => other !== null && JSON.stringify(other) === JSON.stringify(slot);
  const invalid = draggedMacro.value !== null ? !canApplyDraggedMacro(slot) : draggedShortcut.value ? !canApplyShortcut(draggedShortcut.value, slot)
    : draggedSlot.value && !same(draggedSlot.value) && !canSwapSlots(draggedSlot.value, slot);
  const end = () => { draggedSlot.value = null; slotDrop.value = null; };
  return {
    draggable: true,
    class: `${slot.branch ? 'gesture-target' : 'timer-action'} ${same(selectedSlot.value) ? 'is-selected' : ''} ${same(draggedSlot.value) ? 'is-dragging' : ''} ${same(slotDrop.value?.slot ?? null) && slotDrop.value?.position === 'swap' ? 'is-drop-target' : ''} ${invalid ? 'drag-invalid' : ''}`,
    onDragStart: (event: DragEvent) => {
      const source = event.currentTarget as HTMLElement | null;
      setRoundedDragImage(event, slot.branch ? source?.querySelector<HTMLElement>('.gesture-drag-label') ?? null : source, !!slot.branch, slot.branch ? 15 : 0);
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
      const position = insertion && source?.kind === 'macro' && slot.kind === 'macro' && source.index === slot.index ? dropPosition(event, 'vertical') : 'swap';
      const valid = source && (position === 'swap' ? canSwapSlots(source, slot) : canInsertSlot(source, slot, position));
      slotDrop.value = valid ? { slot, position } : null;
      if (valid) event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'move' : 'none';
    },
    onDrop: (event: DragEvent) => {
      if (shortcutDrop(event, slot)) return;
      event.preventDefault();
      event.stopPropagation();
      const source = draggedSlot.value;
      const position = slotDrop.value?.position ?? 'swap';
      if (source) {
        if (position === 'swap') swapSlotActions(source, slot);
        else insertSlotAction(source, slot, position);
      }
      end();
    },
  };
}

