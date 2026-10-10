import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultProfile } from '../src/model/defaults';
import type { Action, Slot } from '../src/model/types';
import { MacrosPanel } from '../src/ui/components/MacrosPanel';
import { DeviceView } from '../src/ui/components/DeviceView';
import { ChordPanel } from '../src/ui/components/ChordPanel';
import { timedBindingDrag } from '../src/ui/components/TimedActionsPanel';
import { draggedMacro, draggedSlot, getAction, macroDrop, moveMacro, profile, redo, selectedLayer, selectedSlot, slotDrop, undo } from '../src/ui/store';
import { canApplyDraggedMacro, endShortcutDrag, startMacroDrag } from '../src/ui/drag';

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
const call = (macro: number, repeats = 1): Action => ({ type: 'macro', macro, repeats });
beforeEach(() => {
  profile.value = defaultProfile(0);
  profile.value.macros = [4, 5, 6, 7].map(usage => ({ actions: [{ type: 'keyTap', usage, modifiers: 0 }] }));
  selectedSlot.value = null;
  selectedLayer.value = 0;
  draggedSlot.value = null;
  endShortcutDrag();
});
afterEach(endShortcutDrag);

it.each([
  [0, 2, 'swap', [2, 1, 0, 3]],
  [3, 0, 'before', [3, 0, 1, 2]],
  [0, 2, 'after', [1, 2, 0, 3]],
  [3, 1, 'after', [0, 1, 3, 2]],
  [0, 3, 'before', [1, 2, 0, 3]],
] as const)('remaps all invocation sites when moving %i to %i (%s)', (source, target, position, order) => {
  const p = profile.value!;
  for (const layer of p.layers) {
    layer.keys = layer.keys.map((_, index) => call(index % 4, index + 1));
    layer.encoderButton = call(0, 2);
    layer.clockwise = call(1, 3);
    layer.counterclockwise = call(2, 4);
  }
  p.chords = [{ layer: 0, keyA: 0, keyB: 1, action: call(3, 5) }];
  p.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: call(1, 6), resumeAction: call(3, 7) }];
  const before = structuredClone(p);
  selectedSlot.value = { kind: 'macro', layer: 0, index: source, step: 0 };
  moveMacro(source, target, position);
  const remap = (action: Action) => action.type === 'macro' ? { ...action, macro: (order as readonly number[]).indexOf(action.macro) } : action;
  expect(profile.value!.macros).toEqual(order.map(index => before.macros![index]));
  expect(profile.value!.layers).toEqual(before.layers.map(layer => ({ ...layer, keys: layer.keys.map(remap), encoderButton: remap(layer.encoderButton), clockwise: remap(layer.clockwise), counterclockwise: remap(layer.counterclockwise) })));
  expect(profile.value!.chords[0]!.action).toEqual(remap(before.chords[0]!.action));
  expect(profile.value!.timedActions![0]).toMatchObject({ action: remap(before.timedActions![0]!.action), resumeAction: remap(before.timedActions![0]!.resumeAction) });
  expect(selectedSlot.value).toMatchObject({ index: (order as readonly number[]).indexOf(source), step: 0 });
  const after = structuredClone(profile.value);
  undo(); expect(profile.value).toEqual(before);
  redo(); expect(profile.value).toEqual(after);
});

it.each([[50, 'swap'], [1, 'before'], [99, 'after']] as const)('drops on a macro at y=%i to %s without editing its steps', (y, position) => {
  draggedMacro.value = 3;
  const row = nodes(MacrosPanel()).find(node => node.props['data-macro'] === 1)!;
  const e = event(y);
  invoke(row, 'onDragOverCapture', e);
  expect(macroDrop.value).toEqual({ index: 1, position });
  expect(e.dataTransfer.dropEffect).toBe('move');
  expect(e.stopPropagation).toHaveBeenCalled();
  invoke(row, 'onDropCapture', e);
  const expected = position === 'swap' ? [4, 7, 6, 5] : position === 'before' ? [4, 7, 5, 6] : [4, 5, 7, 6];
  expect(profile.value!.macros!.map(macro => macro.actions[0])).toEqual(expected.map(usage => ({ type: 'keyTap', usage, modifiers: 0 })));
  expect(draggedMacro.value).toBeNull();
  expect(macroDrop.value).toBeNull();
});

it.each([[-5, [7, 4, 5, 6]], [46, [4, 7, 5, 6]], [250, [5, 6, 7, 4]]] as const)('inserts macros in outer and intermediate gaps at y=%i', (y, expected) => {
  draggedMacro.value = y === 250 ? 0 : 3;
  const list = nodes(MacrosPanel()).find(node => node.props.class === 'timer-list macro-list')!;
  const e = { ...event(y), target: { closest: () => null }, currentTarget: { querySelectorAll: () => [0, 1, 2, 3].map(index => ({ getBoundingClientRect: () => ({ top: index * 52, bottom: index * 52 + 40 }) })) } };
  invoke(list, 'onDragOver', e);
  expect(e.dataTransfer.dropEffect).toBe('move');
  invoke(list, 'onDrop', e);
  expect(profile.value!.macros!.map(macro => macro.actions[0])).toEqual(expected.map(usage => ({ type: 'keyTap', usage, modifiers: 0 })));
});

