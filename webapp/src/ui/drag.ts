import type { DropPosition } from './store';

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
