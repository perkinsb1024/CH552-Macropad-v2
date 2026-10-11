import { afterEach, expect, it, vi } from 'vitest';
import { Inspector } from '../src/ui/components/Inspector';
import { defaultProfile } from '../src/model/defaults';
import { profile, selectedSlot, setAction, getAction } from '../src/ui/store';
import type { Action, Slot } from '../src/model/types';

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
  expect(tree.find(n => n.type === 'option' && n.props.value === 'mouseX')?.props.disabled).toBeFalsy();
  expect(tree.filter(n => n.type === 'option' && ['mouseX', 'mouseY', 'mouseXY'].includes(n.props.value as string))).toHaveLength(1);
  expect(tree.find(n => n.type === 'select')!.props.value).toBe('mouseX');
  expect(tree.some(n => n.props['aria-label'] === 'Behavior')).toBe(kind === 'key');
  const component = tree.find(n => typeof n.type === 'function' && n.type.name === 'DirectionalStep' && n.props.label === 'Horizontal amount')!;
  const controls = nodes((component.type as (p: unknown) => unknown)(component.props));
  const slider = controls.find(n => n.type === 'input')!;
  expect([slider.props.min, slider.props.max, slider.props.step, slider.props.value]).toEqual([0, 60, 4, 4]);
  (slider.props.onInput as (e: unknown) => void)({ target: { value: '8' } });
  expect(getAction(profile.value, slot)).toEqual({ type: 'mouseXY', x: -8, y: 60 });
  tree = nodes(Inspector());
  const horizontal = tree.find(n => typeof n.type === 'function' && n.type.name === 'DirectionalStep' && n.props.label === 'Horizontal amount')!;
  const right = nodes((horizontal.type as (p: unknown) => unknown)(horizontal.props)).find(n => n.type === 'button' && n.props.children === 'Right')!;
  (right.props.onClick as () => void)();
  expect(getAction(profile.value, slot)).toEqual({ type: 'mouseXY', x: 8, y: 60 });
  if (kind === 'key') {
    const hold = nodes(Inspector()).find(n => n.type === 'button' && n.props.children === 'Hold')!;
    (hold.props.onClick as () => void)();
    expect(getAction(profile.value, slot)).toEqual({ type: 'mouseXY', x: 8, y: 60, hold: true });
  }
});

it.each([
  { type: 'mouseX', delta: -17, hold: true },
  { type: 'mouseY', delta: 23 },
  { type: 'mouseXY', x: -8, y: 12 },
] satisfies Action[])('shows saved $type actions under Move mouse with the correct axis controls', action => {
  profile.value = defaultProfile(0);
  const slot: Slot = { kind: 'key', layer: 0, index: 0 };
  selectedSlot.value = slot;
  setAction(slot, action);
  const tree = nodes(Inspector());
  expect(tree.find(n => n.type === 'option' && n.props.value === 'mouseX')!.props.children).toContain('Move mouse');
  const axis = tree.find(n => n.props['aria-label'] === 'Axis')!;
  expect(nodes(axis).filter(n => n.type === 'button').map(n => [n.props.children, n.props['aria-pressed']])).toEqual([
    ['X', action.type === 'mouseX'], ['Y', action.type === 'mouseY'], ['Both', action.type === 'mouseXY'],
  ]);
  if (action.type !== 'mouseXY') {
    const component = tree.find(n => typeof n.type === 'function' && n.type.name === 'DirectionalStep')!;
    const controls = nodes((component.type as (p: unknown) => unknown)(component.props));
    const direction = controls.findIndex(n => n.props['aria-label'] === 'Direction');
    const slider = controls.findIndex(n => n.type === 'input');
    expect(direction).toBeLessThan(slider);
    expect(controls[slider]!.props['aria-label']).toBe('Amount');
    expect(controls[slider]!.props.value).toBe(Math.abs(action.delta));
    expect(controls.filter(n => n.type === 'button').map(n => n.props.children)).toEqual(action.type === 'mouseX' ? ['Left', 'Right'] : ['Up', 'Down']);
    (controls[slider]!.props.onInput as (e: unknown) => void)({ target: { value: '31' } });
    expect(getAction(profile.value, slot)).toEqual({ ...action, delta: action.delta < 0 ? -31 : 31 });
  } else {
    expect(tree.filter(n => typeof n.type === 'function' && n.type.name === 'DirectionalStep')).toHaveLength(2);
  }
});

it('keeps movement settings when changing axes and restores each axis when revisited', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  profile.value = defaultProfile(0);
  const slot: Slot = { kind: 'key', layer: 0, index: 0 };
  selectedSlot.value = slot;
  setAction(slot, { type: 'mouseX', delta: -127, hold: true });
  const choose = (label: string) => {
    const axis = nodes(Inspector()).find(n => n.props['aria-label'] === 'Axis')!;
    const button = nodes(axis).find(n => n.type === 'button' && n.props.children === label)!;
    (button.props.onClick as () => void)();
  };
  choose('Y');
  expect(getAction(profile.value, slot)).toEqual({ type: 'mouseY', delta: -127, hold: true });
  choose('Both');
  expect(getAction(profile.value, slot)).toEqual({ type: 'mouseXY', x: 4, y: -60, hold: true });
  choose('X');
  expect(getAction(profile.value, slot)).toEqual({ type: 'mouseX', delta: -127, hold: true });
  choose('Both');
  expect(getAction(profile.value, slot)).toEqual({ type: 'mouseXY', x: 4, y: -60, hold: true });
  const selector = nodes(Inspector()).find(n => n.type === 'select')!;
  (selector.props.onChange as (e: unknown) => void)({ target: { value: 'mouseX' } });
  expect(getAction(profile.value, slot)).toEqual({ type: 'mouseXY', x: 4, y: -60, hold: true });
});

it.each(['mouseX', 'mouseY'] as const)('uses a valid nonzero step when changing from a stationary %s axis', type => {
  profile.value = defaultProfile(0);
  const slot: Slot = { kind: 'key', layer: 0, index: 0 };
  selectedSlot.value = slot;
  setAction(slot, { type: 'mouseXY', x: type === 'mouseX' ? 0 : 8, y: type === 'mouseY' ? 0 : 8 });
  const axis = nodes(Inspector()).find(n => n.props['aria-label'] === 'Axis')!;
  const button = nodes(axis).find(n => n.type === 'button' && n.props.children === (type === 'mouseX' ? 'X' : 'Y'))!;
  (button.props.onClick as () => void)();
  expect(getAction(profile.value, slot)).toEqual({ type, delta: 4 });
});
