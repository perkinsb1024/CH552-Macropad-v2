import { keyCount, type Variant, MOD_CTRL, MOD_GUI, MOD_SHIFT, LayerIndicatorBehavior } from './constants';
import type { Action, Layer, Profile } from './types';

const SHORTCUT_USAGES = [0x1d, 0x06, 0x19, 0x1d, 0x1b, 0x04]; // Z, C, V, Z, X, A

export const NONE: Action = { type: 'none' };

/** An empty layer: every binding None, LEDs off, no options. */
export function emptyLayer(variant: Variant): Layer {
  const keys = keyCount(variant);
  return {
    keys: Array.from({ length: keys }, () => NONE),
    encoderButton: NONE,
    clockwise: NONE,
    counterclockwise: NONE,
    leds: Array.from({ length: keys }, () => 15),
    bootloaderFromRun: false,
    indicatorBehavior: 0,
    indicatorColor: 0,
  };
}

/** Starter Mac or Windows shortcut layer for a new profile. */
function defaultLayer(variant: Variant, windows: boolean): Layer {
  const keys = keyCount(variant);
  const modifier = windows ? MOD_CTRL : MOD_GUI;
  const keyModifiers = [modifier, modifier, modifier, windows ? modifier : modifier | MOD_SHIFT, modifier, modifier];
  const usages = [...SHORTCUT_USAGES];
  if (windows) usages[3] = 0x1c; // Ctrl+Y is the conventional Windows redo.
  return {
    keys: Array.from({ length: keys }, (_, i) => {
      const sourceIndex = keys === 6 ? (i + 3) % 6 : i;
      return {
        type: 'keyTap',
        usage: usages[sourceIndex]!,
        modifiers: keyModifiers[sourceIndex]!,
      };
    }),
    encoderButton: { type: 'setLayer', layer: windows ? 0 : 1 },
    clockwise: { type: 'scroll', delta: -2 },
    counterclockwise: { type: 'scroll', delta: 2 },
    leds: Array.from({ length: keys }, () => windows ? 4 : 14),
    bootloaderFromRun: true,
    indicatorBehavior: LayerIndicatorBehavior.AlwaysOn,
    indicatorColor: windows ? 4 : 14,
  };
}

export function defaultProfile(variant: Variant): Profile {
  return {
    variant,
    startupLayer: 0,
    chordWindow: 8,
    layers: [defaultLayer(variant, false), defaultLayer(variant, true)],
    chords: [],
  };
}

export function cloneProfile(profile: Profile): Profile {
  return structuredClone(profile);
}

/** Converts profiles from the former per-layer scroll inversion option. */
export function migrateLegacyScrollInversion(profile: Profile): Profile {
  for (const layer of profile.layers) {
    // Drafts saved by older editor versions do not contain these fields.
    layer.indicatorBehavior ??= 0;
    layer.indicatorColor ??= 0;
    const legacy = layer as Layer & { invertScroll?: boolean };
    if (legacy.invertScroll) {
      if (layer.clockwise.type === 'scroll') layer.clockwise = { ...layer.clockwise, delta: -layer.clockwise.delta };
      if (layer.counterclockwise.type === 'scroll') layer.counterclockwise = { ...layer.counterclockwise, delta: -layer.counterclockwise.delta };
    }
    delete legacy.invertScroll;
  }
  return profile;
}
