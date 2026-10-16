import { layerPaletteSize } from './constants';
import { PALETTE } from './palette';
import type { Layer, Profile } from './types';

export function usePerKeyColors(layer: Layer): void {
  layer.idleLeds ??= layer.leds.map(() => layer.indicatorColor || 0);
  layer.indicatorColor = 0;
}

export function applyIdleColorToLayer(layer: Layer, color: number): void {
  layer.idleLeds = layer.leds.map(() => color);
  layer.indicatorColor = 0;
}

export function layerPaletteWarnings(profile: Profile) {
  return profile.layers.flatMap((layer, index) => {
    const color = layer.idleLeds?.[0];
    return layer.indicatorColor === 0 && color !== undefined && layer.idleLeds!.every(c => c === color)
      ? [{ layer: index, color, message: `Every key uses ${PALETTE[color]?.name}. ${color === 0 ? 'Select Do Not Indicate' : 'Select it as the uniform Layer Indicator Color'} to reclaim ${layerPaletteSize(profile.variant)} bytes.` }]
      : [];
  });
}

export const RAINBOW_COLORS = ['#ff0000', '#ffb400', '#00ff00', '#00ffff', '#0040ff', '#8000ff', '#ff00ff', '#ff0000'];
export const RAINBOW_GRADIENT = `linear-gradient(90deg, ${RAINBOW_COLORS.join(', ')})`;

/** Six-key perimeter order follows the top row rightward and bottom row leftward. */
export function layerIndicatorBackground(layer: Layer): string {
  const hex = (color: number) => color === 14 ? '#B8BEC8' : PALETTE[color]?.hex ?? '#000000';
  if (layer.indicatorColor === 15) return `conic-gradient(from 45deg, ${RAINBOW_COLORS.join(', ')})`;
  if (layer.indicatorColor !== 0) return hex(layer.indicatorColor);
  const colors = layer.idleLeds ?? layer.leds.map(() => 0);
  const order = colors.length === 6 ? [0, 1, 2, 5, 4, 3] : [0, 1, 2];
  const stops = order.flatMap((key, position) => {
    const samples = colors[key] === 15 ? RAINBOW_COLORS : [hex(colors[key]!), hex(colors[key]!)];
    return samples.map((color, i) => `${color} ${((position + 0.12 + i / (samples.length - 1) * 0.76) / order.length * 100).toFixed(2)}%`);
  });
  return colors.length === 6 ? `conic-gradient(from -90deg, ${stops.join(', ')})` : `linear-gradient(90deg, ${stops.join(', ')})`;
}
