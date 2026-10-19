import { signal } from '@preact/signals';
import type { Shortcut } from '../model/shortcuts';
import type { Action, Slot } from '../model/types';
import { actionProblem } from '../model/validate';
import { draggedTimer, timerDrop, draggedMacro, macroDrop, draggedSlot, getAction, profile, selectedSlot, setAction, slotDrop, type DropPosition } from './store';

export const draggedShortcut = signal<Shortcut | null>(null);

/** Snapshot an isolated, clipped copy so Chrome cannot include the page behind rounded corners. */
export function setRoundedDragImage(event: DragEvent, source = event.currentTarget as HTMLElement | null, centered = false, liftPx = 0): void {
  if (!source || !event.dataTransfer) return;
  const rect = source.getBoundingClientRect();
  const preview = source.cloneNode(true) as HTMLElement;
  const originals = [source, ...source.querySelectorAll<HTMLElement>('*')];
  const copies = [preview, ...preview.querySelectorAll<HTMLElement>('*')];
  // Preserve inherited colors, custom properties, and layout outside the source's parent.
  originals.forEach((original, index) => {
    const copy = copies[index]!;
    const style = getComputedStyle(original);
    for (const property of style) copy.style.setProperty(property, style.getPropertyValue(property));
    copy.removeAttribute('id');
  });
  const radius = getComputedStyle(source).borderRadius;
  Object.assign(preview.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    transform: 'none',
    opacity: '1',
    boxShadow: 'none',
    // Explicitly clip the snapshot; border-radius alone leaves a rectangular backplate in Chrome.
    clipPath: `inset(0 round ${radius})`,
    pointerEvents: 'none',
  });
  preview.setAttribute('aria-hidden', 'true');
  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(preview,
    centered ? rect.width / 2 : Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    (centered ? rect.height / 2 : Math.max(0, Math.min(rect.height, event.clientY - rect.top))) + liftPx);
  // The browser captures after dragstart returns; keep the copy until the next task.
  setTimeout(() => preview.remove(), 0);
}

export function endShortcutDrag(): void {
  draggedShortcut.value = null;
  draggedTimer.value = null;
  timerDrop.value = null;
  draggedMacro.value = null;
  macroDrop.value = null;
  slotDrop.value = null;
}

export function startShortcutDrag(event: DragEvent, shortcut: Shortcut): void {
  setRoundedDragImage(event);
  endShortcutDrag();
  draggedSlot.value = null;
  slotDrop.value = null;
  draggedShortcut.value = shortcut;
  event.dataTransfer?.setData('application/x-macropad-shortcut', shortcut.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
}

/** A macro can be moved among definitions or copied to an invocation binding. */
export function startMacroDrag(event: DragEvent, index: number): void {
  const label = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('.macro-drag-label');
  setRoundedDragImage(event, label ?? null);
  endShortcutDrag();
  draggedSlot.value = null;
  draggedMacro.value = index;
  event.dataTransfer?.setData('application/x-macropad-macro', String(index));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove';
}

/** Timer headers move definitions; individual action buttons move bindings. */
export function startTimerDrag(event: DragEvent, index: number): void {
  const label = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('.timer-drag-label');
  setRoundedDragImage(event, label ?? null);
  endShortcutDrag();
  draggedSlot.value = null;
  draggedTimer.value = index;
  event.dataTransfer?.setData('application/x-macropad-timer', String(index));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function draggedAssignment(): Action | null {
  if (draggedMacro.value !== null) return { type: 'macro', macro: draggedMacro.value, repeats: 1 };
  return draggedShortcut.value?.action ?? null;
}

function canApplyAction(action: Action, slot: Slot): boolean {
  const p = profile.value;
  return !!p && !!getAction(p, slot) && !actionProblem(action, {
    layerCount: p.layers.length, branch: slot.branch,
    macro: slot.kind === 'macro', timed: slot.kind === 'timed',
    macros: p.macros, macroCount: p.macros?.length ?? 0,
    rotation: slot.kind === 'timed' || slot.kind === 'clockwise' || slot.kind === 'counterclockwise',
  });
}

export function canApplyShortcut(shortcut: Shortcut, slot: Slot): boolean {
  return canApplyAction(shortcut.action, slot);
}

export function canApplyDraggedMacro(slot: Slot): boolean {
  const action = draggedMacro.value !== null ? draggedAssignment() : null;
  return !!action && canApplyAction(action, slot);
}

export function applyShortcut(shortcut: Shortcut, slot: Slot): void {
  if (!canApplyShortcut(shortcut, slot)) return;
  setAction(slot, { ...shortcut.action });
  selectedSlot.value = slot;
}

/** Presets and macro invocations replace the hovered binding, including at its edges. */
export function shortcutDragOver(event: DragEvent, slot: Slot): boolean {
  const action = draggedAssignment();
  if (!action) return false;
  event.stopPropagation();
  const valid = canApplyAction(action, slot);
  macroDrop.value = null;
  slotDrop.value = valid ? { slot, position: 'swap' } : null;
  if (valid) event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'copy' : 'none';
  return true;
}

export function shortcutDrop(event: DragEvent, slot: Slot): boolean {
  const action = draggedAssignment();
  if (!action) return false;
  event.preventDefault();
  event.stopPropagation();
  if (canApplyAction(action, slot)) {
    setAction(slot, { ...action });
    selectedSlot.value = slot;
  }
  endShortcutDrag();
  return true;
}

/** Edges insert; the center swaps. */
export function dropPosition(event: DragEvent, orientation: 'horizontal' | 'vertical'): DropPosition {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const fraction = orientation === 'horizontal'
    ? (event.clientX - rect.left) / rect.width
    : (event.clientY - rect.top) / rect.height;
  if (fraction < 0.25) return 'before';
  if (fraction > 0.75) return 'after';
  return 'swap';
}
