import { expect, it, vi } from 'vitest';
import { Inspector } from '../src/ui/components/Inspector';
import { profile, selectedSlot } from '../src/ui/store';
import { defaultProfile } from '../src/model/defaults';
import { LED_COMMANDS, ledProblem, ledValueOptions } from '../src/model/ledControl';
vi.mock('preact/hooks', () => ({ useMemo: (factory: () => unknown) => factory() }));
type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function setup() {
  profile.value = defaultProfile(1);
  profile.value.layers[0]!.keys[0] = { type: 'ledControl', command: 'commonPresetRelative', value: 1 };
  selectedSlot.value = { kind: 'key', layer: 0, index: 0 };
}
function selects() { return nodes(Inspector()).filter(n => n.type === 'select'); }
function change(node: Node, value: string) { (node.props.onChange as (e: unknown) => void)({ target: { value } }); }
it('offers all 13 LED commands and switches each to a valid default', () => {
  setup();
  const commands = nodes(selects()[1]!.props.children);
  expect(commands.filter(n => !n.props.disabled).map(n => n.props.value)).toEqual([
    ...LED_COMMANDS.filter(c => c.command !== 'restoreAll').map(c => c.command), 'restoreAll',
  ]);
  expect(commands.at(-2)!.props).toMatchObject({ value: '', disabled: true });
  const before = profile.value!.layers[0]!.keys[0];
  change(selects()[1]!, '');
  expect(profile.value!.layers[0]!.keys[0]).toEqual(before);
  for (const spec of LED_COMMANDS) {
    change(selects()[1]!, spec.command);
    const action = profile.value!.layers[0]!.keys[0]!;
    if (action.type !== 'ledControl') throw new Error('wrong action');
    expect(ledProblem(action.command, action.value)).toBeNull();
    if (spec.command === 'restoreAll') { expect(selects()).toHaveLength(2); continue; }
    const field = selects()[2]!;
    const options = nodes(field.props.children).filter(n => n.type === 'option');
    expect(options.map(n => n.props.value)).toEqual(spec.relative ? [-1,1] : ledValueOptions(spec.command).map(o => o.value));
    for (const option of options) {
      change(field, String(option.props.value));
      const next = profile.value!.layers[0]!.keys[0]!;
      if (next.type !== 'ledControl') throw new Error('wrong action');
      expect(ledProblem(next.command, next.value)).toBeNull();
    }
  }
});
it('preserves existing larger relative steps but only permits editing to minus or plus one', () => {
  setup();
  profile.value!.layers[0]!.keys[0] = { type: 'ledControl', command: 'commonPresetRelative', value: 3 };
  const field = selects()[2]!;
  const options = nodes(field.props.children).filter(n => n.type === 'option');
  expect(options.map(n => n.props.value)).toEqual([3, -1, 1]);
  expect(options[0]!.props.disabled).toBe(true);
  expect(profile.value!.layers[0]!.keys[0]).toMatchObject({ value: 3 });
  change(field, '2');
  expect(profile.value!.layers[0]!.keys[0]).toMatchObject({ value: 3 });
  change(field, '-1');
  expect(profile.value!.layers[0]!.keys[0]).toEqual({ type: 'ledControl', command: 'commonPresetRelative', value: -1 });
});
it('shows phase degrees without approximation marks and permits configured restores', () => {
  setup(); change(selects()[1]!, 'rainbowPhaseSet');
  expect(nodes(selects()[2]!.props.children).map(n => n.props.children)).toEqual(['0°', '30°', '60°', 'Variable', 'As configured']);
  change(selects()[2]!, 'asConfigured');
  expect(profile.value!.layers[0]!.keys[0]).toEqual({ type: 'ledControl', command: 'rainbowPhaseSet', value: 'asConfigured' });
});
