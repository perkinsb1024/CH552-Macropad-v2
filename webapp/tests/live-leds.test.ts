import { expect, it } from 'vitest';
import { defaultProfile } from '../src/model/defaults';
import { liveLedColors, rainbowRgb } from '../src/model/liveLeds';
import { PALETTE } from '../src/model/palette';
import { parseRuntime, type RuntimeState } from '../src/protocol/packet';

function state(changes: Partial<RuntimeState> = {}): RuntimeState {
  const data = new Uint8Array(23);
  data.set([2, 1, 3, 3], 14);
  return { ...parseRuntime(data)!, ...changes };
}

it('matches configurator palette swatches at full and dim brightness without changing hues', () => {
  const p = defaultProfile(0);
  const layer = p.layers[0]!;
  layer.indicatorBehavior = 3;
  for (const entry of PALETTE.slice(0, 15)) {
    layer.indicatorColor = entry.index;
    layer.idleLeds = layer.leds.map(() => entry.index);
    expect(liveLedColors(p, 0, state({ indicatorPolicy: 2 })).displayColors[0]).toBe(entry.hex.toLowerCase());
    const dim = `#${entry.hex.slice(1).match(/../g)!.map(c => Math.round(parseInt(c, 16) * 0.5)
      .toString(16).padStart(2, '0')).join('')}`;
    expect(liveLedColors(p, 0, state({ indicatorPolicy: 1 })).displayColors[0]).toBe(dim);
    expect(liveLedColors(p, 0, state({ indicatorPolicy: 0 })).displayColors[0]).toBe('#000000');
  }
  layer.indicatorColor = 2;
  expect(liveLedColors(p, 0, state({ indicatorPolicy: 2 })).displayColors[0]).toBe('#ff6b5e');
  expect(liveLedColors(p, 0, state({ indicatorPolicy: 1 })).displayColors[0]).toBe('#80362f');
});

it.each([0, 1] as const)('renders uniform and per-key layer backgrounds and actual presses on variant %s', variant => {
  const p = defaultProfile(variant);
  const layer = p.layers[0]!;
  layer.indicatorBehavior = 3; layer.indicatorFullBrightness = true;
  layer.indicatorColor = 10; layer.leds.fill(1);
  expect(liveLedColors(p, 0, state()).colors).toEqual(layer.leds.map(() => '#0000ff'));
  expect(liveLedColors(p, 0, state(), 1).colors.slice(0, 3)).toEqual(['#ff0000', '#0000ff', '#0000ff']);
  layer.indicatorColor = 0; layer.idleLeds = layer.leds.map((_, key) => key + 1);
  expect(liveLedColors(p, 0, state()).colors.slice(0, 3)).toEqual(['#ff0000', '#ff6b5e', '#ff4b00']);
  layer.indicatorFullBrightness = false;
  expect(liveLedColors(p, 0, state()).colors.slice(0, 3)).toEqual(['#0f0000', '#0f0705', '#0f0500']);
  expect(liveLedColors(p, 0, state(), 1).colors[0]).toBe('#ff0000');
});

it('resolves independent brightness policies, blackout, and transparent Off overlays', () => {
  const p = defaultProfile(0); const layer = p.layers[0]!;
  layer.indicatorBehavior = 3; layer.indicatorColor = 8; layer.indicatorFullBrightness = false;
  layer.leds.fill(1);
  expect(liveLedColors(p, 0, state({ indicatorPolicy: 2, keyPolicy: 1 }), 1).colors.slice(0, 2)).toEqual(['#0f0000', '#00ffff']);
  expect(liveLedColors(p, 0, state({ indicatorPolicy: 0 }), 1).colors.slice(0, 2)).toEqual(['#ff0000', '#000000']);
  expect(liveLedColors(p, 0, state({ keyPolicy: 0 }), 1).colors[0]).toBe('#000f0f');
  expect(liveLedColors(p, 0, state({ indicatorPolicy: 0, keyPolicy: 0 }), 1).colors.every(c => c === '#000000')).toBe(true);
  layer.leds[0] = 0;
  expect(liveLedColors(p, 0, state(), 1).colors[0]).toBe('#000000');
  p.transparentBlack = true;
  expect(liveLedColors(p, 0, state(), 1).colors[0]).toBe('#000f0f');
  layer.indicatorBehavior = 0;
  expect(liveLedColors(p, 0, state(), 1).colors[0]).toBe('#000000');
});

it('gives timed and blinking indications priority over held keys, including Off palettes', () => {
  const p = defaultProfile(0); const layer = p.layers[0]!;
  layer.indicatorColor = 6; layer.indicatorFullBrightness = true; layer.leds.fill(1);
  layer.indicatorBehavior = 1;
  for (const phases of [6, 5, 4, 3, 2, 1]) expect(liveLedColors(p, 0, state({ phases }), 1).colors[0]).toBe('#00ff00');
  expect(liveLedColors(p, 0, state({ phases: 0 }), 1).colors.slice(0, 2)).toEqual(['#ff0000', '#000000']);
  layer.indicatorBehavior = 2;
  for (const phases of [6, 4, 2]) expect(liveLedColors(p, 0, state({ phases }), 1).colors[0]).toBe('#00ff00');
  for (const phases of [5, 3, 1]) expect(liveLedColors(p, 0, state({ phases }), 1).colors[0]).toBe('#000000');
  expect(liveLedColors(p, 0, state({ phases: 2, indicatorPolicy: 0 }), 1).colors[0]).toBe('#ff0000');
  layer.indicatorColor = 0; layer.idleLeds = layer.leds.map(() => 0);
  expect(liveLedColors(p, 0, state({ phases: 2 }), 1).colors[0]).toBe('#000000');
});

