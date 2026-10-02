import { LED_COMMANDS, ledProblem } from '../model/ledControl';
import {
  DEFAULT_RAINBOW_SPEED, HEADER_RAINBOW_SPEED_SHIFT, DEFAULT_RAINBOW_PHASE, HEADER_RAINBOW_PHASE_SHIFT, ActionCode, CHORD_ENTRY_SIZE, FORMAT_VERSION, HEADER_SIZE, IMAGE_SIZE, maxLayers,
  LAYER_OPT_BOOTLOADER_RUN, LAYER_OPT_FULL_BRIGHTNESS, LAYER_OPT_INDICATOR_SHIFT,
  keyCount, layerSize, pairCount, type Variant,
} from '../model/constants';
import type { Action, Chord, Layer, Profile } from '../model/types';
import { pairFromIndex } from '../model/pairs';
import { imageCrc, storedCrc } from './crc16';
import { isSupportedUsage } from '../keys/keyboard';

export type DecodeResult =
  | { ok: true; profile: Profile }
  | { ok: false; reason: DecodeFailure; detail: string };

export type DecodeFailure = 'no-magic' | 'unsupported-version' | 'malformed' | 'bad-crc';

function toSigned(byte: number): number {
  return byte > 127 ? byte - 256 : byte;
}

interface PoolView {
  start: number;
  used: number;
  bytes: Uint8Array;
}

function stringAt(pool: PoolView, offset: number): string | null {
  if (offset >= pool.used) return null;
  if (offset !== 0 && pool.bytes[pool.start + offset - 1] !== 0) return null; // must begin a string
  let end = offset;
  while (end < pool.used && pool.bytes[pool.start + end] !== 0) end++;
  if (end >= pool.used) return null; // missing terminator
  let text = '';
  for (let i = offset; i < end; i++) text += String.fromCharCode(pool.bytes[pool.start + i]!);
  return text;
}

function decodeAction(b0: number, b1: number, layers: number, rotation: boolean, pool: PoolView, version: number): Action | string {
  let type = b0 & 15;
  if (version < 6) {
    if (type === 12) return 'Reserved action type in older format';
    if (type >= 13) type--;
  }
  const aux = b0 >> 4;
  const nonZeroAux = aux !== 0;
  switch (type) {
    case ActionCode.LedControl: {
      const spec = LED_COMMANDS[b1];
      if (!spec) return 'Unknown LED command';
      const value = spec.relative ? (aux < 8 ? aux : aux - 16) : aux === 15 ? 'asConfigured' : aux;
      const problem = ledProblem(spec.command, value);
      return problem ?? { type: 'ledControl', command: spec.command, value };
    }
    case ActionCode.None:
      return nonZeroAux || b1 ? 'None action has non-zero data' : { type: 'none' };
    case ActionCode.RelativeLayer: {
      const offset = toSigned(b1);
      return aux > 1 || offset < -6 || offset > 6 ? 'Invalid relative-layer offset' : aux ? { type: 'oneShotRelativeLayer', offset } : { type: 'relativeLayer', offset };
    }
    case ActionCode.KeyTap:
    case ActionCode.KeyHold:
      if (rotation && type === ActionCode.KeyHold) return 'Key hold bound to rotation';
      if (!isSupportedUsage(b1)) return `Unsupported key usage 0x${b1.toString(16)}`;
      return { type: type === ActionCode.KeyTap ? 'keyTap' : 'keyHold', usage: b1, modifiers: aux };
    case ActionCode.MouseClick:
    case ActionCode.MouseDouble:
    case ActionCode.MouseHold:
    case ActionCode.MouseToggle: {
      if (rotation && type === ActionCode.MouseHold) return 'Mouse hold bound to rotation';
      if (nonZeroAux || b1 < 1 || b1 > 7) return 'Invalid mouse button mask';
      const t = (['mouseClick', 'mouseDouble', 'mouseHold', 'mouseToggle'] as const)[type - ActionCode.MouseClick]!;
      return { type: t, buttons: b1 };
    }
    case ActionCode.Scroll:
      if (nonZeroAux || b1 === 0x80) return 'Invalid relative delta';
      return { type: 'scroll', delta: toSigned(b1) };
    case ActionCode.MouseX:
    case ActionCode.MouseY: {
      if (aux > 1 || b1 === 0x80) return 'Invalid relative delta';
      if (rotation && aux) return 'Pointer hold bound to rotation';
      const t = type === ActionCode.MouseX ? 'mouseX' : 'mouseY';
      return { type: t, delta: toSigned(b1), ...(aux ? { hold: true } : {}) };
    }
    case ActionCode.Consumer:
      if (!nonZeroAux && !b1) return 'Consumer usage is zero';
      return { type: 'consumer', usage: (aux << 8) | b1 };
    case ActionCode.String: {
      if (nonZeroAux) return 'String action has non-zero auxiliary data';
      const text = stringAt(pool, b1);
      if (text === null) return `String offset ${b1} does not start a string`;
      return { type: 'string', text };
    }
    case ActionCode.SetLayer:
    case ActionCode.MomentaryLayer: {
      if ((type === ActionCode.SetLayer ? aux > 1 : nonZeroAux) || b1 >= layers) return `Layer ${b1 + 1} does not exist`;
      if (rotation && type === ActionCode.MomentaryLayer) return 'Momentary layer bound to rotation';
      const t = type === ActionCode.SetLayer ? (aux ? 'oneShotSetLayer' : 'setLayer') : 'momentaryLayer';
      return { type: t, layer: b1 };
    }
    default:
      return 'Unknown action type';
  }
}

