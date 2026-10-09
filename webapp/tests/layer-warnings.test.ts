import { describe, expect, it } from 'vitest';
import { encodeProfile } from '../src/codec/encode';
import { LayerIndicatorBehavior, VARIANT_SIX_KEYS } from '../src/model/constants';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { selfReferentialLayerWarnings } from '../src/model/layerWarnings';
import type { Action } from '../src/model/types';
import { validateProfile } from '../src/model/validate';

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
      { type: 'setLayer', layer: 9 }, { type: 'relativeLayer', offset: 7 },
      { type: 'keyTap', usage: 4, modifiers: 0 }, { type: 'relativeLayer', offset: 1 },
    ];
    actions.forEach((action, index) => { profile.layers[0]!.keys[index] = action; });
    profile.layers[0]!.clockwise = { type: 'momentaryLayer', layer: 0 };
    expect(validateProfile(profile)).toHaveLength(3);
    expect(selfReferentialLayerWarnings(profile)).toEqual([]);
  });
});
