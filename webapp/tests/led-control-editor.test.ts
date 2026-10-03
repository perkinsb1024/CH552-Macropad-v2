import { expect, it, vi } from 'vitest';
import { Inspector } from '../src/ui/components/Inspector';
import { profile, selectedSlot } from '../src/ui/store';
import { defaultProfile } from '../src/model/defaults';
import { LED_COMMANDS, isLedEffect, ledProblem, ledValueOptions } from '../src/model/ledControl';
import { encodeAction } from '../src/codec/encode';
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
it('offers all existing LED commands plus one temporary-effect command and switches each to a valid default', () => {
  setup();
  const commands = nodes(selects()[1]!.props.children);
  expect(commands.filter(n => !n.props.disabled).map(n => n.props.value)).toEqual([
    ...LED_COMMANDS.filter(c => c.command !== 'restoreAll' && !isLedEffect(c.command)).map(c => c.command), 'temporaryEffect', 'restoreAll',
  ]);
  expect(commands.at(-2)!.props).toMatchObject({ value: '', disabled: true });
  const before = profile.value!.layers[0]!.keys[0];
  change(selects()[1]!, '');
  expect(profile.value!.layers[0]!.keys[0]).toEqual(before);
  for (const spec of LED_COMMANDS.filter(c => !isLedEffect(c.command))) {
    change(selects()[1]!, spec.command);
    const action = profile.value!.layers[0]!.keys[0]!;
    if (action.type !== 'ledControl') throw new Error('wrong action');
    expect(ledProblem(action.command, action.value)).toBeNull();
    if (spec.command === 'restoreAll') { expect(selects()).toHaveLength(2); continue; }
    const field = selects()[2]!;
    const options = nodes(field.props.children).filter(n => n.type === 'option');
    const relativeSteps = spec.command === 'rainbowPhaseRelative' || spec.command === 'rainbowSpeedRelative'
      ? [-2,-1,1,2] : [-1,1];
    expect(options.map(n => n.props.value)).toEqual(spec.relative ? relativeSteps : ledValueOptions(spec.command).map(o => o.value));
    for (const option of options) {
      change(field, String(option.props.value));
      const next = profile.value!.layers[0]!.keys[0]!;
      if (next.type !== 'ledControl') throw new Error('wrong action');
      expect(ledProblem(next.command, next.value)).toBeNull();
      expect(next.value).toBe(option.props.value);
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

it('defaults the toggle to dark mode and excludes the configured endpoint', () => {
  setup(); change(selects()[1]!, 'commonPresetToggle');
  expect(profile.value!.layers[0]!.keys[0]).toEqual({ type: 'ledControl', command: 'commonPresetToggle', value: 3 });
  expect(nodes(selects()[2]!.props.children).filter(n => n.type === 'option').map(n => n.props.value)).toEqual([1, 2, 3, 4]);
});

function effectColors() {
  const group = nodes(Inspector()).find(n => n.props['aria-label'] === 'Temporary LED effect color');
  return nodes(group).filter(n => n.props.role === 'radio');
}
it('groups temporary effects into one command, hides restored controls, and selects rainbow', () => {
  setup(); change(selects()[1]!, 'temporaryEffect');
  expect(profile.value!.layers[0]!.keys[0]).toEqual({ type: 'ledControl', command: 'effectRestore', value: 0 });
  expect(effectColors()).toHaveLength(0);
  change(selects()[2]!, 'effectOn');
  expect(profile.value!.layers[0]!.keys[0]).toMatchObject({ command: 'effectOn', value: 15 });
  for (const mode of LED_COMMANDS.filter(c => isLedEffect(c.command) && c.command !== 'effectRestore')) {
    change(selects()[2]!, mode.command === 'effectOn' ? 'effectOn' : 'blink');
    if (mode.command !== 'effectOn') {
      const slider = nodes(Inspector()).find(n => n.props['aria-label'] === 'Blink count')!;
      (slider.props.onInput as (e: unknown) => void)({ target: { value: String(mode.code - 0x81) } });
    }
    const colors = effectColors();
    expect(colors).toHaveLength(16);
    for (const [index, swatch] of colors.entries()) {
      (swatch.props.onClick as () => void)();
      expect(profile.value!.layers[0]!.keys[0]).toMatchObject({ command: mode.command, value: index });
    }
    expect(colors[15]!.props['aria-label']).toBe('Rainbow');
  }
  change(selects()[2]!, 'effectRestore');
  expect(effectColors()).toHaveLength(0);
});

function brightnessButtons() {
  return nodes(nodes(Inspector()).find(n => n.props['aria-label'] === 'Temporary LED effect brightness')).filter(n => n.type === 'button');
}
function blinkSlider() { return nodes(Inspector()).find(n => n.props['aria-label'] === 'Blink count'); }

it('offers one Blink mode and a 1–8 count slider, preserving color and dim brightness', () => {
  setup(); change(selects()[1]!, 'temporaryEffect');
  expect(nodes(selects()[2]!.props.children).map(n => n.props.children)).toEqual(['As configured', 'Always on', 'Blink']);
  expect(blinkSlider()).toBeUndefined();
  expect(brightnessButtons()).toHaveLength(0);
  change(selects()[2]!, 'effectOn');
  expect(brightnessButtons().map(n => n.props.children)).toEqual(['Full Brightness', 'Dim']);
  expect(brightnessButtons()[0]!.props['aria-pressed']).toBe(true);
  (brightnessButtons()[1]!.props.onClick as () => void)();
  (effectColors()[4]!.props.onClick as () => void)();
  change(selects()[2]!, 'blink');
  for (let count = 1; count <= 8; count++) {
    const slider = blinkSlider()!;
    expect(slider.props).toMatchObject({ type: 'range', min: 1, max: 8, step: 1 });
    (slider.props.onInput as (e: unknown) => void)({ target: { value: String(count) } });
    const action = profile.value!.layers[0]!.keys[0]!;
    expect(action).toEqual({ type: 'ledControl', command: `effectBlink${count}`, value: 4, brightness: 'dim' });
    expect(encodeAction(action, new Map())).toEqual([0x4f, 0x91 + count]);
    expect(blinkSlider()!.props.value).toBe(count);
    expect(nodes(Inspector()).filter(n => n.type === 'output').some(n =>
      JSON.stringify(n.props.children) === JSON.stringify([count, ' ', count === 1 ? 'time' : 'times']))).toBe(true);
  }
  // Existing saved counts render as Blink with their original count.
  expect(selects()[2]!.props.value).toBe('blink');
  change(selects()[2]!, 'effectOn');
  expect(blinkSlider()).toBeUndefined();
  expect(profile.value!.layers[0]!.keys[0]).toMatchObject({ value: 4, brightness: 'dim' });
  (brightnessButtons()[0]!.props.onClick as () => void)();
  expect(profile.value!.layers[0]!.keys[0]).toEqual({ type: 'ledControl', command: 'effectOn', value: 4 });
  (brightnessButtons()[1]!.props.onClick as () => void)();
  change(selects()[2]!, 'effectRestore');
  expect(profile.value!.layers[0]!.keys[0]).toEqual({ type: 'ledControl', command: 'effectRestore', value: 0 });
  expect(brightnessButtons()).toHaveLength(0);
  expect(blinkSlider()).toBeUndefined();
});
