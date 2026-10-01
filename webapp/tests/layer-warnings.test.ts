import { describe, expect, it } from 'vitest';
import { encodeProfile } from '../src/codec/encode';
import { LayerIndicatorBehavior, VARIANT_SIX_KEYS } from '../src/model/constants';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { encoderBootloaderWarnings, selfReferentialLayerWarnings } from '../src/model/layerWarnings';
import type { Action } from '../src/model/types';
import { validateProfile } from '../src/model/validate';
import { IssuesPanel } from '../src/ui/components/IssuesPanel';
import { LayerOptions } from '../src/ui/components/LayerOptions';
import { bootloaderWarnings, profile as editorProfile, selectedLayer, selectedSlot, updateProfile } from '../src/ui/store';

function profileWithLayers(count = 4) {
  const profile = defaultProfile(VARIANT_SIX_KEYS);
  profile.layers = Array.from({ length: count }, () => emptyLayer(profile.variant));
  return profile;
}

describe('self-referential layer warnings', () => {
  it.each([
    [LayerIndicatorBehavior.None, true],
    [LayerIndicatorBehavior.AlwaysOn, true],
    [LayerIndicatorBehavior.TimedOn, false],
    [LayerIndicatorBehavior.BlinkByLayer, false],
  ] as const)('checks indicator mode %i for absolute and relative actions', (indicatorBehavior, warns) => {
    const profile = profileWithLayers(2);
    profile.layers[1]!.indicatorBehavior = indicatorBehavior;
    profile.layers[1]!.keys[0] = { type: 'setLayer', layer: 1 };
    profile.layers[1]!.keys[1] = { type: 'oneShotSetLayer', layer: 1 };
    profile.layers[1]!.encoderButton = { type: 'momentaryLayer', layer: 1 };
    profile.layers[1]!.clockwise = { type: 'relativeLayer', offset: 0 };
    profile.layers[1]!.counterclockwise = { type: 'oneShotRelativeLayer', offset: 2 };
    profile.chords = [{ layer: 1, keyA: 2, keyB: 3, action: { type: 'setLayer', layer: 1 } }];
    expect(selfReferentialLayerWarnings(profile)).toHaveLength(warns ? 6 : 0);
  });

  it('uses the effective layer indicator for global chords and updates after indicator edits', () => {
    const profile = profileWithLayers(2);
    profile.chords = [{ layer: 0, global: true, keyA: 0, keyB: 1, action: { type: 'setLayer', layer: 1 } }];
    profile.layers[0]!.indicatorBehavior = LayerIndicatorBehavior.None;
    profile.layers[1]!.indicatorBehavior = LayerIndicatorBehavior.TimedOn;
    expect(selfReferentialLayerWarnings(profile)).toEqual([]);
    profile.layers[1]!.indicatorBehavior = LayerIndicatorBehavior.AlwaysOn;
    expect(selfReferentialLayerWarnings(profile)).toHaveLength(1);
    profile.layers[0]!.indicatorBehavior = LayerIndicatorBehavior.BlinkByLayer;
    expect(selfReferentialLayerWarnings(profile)).toHaveLength(1);
    profile.layers[1]!.indicatorBehavior = LayerIndicatorBehavior.BlinkByLayer;
    expect(selfReferentialLayerWarnings(profile)).toEqual([]);
  });

  it.each(['setLayer', 'oneShotSetLayer', 'momentaryLayer'] as const)('warns for %s without preventing encoding', (type) => {
    const profile = profileWithLayers();
    profile.layers[3]!.keys[0] = { type, layer: 3 };
    expect(selfReferentialLayerWarnings(profile)).toEqual([{
      where: 'Layer 4 · Key 1',
      message: 'This action leads back to Layer 4, so it does not change layers or offer any indication.',
      slot: { kind: 'key', layer: 3, index: 0 },
    }]);
    expect(validateProfile(profile)).toEqual([]);
    expect(() => encodeProfile(profile)).not.toThrow();
    profile.layers[3]!.keys[0] = { type, layer: 2 };
    expect(selfReferentialLayerWarnings(profile)).toEqual([]);
  });

  it.each([
    [4, 0], [2, 2], [2, -2], [3, 3], [3, -3], [1, 1],
  ])('detects relative self references with %i layers and offset %i', (count, offset) => {
    const profile = profileWithLayers(count);
    profile.layers[0]!.clockwise = { type: 'relativeLayer', offset };
    profile.layers[0]!.counterclockwise = { type: 'oneShotRelativeLayer', offset };
    expect(selfReferentialLayerWarnings(profile).map((warning) => warning.slot?.kind))
      .toEqual(['clockwise', 'counterclockwise']);
  });

  it('covers encoder buttons and local chords, and clears warnings after edits', () => {
    const profile = profileWithLayers();
    profile.layers[2]!.encoderButton = { type: 'setLayer', layer: 2 };
    profile.chords = [{ layer: 3, keyA: 0, keyB: 1, action: { type: 'oneShotSetLayer', layer: 3 } }];
    expect(selfReferentialLayerWarnings(profile).map((warning) => warning.slot?.kind))
      .toEqual(['encoderButton', 'chord']);
    profile.layers[2]!.encoderButton = { type: 'none' };
    profile.chords[0]!.action = { type: 'setLayer', layer: 0 };
    expect(selfReferentialLayerWarnings(profile)).toEqual([]);
  });

  it('checks global chords on their effective layer and respects local overrides', () => {
    const profile = profileWithLayers();
    profile.chords = [{ layer: 0, global: true, keyA: 0, keyB: 1, action: { type: 'setLayer', layer: 3 } }];
    const warnings = selfReferentialLayerWarnings(profile);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain('Layer 4');
    expect(warnings[0]!.slot?.layer).toBe(0); // Navigate to the global chord's editor.
    profile.chords.push({ layer: 3, keyA: 0, keyB: 1, action: { type: 'none' } });
    expect(selfReferentialLayerWarnings(profile)).toEqual([]);
  });

  it('does not duplicate validation errors or warn about other actions', () => {
    const profile = profileWithLayers();
    const actions: Action[] = [
      { type: 'setLayer', layer: 9 }, { type: 'relativeLayer', offset: 4 },
      { type: 'keyTap', usage: 4, modifiers: 0 }, { type: 'relativeLayer', offset: 1 },
    ];
    actions.forEach((action, index) => { profile.layers[0]!.keys[index] = action; });
    profile.layers[0]!.clockwise = { type: 'momentaryLayer', layer: 0 };
    expect(validateProfile(profile)).toHaveLength(3);
    expect(selfReferentialLayerWarnings(profile)).toEqual([]);
  });
});

