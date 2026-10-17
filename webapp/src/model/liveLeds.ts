import { RAINBOW_SPEED_FRAME_MS } from './constants';
import { paletteHex } from './palette';
import type { Profile } from './types';
import type { RuntimeState } from '../protocol/packet';

/** Independent firmware rainbow clock: one shared hue and physical LED drift. */
export function rainbowRgb(frame: number, key: number, keys: number, spacing: number): number[] {
  const position = keys === 6 ? [0, 1, 2, 5, 4, 3][key]! : key;
  const interval = (keys === 6 ? [4, 32, 8, 64, 16, 128] : [4, 16, 8])[key]!;
  const hue = (frame + position * [0, 21, 42, 109][spacing]! +
    (spacing === 3 ? Math.floor(frame / interval) : 0)) & 255;
  const wheel = hue * 3 & 255;
  if (hue < 85) return [255 - wheel, 0, wheel];
  if (hue < 170) return [0, (wheel + 1) & 255, 255 - ((wheel + 1) & 255)];
  return [(wheel + 2) & 255, 255 - ((wheel + 2) & 255), 0];
}

/** Mirror updateLeds(), using reported policies rather than replaying bindings.
 * Without runtime state, show the viewed layer's saved colors only.
 */
export function liveLedColors(profile: Profile, layerIndex: number, state: RuntimeState | null,
  pressed = 0, frame = 0) {
  const layer = profile.layers[layerIndex]!;
  const keys = layer.leds.length;
  const overlay = state?.effect ?? 0;
  const preview = !!state?.colorPreview;
  const spacing = !state || preview ? profile.rainbowPhase : state.rainbowPhase;
  // Color preview uses saved speed; temporary LED effects use runtime speed.
  const speed = !state || preview ? profile.rainbowSpeed : state.rainbowSpeed;
  const behavior = overlay ? (overlay >> 2) & 3 : layer.indicatorBehavior;
  const policy = state?.indicatorPolicy ?? 3;
  const indicator = overlay ? 1 + (overlay & 1) : policy === 3 ? 1 + Number(layer.indicatorFullBrightness) : policy;
  const keyLevel = state?.keyPolicy === 3 ? 2 : state?.keyPolicy ?? 2;
  const phases = !overlay && !indicator ? 0 : state?.phases ?? 0;
  const perKey = !overlay && layer.indicatorColor === 0;
  let animating = overlay ? overlay >= 0xf4 && !!(overlay & 8) :
    layer.indicatorColor === 15 && layer.indicatorBehavior !== 0;
  const displayColors: string[] = [];
  const colors = Array.from({ length: keys }, (_, key) => {
    let color = overlay ? overlay >> 4 : perKey ? layer.idleLeds?.[key] ?? 0 : layer.indicatorColor;
    let level = indicator;
    if (perKey && color === 15) animating = true;
    if (!state) {
      if (color === 15) animating = true;
    } else if (!preview) {
      if (phases) {
        if (behavior === 2 && (phases & 1)) level = 0;
      } else {
        if (behavior !== 3 || (!overlay && !indicator)) level = 0;
        if (keyLevel && (pressed & (1 << key))) {
          const pressColor = layer.leds[key]!;
          if (pressColor || !profile.transparentBlack) {
            color = pressColor;
            level = keyLevel;
            if (color === 15) animating = true;
          }
        }
      }
    }
    let rgb = color === 15 && (!preview || behavior === 3)
      ? rainbowRgb(frame, key, keys, spacing)
      : paletteHex(color).slice(1).match(/../g)!.map(value => parseInt(value, 16));
    // Match the configurator swatches before firmware PWM dimming quantizes
    // their channels: full palette color, 50% for Dim, or black for Off.
    displayColors.push(`#${rgb.map(value => Math.round(value * (!level ? 0 : level === 1 ? 0.5 : 1))
      .toString(16).padStart(2, '0')).join('')}`);
    if (!level) rgb = [0, 0, 0];
    else if (level === 1) rgb = rgb.map(value => value ? (value >> 4) | 1 : 0);
    return `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`;
  });
  return { colors, displayColors, animating, frameMs: RAINBOW_SPEED_FRAME_MS[speed]! };
}