/** Reads the format version and variant without full validation, for diagnostics. */
export function peekHeader(image: Uint8Array): { magic: boolean; version: number; variant: Variant } {
  return { magic: image[0] === 0x4d && image[1] === 0x50, version: image[2] ?? 0, variant: ((image[5] ?? 0) & 1) as Variant };
}

/** Decodes and fully validates a 128-byte image, mirroring the firmware's configValid. */
export function decodeImage(image: Uint8Array, expectedVariant?: Variant): DecodeResult {
  const fail = (reason: DecodeFailure, detail: string): DecodeResult => ({ ok: false, reason, detail });
  if (image.length !== IMAGE_SIZE) return fail('malformed', `Image is ${image.length} bytes, expected ${IMAGE_SIZE}.`);
  if (image[0] !== 0x4d || image[1] !== 0x50) return fail('no-magic', 'Missing MP marker; no saved profile.');
  if (![2, 3, 4, 5, FORMAT_VERSION].includes(image[2]!)) return fail('unsupported-version', `Format version ${image[2]} is not supported (expected 2, 3, 4, 5 or ${FORMAT_VERSION}).`);
  if (image[2] === 2 && (image[5]! & 0x80)) return fail('malformed', 'Reserved bit set in version 2 byte 5.');
  const extended = image[2]! >= 4;
  const configurableRainbow = image[2]! >= 5;
  if (image[3]! & (extended ? 0xc0 : 0xf0)) return fail('malformed', 'Reserved bits set in byte 3.');
  if (!configurableRainbow && (image[8]! & 0xf0)) return fail('malformed', 'Reserved bits set in chord-window byte.');

  const variant = (image[5]! & 1) as Variant;
  if (expectedVariant !== undefined && variant !== expectedVariant) {
    return fail('malformed', `Image is for the ${variant ? 'three' : 'six'}-key variant but the device has ${expectedVariant ? 'three' : 'six'} keys.`);
  }
  const layerCount = (image[3]! & (extended ? 7 : 3)) + 1;
  const startupLayer = (image[3]! >> (extended ? 3 : 2)) & (extended ? 7 : 3);
  if (startupLayer >= layerCount) return fail('malformed', `Startup layer ${startupLayer + 1} exceeds layer count ${layerCount}.`);
  if (layerCount > (extended ? maxLayers(variant) : 4)) return fail('malformed', 'Too many layers.');

  const keys = keyCount(variant);
  const size = layerSize(variant);
  const chordCount = (image[5]! >> 1) & 63;
  const poolUsed = image[4]!;
  const poolStart = HEADER_SIZE + size * layerCount + CHORD_ENTRY_SIZE * chordCount;
  const end = poolStart + poolUsed;
  if (end > IMAGE_SIZE) return fail('malformed', `Declared content ends at byte ${end}, beyond the 128-byte image.`);
  const pool: PoolView = { start: poolStart, used: poolUsed, bytes: image };

  if (poolUsed && image[poolStart + poolUsed - 1] !== 0) return fail('malformed', 'String pool does not end with a terminator.');
  for (let i = 0; i < poolUsed; i++) {
    const c = image[poolStart + i]!;
    if (c !== 0 && c !== 9 && c !== 10 && (c < 32 || c > 126)) return fail('malformed', `Unsupported string byte 0x${c.toString(16)} in pool.`);
  }
  for (let i = end; i < IMAGE_SIZE; i++) {
    if (image[i] !== 0) return fail('malformed', `Non-zero padding at byte ${i}.`);
  }

  const layers: Layer[] = [];
  for (let li = 0; li < layerCount; li++) {
    const base = HEADER_SIZE + size * li;
    const actions: Action[] = [];
    for (let i = 0; i < keys + 3; i++) {
      const decoded = decodeAction(image[base + 2 * i]!, image[base + 2 * i + 1]!, layerCount, i >= keys + 1, pool, image[2]!);
      if (typeof decoded === 'string') return fail('malformed', `Layer ${li + 1}, input ${i + 1}: ${decoded}.`);
      actions.push(decoded);
    }
    const ledBase = base + 2 * (keys + 3);
    if (keys === 3 && image[ledBase + 1]! & 0xf0) return fail('malformed', `Layer ${li + 1}: unused LED nibble is non-zero.`);
    const leds: number[] = [];
    for (let i = 0; i < keys; i++) {
      const byte = image[ledBase + (i >> 1)]!;
      leds.push(i & 1 ? byte >> 4 : byte & 15);
    }
    const options = image[base + size - 1]!;
    const layer: Layer = {
      keys: actions.slice(0, keys),
      encoderButton: actions[keys]!,
      clockwise: actions[keys + 1]!,
      counterclockwise: actions[keys + 2]!,
      leds,
      bootloaderFromRun: !!(options & LAYER_OPT_BOOTLOADER_RUN),
      indicatorBehavior: (options >> LAYER_OPT_INDICATOR_SHIFT) & 3,
      indicatorColor: options >> 4,
      indicatorFullBrightness: !!(options & LAYER_OPT_FULL_BRIGHTNESS),
    };
    layers.push(layer);
  }

  const chords: Chord[] = [];
  let offset = HEADER_SIZE + size * layerCount;
  let previous = -1;
  for (let i = 0; i < chordCount; i++, offset += CHORD_ENTRY_SIZE) {
    const id = image[offset]!;
    const layer = (id >> 4) & (extended ? 7 : 3);
    const global = !!(id & 0x80);
    const pair = id & 15;
    if (!extended && (id & 0x40)) return fail('malformed', `Chord ${i + 1}: reserved identifier bit set.`);
    if (layer >= layerCount) return fail('malformed', `Chord ${i + 1}: layer ${layer + 1} does not exist.`);
    if (pair >= pairCount(variant)) return fail('malformed', `Chord ${i + 1}: pair index ${pair} is invalid.`);
    if (id <= previous) return fail('malformed', `Chord ${i + 1}: identifiers are not strictly ascending.`);
    previous = id;
    const decoded = decodeAction(image[offset + 1]!, image[offset + 2]!, layerCount, false, pool, image[2]!);
    if (typeof decoded === 'string') return fail('malformed', `Chord ${i + 1}: ${decoded}.`);
    const [keyA, keyB] = pairFromIndex(pair, keys);
    chords.push({ layer, keyA, keyB, global, action: decoded });
  }

  if (imageCrc(image) !== storedCrc(image)) return fail('bad-crc', 'Stored CRC does not match image contents.');

  return {
    ok: true,
    profile: { variant, transparentBlack: !!(image[5]! & 0x80), startupLayer, chordWindow: image[8]! & 15, rainbowPhase: configurableRainbow ? (image[8]! >> HEADER_RAINBOW_PHASE_SHIFT) & 3 : DEFAULT_RAINBOW_PHASE, rainbowSpeed: configurableRainbow ? image[8]! >> HEADER_RAINBOW_SPEED_SHIFT : DEFAULT_RAINBOW_SPEED, layers, chords },
  };
}
