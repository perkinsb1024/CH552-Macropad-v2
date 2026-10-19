import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultProfile } from '../src/model/defaults';
import type { Slot } from '../src/model/types';
import { DeviceView } from '../src/ui/components/DeviceView';
import { installDropIndicatorCleanup } from '../src/ui/drag';
import { canInsertSlot, insertSlotAction, draggedSlot, layerDrop, macroDrop, profile, selectedLayer, selectedSlot, slotDrop, timerDrop } from '../src/ui/store';

type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function encoder(kind: Slot['kind']) {
  return nodes(DeviceView()).find(node => {
    const slot = node.props['data-slot'];
    return typeof slot === 'string' && JSON.parse(slot).kind === kind;
  })!;
}
function hover(node: Node, y: number) {
  const event = {
    preventDefault: vi.fn(), clientX: 50, clientY: y,
    dataTransfer: { dropEffect: 'none' },
    currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
  };
  (node.props.onDragOver as (event: unknown) => void)(event);
  return event;
}

beforeEach(() => {
  profile.value = defaultProfile(0);
  selectedLayer.value = 0;
  selectedSlot.value = null;
  draggedSlot.value = null;
  slotDrop.value = null;
});
afterEach(() => { draggedSlot.value = null; slotDrop.value = null; macroDrop.value = null; timerDrop.value = null; layerDrop.value = null; });

it.each(['clockwise', 'encoderButton', 'counterclockwise'] as const)('swaps at every part of %s without moving the third action', target => {
  for (const y of [1, 50, 99]) {
    const layer = profile.value!.layers[0]!;
    layer.clockwise = { type: 'keyTap', usage: 4, modifiers: 0 };
    layer.encoderButton = { type: 'keyTap', usage: 5, modifiers: 0 };
    layer.counterclockwise = { type: 'keyTap', usage: 6, modifiers: 0 };
    const source = target === 'clockwise' ? 'counterclockwise' : 'clockwise';
    const third = (['clockwise', 'encoderButton', 'counterclockwise'] as const).find(kind => kind !== source && kind !== target)!;
    const before = structuredClone(layer);
    draggedSlot.value = { kind: source, layer: 0 };
    const button = encoder(target);
    const event = hover(button, y);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(slotDrop.value).toEqual({ slot: { kind: target, layer: 0 }, position: 'swap' });
    (button.props.onDrop as (event: unknown) => void)(event);
    expect(profile.value!.layers[0]![target]).toEqual(before[source]);
    expect(profile.value!.layers[0]![source]).toEqual(before[target]);
    expect(profile.value!.layers[0]![third]).toEqual(before[third]);
  }
});

it('does not accept drops in the encoder gaps', () => {
  const list = nodes(DeviceView()).find(node => node.props.class === 'enc-parts')!;
  expect(list.props.onDragOver).toBeUndefined();
  expect(list.props.onDrop).toBeUndefined();
});

it('rejects encoder insertion operations without changing any assignments', () => {
  const before = structuredClone(profile.value);
  for (const source of ['clockwise', 'encoderButton', 'counterclockwise'] as const) {
    for (const target of ['clockwise', 'encoderButton', 'counterclockwise'] as const) {
      for (const position of ['before', 'after'] as const) {
        const from = { kind: source, layer: 0 };
        const to = { kind: target, layer: 0 };
        expect(canInsertSlot(from, to, position)).toBe(false);
        insertSlotAction(from, to, position);
      }
    }
  }
  expect(profile.value).toEqual(before);
});

it('clears indicators over unhandled areas and on leaving the window, retaining accepted drops', () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const view = {
    innerWidth: 1000, innerHeight: 800,
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const cleanup = installDropIndicatorCleanup(view as unknown as Window);
  const pending = { slot: { kind: 'clockwise', layer: 0 } as Slot, position: 'swap' as const };
  slotDrop.value = pending;
  listeners.get('dragover')!({ defaultPrevented: true });
  expect(slotDrop.value).toEqual(pending);
  listeners.get('dragover')!({ defaultPrevented: false });
  expect(slotDrop.value).toBeNull();
  slotDrop.value = pending;
  listeners.get('dragleave')!({ clientX: 500, clientY: 400 });
  expect(slotDrop.value).toEqual(pending);
  listeners.get('dragleave')!({ clientX: 0, clientY: 400 });
  expect(slotDrop.value).toBeNull();
  cleanup();
  expect(listeners.size).toBe(0);
});
