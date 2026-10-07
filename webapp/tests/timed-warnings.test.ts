import { afterEach, expect, it } from 'vitest';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { LayerIndicatorBehavior } from '../src/model/constants';
import { selfReferentialLayerWarnings } from '../src/model/layerWarnings';
import { timedToggleWarnings } from '../src/model/timedWarnings';
import type { Action } from '../src/model/types';
import { encodeProfile } from '../src/codec/encode';
import { validateProfile } from '../src/model/validate';
import { IssuesPanel } from '../src/ui/components/IssuesPanel';
import { profile, selectedLayer, selectedSlot, timerWarnings, updateProfile } from '../src/ui/store';

function setup(action: Action = { type: 'relativeLayer', offset: 0 }) {
  const p = defaultProfile(0);
  p.layers = [emptyLayer(0), emptyLayer(0)];
  p.timedActions = [{ layer: 0, ticks: 1, resetOnInput: true, consumeInput: false, action, resumeAction: { type: 'none' } }];
  return p;
}

afterEach(() => { profile.value = null; selectedLayer.value = 0; selectedSlot.value = null; });

it('detects the reported layer-scoped relative-zero timer and respects indicator feedback', () => {
  const p = setup();
  expect(selfReferentialLayerWarnings(p)).toEqual([{
    where: 'Timed action 1',
    message: expect.stringContaining('Layer 1'),
    slot: { kind: 'timed', layer: 0, index: 0, resume: false },
  }]);
  p.layers[0]!.indicatorBehavior = LayerIndicatorBehavior.TimedOn;
  expect(selfReferentialLayerWarnings(p)).toEqual([]);
  p.layers[0]!.indicatorBehavior = LayerIndicatorBehavior.AlwaysOn;
  expect(selfReferentialLayerWarnings(p)).toHaveLength(1);
});

it('checks global timers on every possible source layer, including wrapped relative actions', () => {
  const p = setup({ type: 'oneShotRelativeLayer', offset: 2 });
  delete p.timedActions![0]!.layer;
  expect(selfReferentialLayerWarnings(p).map(w => w.message)).toEqual([
    expect.stringContaining('Layer 1'), expect.stringContaining('Layer 2'),
  ]);
  p.timedActions![0]!.action = { type: 'setLayer', layer: 1 };
  expect(selfReferentialLayerWarnings(p)).toHaveLength(1);
  p.timedActions![0]!.layer = 0;
  expect(selfReferentialLayerWarnings(p)).toEqual([]);
});

it('checks next-input actions on all layers even for a scoped timer and skips invalid actions', () => {
  const p = setup({ type: 'none' });
  p.timedActions![0]!.resumeAction = { type: 'setLayer', layer: 1 };
  expect(selfReferentialLayerWarnings(p)[0]).toMatchObject({
    message: expect.stringContaining('Layer 2'), slot: { kind: 'timed', resume: true },
  });
  p.timedActions![0]!.resumeAction = { type: 'momentaryLayer', layer: 1 };
  expect(selfReferentialLayerWarnings(p)).toEqual([]);
  p.timedActions![0]!.action = { type: 'setLayer', layer: 99 };
  expect(selfReferentialLayerWarnings(p)).toEqual([]);
  p.timedActions![0]!.action = { type: 'relativeLayer', offset: 0 };
  p.timedActions![0]!.layer = 99;
  expect(selfReferentialLayerWarnings(p)).toEqual([]);
});

it.each([
  { type: 'ledControl', command: 'commonPresetToggle', value: 4 },
  { type: 'mouseToggle', buttons: 1 },
] satisfies Action[])('warns for repeating $type toggles without blocking saving', action => {
  const p = setup(action);
  expect(timedToggleWarnings(p)).toHaveLength(1);
  expect(validateProfile(p)).toEqual([]);
  expect(() => encodeProfile(p)).not.toThrow();
  p.timedActions![0]!.action = { type: 'none' };
  p.timedActions![0]!.resumeAction = action;
  expect(timedToggleWarnings(p)).toEqual([]);
});

it('updates the sidebar after edits and navigates to the affected timer', () => {
  type Node = { type: unknown; props: Record<string, unknown> };
  const nodes = (value: unknown): Node[] => {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== 'object' || !('props' in value)) return [];
    const node = value as Node;
    return [node, ...nodes(node.props.children)];
  };
  profile.value = setup({ type: 'ledControl', command: 'commonPresetToggle', value: 4 });
  const warning = timerWarnings.value[0]!;
  expect(nodes(IssuesPanel()).some(n => n.props.children === warning.message)).toBe(true);
  const link = nodes(IssuesPanel()).find(n => n.type === 'button' && n.props.children === warning.where)!;
  selectedSlot.value = null;
  (link.props.onClick as () => void)();
  expect(selectedSlot.value).toEqual(warning.slot);
  updateProfile(draft => { draft.timedActions![0]!.action = { type: 'ledControl', command: 'commonPresetSet', value: 4 }; });
  expect(timerWarnings.value).toEqual([]);
  expect(nodes(IssuesPanel()).some(n => n.props.children === warning.message)).toBe(false);
});
