import { afterEach, describe, expect, it } from 'vitest';
import { LayerOptions } from '../src/ui/components/LayerOptions';
import { ProfilePanel } from '../src/ui/components/ProfilePanel';
import { ColorPreview } from '../src/ui/components/ColorPreview';
import { connectSimulator, disconnect, selectedLayer, updateProfile } from '../src/ui/store';

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

afterEach(() => disconnect());

describe('firmware-specific indicator options', () => {
  it.each([2, 3] as const)('shows the actual mode and rainbow support on format %s', async (format) => {
    await connectSimulator(0, false, format);
    selectedLayer.value = 0;
    updateProfile((p) => { p.layers[0]!.indicatorBehavior = 1; p.layers[0]!.indicatorColor = 15; });
    const nodes = elements(LayerOptions());
    const mode = nodes.find((node) => node.type === 'option' && node.props.value === 1)!;
    expect(text(mode)).toBe(format === 2 ? 'Blink once' : 'On for 1.5 seconds');
    const off = nodes.find((node) => node.props.role === 'radio' && node.props['aria-label'] === (format === 2 ? 'Off' : 'Rainbow'));
    expect(off).toBeDefined();
    expect(nodes.find((node) => node.type === ColorPreview)!.props.rainbow).toBe(format === 3);
    expect(nodes.some((node) => node.props['aria-label'] === 'Layer indicator brightness')).toBe(format === 3);
    const transparency = elements(ProfilePanel()).find((node) => node.type === 'input' && node.props.type === 'checkbox')!;
    expect(transparency.props.disabled).toBe(format === 2);
    // An imported enabled flag can always be turned off, including on v2.
    updateProfile((p) => { p.transparentBlack = true; });
    expect(elements(ProfilePanel()).find((node) => node.type === 'input' && node.props.type === 'checkbox')!.props.disabled).toBe(false);
  });
});
