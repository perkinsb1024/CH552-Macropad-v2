import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultProfile } from '../src/model/defaults';
import { TimedActionsPanel } from '../src/ui/components/TimedActionsPanel';
import { DeviceView } from '../src/ui/components/DeviceView';
import { draggedMacro, draggedSlot, draggedTimer, moveTimer, profile, redo, selectedLayer, selectedSlot, slotDrop, timerDrop, undo } from '../src/ui/store';
import { endShortcutDrag, startTimerDrag } from '../src/ui/drag';

vi.mock('preact/hooks', () => ({ useMemo: (factory: () => unknown) => factory(), useState: (initial: unknown) => [initial, vi.fn()] }));
type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function event(y = 50) {
  return { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 1, clientY: y,
    dataTransfer: { dropEffect: 'none', effectAllowed: '', setData: vi.fn() },
    currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 100, left: 0, width: 100 }) } };
}
function invoke(node: Node, handler: string, e: unknown) {
  (node.props[handler] as (event: unknown) => void)(e);
}
beforeEach(() => {
  profile.value = defaultProfile(0);
  profile.value.timedActions = [1, 2, 3, 4].map(ticks => ({ ticks, layer: ticks % 2 ? 0 : undefined,
    resetOnInput: !!(ticks % 2), consumeInput: !!(ticks % 3),
    action: { type: 'keyTap', usage: ticks + 3, modifiers: 0 }, resumeAction: { type: 'consumer', usage: ticks } }));
  selectedSlot.value = null; selectedLayer.value = 0; draggedSlot.value = null;
  endShortcutDrag();
});
afterEach(() => { endShortcutDrag(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([
  [0, 2, 'swap', [2, 1, 0, 3]], [3, 0, 'before', [3, 0, 1, 2]],
  [0, 2, 'after', [1, 2, 0, 3]], [3, 1, 'after', [0, 1, 3, 2]],
  [0, 3, 'before', [1, 2, 0, 3]],
] as const)('moves complete timers from %i to %i (%s) and supports undo/redo', (source, target, position, order) => {
  const before = structuredClone(profile.value!);
  selectedSlot.value = { kind: 'timed', layer: 0, index: source, resume: true };
  moveTimer(source, target, position);
  expect(profile.value).toEqual({ ...before, timedActions: order.map(index => before.timedActions![index]) });
  expect(selectedSlot.value).toEqual({ kind: 'timed', layer: 0, index: (order as readonly number[]).indexOf(source), resume: true });
  const after = structuredClone(profile.value);
  undo(); expect(profile.value).toEqual(before);
  redo(); expect(profile.value).toEqual(after);
});

it.each([[50, 'swap'], [1, 'before'], [99, 'after']] as const)('drops a timer at y=%i to %s without swapping individual actions', (y, position) => {
  const before = structuredClone(profile.value!);
  draggedTimer.value = 3;
  const row = nodes(TimedActionsPanel()).find(node => node.props['data-timer'] === 1)!;
  const e = event(y);
  invoke(row, 'onDragOverCapture', e);
  expect(timerDrop.value).toEqual({ index: 1, position });
  expect(e.dataTransfer.dropEffect).toBe('move');
  expect(e.stopPropagation).toHaveBeenCalled();
  invoke(row, 'onDropCapture', e);
  const order = position === 'swap' ? [0, 3, 2, 1] : position === 'before' ? [0, 3, 1, 2] : [0, 1, 3, 2];
  expect(profile.value!.timedActions).toEqual(order.map(index => before.timedActions![index]));
  expect(draggedTimer.value).toBeNull(); expect(timerDrop.value).toBeNull();
});

it.each([[-5, [3, 0, 1, 2]], [46, [0, 3, 1, 2]], [250, [1, 2, 3, 0]]] as const)('inserts timers in outer and intermediate gaps at y=%i', (y, order) => {
  const before = structuredClone(profile.value!);
  draggedTimer.value = y === 250 ? 0 : 3;
  const list = nodes(TimedActionsPanel()).find(node => node.props.class === 'timer-list timed-list')!;
  const e = { ...event(y), target: { closest: () => null }, currentTarget: { querySelectorAll: () => [0, 1, 2, 3].map(index => ({ getBoundingClientRect: () => ({ top: index * 52, bottom: index * 52 + 40 }) })) } };
  invoke(list, 'onDragOver', e);
  expect(e.dataTransfer.dropEffect).toBe('move');
  invoke(list, 'onDrop', e);
  expect(profile.value!.timedActions).toEqual(order.map(index => before.timedActions![index]));
});

it('keeps an un-dragged selected firing action attached to its timer', () => {
  selectedSlot.value = { kind: 'timed', layer: 0, index: 1, resume: false };
  moveTimer(3, 0, 'before');
  expect(selectedSlot.value).toEqual({ kind: 'timed', layer: 0, index: 2, resume: false });
});

it('ignores self, adjacent insertion, and stale moves', () => {
  const before = structuredClone(profile.value);
  moveTimer(0, 0, 'swap'); moveTimer(0, 1, 'before'); moveTimer(2, 1, 'after'); moveTimer(99, 1, 'swap');
  expect(profile.value).toEqual(before);
});

it('does not assign timer headers to keys and clears cancelled drags', () => {
  const before = structuredClone(profile.value);
  const e = event();
  draggedMacro.value = 0;
  draggedSlot.value = { kind: 'key', layer: 0, index: 1 };
  startTimerDrag({ ...e, currentTarget: null } as unknown as DragEvent, 0);
  expect(e.dataTransfer.effectAllowed).toBe('move');
  expect(e.dataTransfer.setData).toHaveBeenCalledWith('application/x-macropad-timer', '0');
  expect(draggedSlot.value).toBeNull(); expect(draggedMacro.value).toBeNull();
  const key = nodes(DeviceView({})).find(node => node.props['data-slot'] === JSON.stringify({ kind: 'key', layer: 0, index: 0 }))!;
  invoke(key, 'onDragOver', e);
  expect(e.dataTransfer.dropEffect).toBe('none');
  invoke(key, 'onDrop', e);
  expect(profile.value).toEqual(before);
  endShortcutDrag();
  expect(draggedTimer.value).toBeNull(); expect(timerDrop.value).toBeNull(); expect(slotDrop.value).toBeNull();
});

it('previews only the timer label, excluding the delete button', () => {
  vi.useFakeTimers();
  const preview = { style: { setProperty: vi.fn() }, querySelectorAll: () => [], removeAttribute: vi.fn(), setAttribute: vi.fn(), remove: vi.fn() };
  const label = { getBoundingClientRect: () => ({ left: 20, top: 20, width: 80, height: 20 }), querySelectorAll: () => [], cloneNode: vi.fn(() => preview) };
  const header = { querySelector: vi.fn(() => label), cloneNode: vi.fn() };
  vi.stubGlobal('document', { body: { appendChild: vi.fn() } });
  vi.stubGlobal('getComputedStyle', () => Object.assign([], { borderRadius: '0px' }));
  const e = { ...event(), currentTarget: header, dataTransfer: { ...event().dataTransfer, setDragImage: vi.fn() } };
  startTimerDrag(e as unknown as DragEvent, 0);
  expect(header.querySelector).toHaveBeenCalledWith('.timer-drag-label');
  expect(label.cloneNode).toHaveBeenCalledWith(true); expect(header.cloneNode).not.toHaveBeenCalled();
  expect(e.dataTransfer.setDragImage).toHaveBeenCalledWith(preview, 0, 20);
  vi.runAllTimers(); expect(preview.remove).toHaveBeenCalled();
});
