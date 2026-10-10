import { afterEach, expect, it, vi } from 'vitest';
import { Inspector } from '../src/ui/components/Inspector';
import { defaultProfile } from '../src/model/defaults';
import { profile, selectedSlot, setAction, getAction } from '../src/ui/store';
import type { Slot } from '../src/model/types';

vi.mock('preact/hooks', () => ({
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: () => ({ current: null }),
  useEffect: vi.fn(),
}));
type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const n = value as Node; return [n, ...nodes(n.props.children)];
}
afterEach(() => vi.unstubAllGlobals());

it.each(['key', 'clockwise', 'timed', 'macro'] as const)('edits both axes with appropriate hold controls on %s', kind => {
  profile.value = defaultProfile(0);
  profile.value.macros = [{ actions: [{ type: 'mouseXY', x: -4, y: 60 }] }];
  profile.value.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: { type: 'mouseXY', x: -4, y: 60 }, resumeAction: { type: 'none' } }];
  const slot = (kind === 'key' ? { kind, layer: 0, index: 0 } : kind === 'timed' ? { kind, layer: 0, index: 0, resume: false } : kind === 'macro' ? { kind, layer: 0, index: 0, step: 0 } : { kind, layer: 0 }) as Slot;
  selectedSlot.value = slot; setAction(slot, { type: 'mouseXY', x: -4, y: 60 });
  let tree = nodes(Inspector());
  expect(tree.find(n => n.type === 'option' && n.props.value === 'mouseXY')?.props.disabled).toBeFalsy();
  expect(tree.some(n => n.props['aria-label'] === 'Movement behavior')).toBe(kind === 'key');
  const component = tree.find(n => typeof n.type === 'function' && n.type.name === 'DirectionalStep' && n.props.label === 'Horizontal move')!;
  const controls = nodes((component.type as (p: unknown) => unknown)(component.props));
  const slider = controls.find(n => n.type === 'input')!;
  expect([slider.props.min, slider.props.max, slider.props.step, slider.props.value]).toEqual([0, 60, 4, 4]);
  (slider.props.onInput as (e: unknown) => void)({ target: { value: '8' } });
  expect(getAction(profile.value, slot)).toEqual({ type: 'mouseXY', x: -8, y: 60 });
  tree = nodes(Inspector());
  const horizontal = tree.find(n => typeof n.type === 'function' && n.type.name === 'DirectionalStep' && n.props.label === 'Horizontal move')!;
  const right = nodes((horizontal.type as (p: unknown) => unknown)(horizontal.props)).find(n => n.type === 'button' && n.props.children === 'Right')!;
  (right.props.onClick as () => void)();
  expect(getAction(profile.value, slot)).toEqual({ type: 'mouseXY', x: 8, y: 60 });
  if (kind === 'key') {
    const hold = nodes(Inspector()).find(n => n.type === 'button' && n.props.children === 'Hold')!;
    (hold.props.onClick as () => void)();
    expect(getAction(profile.value, slot)).toEqual({ type: 'mouseXY', x: 8, y: 60, hold: true });
  }
});
