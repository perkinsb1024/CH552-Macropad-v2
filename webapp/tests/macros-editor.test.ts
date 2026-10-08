import { afterEach, expect, it, vi } from 'vitest';
import { MacrosPanel } from '../src/ui/components/MacrosPanel';
import { Inspector } from '../src/ui/components/Inspector';
import { defaultProfile } from '../src/model/defaults';
import { profileChanges } from '../src/model/changes';
import { computeCapacity } from '../src/model/capacity';
import { profile, selectedSlot, setAction, getAction, undo, redo, updateProfile, insertLayer, removeLayer, canSwapSlots, draggedSlot, slotDrop, clearSelectedAction, cutSelectedConfiguration } from '../src/ui/store';
vi.mock('preact/hooks', () => ({ useMemo: (factory: () => unknown) => factory(), useState: (initial: unknown) => [initial, vi.fn()] }));
type Node = { type: unknown; props: Record<string, unknown> };
function nodes(v: unknown): Node[] {
  if (Array.isArray(v)) return v.flatMap(nodes);
  if (!v || typeof v !== 'object' || !('props' in v)) return [];
  const n = v as Node; return [n, ...nodes(n.props.children)];
}
function click(label: string) {
  const button = nodes(MacrosPanel()).find(n => n.props['aria-label'] === label || n.props.title === label)!;
  expect(button).toBeDefined(); (button.props.onClick as () => void)();
}
function addMacro() {
  const button = nodes(MacrosPanel()).filter(n => n.type === 'button').at(-1)!;
  (button.props.onClick as () => void)();
}
function start() { profile.value = defaultProfile(0); selectedSlot.value = null; }
afterEach(() => { selectedSlot.value = null; });
it('adds steps, edits through the inspector, reorders, deletes, and supports undo/redo', () => {
  start(); addMacro();
  expect(selectedSlot.value).toEqual({ kind: 'macro', layer: 0, index: 0, step: 0 });
  expect(nodes(Inspector()).find(n => n.type === 'h2')!.props.children).toBe('Macro 1 · Step 1');
  setAction(selectedSlot.value!, { type: 'pause', ticks: 16 });
  const slider = nodes(Inspector()).find(n => n.props['aria-label'] === 'Pause duration')!;
  (slider.props.onInput as (e: unknown) => void)({ target: { value: '255' } });
  expect(getAction(profile.value!, selectedSlot.value!)).toEqual({ type: 'pause', ticks: 255 });
  const add = nodes(MacrosPanel()).find(n => n.type === 'button' && Array.isArray(n.props.children) && n.props.children.includes(' Add step'))!;
  (add.props.onClick as () => void)();
  expect(profile.value!.macros![0]!.actions).toHaveLength(2);
  draggedSlot.value = selectedSlot.value;
  const target = nodes(MacrosPanel()).find(n => n.props['aria-label'] === 'Edit macro 1 step 1')!;
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientY: 1,
    currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 100 }) } };
  (target.props.onDragOver as (event: unknown) => void)(event);
  expect(slotDrop.value?.position).toBe('before');
  (target.props.onDrop as (event: unknown) => void)(event);
  expect(profile.value!.macros![0]!.actions[1]!.type).toBe('pause');
  expect(selectedSlot.value).toMatchObject({ step: 0 });
  click('Remove step 1'); expect(selectedSlot.value).toBeNull();
  undo(); expect(profile.value!.macros![0]!.actions).toHaveLength(2);
  redo(); expect(profile.value!.macros![0]!.actions).toHaveLength(1);
  const addPause = nodes(MacrosPanel()).find(n => n.type === 'button' && Array.isArray(n.props.children) && n.props.children.includes(' Add pause'))!;
  (addPause.props.onClick as () => void)();
  expect(profile.value!.macros![0]!.actions[1]).toEqual({ type: 'pause', ticks: 16 });
  expect(selectedSlot.value).toMatchObject({ kind: 'macro', index: 0, step: 1 });
  undo(); expect(profile.value!.macros![0]!.actions).toHaveLength(1);
});
it('prevents nested and held steps and edits invocation selection and repeats', () => {
  start(); addMacro();
  const options = nodes(Inspector()).filter(n => n.type === 'option').map(n => n.props.value);
  expect(options).not.toContain('macro'); expect(options).not.toContain('none'); expect(options).not.toContain('keyHold');
  const step = selectedSlot.value!;
  updateProfile(p => { p.layers[0]!.keys[0] = { type: 'keyHold', usage: 4, modifiers: 0 }; });
  expect(canSwapSlots({ kind: 'key', layer: 0, index: 0 }, step)).toBe(false);
  selectedSlot.value = { kind: 'key', layer: 0, index: 1 };
  setAction(selectedSlot.value, { type: 'macro', macro: 0, repeats: 1 });
  expect(nodes(Inspector()).find(n => n.props['aria-label'] === 'Run count')).toBeUndefined();
  const repeatToggle = () => nodes(Inspector()).find(n => n.props['aria-label'] === 'Repeat')!;
  const on = nodes(repeatToggle()).find(n => n.type === 'button' && n.props.children === 'On')!;
  expect(on.props['aria-pressed']).toBe(false);
  (on.props.onClick as () => void)();
  expect(getAction(profile.value!, selectedSlot.value!)).toMatchObject({ repeats: 2 });
  const repeats = nodes(Inspector()).find(n => n.props['aria-label'] === 'Run count')!;
  expect(repeats.props).toMatchObject({ type: 'range', min: 2, max: 16 });
  (repeats.props.onInput as (e: unknown) => void)({ target: { value: '16' } });
  expect(getAction(profile.value!, selectedSlot.value!)).toEqual({ type: 'macro', macro: 0, repeats: 16 });
  const off = nodes(repeatToggle()).find(n => n.type === 'button' && n.props.children === 'Off')!;
  (off.props.onClick as () => void)();
  expect(getAction(profile.value!, selectedSlot.value!)).toMatchObject({ repeats: 1 });
  expect(nodes(Inspector()).find(n => n.props['aria-label'] === 'Run count')).toBeUndefined();
});
it('clears removed macro bindings and renumbers surviving references across all sites', () => {
  start(); addMacro(); addMacro();
  updateProfile(p => {
    p.layers[0]!.keys[0] = { type: 'macro', macro: 0, repeats: 1 };
    p.layers[0]!.clockwise = { type: 'macro', macro: 1, repeats: 2 };
    p.chords = [{ layer: 0, keyA: 0, keyB: 1, action: { type: 'macro', macro: 1, repeats: 3 } }];
    p.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: { type: 'macro', macro: 0, repeats: 1 }, resumeAction: { type: 'macro', macro: 1, repeats: 4 } }];
  });
  click('Remove macro 1 and its bindings');
  expect(profile.value!.layers[0]!.keys[0]).toEqual({ type: 'none' });
  expect(profile.value!.layers[0]!.clockwise).toEqual({ type: 'macro', macro: 0, repeats: 2 });
  expect(profile.value!.chords[0]!.action).toMatchObject({ macro: 0 });
  expect(profile.value!.timedActions![0]!).toMatchObject({ action: { type: 'none' }, resumeAction: { macro: 0, repeats: 4 } });
  expect(selectedSlot.value).toMatchObject({ index: 0 });
  undo(); expect(profile.value!.macros).toHaveLength(2);
});
it('remaps macro layer targets, tracks edits, and clears a step to a zero pause', () => {
  start(); const before = structuredClone(profile.value!); addMacro();
  setAction(selectedSlot.value!, { type: 'setLayer', layer: 1 });
  insertLayer(1, 0, 'before'); expect(profile.value!.macros![0]!.actions[0]).toMatchObject({ layer: 0 });
  removeLayer(1); expect(profile.value!.macros![0]!.actions[0]).toMatchObject({ layer: 0 });
  selectedSlot.value = { kind: 'macro', layer: 0, index: 0, step: 0 }; clearSelectedAction();
  expect(profile.value!.macros![0]!.actions[0]).toEqual({ type: 'pause', ticks: 0 });
  cutSelectedConfiguration();
  expect(profile.value!.macros![0]!.actions[0]).toEqual({ type: 'pause', ticks: 0 });
  expect(profileChanges(before, profile.value!).some(c => c.where === 'Macros')).toBe(true);
  expect(computeCapacity(profile.value!).macros).toBe(3);
});