describe('encoder bootloader warnings', () => {
  it.each([
    { type: 'keyHold', usage: 4, modifiers: 0 },
    { type: 'keyHold', usage: 0, modifiers: 1 },
    { type: 'mouseHold', buttons: 1 },
    { type: 'mouseX', delta: 10, hold: true },
    { type: 'mouseY', delta: -10, hold: true },
  ] satisfies Action[])('warns for $type only when enabled on the same layer', (action) => {
    const profile = profileWithLayers(2);
    profile.layers[1]!.encoderButton = action;
    profile.layers[0]!.bootloaderFromRun = true;
    expect(encoderBootloaderWarnings(profile)).toEqual([]);
    profile.layers[1]!.bootloaderFromRun = true;
    expect(encoderBootloaderWarnings(profile)).toEqual([{
      where: 'Layer 2 · Encoder button',
      message: expect.stringContaining('three seconds'),
      slot: { kind: 'encoderButton', layer: 1 },
    }]);
    expect(validateProfile(profile)).toEqual([]);
    expect(() => encodeProfile(profile)).not.toThrow();
    profile.layers[1]!.bootloaderFromRun = false;
    expect(encoderBootloaderWarnings(profile)).toEqual([]);
  });

  it('updates both warning displays after edits and links to the affected encoder', () => {
    type Element = { type: unknown; props: Record<string, unknown> };
    const elements = (node: unknown): Element[] => {
      if (Array.isArray(node)) return node.flatMap(elements);
      if (!node || typeof node !== 'object' || !('props' in node)) return [];
      const element = node as Element;
      return [element, ...elements(element.props.children)];
    };
    const profile = profileWithLayers(2);
    profile.layers[1]!.encoderButton = { type: 'keyHold', usage: 4, modifiers: 0 };
    editorProfile.value = profile;
    selectedLayer.value = 1;
    expect(bootloaderWarnings.value).toEqual([]);
    updateProfile((draft) => { draft.layers[1]!.bootloaderFromRun = true; });
    const warning = bootloaderWarnings.value[0]!;
    expect(elements(LayerOptions()).some((node) => node.props.children === warning.message)).toBe(true);
    const link = elements(IssuesPanel()).find((node) => node.type === 'button' && node.props.children === warning.where)!;
    selectedLayer.value = 0;
    (link.props.onClick as () => void)();
    expect(selectedLayer.value).toBe(1);
    expect(selectedSlot.value).toEqual(warning.slot);
    updateProfile((draft) => { draft.layers[1]!.encoderButton = { type: 'none' }; });
    expect(bootloaderWarnings.value).toEqual([]);
    expect(elements(LayerOptions()).some((node) => node.props.children === warning.message)).toBe(false);
    expect(elements(IssuesPanel()).some((node) => node.props.children === warning.message)).toBe(false);
    editorProfile.value = null;
    selectedLayer.value = 0;
    selectedSlot.value = null;
  });

  it.each([
    { type: 'none' }, { type: 'keyTap', usage: 4, modifiers: 0 },
    { type: 'mouseClick', buttons: 1 }, { type: 'mouseToggle', buttons: 1 },
    { type: 'mouseX', delta: 10 }, { type: 'mouseY', delta: 10, hold: false },
    { type: 'momentaryLayer', layer: 1 },
  ] satisfies Action[])('does not warn for $type or holds on physical keys and chords', (action) => {
    const profile = profileWithLayers(2);
    profile.layers[0]!.bootloaderFromRun = true;
    profile.layers[0]!.encoderButton = action;
    profile.layers[0]!.keys[0] = { type: 'keyHold', usage: 4, modifiers: 0 };
    profile.chords = [{ layer: 0, keyA: 0, keyB: 1, action: { type: 'mouseHold', buttons: 1 } }];
    expect(encoderBootloaderWarnings(profile)).toEqual([]);
  });
});
