import { DEFAULT_RAINBOW_SPEED, DEFAULT_RAINBOW_PHASE, keyCount, type Variant, MOD_CTRL, MOD_GUI, MOD_SHIFT, LayerIndicatorBehavior } from './constants';
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
    indicatorFullBrightness: false,
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
    encoderButton: { type: 'relativeLayer', offset: 1 },
    clockwise: { type: 'scroll', delta: -2 },
    counterclockwise: { type: 'scroll', delta: 2 },
    leds: Array.from({ length: keys }, () => windows ? 4 : 14),
    bootloaderFromRun: false,
    indicatorBehavior: LayerIndicatorBehavior.AlwaysOn,
    indicatorColor: windows ? 4 : 14,
    indicatorFullBrightness: false,
  };
}

export function defaultProfile(variant: Variant): Profile {
  return {
    variant,
    transparentBlack: false,
    startupLayer: 0,
    chordWindow: 8,
    rainbowPhase: DEFAULT_RAINBOW_PHASE,
    rainbowSpeed: DEFAULT_RAINBOW_SPEED,
    layers: [defaultLayer(variant, false), defaultLayer(variant, true)],
    chords: [],
  };
}

export function cloneProfile(profile: Profile): Profile {
  return structuredClone(profile);
}

/** Upgrade older editor profiles without changing bindings or palette indices.
 * Indicator value 1 now means timed-on; transparency defaults to disabled.
 */
export function migrateLegacyProfile(profile: Profile): Profile {
  profile.transparentBlack ??= false;
  profile.rainbowPhase ??= DEFAULT_RAINBOW_PHASE;
  profile.rainbowSpeed ??= DEFAULT_RAINBOW_SPEED;
  const migrateAction = (action: Action): Action =>
    (action as { type: string }).type === 'nextLayer' ? { type: 'relativeLayer', offset: 0 } : action;
  for (const layer of profile.layers) {
    layer.indicatorBehavior ??= 0;
    layer.indicatorColor ??= 0;
    layer.indicatorFullBrightness ??= false;
    layer.keys = layer.keys.map(migrateAction);
    layer.encoderButton = migrateAction(layer.encoderButton);
    layer.clockwise = migrateAction(layer.clockwise);
    layer.counterclockwise = migrateAction(layer.counterclockwise);
    const legacy = layer as Layer & { invertScroll?: boolean };
    if (legacy.invertScroll) {
      if (layer.clockwise.type === 'scroll') layer.clockwise = { ...layer.clockwise, delta: -layer.clockwise.delta };
      if (layer.counterclockwise.type === 'scroll') layer.counterclockwise = { ...layer.counterclockwise, delta: -layer.counterclockwise.delta };
    }
    delete legacy.invertScroll;
  }
  for (const chord of profile.chords) chord.action = migrateAction(chord.action);
  return profile;
}
