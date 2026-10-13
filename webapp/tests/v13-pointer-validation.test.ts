import { afterEach, expect, it, vi } from 'vitest';
import { defaultProfile } from '../src/model/defaults';
import { validateProfile } from '../src/model/validate';
import { encodeProfile } from '../src/codec/encode';
import type { Action, Slot } from '../src/model/types';
import { IssuesPanel } from '../src/ui/components/IssuesPanel';
import { navigateToSlot } from '../src/ui/navigation';
import { issues, profile, selectedSlot, setAction } from '../src/ui/store';

vi.mock('../src/ui/navigation', () => ({ navigateToSlot: vi.fn(), navigateToLayer: vi.fn(), navigateToMacro: vi.fn() }));
afterEach(() => { profile.value = null; selectedSlot.value = null; vi.clearAllMocks(); });

it.each([0, 1] as const)('rejects zero combined movement at every binding on variant %s', variant => {
  const p = defaultProfile(variant);
  const zero: Action = { type: 'mouseXY', x: 0, y: 0 };
  p.layers[0]!.keys[0] = { ...zero, hold: true };
  p.layers[0]!.encoderButton = zero;
  p.layers[0]!.clockwise = zero;
  p.layers[0]!.counterclockwise = zero;
  p.chords = [
    { layer: 0, keyA: 0, keyB: 1, action: zero },
    { layer: 0, keyA: 0, keyB: 2, global: true, action: zero },
  ];
  p.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: zero, resumeAction: zero }];
  p.macros = [{ actions: [{ type: 'pause', ticks: 1 }, zero] }];
  const warnings = validateProfile(p);
  expect(warnings.map(w => w.slot)).toEqual([
    { kind: 'key', layer: 0, index: 0 },
    { kind: 'encoderButton', layer: 0 },
    { kind: 'clockwise', layer: 0 },
    { kind: 'counterclockwise', layer: 0 },
    { kind: 'chord', layer: 0, keyA: 0, keyB: 1 },
    { kind: 'chord', layer: 0, keyA: 0, keyB: 2, global: true },
    { kind: 'timed', layer: 0, index: 0, resume: false },
    { kind: 'timed', layer: 0, index: 0, resume: true },
    { kind: 'macro', layer: 0, index: 0, step: 1 },
  ] satisfies Slot[]);
  expect(warnings.every(w => w.where && w.message.includes('4–64'))).toBe(true);
  expect(() => encodeProfile(p)).toThrow('4–64');
});

it('rejects either zero axis while accepting combined and single-axis movement', () => {
  const p = defaultProfile(0);
  p.layers[0]!.keys = [
    { type: 'mouseXY', x: 0, y: 4 }, { type: 'mouseXY', x: -4, y: 0 },
    { type: 'mouseXY', x: -4, y: 4 }, { type: 'mouseX', delta: 1 },
    { type: 'mouseY', delta: -1 }, { type: 'none' },
  ];
  expect(validateProfile(p).map(issue => issue.slot)).toEqual([
    { kind: 'key', layer: 0, index: 0 }, { kind: 'key', layer: 0, index: 1 },
  ]);
});

type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const n = value as Node;
  return [n, ...nodes(n.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join('');
  if (value && typeof value === 'object' && 'props' in value) return text((value as Node).props.children);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

it('shows a blocking sidebar issue, navigates to its action, and clears when corrected', () => {
  profile.value = defaultProfile(0);
  const slot: Slot = { kind: 'key', layer: 0, index: 0 };
  setAction(slot, { type: 'mouseXY', x: 0, y: 0 });
  expect(issues.value).toHaveLength(1);
  const card = nodes(IssuesPanel()).find(n => n.type === 'details' && text(n).includes('Fix Before Saving'))!;
  expect(card.props.open).toBe(true);
  expect(card.props.class).toContain('issues-error');
  expect(nodes(card).find(n => n.type === 'span' && n.props.class === 'warn')!.props.children).toBe(1);
  const link = nodes(card).find(n => n.type === 'button')!;
  (link.props.onClick as () => void)();
  expect(navigateToSlot).toHaveBeenCalledWith(slot);
  setAction(slot, { type: 'mouseXY', x: 4, y: 4 });
  expect(issues.value).toEqual([]);
  expect(text(IssuesPanel())).not.toContain('Fix Before Saving');
});
