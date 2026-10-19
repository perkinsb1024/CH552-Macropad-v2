import { afterEach, expect, it, vi } from 'vitest';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { holdThreshold, holdBindings } from '../src/model/tapHold';
import type { Action, OrdinaryAction, Slot } from '../src/model/types';
import { bindingDrag } from '../src/ui/bindingDrag';
import { canApplyShortcut, shortcutDrop, draggedShortcut, endShortcutDrag } from '../src/ui/drag';
import { Inspector } from '../src/ui/components/Inspector';
import { ProfilePanel } from '../src/ui/components/ProfilePanel';
import { dialog, closeDialog, getAction, profile, selectedSlot, setAction, undo, redo, insertLayer, removeLayer, layerReferences, connection, canSave, save, issues, copySelectedConfiguration, cutSelectedConfiguration, pasteSelectedConfiguration, canSwapSlots, swapSlotActions, clearSelectedAction, canInsertSlot, draggedSlot, slotDrop } from '../src/ui/store';

vi.mock('preact/hooks', () => ({ useMemo: (factory: () => unknown) => factory(), useState: (initial: unknown) => [initial, vi.fn()] }));
type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
const click = (node: Node) => (node.props.onClick as () => void)();
function start(action: Action = { type: 'keyTap', usage: 40, modifiers: 0 }, slot: Slot = { kind: 'key', layer: 0, index: 0 }) {
  const memory = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) });
  profile.value = defaultProfile(0); selectedSlot.value = slot; setAction(slot, action);
}
function addHold() { click(nodes(Inspector()).find(n => n.type === 'button' && n.props.children === 'Add Hold Gesture')!); }
const current = () => getAction(profile.value!, selectedSlot.value!)!;
afterEach(() => { closeDialog(); profile.value = null; selectedSlot.value = null; connection.value = { kind: 'disconnected' }; vi.unstubAllGlobals(); });

it('creates one labeled group with two native collapsible editors and preserves the original tap', () => {
  start(); addHold();
  expect(current()).toEqual({ type: 'tapHold', tap: { type: 'keyTap', usage: 40, modifiers: 0 }, hold: { type: 'none' } });
  const tree = nodes(Inspector());
  expect(tree.filter(n => n.type === 'fieldset')).toHaveLength(1);
  expect(tree.filter(n => n.type === 'legend').map(n => n.props.children)).toEqual(['Tap and Hold']);
  const sections = tree.filter(n => n.type === 'details' && String(n.props.class).includes('gesture-editor'));
  expect(sections).toHaveLength(2); expect(sections.map(n => n.props.open)).toEqual([false, false]);
  undo(); expect(current().type).toBe('keyTap'); redo(); expect(current().type).toBe('tapHold');
});

it('preserves an existing held output in the Hold branch', () => {
  start({ type: 'keyHold', usage: 0, modifiers: 1 }); addHold();
  expect(current()).toEqual({ type: 'tapHold', tap: { type: 'none' }, hold: { type: 'keyHold', usage: 0, modifiers: 1 } });
});

it('edits either branch without replacing its sibling and enforces the Tap release restriction', () => {
  start(); addHold();
  let tree = nodes(Inspector({ branch: 'hold' }));
  (tree.find(n => n.type === 'select')!.props.onChange as (event: unknown) => void)({ target: { value: 'keyTap' } });
  tree = nodes(Inspector({ branch: 'hold' }));
  click(tree.find(n => n.type === 'button' && n.props.children === 'Until Release')!);
  expect(current()).toMatchObject({ tap: { usage: 40 }, hold: { type: 'keyHold', usage: 40 } });
  tree = nodes(Inspector({ branch: 'tap' }));
  const unavailable = tree.find(n => n.type === 'button' && n.props.children === 'Until Release')!;
  expect(unavailable.props.disabled).toBe(true); click(unavailable);
  expect(current()).toMatchObject({ tap: { type: 'keyTap' }, hold: { type: 'keyHold' } });
  expect(tree.some(n => String(n.props.class).includes('led-color-field'))).toBe(false);
});

