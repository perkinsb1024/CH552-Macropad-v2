import type { LayerIndicatorBehavior, Variant } from './constants';

export type Action =
  | { type: 'none' }
  | { type: 'keyTap'; usage: number; modifiers: number }
  | { type: 'keyHold'; usage: number; modifiers: number }
  | { type: 'mouseClick'; buttons: number }
  | { type: 'mouseDouble'; buttons: number }
  | { type: 'mouseHold'; buttons: number }
  | { type: 'mouseToggle'; buttons: number }
  | { type: 'scroll'; delta: number }
  | { type: 'consumer'; usage: number }
  | { type: 'string'; text: string }
  | { type: 'setLayer'; layer: number }
  | { type: 'oneShotSetLayer'; layer: number }
  | { type: 'momentaryLayer'; layer: number }
  | { type: 'relativeLayer'; offset: number }
  | { type: 'oneShotRelativeLayer'; offset: number }
  | { type: 'mouseX'; delta: number; hold?: boolean }
  | { type: 'mouseY'; delta: number; hold?: boolean };

export type ActionType = Action['type'];

export interface Layer {
  /** One binding per physical key, length 3 or 6. */
  keys: Action[];
  encoderButton: Action;
  clockwise: Action;
  counterclockwise: Action;
  /** Palette index per physical key, length 3 or 6. */
  leds: number[];
  bootloaderFromRun: boolean;
  indicatorBehavior: LayerIndicatorBehavior;
  indicatorColor: number;
  indicatorFullBrightness: boolean;
}

export interface Chord {
  layer: number;
  /** Applies on every layer; layer remains its editor/home layer. */
  global?: boolean;
  /** Lower physical key index. */
  keyA: number;
  /** Higher physical key index. */
  keyB: number;
  action: Action;
}

export interface Profile {
  variant: Variant;
  transparentBlack: boolean;
  startupLayer: number;
  /** Chord window in 5 ms units, 0–15. Zero disables chords. */
  chordWindow: number;
  /** Index of the rainbow phase spacing: 0°, ~30°, ~60°, ~120°. */
  rainbowPhase: number;
  layers: Layer[];
  chords: Chord[];
}

/** Identifies one editable binding slot within a profile. */
export type Slot =
  | { kind: 'key'; layer: number; index: number }
  | { kind: 'encoderButton'; layer: number }
  | { kind: 'clockwise'; layer: number }
  | { kind: 'counterclockwise'; layer: number }
  | { kind: 'chord'; layer: number; keyA: number; keyB: number };

export interface Issue {
  /** Human-readable location, e.g. "Layer 2 · Key 3". */
  where: string;
  message: string;
  slot?: Slot;
}