it('inserts new steps before a layer switch and explains the restriction in the sidebar', () => {
  start(); addMacro();
  setAction(selectedSlot.value!, { type: 'oneShotRelativeLayer', offset: 0 });
  const add = () => nodes(MacrosPanel()).find(n => n.type === 'button' && Array.isArray(n.props.children) && n.props.children.includes(' Add step'))!;
  expect(add().props.disabled).toBe(false);
  expect(JSON.stringify(nodes(Inspector()).filter(n => n.type === 'p').map(n => n.props.children))).toContain('final macro step');
  (add().props.onClick as () => void)();
  expect(profile.value!.macros![0]!.actions.map(a => a.type)).toEqual(['keyTap', 'oneShotRelativeLayer']);
  expect(selectedSlot.value).toMatchObject({ step: 0 });
  undo(); expect(profile.value!.macros![0]!.actions).toHaveLength(1);
});

it('marks invalid layer switches and inserts pauses before the first switch without rearranging steps', () => {
  start();
  updateProfile(p => { p.macros = [{ actions: [
    { type: 'relativeLayer', offset: 0 },
    { type: 'oneShotRelativeLayer', offset: 0 },
    { type: 'setLayer', layer: 0 },
  ] }]; });
  const rows = () => nodes(MacrosPanel()).filter(n => String(n.props.class ?? '').split(' ').includes('macro-step'));
  expect(rows().map(n => String(n.props.class).includes('has-problem'))).toEqual([true, true, false]);
  const markers = () => nodes(MacrosPanel()).filter(n => n.props.class === 'hint macro-insertion-marker');
  expect(markers()).toHaveLength(1);
  const add = nodes(MacrosPanel()).find(n => n.type === 'button' && Array.isArray(n.props.children) && n.props.children.includes(' Add pause'))!;
  expect(add.props.disabled).toBe(false);
  (add.props.onClick as () => void)();
  expect(profile.value!.macros![0]!.actions.map(a => a.type)).toEqual(['pause', 'relativeLayer', 'oneShotRelativeLayer', 'setLayer']);
  expect(selectedSlot.value).toMatchObject({ step: 0 });
  expect(markers()).toHaveLength(1);
  expect(rows().map(n => String(n.props.class).includes('has-problem'))).toEqual([false, true, true, false]);
  undo(); expect(profile.value!.macros![0]!.actions).toHaveLength(3);
});