it('shows the shared threshold only with a gesture and applies it to all bindings with undo', () => {
  start();
  expect(nodes(ProfilePanel()).some(n => n.props['aria-label'] === 'Hold Threshold')).toBe(false);
  addHold(); profile.value!.layers[0]!.encoderButton = structuredClone(current());
  const threshold = nodes(ProfilePanel()).find(n => n.props['aria-label'] === 'Hold Threshold')!;
  expect(threshold.props.value).toBe(256);
  expect(threshold.props).toMatchObject({ type: 'range', min: 32, max: 512, step: 32 });
  (threshold.props.onInput as (event: unknown) => void)({ target: { value: '192' } });
  expect(holdBindings(profile.value!).map(a => holdThreshold(profile.value!, a))).toEqual([192, 192]);
  undo(); expect(holdThreshold(profile.value!)).toBe(256);
  redo(); expect(holdThreshold(profile.value!)).toBe(192);
});

it('removes a gesture without a modal when either branch is empty', () => {
  const key: Action = { type: 'keyTap', usage: 40, modifiers: 0 };
  for (const [tap, hold] of [[key, { type: 'none' }], [{ type: 'none' }, key], [{ type: 'none' }, { type: 'none' }]] as [OrdinaryAction, OrdinaryAction][]) {
    start({ type: 'tapHold', tap, hold });
    click(nodes(Inspector()).find(n => n.type === 'button' && n.props.children === 'Remove Hold Gesture')!);
    expect(current()).toEqual(tap.type === 'none' ? hold : tap);
    expect(dialog.value).toBeNull();
  }
});

it('asks which actual action to keep when both branches are populated', () => {
  const tap: Action = { type: 'keyTap', usage: 40, modifiers: 0 };
  const hold: Action = { type: 'keyHold', usage: 44, modifiers: 0 };
  for (const choice of [0, 1]) {
    start({ type: 'tapHold', tap, hold });
    click(nodes(Inspector()).find(n => n.type === 'button' && n.props.children === 'Remove Hold Gesture')!);
    expect(current().type).toBe('tapHold');
    expect(dialog.value?.body).toBe('Which action would you like to keep?');
    expect(dialog.value?.actions.map(a => a.label)).toEqual(['Cancel', 'Key Press: Enter', 'Key Hold: Space']);
    dialog.value!.actions[choice + 1]!.onSelect();
    expect(current()).toEqual(choice === 0 ? tap : hold);
    expect(dialog.value).toBeNull();
    undo(); expect(current().type).toBe('tapHold');
  }
});

it('cancels removing a populated gesture without changing the binding', () => {
  start({ type: 'tapHold', tap: { type: 'keyTap', usage: 40, modifiers: 0 }, hold: { type: 'keyHold', usage: 44, modifiers: 0 } });
  click(nodes(Inspector()).find(n => n.type === 'button' && n.props.children === 'Remove Hold Gesture')!);
  dialog.value!.actions.find(action => action.label === 'Cancel')!.onSelect();
  expect(dialog.value).toBeNull();
  expect(current().type).toBe('tapHold');
});

it('keeps layer references in either branch intact when layers are reordered and removed', () => {
  start(); profile.value!.layers = [emptyLayer(0), emptyLayer(0), emptyLayer(0)];
  setAction(selectedSlot.value!, { type: 'tapHold', tap: { type: 'setLayer', layer: 2 }, hold: { type: 'momentaryLayer', layer: 1 } });
  expect(layerReferences(profile.value!, 2).actions).toBe(1);
  insertLayer(2, 1, 'before');
  expect(profile.value!.layers[0]!.keys[0]).toMatchObject({ tap: { layer: 1 }, hold: { layer: 2 } });
  removeLayer(1);
  expect(profile.value!.layers[0]!.keys[0]).toMatchObject({ hold: { layer: 1 } });
});

