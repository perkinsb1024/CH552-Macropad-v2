import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProfile } from '../src/model/defaults';
import { VARIANT_SIX_KEYS } from '../src/model/constants';
import { canSwapSlots, profile, selectedLayer, selectedSlot, swapLayers, swapSlotActions } from '../src/ui/store';

describe('drag and drop swaps', () => {
  beforeEach(() => {
    profile.value = defaultProfile(VARIANT_SIX_KEYS);
    selectedLayer.value = 0;
    selectedSlot.value = null;
  });

  it('moves key actions and their LED colors together', () => {
    const p = profile.value!;
    p.layers[0]!.keys[0] = { type: 'keyTap', usage: 4, modifiers: 0 };
    p.layers[0]!.keys[1] = { type: 'consumer', usage: 0xe9 };
    p.layers[0]!.leds[0] = 2;
    p.layers[0]!.leds[1] = 11;

    swapSlotActions({ kind: 'key', layer: 0, index: 0 }, { kind: 'key', layer: 0, index: 1 });

    expect(profile.value!.layers[0]!.keys[0]).toEqual({ type: 'consumer', usage: 0xe9 });
    expect(profile.value!.layers[0]!.keys[1]).toEqual({ type: 'keyTap', usage: 4, modifiers: 0 });
    expect(profile.value!.layers[0]!.leds.slice(0, 2)).toEqual([11, 2]);
  });

  it('rejects a hold action dropped onto encoder rotation', () => {
    profile.value!.layers[0]!.keys[0] = { type: 'keyHold', usage: 4, modifiers: 0 };
    const key = { kind: 'key', layer: 0, index: 0 } as const;
    const turn = { kind: 'clockwise', layer: 0 } as const;

    expect(canSwapSlots(key, turn)).toBe(false);
    swapSlotActions(key, turn);
    expect(profile.value!.layers[0]!.keys[0]).toEqual({ type: 'keyHold', usage: 4, modifiers: 0 });
  });

  it('moves whole layers and preserves their layer targets, chords, and startup layer', () => {
    const p = profile.value!;
    p.layers[0]!.keys[0] = { type: 'setLayer', layer: 1 };
    p.layers[1]!.keys[0] = { type: 'momentaryLayer', layer: 0 };
    p.chords.push({ layer: 0, keyA: 0, keyB: 1, action: { type: 'setLayer', layer: 1 } });
    p.startupLayer = 0;

    swapLayers(0, 1);

    expect(profile.value!.layers[0]!.keys[0]).toEqual({ type: 'momentaryLayer', layer: 1 });
    expect(profile.value!.layers[1]!.keys[0]).toEqual({ type: 'setLayer', layer: 0 });
    expect(profile.value!.chords[0]).toMatchObject({ layer: 1, action: { type: 'setLayer', layer: 0 } });
    expect(profile.value!.startupLayer).toBe(1);
  });
});
