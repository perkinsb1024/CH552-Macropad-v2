import { afterEach, expect, it, vi } from 'vitest';
import { Inspector } from '../src/ui/components/Inspector';
import { defaultProfile } from '../src/model/defaults';
import { profile, selectedSlot, setAction, getAction } from '../src/ui/store';
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

it.each(['key', 'encoderButton', 'clockwise', 'counterclockwise', 'chord', 'timed', 'resume', 'macro'])('edits persistent modifiers on %s', kind => {
  profile.value = defaultProfile(0);
  profile.value.macros = [{ actions: [{ type: 'modifierDown', modifiers: 6 }] }];
  profile.value.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: { type: 'none' }, resumeAction: { type: 'none' } }];
  profile.value.chords = [{ layer: 0, keyA: 0, keyB: 1, action: { type: 'none' } }];
  const slot = (kind === 'key' ? { kind, layer: 0, index: 0 }
    : kind === 'timed' || kind === 'resume' ? { kind: 'timed', layer: 0, index: 0, resume: kind === 'resume' }
    : kind === 'macro' ? { kind, layer: 0, index: 0, step: 0 }
    : kind === 'chord' ? { kind, layer: 0, keyA: 0, keyB: 1 }
    : { kind, layer: 0 }) as Slot;
  selectedSlot.value = slot; setAction(slot, { type: 'modifierDown', modifiers: 6 });
  for (const type of ['modifierUp', 'modifierToggle', 'modifierDown']) {
    const tree = nodes(Inspector());
    expect(tree.find(n => n.type === 'option' && n.props.value === type)?.props.disabled).toBeFalsy();
    (tree.find(n => n.type === 'select')!.props.onChange as (e: unknown) => void)({ target: { value: type } });
    expect(getAction(profile.value, slot)).toEqual({ type, modifiers: 6 });
  }
  const picker = nodes(Inspector()).find(n => typeof n.type === 'function' && n.type.name === 'ModifierPicker')!;
  const controls = nodes((picker.type as (p: unknown) => unknown)(picker.props)).filter(n => n.type === 'input');
  expect(controls.map(n => n.props.checked)).toEqual([false, true, true, false]);
  (controls[3]!.props.onChange as (e: unknown) => void)({ target: { checked: true } });
  expect(getAction(profile.value, slot)).toEqual({ type: 'modifierDown', modifiers: 14 });
});
