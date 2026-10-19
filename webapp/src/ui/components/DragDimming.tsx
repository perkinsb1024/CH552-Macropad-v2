import { useLayoutEffect, useRef } from 'preact/hooks';
import type { Slot } from '../../model/types';
import { canDropDraggedAction, draggedShortcut } from '../drag';
import { draggedMacro, draggedSlot, draggedTimer, profile, selectedLayer, selectedSlot } from '../store';

/** Copy the target above the shade; the original keeps its drag handlers. */
function brightCopy(source: HTMLElement): HTMLElement {
  const copy = source.cloneNode(true) as HTMLElement;
  const originals = [source, ...source.querySelectorAll<HTMLElement>('*')];
  const copies = [copy, ...copy.querySelectorAll<HTMLElement>('*')];
  originals.forEach((original, index) => {
    const target = copies[index]!;
    const style = getComputedStyle(original);
    for (const property of style) target.style.setProperty(property, style.getPropertyValue(property));
    for (const attribute of ['id', 'data-slot', 'data-macro', 'data-timer', 'data-clipboard-target', 'draggable']) target.removeAttribute(attribute);
    target.style.pointerEvents = 'none';
  });
  Object.assign(copy.style, {
    position: 'absolute', margin: '0', transform: 'none', transition: 'none',
    minWidth: '0', minHeight: '0', maxWidth: 'none', maxHeight: 'none', zIndex: 'auto',
  });
  return copy;
}

export function DragDimming() {
  const overlay = useRef<HTMLDivElement>(null);
  const slot = draggedSlot.value;
  const shortcut = draggedShortcut.value;
  const macro = draggedMacro.value;
  const timer = draggedTimer.value;
  const p = profile.value;
  const layer = selectedLayer.value;
  const selection = selectedSlot.value;
  const active = !!slot || !!shortcut || macro !== null || timer !== null;

  useLayoutEffect(() => {
    const root = overlay.current;
    if (!active || !root) return;
    let frame = 0;
    const definitionSelector = macro !== null ? '[data-macro]' : timer !== null ? '[data-timer]' : null;
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-slot], [data-macro], [data-timer]')).filter(element => {
      if (element.closest('[aria-hidden="true"]')) return false;
      // Definition rows intercept drops before their nested action buttons.
      const definition = definitionSelector && element.closest(definitionSelector);
      if (definition) return element === definition && Number(macro !== null ? element.dataset.macro : element.dataset.timer) !== (macro ?? timer);
      return !!element.dataset.slot && canDropDraggedAction(JSON.parse(element.dataset.slot) as Slot);
    });
    const copies = new Map<HTMLElement, { wrapper: HTMLDivElement; signature: string }>();
    const update = () => {
      const indicators = Array.from(document.querySelectorAll<HTMLElement>('.drop-line')).filter(element => !root.contains(element) && !element.closest('[aria-hidden="true"]:not(.drop-line)'));
      // An insertion line inside a bright target is already included in its copy.
      const visible = [...targets, ...indicators.filter(element => !targets.some(target => target.contains(element)))];
      for (const [source, { wrapper }] of copies) {
        if (!visible.includes(source)) { wrapper.remove(); copies.delete(source); }
      }
      for (const source of visible) {
        let entry = copies.get(source);
        if (!entry) {
          const wrapper = document.createElement('div');
          Object.assign(wrapper.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
          root.appendChild(wrapper);
          entry = { wrapper, signature: '' };
          copies.set(source, entry);
        }
        const rect = source.getBoundingClientRect();
        // CSS transitions keep changing after a class is removed. Refresh until
        // they settle rather than freezing an intermediate highlight in a copy.
        const style = getComputedStyle(source);
        const appearance = [style.boxShadow, style.backgroundColor, style.outlineColor,
          style.outlineWidth, style.outlineOffset, style.borderColor, style.opacity];
        const signature = `${source.outerHTML}|${source.parentElement?.className}|${rect.width}|${rect.height}|${appearance.join('|')}`;
        if (signature !== entry.signature) {
          entry.wrapper.replaceChildren(brightCopy(source));
          entry.signature = signature;
        }
        const copy = entry.wrapper.firstElementChild as HTMLElement;
        Object.assign(copy.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        entry.wrapper.style.display = source.getClientRects().length ? '' : 'none';
        // Clip only at scrolling boundaries; the glow fades beyond the target.
        let left = 0, top = 0, right = window.innerWidth, bottom = window.innerHeight;
        for (let parent = source.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          const bounds = parent.getBoundingClientRect();
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
            left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
          }
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
          }
        }
        entry.wrapper.style.clipPath = `inset(${top}px ${Math.max(0, window.innerWidth - right)}px ${Math.max(0, window.innerHeight - bottom)}px ${left}px)`;
      }
      frame = requestAnimationFrame(update);
    };
    update();
    return () => { cancelAnimationFrame(frame); root.replaceChildren(); };
  }, [active, slot, shortcut, macro, timer, p, layer, selection]);

  return active ? <div class="drag-dimming" ref={overlay} aria-hidden="true" inert /> : null;
}
