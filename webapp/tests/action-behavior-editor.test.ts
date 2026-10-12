import { afterEach, expect, it, vi } from 'vitest';
import { Inspector } from '../src/ui/components/Inspector';
import { ACTION_FAMILIES } from '../src/ui/actionFamilies';
import { defaultProfile } from '../src/model/defaults';
import { blankAction } from '../src/model/actions';
import { PREVIOUS_LAYER } from '../src/model/constants';
import { encodeAction } from '../src/codec/encode';
import { profile, selectedSlot, getAction, setAction, undo, redo } from '../src/ui/store';
import type { Action, Slot } from '../src/model/types';

vi.mock('preact/hooks', () => ({ useMemo: (factory: () => unknown) => factory(), useState: (initial: unknown) => [initial, vi.fn()] }));
type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function start(action: Action, slot: Slot = { kind: 'key', layer: 0, index: 0 }) {
  profile.value = defaultProfile(0);
  profile.value.chords = [{ layer: 0, keyA: 0, keyB: 1, action: { type: 'none' } }];
  profile.value.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: { type: 'none' }, resumeAction: { type: 'none' } }];
  profile.value.macros = [{ actions: [{ type: 'pause', ticks: 1 }] }];
  selectedSlot.value = slot;
  setAction(slot, action);
}
function current() { return getAction(profile.value!, selectedSlot.value!)!; }
function selector() { return nodes(Inspector()).find(n => n.type === 'select')!; }
function choose(type: string) { (selector().props.onChange as (event: unknown) => void)({ target: { value: type } }); }
function behaviors() {
  return nodes(nodes(Inspector()).find(n => ['Key behavior', 'Media behavior', 'Layer behavior'].includes(String(n.props['aria-label'])))).filter(n => n.type === 'button');
}
function behavior(label: string) { return behaviors().find(n => n.props.children === label)!; }
function click(node: Node) { (node.props.onClick as () => void)(); }
function memory() {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  return storage;
}
afterEach(() => { vi.unstubAllGlobals(); profile.value = null; selectedSlot.value = null; });

it.each(Object.entries(ACTION_FAMILIES))('shows every saved %s variant under its parent with its behavior selected', (family, types) => {
  for (const [index, type] of types.entries()) {
    start(blankAction(type));
    const before = current();
    expect(selector().props.value).toBe(family);
    expect(behaviors().map(n => n.props['aria-pressed'])).toEqual(types.map((_, i) => i === index));
    expect(current()).toEqual(before);
    const options = nodes(selector());
    const group = options.find(n => n.type === 'optgroup' && n.props.label === (family === 'keyTap' ? 'Keyboard' : family.startsWith('consumer') ? 'Media' : 'Layers'))!;
    expect(nodes(group).filter(n => n.type === 'option').map(n => n.props.value)).toEqual(family === 'keyTap' ? ['keyTap'] : family.startsWith('consumer') ? ['consumer', 'consumerModified'] : ['setLayer', 'relativeLayer']);
    if (family === 'keyTap') expect(nodes(group).find(n => n.type === 'option')!.props.children).toContain('Key press');
    choose(family);
    expect(current()).toEqual(before);
  }
});

const releaseSlots: Slot[] = [
  { kind: 'key', layer: 0, index: 0 }, { kind: 'encoderButton', layer: 0 },
  { kind: 'chord', layer: 0, keyA: 0, keyB: 1 },
];
const noReleaseSlots: Slot[] = [
  { kind: 'clockwise', layer: 0 }, { kind: 'counterclockwise', layer: 0 },
  { kind: 'timed', layer: 0, index: 0, resume: false }, { kind: 'timed', layer: 0, index: 0, resume: true },
  { kind: 'macro', layer: 0, index: 0, step: 0 },
];
it.each([...releaseSlots, ...noReleaseSlots])('enforces all families’ hold restrictions on %o, including direct handler calls', slot => {
  for (const types of Object.values(ACTION_FAMILIES)) {
    start(blankAction(types[0]), slot);
    const before = current();
    const hold = behavior('Hold');
    const unavailable = noReleaseSlots.includes(slot);
    expect(hold.props.disabled).toBe(unavailable);
    click(hold);
    expect(current()).toEqual(unavailable ? before : { ...before, type: types[types.length - 1] });
    click(behaviors()[0]!);
    expect(current()).toEqual(before);
    if (types.length === 3) {
      click(behavior('One-shot'));
      expect(current()).toEqual({ ...before, type: types[1] });
    }
  }
});

it('uses current media parameters across behavior changes even when older settings are remembered', () => {
  memory();
  start({ type: 'consumerModifiedHold', usage: 0x6f, modifiers: 6 });
  setAction(selectedSlot.value!, { type: 'consumerModified', usage: 0x70, modifiers: 15 });
  click(behavior('Hold'));
  expect(current()).toEqual({ type: 'consumerModifiedHold', usage: 0x70, modifiers: 15 });
  expect(encodeAction(current(), new Map())).toEqual([0xfb, 0x70]);
  click(behavior('Tap'));
  expect(current()).toEqual({ type: 'consumerModified', usage: 0x70, modifiers: 15 });
  expect(encodeAction(current(), new Map())).toEqual([0xfa, 0x70]);
  undo(); expect(current().type).toBe('consumerModifiedHold');
  redo(); expect(current().type).toBe('consumerModified');
});

