import { signal } from '@preact/signals';
import type { Shortcut } from '../model/shortcuts';
import type { Slot } from '../model/types';
import { actionProblem } from '../model/validate';
import { draggedSlot, getAction, profile, selectedSlot, setAction, slotDrop, type DropPosition } from './store';

export const draggedShortcut = signal<Shortcut | null>(null);

/** Snapshot an isolated, clipped copy so Chrome cannot include the page behind rounded corners. */
export function setRoundedDragImage(event: DragEvent): void {
  const source = event.currentTarget as HTMLElement | null;
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
    Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    Math.max(0, Math.min(rect.height, event.clientY - rect.top)));
  // The browser captures after dragstart returns; keep the copy until the next task.
  setTimeout(() => preview.remove(), 0);
}

export function endShortcutDrag(): void {
  draggedShortcut.value = null;
  slotDrop.value = null;
}

export function startShortcutDrag(event: DragEvent, shortcut: Shortcut): void {
  setRoundedDragImage(event);
  draggedSlot.value = null;
  slotDrop.value = null;
  draggedShortcut.value = shortcut;
  event.dataTransfer?.setData('application/x-macropad-shortcut', shortcut.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
}

export function canApplyShortcut(shortcut: Shortcut, slot: Slot): boolean {
  const p = profile.value;
  return !!p && !!getAction(p, slot) && !actionProblem(shortcut.action, {
    layerCount: p.layers.length,
    macro: slot.kind === 'macro',
    macros: p.macros, macroCount: p.macros?.length ?? 0,
    rotation: slot.kind === 'timed' || slot.kind === 'clockwise' || slot.kind === 'counterclockwise',
  });
}

export function applyShortcut(shortcut: Shortcut, slot: Slot): void {
  if (!canApplyShortcut(shortcut, slot)) return;
  setAction(slot, { ...shortcut.action });
  selectedSlot.value = slot;
}

/** Presets replace the hovered binding, including at its edges. */
export function shortcutDragOver(event: DragEvent, slot: Slot): boolean {
  const shortcut = draggedShortcut.value;
  if (!shortcut) return false;
  event.stopPropagation();
  const valid = canApplyShortcut(shortcut, slot);
  slotDrop.value = valid ? { slot, position: 'swap' } : null;
  if (valid) event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'copy' : 'none';
  return true;
}

export function shortcutDrop(event: DragEvent, slot: Slot): boolean {
  const shortcut = draggedShortcut.value;
  if (!shortcut) return false;
  event.preventDefault();
  event.stopPropagation();
  applyShortcut(shortcut, slot);
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