it('renders explicit effects independently of policies and allows keys over always-on effects', () => {
  const p = defaultProfile(0); const layer = p.layers[0]!;
  layer.indicatorBehavior = 2; layer.leds.fill(1);
  const effect = state({ indicatorPolicy: 0, keyPolicy: 1, effect: 0x6b, phases: 4 });
  expect(liveLedColors(p, 0, effect, 1).colors.every(c => c === '#00ff00')).toBe(true);
  expect(liveLedColors(p, 0, { ...effect, phases: 3 }, 1).colors.every(c => c === '#000000')).toBe(true);
  expect(liveLedColors(p, 0, { ...effect, effect: 0x6a }, 1).colors[0]).toBe('#000f00');
  expect(liveLedColors(p, 0, { ...effect, effect: 0x6f, phases: 0 }, 1).colors.slice(0, 2)).toEqual(['#0f0000', '#00ff00']);
  expect(liveLedColors(p, 0, { ...effect, effect: 0, phases: 0 }, 1).colors.slice(0, 2)).toEqual(['#0f0000', '#000000']);
});

it('renders color preview above pressed keys and policies, including the legacy black selector', () => {
  const p = defaultProfile(0);
  const preview = state({ effect: 0x85, colorPreview: true, indicatorPolicy: 0, keyPolicy: 0 });
  expect(liveLedColors(p, 0, preview, 63).colors.every(c => c === '#00ffff')).toBe(true);
  expect(liveLedColors(p, 0, { ...preview, effect: 0x84 }, 63).colors[0]).toBe('#000f0f');
  expect(liveLedColors(p, 0, { ...preview, effect: 0xf5 }, 63).colors[0]).toBe('#000000');
  expect(liveLedColors(p, 0, { ...preview, effect: 0xfd }, 63).colors[0]).toBe('#ff0000');
});

it('shows only saved layer colors when browsing without runtime, regardless of visibility mode', () => {
  const p = defaultProfile(0); const layer = p.layers[1]!;
  layer.indicatorBehavior = 0; layer.indicatorColor = 0; layer.indicatorFullBrightness = false;
  layer.idleLeds = [1, 6, 10, 1, 6, 10]; layer.leds.fill(14);
  expect(liveLedColors(p, 1, null, 63).colors).toEqual(['#0f0000', '#000f00', '#00000f', '#0f0000', '#000f00', '#00000f']);
});

it('uses the firmware hue wheel, physical perimeter order and phase spacing', () => {
  expect(rainbowRgb(0, 0, 6, 0)).toEqual([255, 0, 0]);
  expect(rainbowRgb(85, 0, 6, 0)).toEqual([0, 0, 255]);
  expect(rainbowRgb(170, 0, 6, 0)).toEqual([0, 255, 0]);
  expect(rainbowRgb(256, 0, 6, 0)).toEqual([255, 0, 0]);
  expect(Array.from({ length: 6 }, (_, key) => rainbowRgb(0, key, 6, 2))).toEqual([
    [255, 0, 0], [129, 0, 126], [3, 0, 252], [120, 135, 0], [0, 249, 6], [0, 123, 132],
  ]);
  for (const keys of [3, 6]) for (let key = 0; key < keys; key++) expect(rainbowRgb(85, key, keys, 0)).toEqual([0, 0, 255]);
});

it.each([3, 6])('accumulates independent scattered drift across hue wraps for %s keys', keys => {
  const positions = keys === 6 ? [0, 1, 2, 5, 4, 3] : [0, 1, 2];
  // After 1024 frames the base hue has wrapped four times; drift has not reset.
  const drift = keys === 6 ? [0, 32, 128, 16, 64, 8] : [0, 64, 128];
  for (let key = 0; key < keys; key++) {
    expect(rainbowRgb(1024, key, keys, 3)).toEqual(rainbowRgb(positions[key]! * 109 + drift[key]!, 0, keys, 0));
  }
});

it('shares the rainbow clock across layer and key colors, using actual overlay speed behavior', () => {
  const p = defaultProfile(0); const layer = p.layers[0]!;
  layer.indicatorBehavior = 3; layer.indicatorColor = 15; layer.indicatorFullBrightness = true;
  layer.leds.fill(15); p.rainbowSpeed = 3; p.rainbowPhase = 0;
  const runtime = state({ rainbowSpeed: 0, rainbowPhase: 2 });
  expect(liveLedColors(p, 0, runtime, 1, 42).colors).toEqual(liveLedColors(p, 0, runtime, 0, 42).colors);
  expect(liveLedColors(p, 0, runtime).frameMs).toBe(4);
  expect(liveLedColors(p, 0, { ...runtime, effect: 0xff }).frameMs).toBe(18);
  expect(liveLedColors(p, 0, { ...runtime, effect: 0xff }, 0, 42).colors).toEqual(liveLedColors(p, 0, runtime, 0, 42).colors);
  const preview = liveLedColors(p, 0, { ...runtime, effect: 0xfd, colorPreview: true }, 0, 42);
  expect(new Set(preview.colors).size).toBe(1);
  expect(preview.frameMs).toBe(18);
});
