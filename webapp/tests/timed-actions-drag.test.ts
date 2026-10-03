import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultProfile } from '../src/model/defaults';
import type { Slot } from '../src/model/types';
import { SHORTCUTS, type Shortcut } from '../src/model/shortcuts';
import { draggedSlot, getAction, profile, selectedLayer, selectedSlot, slotDrop, undo } from '../src/ui/store';
import { applyShortcut, draggedShortcut, endShortcutDrag, startShortcutDrag } from '../src/ui/drag';
import { TimedActionsPanel } from '../src/ui/components/TimedActionsPanel';
import { DeviceView } from '../src/ui/components/DeviceView';
import { ChordPanel } from '../src/ui/components/ChordPanel';

vi.mock('preact/hooks', () => ({
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
}));
type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function event() {
  return {
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
    currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
    clientX: 1, clientY: 1,
    dataTransfer: { setData: vi.fn(), effectAllowed: '', dropEffect: '' },
  };
}
function fire(node: Node, name: string, e = event()) {
  (node.props[name] as (event: unknown) => void)(name === 'onDragStart' ? { ...e, currentTarget: null } : e);
  return e;
}
function timedButton(resume: boolean, index = 0) {
  return nodes(TimedActionsPanel()).find(n => n.props['aria-label'] === `Edit timer ${index + 1} ${resume ? 'resume action' : 'action'}`)!;
}
const timerSlot = (resume: boolean, index = 0): Slot => ({ kind: 'timed', layer: 0, index, resume });

beforeEach(() => {
  profile.value = defaultProfile(0);
  profile.value.timedActions = Array.from({ length: 2 }, () => ({ ticks: 5, resetOnInput: true, consumeInput: true,
    action: { type: 'none' }, resumeAction: { type: 'none' } }));
  selectedLayer.value = 0; selectedSlot.value = null; draggedSlot.value = null;
  endShortcutDrag();
});
afterEach(() => { draggedSlot.value = null; endShortcutDrag(); });

it.each([false, true])('drops shortcuts onto timer resume=%s and supports click assignment and undo', resume => {
  const shortcut = SHORTCUTS.find(s => s.id === 'volume-up')!;
  const before = structuredClone(profile.value);
  startShortcutDrag({ ...event(), currentTarget: null } as unknown as DragEvent, shortcut);
  const hover = fire(timedButton(resume), 'onDragOver');
  expect(hover.dataTransfer.dropEffect).toBe('copy');
  expect(hover.preventDefault).toHaveBeenCalled();
  expect(String(timedButton(resume).props.class)).toContain('is-drop-target');
  fire(timedButton(resume), 'onDrop');
  expect(getAction(profile.value!, timerSlot(resume))).toEqual(shortcut.action);
  expect(selectedSlot.value).toEqual(timerSlot(resume));
  expect(draggedShortcut.value).toBeNull(); expect(slotDrop.value).toBeNull();
  undo(); expect(profile.value).toEqual(before);
  applyShortcut(shortcut, timerSlot(resume));
  expect(getAction(profile.value!, timerSlot(resume))).toEqual(shortcut.action);
});

it.each([false, true])('swaps bindings into timer resume=%s while preserving timer settings and key colors', resume => {
  const sources: Slot[] = [{ kind: 'key', layer: 0, index: 0 }, { kind: 'clockwise', layer: 0 },
    { kind: 'encoderButton', layer: 0 }, { kind: 'chord', layer: 0, keyA: 0, keyB: 1 }, timerSlot(!resume, 1)];
  const action = { type: 'ledControl', command: 'effectBlink8', value: 15, brightness: 'dim' } as const;
  for (const source of sources) {
    const p = profile.value!;
    p.layers[0]!.keys[0] = action; p.layers[0]!.clockwise = action; p.layers[0]!.encoderButton = action;
    p.chords = [{ layer: 0, keyA: 0, keyB: 1, action }];
    p.timedActions![1]![resume ? 'action' : 'resumeAction'] = action;
    p.timedActions![0]![resume ? 'resumeAction' : 'action'] = { type: 'none' };
    const before = structuredClone(p);
    draggedSlot.value = source;
    expect(fire(timedButton(resume), 'onDragOver').dataTransfer.dropEffect).toBe('move');
    fire(timedButton(resume), 'onDrop');
    expect(getAction(profile.value!, timerSlot(resume))).toEqual(action);
    expect(getAction(profile.value!, source)).toEqual({ type: 'none' });
    expect(profile.value!.layers[0]!.leds).toEqual(before.layers[0]!.leds);
    expect(profile.value!.timedActions![0]).toMatchObject({ ticks: 5, resetOnInput: true, consumeInput: true });
    expect(draggedSlot.value).toBeNull(); expect(slotDrop.value).toBeNull();
    undo(); expect(profile.value).toEqual(before);
  }
});

it.each([false, true])('drags timer resume=%s out to key, encoder and chord edges as swaps', resume => {
  const action = { type: 'consumer', usage: 0xe9 } as const;
  profile.value!.timedActions![0]![resume ? 'resumeAction' : 'action'] = action;
  profile.value!.chords = [{ layer: 0, keyA: 0, keyB: 1, action: { type: 'none' } }];
  const findTargets = () => [
    nodes(DeviceView()).find(n => n.type === 'button' && String(n.props['aria-label']).startsWith('Key 1:'))!,
    nodes(DeviceView()).find(n => n.type === 'button' && String(n.props.class).includes('enc-part'))!,
    nodes(ChordPanel()).find(n => n.type === 'button' && n.props.class === 'chord-main')!,
  ];
  for (let index = 0; index < 3; index++) {
    const before = structuredClone(profile.value);
    const start = fire(timedButton(resume), 'onDragStart');
    expect(start.dataTransfer.effectAllowed).toBe('move');
    expect(draggedSlot.value).toEqual(timerSlot(resume));
    fire(findTargets()[index]!, 'onDragOver');
    expect(slotDrop.value?.position).toBe('swap');
    const target = slotDrop.value!.slot;
    fire(findTargets()[index]!, 'onDrop');
    expect(getAction(profile.value!, target)).toEqual(action);
    undo(); expect(profile.value).toEqual(before);
  }
  fire(timedButton(resume), 'onDragStart');
  fire(timedButton(resume), 'onDragEnd');
  expect(draggedSlot.value).toBeNull(); expect(slotDrop.value).toBeNull();
});

it.each([false, true])('rejects held bindings and shortcuts on timer resume=%s', resume => {
  const hold = { type: 'keyHold', usage: 4, modifiers: 0 } as const;
  profile.value!.layers[0]!.keys[0] = hold;
  const before = structuredClone(profile.value);
  draggedSlot.value = { kind: 'key', layer: 0, index: 0 };
  const hover = fire(timedButton(resume), 'onDragOver');
  expect(hover.dataTransfer.dropEffect).toBe('none');
  expect(hover.preventDefault).not.toHaveBeenCalled();
  expect(String(timedButton(resume).props.class)).toContain('drag-invalid');
  fire(timedButton(resume), 'onDrop');
  expect(profile.value).toEqual(before);
  startShortcutDrag({ ...event(), currentTarget: null } as unknown as DragEvent, { ...SHORTCUTS[0]!, action: hold } as Shortcut);
  expect(fire(timedButton(resume), 'onDragOver').dataTransfer.dropEffect).toBe('none');
  fire(timedButton(resume), 'onDrop');
  expect(profile.value).toEqual(before);
});
