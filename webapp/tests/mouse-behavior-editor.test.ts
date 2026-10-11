import { afterEach, expect, it, vi } from 'vitest';
import { Inspector } from '../src/ui/components/Inspector';
import { defaultProfile } from '../src/model/defaults';
import { getAction, profile, selectedSlot, setAction, undo, redo } from '../src/ui/store';
import type { Action, Slot } from '../src/model/types';

vi.mock('preact/hooks', () => ({
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: vi.fn(),
}));
type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function textContent(value: unknown): string {
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'props' in value) return textContent((value as Node).props.children);
  return '';
}
function start(slot: Slot, action: Action) {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  profile.value = defaultProfile(0);
  profile.value.macros = [{ actions: [{ type: 'mouseClick', buttons: 1 }] }];
  profile.value.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: { type: 'none' }, resumeAction: { type: 'none' } }];
  selectedSlot.value = slot;
  setAction(slot, action);
}
function choose(type: Action['type']) {
  const select = nodes(Inspector()).find(n => n.props['aria-label'] === 'Mouse behavior')!;
  (select.props.onChange as (e: unknown) => void)({ target: { value: type } });
}
afterEach(() => vi.unstubAllGlobals());

it.each(['mouseClick', 'mouseHold', 'mouseToggle', 'mouseDown', 'mouseUp'] as const)('opens saved %s under Mouse click with the correct behavior and click controls', type => {
  start({ kind: 'key', layer: 0, index: 0 }, { type, buttons: 5 });
  const tree = nodes(Inspector());
  const actionSelect = tree.find(n => n.type === 'select')!;
  expect(actionSelect.props.value).toBe('mouseClick');
  expect(nodes(actionSelect).filter(n => n.type === 'option' && ['mouseClick', 'mouseHold', 'mouseToggle', 'mouseDown', 'mouseUp'].includes(String(n.props.value))).map(n => n.props.value)).toEqual(['mouseClick']);
  const behavior = tree.find(n => n.props['aria-label'] === 'Mouse behavior')!;
  expect(behavior.props.value).toBe(type);
  expect(nodes(behavior).filter(n => n.type === 'option').map(n => n.props.children)).toEqual(['Click', 'Hold', 'Toggle', 'Down', 'Up']);
  expect(tree.some(n => n.props['aria-label'] === 'Click behavior')).toBe(type === 'mouseClick');
  (actionSelect.props.onChange as (e: unknown) => void)({ target: { value: 'mouseClick' } });
  expect(getAction(profile.value!, selectedSlot.value!)).toEqual({ type, buttons: 5 });
});

it.each<Slot>([
  { kind: 'key', layer: 0, index: 0 },
  { kind: 'encoderButton', layer: 0 },
  { kind: 'clockwise', layer: 0 },
  { kind: 'counterclockwise', layer: 0 },
  { kind: 'timed', layer: 0, index: 0, resume: false },
  { kind: 'timed', layer: 0, index: 0, resume: true },
  { kind: 'macro', layer: 0, index: 0, step: 0 },
])('allows Hold only on physical button slots: $kind', slot => {
  start(slot, { type: 'mouseClick', buttons: 2 });
  const restricted = !['key', 'encoderButton'].includes(slot.kind);
  const tree = nodes(Inspector());
  const hold = tree.find(n => n.type === 'option' && n.props.value === 'mouseHold')!;
  expect(hold.props.disabled).toBe(restricted);
  expect(textContent(tree.find(n => n.props.id === 'mouse-behavior-hint')).includes('Hold is not available on this input.')).toBe(restricted);
  choose('mouseHold');
  expect(getAction(profile.value!, slot)).toEqual({ type: restricted ? 'mouseClick' : 'mouseHold', buttons: 2 });
  for (const type of ['mouseToggle', 'mouseDown', 'mouseUp', 'mouseClick'] as const) {
    choose(type);
    expect(getAction(profile.value!, slot)).toEqual({ type, buttons: 2 });
  }
});

it.each([2, 7])('preserves current buttons and restores %i clicks across behavior changes, with undo and redo', clicks => {
  const slot: Slot = { kind: 'key', layer: 0, index: 0 };
  start(slot, { type: 'mouseClick', buttons: 1, clicks });
  choose('mouseToggle');
  setAction(slot, { type: 'mouseToggle', buttons: 6 });
  choose('mouseClick');
  expect(getAction(profile.value!, slot)).toEqual({ type: 'mouseClick', buttons: 6, clicks });
  undo();
  expect(getAction(profile.value!, slot)).toEqual({ type: 'mouseToggle', buttons: 6 });
  redo();
  expect(getAction(profile.value!, slot)).toEqual({ type: 'mouseClick', buttons: 6, clicks });
  choose('mouseToggle');
  expect(getAction(profile.value!, slot)).toEqual({ type: 'mouseToggle', buttons: 6 });
  setAction(slot, { type: 'mouseToggle', buttons: 128 });
  choose('mouseDown');
  choose('mouseUp');
  choose('mouseToggle');
  choose('mouseClick');
  expect(getAction(profile.value!, slot)).toEqual({ type: 'mouseClick', buttons: 128, clicks });
});
