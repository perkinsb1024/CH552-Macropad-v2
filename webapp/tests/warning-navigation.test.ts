import { afterEach, expect, it, vi } from 'vitest';
import { navigateToLayer, navigateToMacro, navigateToSlot } from '../src/ui/navigation';
import { selectedLayer, selectedSlot } from '../src/ui/store';
import type { Slot } from '../src/model/types';

afterEach(() => { vi.unstubAllGlobals(); selectedLayer.value = 0; selectedSlot.value = null; });

it.each([
  { kind: 'macro', layer: 0, index: 1, step: 2 },
  { kind: 'timed', layer: 0, index: 1, resume: false },
  { kind: 'timed', layer: 0, index: 1, resume: true },
  { kind: 'key', layer: 2, index: 3 },
  { kind: 'encoderButton', layer: 1 },
  { kind: 'chord', layer: 1, keyA: 0, keyB: 1 },
] satisfies Slot[])('reveals a $kind warning target after rendering, including repeated clicks', slot => {
  const outer = { open: false, parentElement: null };
  const inner = { open: false, parentElement: { closest: () => outer } };
  const target = {
    dataset: { slot: JSON.stringify(slot) }, closest: () => inner,
    focus: vi.fn(), scrollIntoView: vi.fn(() => { expect(inner.open && outer.open).toBe(true); }),
  };
  let frame: () => void = () => {};
  vi.stubGlobal('window', { requestAnimationFrame: (callback: () => void) => { frame = callback; } });
  vi.stubGlobal('document', { querySelectorAll: () => [target] });
  for (let click = 0; click < 2; click++) {
    outer.open = inner.open = false;
    navigateToSlot(slot);
    expect(selectedLayer.value).toBe(slot.layer);
    expect(selectedSlot.value).toEqual(slot);
    expect(outer.open).toBe(false);
    frame();
    expect(target.focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(target.scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' });
  }
});

it('scrolls to the device view for a layer warning without selecting a binding', () => {
  const target = { closest: () => null, focus: vi.fn(), scrollIntoView: vi.fn() };
  vi.stubGlobal('window', { requestAnimationFrame: (callback: () => void) => callback() });
  vi.stubGlobal('document', { querySelector: vi.fn(() => target) });
  navigateToLayer(2);
  expect(selectedLayer.value).toBe(2);
  expect(selectedSlot.value).toBeNull();
  expect(document.querySelector).toHaveBeenCalledWith('.card-device');
  expect(target.scrollIntoView).toHaveBeenCalledOnce();
});

it('reveals an unused macro even when it has no steps', () => {
  const details = { open: false, parentElement: null };
  const target = { closest: () => details, focus: vi.fn(), scrollIntoView: vi.fn() };
  vi.stubGlobal('window', { requestAnimationFrame: (callback: () => void) => callback() });
  vi.stubGlobal('document', { querySelector: vi.fn(() => target) });
  navigateToMacro(1);
  expect(document.querySelector).toHaveBeenCalledWith('[data-macro="1"]');
  expect(details.open).toBe(true);
  expect(target.scrollIntoView).toHaveBeenCalledOnce();
});
