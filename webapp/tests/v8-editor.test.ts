import { expect, it, vi } from 'vitest';
import { Inspector } from '../src/ui/components/Inspector';
import { profile, selectedSlot, getAction, setAction, canSwapSlots } from '../src/ui/store';
import { defaultProfile } from '../src/model/defaults';
import { actionNeedsRelease } from '../src/model/actions';
import type { Action, Slot } from '../src/model/types';
vi.mock('preact/hooks', () => ({ useMemo: (factory: () => unknown) => factory(), useState: (initial: unknown) => [initial, vi.fn()] }));
type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const n = value as Node; return [n, ...nodes(n.props.children)];
}
function start(action: Action) {
  profile.value = defaultProfile(0);
  selectedSlot.value = { kind: 'key', layer: 0, index: 0 };
  setAction(selectedSlot.value, action);
}
function selects() { return nodes(Inspector()).filter(n => n.type === 'select'); }
function change(node: Node, value: string) { (node.props.onChange as (event: unknown) => void)({ target: { value } }); }

it('places Media Hold after Media Tap and preserves custom usage when changing either way', () => {
  start({ type: 'consumer', usage: 0xabc });
  const media = nodes(selects()[0]!.props.children).find(n => n.type === 'optgroup' && n.props.label === 'Media')!;
  expect(nodes(media).filter(n => n.type === 'option').map(n => n.props.value)).toEqual(['consumer', 'consumerHold']);
  change(selects()[0]!, 'consumerHold');
  expect(getAction(profile.value!, selectedSlot.value!)).toEqual({ type: 'consumerHold', usage: 0xabc });
  const control = nodes(Inspector()).find(n => typeof n.type === 'function' && n.type.name === 'ConsumerControl')!;
  expect(nodes((control.type as (p: unknown) => unknown)(control.props)).find(n => n.type === 'select')!.props.value).toBe('custom');
  change(selects()[0]!, 'consumer');
  expect(getAction(profile.value!, selectedSlot.value!)).toEqual({ type: 'consumer', usage: 0xabc });
});

it('toggles held scrolling without changing its direction or magnitude', () => {
  start({ type: 'scroll', delta: -3 });
  const behavior = () => nodes(Inspector()).find(n => n.props['aria-label'] === 'Scroll behavior')!;
  const buttons = () => nodes(behavior()).filter(n => n.type === 'button');
  (buttons()[1]!.props.onClick as () => void)();
  expect(getAction(profile.value!, selectedSlot.value!)).toEqual({ type: 'scroll', delta: -3, hold: true });
  expect(actionNeedsRelease(getAction(profile.value!, selectedSlot.value!)!)).toBe(true);
  (buttons()[0]!.props.onClick as () => void)();
  expect(getAction(profile.value!, selectedSlot.value!)).toMatchObject({ type: 'scroll', delta: -3 });
  expect(actionNeedsRelease(getAction(profile.value!, selectedSlot.value!)!)).toBe(false);
});

it.each([{ kind: 'clockwise', layer: 0 }, { kind: 'timed', layer: 0, index: 0, resume: false }] as Slot[])('disables Consumer Hold and hides scroll Hold on release-less slot %o', slot => {
  start({ type: 'consumerHold', usage: 1 });
  profile.value!.timedActions = [{ ticks: 1, resetOnInput: true, consumeInput: false, action: { type: 'scroll', delta: 1 }, resumeAction: { type: 'none' } }];
  selectedSlot.value = slot;
  const option = nodes(selects()[0]!.props.children).find(n => n.type === 'option' && n.props.value === 'consumerHold')!;
  expect(option.props.disabled).toBe(true);
  setAction(slot, { type: 'scroll', delta: 1 });
  expect(nodes(Inspector()).some(n => n.props['aria-label'] === 'Scroll behavior')).toBe(false);
  expect(canSwapSlots({ kind: 'key', layer: 0, index: 0 }, slot)).toBe(false);
});

it('edits Single, Double and Custom clicks with a 3–16 slider and preserves mouse buttons', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  start({ type: 'mouseClick', buttons: 5 });
  const modes = () => nodes(nodes(Inspector()).find(n => n.props['aria-label'] === 'Click behavior')!).filter(n => n.type === 'button');
  const slider = () => nodes(Inspector()).find(n => n.props['aria-label'] === 'Click count');
  expect(modes().map(n => n.props.children)).toEqual(['Single', 'Double', 'Custom']);
  expect(modes().map(n => n.props['aria-pressed'])).toEqual([true, false, false]);
  expect(slider()).toBeUndefined();
  expect(nodes(selects()[0]!.props.children).some(n => n.props.value === 'mouseDouble')).toBe(false);
  (modes()[1]!.props.onClick as () => void)();
  expect(getAction(profile.value!, selectedSlot.value!)).toEqual({ type: 'mouseClick', buttons: 5, clicks: 2 });
  expect(slider()).toBeUndefined();
  (modes()[2]!.props.onClick as () => void)();
  expect(slider()?.props).toMatchObject({ min: 3, max: 16, step: 1, value: 3 });
  (slider()!.props.onInput as (event: unknown) => void)({ target: { value: '16' } });
  expect(getAction(profile.value!, selectedSlot.value!)).toEqual({ type: 'mouseClick', buttons: 5, clicks: 16 });
  expect(modes().map(n => n.props['aria-pressed'])).toEqual([false, false, true]);
  (modes()[2]!.props.onClick as () => void)();
  expect(slider()?.props.value).toBe(16);
  (modes()[0]!.props.onClick as () => void)();
  expect(getAction(profile.value!, selectedSlot.value!)).toEqual({ type: 'mouseClick', buttons: 5 });
  expect(slider()).toBeUndefined();
  (modes()[2]!.props.onClick as () => void)();
  expect(slider()?.props.value).toBe(16);
  (modes()[1]!.props.onClick as () => void)();
  expect(getAction(profile.value!, selectedSlot.value!)).toEqual({ type: 'mouseClick', buttons: 5, clicks: 2 });
  (modes()[2]!.props.onClick as () => void)();
  expect(slider()?.props.value).toBe(16);
  vi.unstubAllGlobals();
});
