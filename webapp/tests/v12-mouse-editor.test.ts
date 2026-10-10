import { afterEach, expect, it, vi } from 'vitest';
import { Inspector } from '../src/ui/components/Inspector';
import { ScrollTest } from '../src/ui/components/ScrollTest';
import { defaultProfile } from '../src/model/defaults';
import { profile, selectedSlot, setAction, getAction } from '../src/ui/store';
import { MOUSE_BUTTONS } from '../src/model/constants';
import type { Slot } from '../src/model/types';
const hookState = vi.hoisted(() => ({ setters: [] as ReturnType<typeof vi.fn>[], effects: [] as (() => unknown)[] }));
vi.mock('preact/hooks', () => ({
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => { const set = vi.fn(); hookState.setters.push(set); return [initial, set]; },
  useRef: () => ({ current: null }),
  useEffect: (effect: () => unknown) => hookState.effects.push(effect),
}));
type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const n = value as Node; return [n, ...nodes(n.props.children)];
}
afterEach(() => { vi.unstubAllGlobals(); hookState.setters = []; hookState.effects = []; });

it.each(['key', 'clockwise', 'timed', 'macro'])('offers explicit down/up without held behavior for %s', kind => {
  profile.value = defaultProfile(0);
  profile.value.macros = [{ actions: [{ type: 'mouseDown', buttons: 0x88 }] }];
  profile.value.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: { type: 'mouseDown', buttons: 0x88 }, resumeAction: { type: 'none' } }];
  const slot = (kind === 'key' ? { kind, layer: 0, index: 0 } : kind === 'timed' ? { kind, layer: 0, index: 0, resume: false } : kind === 'macro' ? { kind, layer: 0, index: 0, step: 0 } : { kind, layer: 0 }) as Slot;
  selectedSlot.value = slot; setAction(slot, { type: 'mouseDown', buttons: 0x88 });
  const tree = nodes(Inspector());
  for (const type of ['mouseDown', 'mouseUp']) expect(tree.find(n => n.type === 'option' && n.props.value === type)?.props.disabled).toBeFalsy();
  expect(tree.some(n => n.props['aria-label'] === 'Movement behavior' || n.props['aria-label'] === 'Scroll behavior')).toBe(false);
  const selector = tree.find(n => n.type === 'select')!;
  (selector.props.onChange as (e: unknown) => void)({ target: { value: 'mouseUp' } });
  expect(getAction(profile.value, slot)).toEqual({ type: 'mouseUp', buttons: 0x88 });
  const buttonComponent = nodes(Inspector()).find(n => typeof n.type === 'function' && n.type.name === 'MouseButtons')!;
  const controls = nodes((buttonComponent.type as (p: unknown) => unknown)(buttonComponent.props)).filter(n => n.type === 'input');
  expect(controls).toHaveLength(8);
  expect(controls.map(n => n.props.checked)).toEqual([false, false, false, true, false, false, false, true]);
  (controls[4]!.props.onChange as (e: unknown) => void)({ target: { checked: true } });
  expect(getAction(profile.value, slot)).toEqual({ type: 'mouseUp', buttons: 0x98 });
});

it('uses DOM event numbering for side-button counts and preserves all held bits', () => {
  const tree = nodes(ScrollTest({ onClose: vi.fn() }));
  const testArea = tree.find(n => n.props['aria-label'] === 'Scroll and click test area')!;
  const click = testArea.props.onAuxClick as (e: unknown) => void;
  for (const [button, index] of [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [7, 7]]) {
    click({ button, preventDefault: vi.fn() });
    const update = hookState.setters[0]!.mock.calls.at(-1)![0] as (counts: number[]) => number[];
    expect(update(Array(8).fill(0))).toEqual(Array.from({ length: 8 }, (_, i) => i === index ? 1 : 0));
  }
  const events = new Map<string, (e: unknown) => void>();
  vi.stubGlobal('window', { addEventListener: (name: string, fn: (e: unknown) => void) => events.set(name, fn) });
  vi.stubGlobal('document', { activeElement: null, addEventListener: vi.fn() });
  hookState.effects[0]!(); events.get('mousemove')!({ buttons: 0x88 });
  expect(hookState.setters[1]).toHaveBeenLastCalledWith(0x88);
  expect(MOUSE_BUTTONS.map(b => b.bit)).toEqual([1, 4, 2, 8, 16, 32, 64, 128]);
});