it('blocks saves to older firmware before any upload request is sent', async () => {
  start(); addHold();
  const saveImage = vi.fn();
  connection.value = { kind: 'connected', connection: {
    info: { formatVersion: 18, variant: 0, actionMask: 0x7fff }, client: { saveImage },
  } } as unknown as typeof connection.value;
  expect(canSave.value).toBe(false);
  expect(issues.value.some(i => i.where === 'Firmware')).toBe(true);
  await save(); expect(saveImage).not.toHaveBeenCalled();
});


it('selects a gesture header for clipboard operations while keeping both editors visible', () => {
  start(); addHold();
  const header = nodes(Inspector()).find(n => n.type === 'summary')!;
  expect(header.props.draggable).toBe(true);
  expect(header.props['data-clipboard-target']).toBe(true);
  click(header);
  expect(selectedSlot.value?.branch).toBe('tap');
  expect(nodes(Inspector()).filter(n => n.type === 'details')).toHaveLength(2);
  expect(JSON.parse(copySelectedConfiguration(false)!).action).toEqual({ type: 'keyTap', usage: 40, modifiers: 0 });
});

it('copies, cuts, pastes and clears branches without changing the sibling, threshold or LEDs', () => {
  start({ type: 'tapHold', thresholdMs: 192, tap: { type: 'keyTap', usage: 40, modifiers: 0 }, hold: { type: 'keyTap', usage: 44, modifiers: 0 } });
  const base = selectedSlot.value!;
  const original = structuredClone(profile.value!);
  selectedSlot.value = { ...base, branch: 'tap' };
  const text = copySelectedConfiguration(false)!;
  expect(JSON.parse(text).led).toBeUndefined();
  cutSelectedConfiguration();
  expect(getAction(profile.value!, base)).toMatchObject({ tap: { type: 'none' }, hold: { usage: 44 }, thresholdMs: 192 });
  expect(profile.value!.layers[0]!.leds).toEqual(original.layers[0]!.leds);
  undo(); expect(profile.value).toEqual(original);
  selectedSlot.value = { ...base, branch: 'hold' };
  expect(pasteSelectedConfiguration(text)).toBe(true);
  expect(current()).toEqual({ type: 'keyTap', usage: 40, modifiers: 0 });
  clearSelectedAction(); clearSelectedAction();
  expect(getAction(profile.value!, base)).toMatchObject({ tap: { usage: 40 }, hold: { type: 'none' }, thresholdMs: 192 });
  expect(profile.value!.layers[0]!.leds).toEqual(original.layers[0]!.leds);
});

it('rejects pasting held outputs into Tap and nested gestures into either branch', () => {
  start({ type: 'keyHold', usage: 44, modifiers: 0 });
  const held = copySelectedConfiguration(false)!;
  addHold();
  const base = selectedSlot.value!;
  const wrapper = copySelectedConfiguration(false)!;
  const original = structuredClone(profile.value!);
  selectedSlot.value = { ...base, branch: 'tap' };
  expect(pasteSelectedConfiguration(held)).toBe(true);
  expect(profile.value).toEqual(original);
  for (const branch of ['tap', 'hold'] as const) {
    selectedSlot.value = { ...base, branch };
    expect(pasteSelectedConfiguration(wrapper)).toBe(true);
    expect(profile.value).toEqual(original);
  }
  selectedSlot.value = { ...base, branch: 'hold' };
  expect(pasteSelectedConfiguration(held)).toBe(true);
  expect(current().type).toBe('keyHold');
});

