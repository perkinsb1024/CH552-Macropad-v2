import { expect, it, vi } from 'vitest';
import { Inspector } from '../src/ui/components/Inspector';
import { profile, selectedSlot, getAction, setAction, canSwapSlots } from '../src/ui/store';
import { defaultProfile } from '../src/model/defaults';
import { actionNeedsRelease } from '../src/model/actions';
import type { Action, Slot } from '../src/model/types';
vi.mock('preact/hooks', () => ({ useMemo: (factory: () => unknown) => factory() }));
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
  expect(selects()[1]!.props.value).toBe('custom');
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
