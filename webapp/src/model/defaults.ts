import { keyCount, type Variant, MOD_ALT, MOD_CTRL, MOD_GUI, MOD_SHIFT, MOUSE_MIDDLE } from './constants';
import type { Action, Layer, Profile } from './types';

const DEFAULT_USAGES = [0x29, 0x2c, 0x21, 0x50, 0x52, 0x4f];
const DEFAULT_MODIFIERS = [0, MOD_ALT, MOD_CTRL | MOD_SHIFT | MOD_GUI, MOD_CTRL, MOD_CTRL, MOD_CTRL];

export const NONE: Action = { type: 'none' };

/** An empty layer: every binding None, LEDs off, no options. */
export function emptyLayer(variant: Variant): Layer {
  const keys = keyCount(variant);
  return {
    keys: Array.from({ length: keys }, () => NONE),
    encoderButton: NONE,
    clockwise: NONE,
    counterclockwise: NONE,
    leds: Array.from({ length: keys }, () => 6),
    invertScroll: false,
    bootloaderFromBoot: false,
    bootloaderFromRun: false,
  };
}

/** Reproduces the firmware's built-in defaults (configDefaults in firmware/src/config.c). */
export function defaultLayer(variant: Variant): Layer {
  const keys = keyCount(variant);
  return {
    keys: Array.from({ length: keys }, (_, i) => ({
      type: 'keyTap',
      usage: DEFAULT_USAGES[i]!,
      modifiers: DEFAULT_MODIFIERS[i]!,
    })),
    encoderButton: { type: 'mouseClick', buttons: MOUSE_MIDDLE },
    clockwise: { type: 'scroll', delta: -1 },
    counterclockwise: { type: 'scroll', delta: 1 },
    leds: Array.from({ length: keys }, (_, i) => i),
    invertScroll: false,
    bootloaderFromBoot: true,
    bootloaderFromRun: true,
  };
}

export function defaultProfile(variant: Variant): Profile {
  return {
    variant,
    startupLayer: 0,
    chordWindow: 8,
    layers: [defaultLayer(variant)],
    chords: [],
  };
}

export function cloneProfile(profile: Profile): Profile {
  return structuredClone(profile);
}
