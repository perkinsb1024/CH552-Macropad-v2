import type { Slot } from '../model/types';
import { selectedLayer, selectedSlot } from './store';

function revealTarget(find: () => HTMLElement | null): void {
  if (typeof window === 'undefined') return;
  // Wait for the selected layer and binding to render before finding the control.
  window.requestAnimationFrame(() => {
    const target = find();
    if (!target) return;
    let section = target.closest('details');
    while (section) {
      section.open = true;
      section = section.parentElement?.closest('details') ?? null;
    }
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

export function navigateToSlot(slot: Slot): void {
  selectedLayer.value = slot.layer;
  selectedSlot.value = slot;
  revealTarget(() => Array.from(document.querySelectorAll<HTMLElement>('[data-slot]'))
    .find(element => element.dataset.slot === JSON.stringify(slot)) ?? null);
}

export function navigateToLayer(layer: number): void {
  selectedLayer.value = layer;
  selectedSlot.value = null;
  revealTarget(() => document.querySelector<HTMLElement>('.card-device'));
}