const slots: Slot[] = [
  { kind: 'key', layer: 0, index: 0 }, { kind: 'encoderButton', layer: 0 },
  { kind: 'clockwise', layer: 0 }, { kind: 'counterclockwise', layer: 0 },
  { kind: 'chord', layer: 0, keyA: 0, keyB: 1, global: true },
  { kind: 'timed', layer: 0, index: 0, resume: false }, { kind: 'timed', layer: 0, index: 0, resume: true },
];
it.each(slots)('assigns a macro through the $kind drop handler with one run and supports undo', slot => {
  const p = profile.value!;
  p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: true, action: { type: 'none' } }];
  p.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: { type: 'none' }, resumeAction: { type: 'none' } }];
  p.macros![2]!.actions.push({ type: 'setLayer', layer: 0 });
  const before = structuredClone(p);
  const e = event();
  startMacroDrag({ ...e, currentTarget: null } as unknown as DragEvent, 2);
  expect(e.dataTransfer.effectAllowed).toBe('copyMove');
  const tree = slot.kind === 'chord' ? ChordPanel() : DeviceView({});
  const binding: Node = slot.kind === 'timed' ? { type: 'button', props: timedBindingDrag(slot) }
    : nodes(tree).find(node => node.props['data-slot'] === JSON.stringify(slot))!;
  expect(binding).toBeDefined();
  invoke(binding, 'onDragOver', e);
  expect(slotDrop.value).toEqual({ slot, position: 'swap' });
  expect(e.dataTransfer.dropEffect).toBe('copy');
  invoke(binding, 'onDrop', e);
  expect(getAction(profile.value!, slot)).toEqual(call(2));
  expect(profile.value!.macros).toEqual(before.macros);
  expect(profile.value!.layers[0]!.leds).toEqual(before.layers[0]!.leds);
  expect(selectedSlot.value).toEqual(slot);
  expect(draggedMacro.value).toBeNull();
  undo(); expect(profile.value).toEqual(before);
});

it('rejects stale invocations and nested macro steps, and clears a cancelled drag', () => {
  draggedMacro.value = 99;
  expect(canApplyDraggedMacro({ kind: 'key', layer: 0, index: 0 })).toBe(false);
  draggedMacro.value = 0;
  expect(canApplyDraggedMacro({ kind: 'key', layer: 99, index: 0 })).toBe(false);
  expect(canApplyDraggedMacro({ kind: 'macro', layer: 0, index: 1, step: 0 })).toBe(false);
  macroDrop.value = { index: 1, position: 'swap' };
  endShortcutDrag();
  expect(draggedMacro.value).toBeNull();
  expect(macroDrop.value).toBeNull();
});

it('leaves self, adjacent insertion, and stale moves unchanged', () => {
  const before = structuredClone(profile.value);
  moveMacro(0, 0, 'swap');
  moveMacro(0, 1, 'before');
  moveMacro(2, 1, 'after');
  moveMacro(99, 1, 'swap');
  expect(profile.value).toEqual(before);
});

it('uses only the macro label for the drag preview, excluding the header delete button', () => {
  vi.useFakeTimers();
  try {
    const preview = { style: { setProperty: vi.fn() }, querySelectorAll: () => [], removeAttribute: vi.fn(), setAttribute: vi.fn(), remove: vi.fn() };
    const label = { getBoundingClientRect: () => ({ left: 20, top: 20, width: 80, height: 20 }),
      querySelectorAll: () => [], cloneNode: vi.fn(() => preview) };
    const header = { querySelector: vi.fn(() => label), cloneNode: vi.fn() };
    const appendChild = vi.fn();
    vi.stubGlobal('document', { body: { appendChild } });
    vi.stubGlobal('getComputedStyle', () => Object.assign([], { borderRadius: '0px' }));
    const e = { ...event(), currentTarget: header, dataTransfer: { ...event().dataTransfer, setDragImage: vi.fn() } };
    startMacroDrag(e as unknown as DragEvent, 0);
    expect(header.querySelector).toHaveBeenCalledWith('.macro-drag-label');
    expect(label.cloneNode).toHaveBeenCalledWith(true);
    expect(header.cloneNode).not.toHaveBeenCalled();
    expect(appendChild).toHaveBeenCalledWith(preview);
    expect(preview.style).toMatchObject({ width: '80px', height: '20px' });
    expect(e.dataTransfer.setDragImage).toHaveBeenCalledWith(preview, 0, 20);
    vi.runAllTimers();
    expect(preview.remove).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
