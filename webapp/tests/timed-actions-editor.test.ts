import { afterEach, expect, it, vi } from 'vitest';
import { TimedActionsPanel, approximateDuration, clampTicks } from '../src/ui/components/TimedActionsPanel';
import { Inspector } from '../src/ui/components/Inspector';
import { defaultProfile } from '../src/model/defaults';
import { computeCapacity } from '../src/model/capacity';
import { profile, selectedSlot, getAction, setAction, updateProfile, undo, redo, insertLayer, removeLayer, copySelectedConfiguration, pasteSelectedConfiguration } from '../src/ui/store';
import { storeDraft, loadDraft } from '../src/io/drafts';
vi.mock('preact/hooks', () => ({ useMemo: (factory: () => unknown) => factory(), useState: (initial: unknown) => [initial, vi.fn()] }));
type Node = { type: unknown; props: Record<string, unknown>; ref?: unknown };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function click(node: Node) { (node.props.onClick as () => void)(); }
function add() { click(nodes(TimedActionsPanel()).find(n => n.type === 'button' && n.props.title === 'Add a timed action')!); }
function start() { profile.value = defaultProfile(0); selectedSlot.value = null; }
afterEach(() => vi.unstubAllGlobals());

it('keeps the next-input section open when consume is unchecked without selecting its action', () => {
  start(); add();
  updateProfile(draft => { draft.timedActions![0]!.consumeInput = true; });
  const element = { open: false } as HTMLDetailsElement;
  const section = () => nodes(TimedActionsPanel()).find(n => n.type === 'details' && n.props.class === 'timer-resume')!;
  const attach = () => (section().ref as (element: HTMLDetailsElement) => void)(element);
  attach(); expect(element.open).toBe(true);
  const consume = nodes(section()).filter(n => n.type === 'input' && n.props.type === 'checkbox')[0]!;
  (consume.props.onChange as (e: unknown) => void)({ target: { checked: false } });
  attach();
  expect(element.open).toBe(true);
  expect(profile.value!.timedActions![0]!.consumeInput).toBe(false);
  expect(selectedSlot.value).toMatchObject({ kind: 'timed', resume: false });
  // Manual closing remains intact through unrelated edits.
  element.open = false;
  updateProfile(draft => { draft.timedActions![0]!.ticks = 2; });
  attach(); expect(element.open).toBe(false);
  // Explicitly selecting the next-input action still reveals it.
  selectedSlot.value = { kind: 'timed', layer: 0, index: 0, resume: true };
  attach(); expect(element.open).toBe(true);
});

