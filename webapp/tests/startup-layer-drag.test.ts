import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultProfile } from '../src/model/defaults';
import { LayerTabs } from '../src/ui/components/LayerTabs';
import { draggedLayer, layerDrop, profile, redo, selectedLayer, selectedSlot, undo } from '../src/ui/store';

vi.mock('preact/hooks', () => ({ useRef: (current: unknown) => ({ current }), useState: (value: unknown) => [value, vi.fn()], useEffect: vi.fn() }));

type Node = { props: Record<string, any> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function event(x = 50) {
  return {
    preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: x, clientY: 20,
    dataTransfer: { setData: vi.fn(), effectAllowed: '', dropEffect: 'none' },
    currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 40 }) },
  };
}
beforeEach(() => {
  profile.value = defaultProfile(0);
  selectedLayer.value = 0;
  selectedSlot.value = { kind: 'key', layer: 0, index: 0 };
  draggedLayer.value = null;
  layerDrop.value = null;
});
afterEach(() => {
  profile.value = null;
  selectedSlot.value = null;
  draggedLayer.value = null;
  layerDrop.value = null;
});

it.each([1, 50, 99])('moves startup at tab x=%i without reordering or selecting layers, and supports undo/redo', x => {
  const before = structuredClone(profile.value!);
  const tree = nodes(LayerTabs());
  const badge = tree.find(node => node.props.class === 'tab-badge')!;
  const tabs = tree.filter(node => node.props.role === 'tab');
  const destination = before.startupLayer === 0 ? 1 : 0;
  const start = event();
  badge.props.onDragStart(start);
  expect(start.stopPropagation).toHaveBeenCalled();
  expect(start.dataTransfer.setData).toHaveBeenCalledWith('application/x-macropad-startup-layer', 'move');
  expect(draggedLayer.value).toBeNull();
  const drop = event(x);
  tabs[destination]!.props.onDragOver(drop);
  expect(layerDrop.value).toEqual({ index: destination, position: 'swap' });
  expect(drop.preventDefault).toHaveBeenCalled();
  tabs[destination]!.props.onDrop(drop);
  expect(profile.value).toEqual({ ...before, startupLayer: destination });
  expect(selectedLayer.value).toBe(0);
  expect(selectedSlot.value).toEqual({ kind: 'key', layer: 0, index: 0 });
  expect(layerDrop.value).toBeNull();
  expect(draggedLayer.value).toBeNull();
  undo();
  expect(profile.value).toEqual(before);
  redo();
  expect(profile.value!.startupLayer).toBe(destination);
});

it('cancels a startup drag without changing the profile or leaving drop feedback', () => {
  const before = structuredClone(profile.value);
  const tree = nodes(LayerTabs());
  const badge = tree.find(node => node.props.class === 'tab-badge')!;
  const tab = tree.find(node => node.props.role === 'tab')!;
  badge.props.onDragStart(event());
  tab.props.onDragOver(event());
  const end = event();
  badge.props.onDragEnd(end);
  expect(end.stopPropagation).toHaveBeenCalled();
  expect(profile.value).toEqual(before);
  expect(layerDrop.value).toBeNull();
  const hover = event();
  tab.props.onDragOver(hover);
  expect(hover.preventDefault).not.toHaveBeenCalled();
});