it.each([{ usage: 4, modifiers: 6 }, { usage: 0, modifiers: 15 }])('preserves the current key combination %o across Tap/Hold and undo/redo', combination => {
  memory();
  start({ type: 'keyHold', usage: 5, modifiers: 1 });
  setAction(selectedSlot.value!, { type: 'keyTap', ...combination });
  click(behavior('Hold'));
  expect(current()).toEqual({ type: 'keyHold', ...combination });
  click(behavior('Tap'));
  expect(current()).toEqual({ type: 'keyTap', ...combination });
  undo(); expect(current()).toEqual({ type: 'keyHold', ...combination });
  redo(); expect(current()).toEqual({ type: 'keyTap', ...combination });
});

it('preserves Hold and representable usages between media entries and restores remembered modifiers', () => {
  memory();
  start({ type: 'consumerModifiedHold', usage: 0x6f, modifiers: 15 });
  choose('consumer');
  expect(current()).toEqual({ type: 'consumerHold', usage: 0x6f });
  setAction(selectedSlot.value!, { type: 'consumerHold', usage: 0x70 });
  choose('consumerModified');
  expect(current()).toEqual({ type: 'consumerModifiedHold', usage: 0x70, modifiers: 15 });
  choose('consumer');
  setAction(selectedSlot.value!, { type: 'consumerHold', usage: 0xabc });
  choose('consumerModified');
  expect(current()).toEqual({ type: 'consumerModifiedHold', usage: 0x70, modifiers: 15 });
});

it.each(['setLayer', 'relativeLayer'] as const)('preserves current %s parameters across all behavior transitions', family => {
  memory();
  const types = ACTION_FAMILIES[family];
  start(family === 'setLayer' ? { type: 'momentaryLayer', layer: 0 } : { type: 'momentaryRelativeLayer', offset: 1 });
  const parameter = family === 'setLayer' ? { layer: 1 } : { offset: -2 };
  setAction(selectedSlot.value!, { type: types[0], ...parameter } as Action);
  for (const [label, type] of [['Hold', types[2]], ['One-shot', types[1]], ['Switch', types[0]]] as const) {
    click(behavior(label));
    expect(current()).toEqual({ type, ...parameter });
  }
});

it('disables Hold for Previous layer, preserves its one-shot target and excludes it from held targets', () => {
  start({ type: 'setLayer', layer: PREVIOUS_LAYER });
  expect(behavior('Hold').props.disabled).toBe(true);
  click(behavior('Hold'));
  expect(current()).toEqual({ type: 'setLayer', layer: PREVIOUS_LAYER });
  click(behavior('One-shot'));
  expect(current()).toEqual({ type: 'oneShotSetLayer', layer: PREVIOUS_LAYER });
  click(behavior('Hold'));
  expect(current()).toEqual({ type: 'oneShotSetLayer', layer: PREVIOUS_LAYER });
  const target = nodes(Inspector()).filter(n => n.type === 'select')[1]!;
  (target.props.onChange as (event: unknown) => void)({ target: { value: '1' } });
  click(behavior('Hold'));
  expect(current()).toEqual({ type: 'momentaryLayer', layer: 1 });
  expect(nodes(Inspector()).some(n => n.type === 'option' && n.props.value === PREVIOUS_LAYER)).toBe(false);
});

it.each(Object.entries(ACTION_FAMILIES))('restores the last %s behavior when returning from another action', (family, types) => {
  memory();
  start(blankAction(types[types.length - 1]!));
  const before = current();
  choose('string');
  choose(family);
  expect(current()).toEqual(before);
});

it.each(noReleaseSlots)('does not restore remembered holds on %o or silently alter an existing invalid hold', slot => {
  const storage = memory();
  for (const [family, types] of Object.entries(ACTION_FAMILIES)) {
    start(blankAction(types[types.length - 1]!), slot);
    const before = current();
    expect(selector().props.value).toBe(family);
    expect(behavior('Hold').props['aria-pressed']).toBe(true);
    expect(nodes(Inspector()).some(n => n.props.role === 'alert')).toBe(true);
    expect(current()).toEqual(before);
    choose('string');
    choose(family);
    expect(current()).toEqual(blankAction(types[0]));
    // Exercise the fallback for older memory without family metadata too.
    const legacy = { [JSON.stringify(slot)]: { [family]: before } };
    choose('string');
    storage.set('universal-macropad:action-settings:v1', JSON.stringify(legacy));
    choose(family);
    expect(current()).toEqual(blankAction(types[0]));
  }
});

it('rejects invalid remembered parameters and preserves modes when changing layer families', () => {
  memory();
  start({ type: 'momentaryLayer', layer: PREVIOUS_LAYER });
  choose('keyTap'); choose('setLayer');
  expect(current()).toEqual({ type: 'setLayer', layer: 0 });
  click(behavior('One-shot')); choose('relativeLayer');
  expect(current()).toEqual({ type: 'oneShotRelativeLayer', offset: 1 });
  click(behavior('Hold')); choose('setLayer');
  expect(current()).toEqual({ type: 'momentaryLayer', layer: 0 });
});
