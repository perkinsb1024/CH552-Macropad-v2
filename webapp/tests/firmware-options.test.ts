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

describe('current firmware indicator options', () => {
  it('shows the timed mode, rainbow, dimming, and transparency', async () => {
    await connectSimulator(0);
    selectedLayer.value = 0;
    updateProfile((p) => {
      p.layers[0]!.indicatorBehavior = 1;
      p.layers[0]!.indicatorColor = 15;
      p.layers[1]!.indicatorBehavior = 3;
      p.layers[1]!.leds[0] = 15;
    });
    const nodes = elements(LayerOptions());
    const mode = nodes.find((node) => node.type === 'option' && node.props.value === 1)!;
    expect(text(mode)).toBe('On for 1.5 seconds');
    const off = nodes.find((node) => node.props.role === 'radio' && node.props['aria-label'] === 'Rainbow');
    expect(off).toBeDefined();
    expect(nodes.find((node) => node.type === ColorPreview)!.props.rainbow).toBe(true);
    expect(nodes.some((node) => node.props['aria-label'] === 'Layer indicator brightness')).toBe(true);
    const transparency = elements(ProfilePanel()).find((node) => node.type === 'button' && text(node) === 'Transparent')!;
    expect(transparency.props.disabled).toBe(undefined);
    // Transparency remains editable for the current firmware.
    (transparency.props.onClick as () => void)();
    expect(elements(ProfilePanel()).find((node) => node.type === 'button' && text(node) === 'Transparent')!.props['aria-pressed']).toBe(true);
  });

  it('offers Rainbow for numbered blinks', async () => {
    await connectSimulator(0);
    selectedLayer.value = 0;
    updateProfile((p) => { p.layers[0]!.indicatorBehavior = 2; p.layers[0]!.indicatorColor = 15; });
    const nodes = elements(LayerOptions());
    expect(nodes.some((node) => node.props.role === 'radio' && node.props['aria-label'] === 'Rainbow')).toBe(true);
    expect(nodes.find((node) => node.type === ColorPreview)!.props.rainbow).toBe(true);
  });
});
