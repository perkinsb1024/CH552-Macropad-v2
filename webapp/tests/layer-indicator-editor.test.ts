import { describe, expect, it, vi } from 'vitest';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import type { Action } from '../src/model/types';
import { Inspector } from '../src/ui/components/Inspector';
import { profile, selectedSlot } from '../src/ui/store';

// Inspect the component's controls without mounting a browser DOM.
vi.mock('preact/hooks', () => ({ useMemo: (factory: () => unknown) => factory() }));

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
function edit(action: Action) {
  const p = defaultProfile(0);
  p.layers = [emptyLayer(0), emptyLayer(0)];
  p.layers[0]!.keys[0] = action;
  profile.value = p;
  selectedSlot.value = { kind: 'key', layer: 0, index: 0 };
  return elements(Inspector());
}
const message = "Changing to the same layer is useful to display the current Layer's indicator";

describe('same-layer indicator actions', () => {
  it.each(['relativeLayer', 'oneShotRelativeLayer'] as const)('offers zero for %s and explains it after selection', (type) => {
    const nodes = edit({ type, offset: 1 });
    const select = nodes.find((node) => node.type === 'select' && elements(node).some((child) => child.type === 'option' && child.props.value === -3))!;
    expect(elements(select).some((node) => node.type === 'option' && node.props.value === 0)).toBe(true);
    expect(nodes.some((node) => text(node) === message)).toBe(false);
    (select.props.onChange as (event: unknown) => void)({ target: { value: '0' } });
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