it('adds and edits expiry/resume actions through the common inspector, including undo', () => {
  start(); add();
  expect(profile.value!.timedActions).toHaveLength(1);
  expect(selectedSlot.value).toMatchObject({ kind: 'timed', index: 0, resume: false });
  expect(nodes(Inspector()).find(n => n.type === 'h2')?.props.children).toBe('Timed action 1');
  const selector = nodes(Inspector()).find(n => n.type === 'select')!;
  expect(nodes(selector.props.children).filter(n => ['keyHold','mouseHold','momentaryLayer'].includes(String(n.props.value))).every(n => n.props.disabled)).toBe(true);
  setAction(selectedSlot.value!, { type: 'ledControl', command: 'commonPresetSet', value: 3 });
  click(nodes(TimedActionsPanel()).find(n => n.props['aria-label'] === 'Edit timer 1 resume action')!);
  setAction(selectedSlot.value!, { type: 'ledControl', command: 'brightnessBothSet', value: 'asConfigured' });
  expect(getAction(profile.value!, selectedSlot.value!)?.type).toBe('ledControl');
  undo(); expect(profile.value!.timedActions![0]!.resumeAction).toEqual({ type: 'none' });
  redo(); expect(profile.value!.timedActions![0]!.resumeAction.type).toBe('ledControl');
  expect(computeCapacity(profile.value!).timedActions).toBe(6);
});
it('edits interval and reset flag, and removes a timer without leaving a stale selection', () => {
  start(); add(); add();
  const input = nodes(TimedActionsPanel()).find(n => n.props['aria-label'] === 'Timer 1 interval ticks')!;
  expect(input.props).toMatchObject({ type: 'range', min: 1, max: 2048, step: 1 });
  (input.props.onInput as (e: unknown) => void)({ target: { value: '55' } });
  const checkbox = nodes(TimedActionsPanel()).find(n => n.props.type === 'checkbox')!;
  (checkbox.props.onChange as (e: unknown) => void)({ target: { checked: false } });
  expect(profile.value!.timedActions![0]).toMatchObject({ ticks: 55, resetOnInput: false });
  click(nodes(TimedActionsPanel()).find(n => n.props['aria-label'] === 'Remove timer 1')!);
  expect(selectedSlot.value).toMatchObject({ index: 0 });
  click(nodes(TimedActionsPanel()).find(n => n.props['aria-label'] === 'Remove timer 1')!);
  expect(profile.value!.timedActions).toBeUndefined();
  expect(selectedSlot.value).toBeNull();
  expect(approximateDuration(55)).toBe('≈ 3 minutes 45 seconds');
  expect(approximateDuration(1)).toBe('≈ 4 seconds');
});
it('limits additions by firmware timer count and shared profile capacity', () => {
  start(); for (let i = 0; i < 4; i++) add();
  expect(nodes(TimedActionsPanel()).some(n => n.type === 'button' && n.props.disabled && n.props.title === 'Maximum 4 timed actions.')).toBe(true);
  start(); profile.value!.layers[0]!.keys[0] = { type: 'string', text: 'x'.repeat(74) };
  expect(nodes(TimedActionsPanel()).some(n => n.type === 'button' && n.props.disabled && String(n.props.title).includes('Not enough storage'))).toBe(true);
});
it('retains timer layer targets when layers move or are removed', () => {
  start(); add();
  updateProfile(p => { p.timedActions![0]!.action = { type: 'setLayer', layer: 1 }; p.timedActions![0]!.resumeAction = { type: 'setLayer', layer: 0 }; });
  insertLayer(1, 0, 'before');
  expect(profile.value!.timedActions![0]).toMatchObject({ action: { layer: 0 }, resumeAction: { layer: 1 } });
  removeLayer(0);
  expect(profile.value!.timedActions![0]!.resumeAction).toMatchObject({ layer: 0 });
});
it('round-trips timer drafts and clipboard actions while rejecting pasted holds', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k,v) });
  start(); add();
  setAction(selectedSlot.value!, { type: 'keyTap', usage: 4, modifiers: 0 });
  const copied = copySelectedConfiguration()!;
  selectedSlot.value = { kind: 'timed', layer: 0, index: 0, resume: true };
  expect(pasteSelectedConfiguration(copied)).toBe(true);
  expect(profile.value!.timedActions![0]!.resumeAction).toMatchObject({ type: 'keyTap', usage: 4 });
  expect(pasteSelectedConfiguration(copied.replace('keyTap', 'keyHold'))).toBe(true);
  expect(profile.value!.timedActions![0]!.resumeAction.type).toBe('keyTap');
  storeDraft(profile.value!, {});
  expect(loadDraft(0)?.profile).toEqual(profile.value);
});

it('clamps edits and provides whole-number durations', () => {
  start(); add();
  for (const [value, ticks] of [['9999',2048], ['0',1], ['-5',1], ['1.5',2], ['',1]] as const) {
    const input = nodes(TimedActionsPanel()).find(n => n.props['aria-label'] === 'Timer 1 interval ticks')!;
    const target = { value };
    (input.props.onInput as (e: unknown) => void)({ target });
    expect(profile.value!.timedActions![0]!.ticks).toBe(ticks);
    expect(String(target.value)).toBe(String(ticks));
  }
  expect(clampTicks('Infinity')).toBe(2048);
  expect(approximateDuration(2048)).toBe('≈ 139 minutes 49 seconds');
  expect(nodes(TimedActionsPanel()).find(n => n.type === 'output')?.props.title).toBeUndefined();
});
it('edits consume independently from restart, and undo restores it', () => {
  start(); add();
  const boxes = nodes(TimedActionsPanel()).filter(n => n.props.type === 'checkbox');
  (boxes[1]!.props.onChange as (e: unknown) => void)({ target: { checked: true } });
  expect(profile.value!.timedActions![0]).toMatchObject({ consumeInput: true, resetOnInput: true });
  undo(); expect(profile.value!.timedActions![0]!.consumeInput).toBe(false);
  redo(); expect(profile.value!.timedActions![0]!.consumeInput).toBe(true);
});
