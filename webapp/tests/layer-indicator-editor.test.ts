import { describe, expect, it, vi } from 'vitest';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import type { Action } from '../src/model/types';
import type { Variant } from '../src/model/constants';
import { Inspector } from '../src/ui/components/Inspector';
import { profile, selectedSlot } from '../src/ui/store';

// Inspect the component's controls without mounting a browser DOM.
vi.mock('preact/hooks', () => ({ useMemo: (factory: () => unknown) => factory(), useState: (initial: unknown) => [initial, vi.fn()] }));

type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node && typeof node === 'object' && 'props' in node) return text((node as Element).props.children);
  return '';
}
function edit(action: Action, variant: Variant = 0) {
  const p = defaultProfile(variant);
  p.layers = [emptyLayer(variant), emptyLayer(variant)];
  p.layers[0]!.keys[0] = action;
  profile.value = p;
  selectedSlot.value = { kind: 'key', layer: 0, index: 0 };
  return elements(Inspector());
}
const message = "Changing to the same layer is useful to display the current layer's indicator";

describe('same-layer indicator actions', () => {
  it.each([
    ['relativeLayer', 0, 4], ['oneShotRelativeLayer', 0, 4],
    ['relativeLayer', 1, 6], ['oneShotRelativeLayer', 1, 6],
  ] as const)('offers a slider with zero for %s on variant %s', (type, variant, limit) => {
    const nodes = edit({ type, offset: 1 }, variant);
    const slider = nodes.find((node) => node.type === 'input' && node.props['aria-label'] === 'Relative offset')!;
    expect(slider.props).toMatchObject({ type: 'range', min: -limit, max: limit, step: 1, value: 1 });
    expect(nodes.filter((node) => node.type === 'output').map(text)).toContain('+1');
    expect(nodes.some((node) => text(node) === message)).toBe(false);
    (slider.props.onInput as (event: unknown) => void)({ target: { value: '0' } });
    expect(profile.value!.layers[0]!.keys[0]).toEqual({ type, offset: 0 });
    expect(elements(Inspector()).some((node) => text(node) === message)).toBe(true);
  });

  it.each([
    { type: 'setLayer', layer: 0 }, { type: 'oneShotSetLayer', layer: 0 },
    { type: 'momentaryLayer', layer: 0 }, { type: 'relativeLayer', offset: 2 },
    { type: 'oneShotRelativeLayer', offset: -2 },
  ] satisfies Action[])('explains selections that return to the same layer: $type', (action) => {
    expect(edit(action).some((node) => text(node) === message)).toBe(true);
  });

  it('omits the panel for another target layer', () => {
    expect(edit({ type: 'setLayer', layer: 1 }).some((node) => text(node) === message)).toBe(false);
  });
});
