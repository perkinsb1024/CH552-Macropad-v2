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

it.each(['key', 'encoderButton', 'clockwise', 'counterclockwise', 'chord', 'timed', 'resume', 'macro'])('edits consumer modifiers on %s', kind => {
  profile.value = defaultProfile(0);
  profile.value.macros = [{ actions: [{ type: 'consumerModified', usage: 0x6f, modifiers: 6 }] }];
  profile.value.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: { type: 'none' }, resumeAction: { type: 'none' } }];
  profile.value.chords = [{ layer: 0, keyA: 0, keyB: 1, action: { type: 'none' } }];
  const slot = (kind === 'key' ? { kind, layer: 0, index: 0 }
    : kind === 'timed' || kind === 'resume' ? { kind: 'timed', layer: 0, index: 0, resume: kind === 'resume' }
    : kind === 'macro' ? { kind, layer: 0, index: 0, step: 0 }
    : kind === 'chord' ? { kind, layer: 0, keyA: 0, keyB: 1 }
    : { kind, layer: 0 }) as Slot;
  selectedSlot.value = slot; setAction(slot, { type: 'consumerModified', usage: 0x6f, modifiers: 6 });
  const tree = nodes(Inspector());
  expect(tree.find(n => n.type === 'option' && n.props.value === 'consumerModified')?.props.disabled).toBeFalsy();
  expect(tree.some(n => n.type === 'option' && String(n.props.value).startsWith('modifier'))).toBe(false);
  const picker = nodes(Inspector()).find(n => typeof n.type === 'function' && n.type.name === 'ModifierPicker')!;
  const controls = nodes((picker.type as (p: unknown) => unknown)(picker.props)).filter(n => n.type === 'input');
  expect(controls.map(n => n.props.checked)).toEqual([false, true, true, false]);
  (controls[3]!.props.onChange as (e: unknown) => void)({ target: { checked: true } });
  expect(getAction(profile.value, slot)).toEqual({ type: 'consumerModified', usage: 0x6f, modifiers: 14 });
});

function controlTree() {
  const control = nodes(Inspector()).find(n => typeof n.type === 'function' && n.type.name === 'ConsumerControl')!;
  return nodes((control.type as (p: unknown) => unknown)(control.props));
}

it.each(['consumerModified', 'consumerModifiedHold'] as const)('limits %s controls and custom input to eight bits while retaining twelve-bit media actions', type => {
  profile.value = defaultProfile(0);
  selectedSlot.value = { kind: 'key', layer: 0, index: 0 };
  setAction(selectedSlot.value, { type, usage: 0xff, modifiers: 6 });
  const tree = controlTree();
  const usages = tree.filter(n => n.type === 'option' && typeof n.props.value === 'number').map(n => Number(n.props.value));
  expect(usages).toContain(0x6f); expect(usages.every(v => v > 0 && v <= 255)).toBe(true);
  expect(usages).not.toContain(0x192);
  const input = tree.find(n => typeof n.type === 'function' && n.type.name === 'ConsumerUsageInput')!;
  const rendered = nodes((input.type as (p: unknown) => unknown)(input.props)).find(n => n.type === 'input')!;
  expect(rendered.props).toMatchObject({ maxLength: 2, value: 'FF', 'aria-invalid': false });
  setAction(selectedSlot.value, { type: 'consumer', usage: 0x192 });
  expect(controlTree().some(n => n.type === 'option' && n.props.value === 0x192)).toBe(true);
});

it.each([0x70, 0x192])('preserves representable media usages when selecting modifiers from %s', usage => {
  profile.value = defaultProfile(0);
  selectedSlot.value = { kind: 'key', layer: 0, index: 0 };
  setAction(selectedSlot.value, { type: 'consumer', usage });
  const select = nodes(Inspector()).find(n => n.type === 'select')!;
  (select.props.onChange as (e: unknown) => void)({ target: { value: 'consumerModified' } });
  expect(getAction(profile.value, selectedSlot.value)).toEqual({ type: 'consumerModified', usage: usage <= 255 ? usage : 0x6f, modifiers: 6 });
});


it('preserves usage and modifiers when switching a modified tap to a hold', () => {
  profile.value = defaultProfile(0);
  selectedSlot.value = { kind: 'key', layer: 0, index: 0 };
  setAction(selectedSlot.value, { type: 'consumerModified', usage: 0x70, modifiers: 15 });
  const hold = nodes(nodes(Inspector()).find(n => n.props['aria-label'] === 'Media Behavior')!).find(n => n.type === 'button' && n.props.children === 'Hold')!;
  (hold.props.onClick as () => void)();
  expect(getAction(profile.value, selectedSlot.value)).toEqual({ type: 'consumerModifiedHold', usage: 0x70, modifiers: 15 });
  const picker = nodes(Inspector()).find(n => typeof n.type === 'function' && n.type.name === 'ModifierPicker')!;
  (picker.props.onChange as (mask: number) => void)(6);
  expect(getAction(profile.value, selectedSlot.value)).toEqual({ type: 'consumerModifiedHold', usage: 0x70, modifiers: 6 });
});