it('restricts repeats when selecting a layer-switching macro without silently changing existing bindings', () => {
  start(); addMacro();
  setAction(selectedSlot.value!, { type: 'setLayer', layer: 0 });
  selectedSlot.value = { kind: 'key', layer: 0, index: 0 };
  setAction(selectedSlot.value, { type: 'macro', macro: 0, repeats: 16 });
  const repeat = nodes(Inspector()).find(n => n.props['aria-label'] === 'Run count')!;
  expect(repeat.props.disabled).toBe(true);
  const toggle = nodes(Inspector()).find(n => n.props['aria-label'] === 'Repeat')!;
  expect(nodes(toggle).find(n => n.props.children === 'On')!.props.disabled).toBe(true);
  expect(repeat.props.value).toBe(16);
  expect(getAction(profile.value!, selectedSlot.value)).toMatchObject({ repeats: 16 });
  const off = nodes(toggle).find(n => n.props.children === 'Off')!;
  expect(off.props.disabled).toBeFalsy();
  (off.props.onClick as () => void)();
  expect(getAction(profile.value!, selectedSlot.value)).toMatchObject({ repeats: 1 });
  expect(nodes(Inspector()).find(n => n.props['aria-label'] === 'Repeat')).toBeUndefined();
  setAction(selectedSlot.value, { type: 'macro', macro: 0, repeats: 16 });
  const select = nodes(Inspector()).find(n => n.props['aria-label'] === 'Macro')!;
  (select.props.onChange as (e: unknown) => void)({ target: { value: '0' } });
  expect(getAction(profile.value!, selectedSlot.value)).toMatchObject({ repeats: 1 });
});

it('inserts a step across multiple rows instead of swapping and restores it with undo', () => {
  start();
  updateProfile(p => { p.macros = [{ actions: [4, 5, 6, 7].map(usage => ({ type: 'keyTap', usage, modifiers: 0 })) }]; });
  const before = structuredClone(profile.value);
  draggedSlot.value = { kind: 'macro', layer: 0, index: 0, step: 3 };
  const target = nodes(MacrosPanel()).find(n => n.props['aria-label'] === 'Edit macro 1 step 1')!;
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientY: 1,
    currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 100 }) } };
  (target.props.onDragOver as (event: unknown) => void)(event);
  (target.props.onDrop as (event: unknown) => void)(event);
  expect(profile.value!.macros![0]!.actions).toEqual([7, 4, 5, 6].map(usage => ({ type: 'keyTap', usage, modifiers: 0 })));
  expect(selectedSlot.value).toMatchObject({ step: 0 });
  undo(); expect(profile.value).toEqual(before);
});

it('inserts macro steps when dropped in the gap between rows', () => {
  start();
  updateProfile(p => { p.macros = [{ actions: [4, 5, 6, 7].map(usage => ({ type: 'keyTap', usage, modifiers: 0 })) }]; });
  const before = structuredClone(profile.value);
  draggedSlot.value = { kind: 'macro', layer: 0, index: 0, step: 3 };
  const container = nodes(MacrosPanel()).find(n => n.props.class === 'macro-steps')!;
  const event = {
    preventDefault: vi.fn(),
    target: { closest: () => null },
    clientY: 46,
    dataTransfer: { dropEffect: 'none' },
    currentTarget: { querySelectorAll: () => [0, 1, 2, 3].map(step => ({
      getBoundingClientRect: () => ({ top: step * 52, bottom: step * 52 + 40 }),
    })) },
  };
  (container.props.onDragOver as (event: unknown) => void)(event);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(event.dataTransfer.dropEffect).toBe('move');
  expect(slotDrop.value).toMatchObject({ slot: { step: 0 }, position: 'after' });
  (container.props.onDrop as (event: unknown) => void)(event);
  expect(profile.value!.macros![0]!.actions).toEqual([4, 7, 5, 6].map(usage => ({ type: 'keyTap', usage, modifiers: 0 })));
  expect(selectedSlot.value).toMatchObject({ step: 1 });
  expect(draggedSlot.value).toBeNull();
  expect(slotDrop.value).toBeNull();
  undo(); expect(profile.value).toEqual(before);
});