it('swaps branches with each other and with ordinary bindings, preserving LEDs and supporting undo', () => {
  start({ type: 'tapHold', tap: { type: 'keyTap', usage: 40, modifiers: 0 }, hold: { type: 'keyTap', usage: 44, modifiers: 0 } });
  const base = selectedSlot.value!;
  const tap: Slot = { ...base, branch: 'tap' }, hold: Slot = { ...base, branch: 'hold' };
  const other: Slot = { kind: 'key', layer: 0, index: 1 };
  setAction(other, { type: 'keyTap', usage: 41, modifiers: 0 });
  const original = structuredClone(profile.value!);
  expect(canInsertSlot(tap, other, 'before')).toBe(false);
  expect(canSwapSlots(tap, base)).toBe(false);
  expect(canSwapSlots(base, tap)).toBe(false);
  expect(canSwapSlots(tap, hold)).toBe(true);
  swapSlotActions(tap, hold);
  expect(getAction(profile.value!, base)).toMatchObject({ tap: { usage: 44 }, hold: { usage: 40 } });
  undo(); expect(profile.value).toEqual(original);
  draggedSlot.value = tap;
  bindingDrag(other).onDrop({ preventDefault() {}, stopPropagation() {} } as DragEvent);
  expect(getAction(profile.value!, tap)).toMatchObject({ usage: 41 });
  expect(getAction(profile.value!, other)).toMatchObject({ usage: 40 });
  expect(profile.value!.layers[0]!.leds).toEqual(original.layers[0]!.leds);
  undo(); expect(profile.value).toEqual(original);
  draggedSlot.value = null; slotDrop.value = null;
});

it('accepts shortcut drops into branches while enforcing gesture restrictions', () => {
  start(); addHold();
  const base = selectedSlot.value!;
  const tap: Slot = { ...base, branch: 'tap' }, hold: Slot = { ...base, branch: 'hold' };
  const shortcut = { id: 'test', label: 'Test', tags: [], action: { type: 'keyHold', usage: 44, modifiers: 0 } } as unknown as NonNullable<typeof draggedShortcut.value>;
  expect(canApplyShortcut(shortcut, tap)).toBe(false);
  expect(canApplyShortcut(shortcut, hold)).toBe(true);
  draggedShortcut.value = shortcut;
  shortcutDrop({ preventDefault() {}, stopPropagation() {} } as DragEvent, hold);
  expect(getAction(profile.value!, base)).toMatchObject({ tap: { usage: 40 }, hold: { type: 'keyHold', usage: 44 } });
  expect(canSwapSlots(hold, tap)).toBe(false);
  endShortcutDrag();
});


it.each(['tap', 'hold'] as const)('uses only the action as the %s drag preview', branch => {
  start(); addHold();
  vi.useFakeTimers();
  try {
    const preview = { style: { setProperty: vi.fn() }, querySelectorAll: () => [], removeAttribute: vi.fn(), setAttribute: vi.fn(), remove: vi.fn() };
    const action = { getBoundingClientRect: () => ({ left: 80, top: 20, width: 120, height: 20 }),
      querySelectorAll: () => [], cloneNode: vi.fn(() => preview) };
    const header = { querySelector: vi.fn(() => action), cloneNode: vi.fn() };
    vi.stubGlobal('document', { body: { appendChild: vi.fn() } });
    vi.stubGlobal('getComputedStyle', () => Object.assign([], { borderRadius: '0px' }));
    const event = { currentTarget: header, clientX: 100, clientY: 30,
      dataTransfer: { setData: vi.fn(), setDragImage: vi.fn() } };
    bindingDrag({ ...selectedSlot.value!, branch }).onDragStart(event as unknown as DragEvent);
    expect(header.querySelector).toHaveBeenCalledWith('.gesture-drag-label');
    expect(action.cloneNode).toHaveBeenCalledWith(true);
    expect(header.cloneNode).not.toHaveBeenCalled();
    expect(event.dataTransfer.setDragImage).toHaveBeenCalledWith(preview, 60, 25);
    expect(preview.style).toMatchObject({ width: '120px', height: '20px' });
    vi.runAllTimers();
    expect(preview.remove).toHaveBeenCalled();
  } finally {
    draggedSlot.value = null;
    vi.useRealTimers();
  }
});
