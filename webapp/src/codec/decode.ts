import {
  ActionCode, CHORD_ENTRY_SIZE, FORMAT_VERSION, HEADER_SIZE, IMAGE_SIZE, MAX_LAYERS,
  LAYER_OPT_BOOTLOADER_RUN, LAYER_OPT_FULL_BRIGHTNESS, LAYER_OPT_INDICATOR_SHIFT,
  keyCount, layerSize, pairCount, type Variant,
} from '../model/constants';
import type { Action, Chord, Layer, Profile } from '../model/types';
import { migrateLegacyScrollInversion } from '../model/defaults';
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

function decodeAction(b0: number, b1: number, layers: number, rotation: boolean, pool: PoolView): Action | string {
  const type = b0 & 15;
  const aux = b0 >> 4;
  const nonZeroAux = aux !== 0;
  switch (type) {
    case ActionCode.None:
      return nonZeroAux || b1 ? 'None action has non-zero data' : { type: 'none' };
    case ActionCode.RelativeLayer: {
      const offset = toSigned(b1);
      return nonZeroAux || offset < -3 || offset > 3 ? 'Invalid relative-layer offset' : { type: 'relativeLayer', offset };
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
    case ActionCode.MouseX:
    case ActionCode.MouseY: {
      if (nonZeroAux || b1 === 0x80) return 'Invalid relative delta';
      const t = type === ActionCode.Scroll ? 'scroll' : type === ActionCode.MouseX ? 'mouseX' : 'mouseY';
      return { type: t, delta: toSigned(b1) };
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
      if (nonZeroAux || b1 >= layers) return `Layer ${b1 + 1} does not exist`;
      if (rotation && type === ActionCode.MomentaryLayer) return 'Momentary layer bound to rotation';
      const t = type === ActionCode.SetLayer ? 'setLayer' : 'momentaryLayer';
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
  if (image[2] !== FORMAT_VERSION) return fail('unsupported-version', `Format version ${image[2]} is not supported (expected ${FORMAT_VERSION}).`);
  if (image[3]! & 0xf0) return fail('malformed', 'Reserved bits set in byte 3.');
  if (image[5]! & 0x80) return fail('malformed', 'Reserved bit set in byte 5.');
  if (image[8]! & 0xf0) return fail('malformed', 'Reserved bits set in chord-window byte.');

  const variant = (image[5]! & 1) as Variant;
  if (expectedVariant !== undefined && variant !== expectedVariant) {
    return fail('malformed', `Image is for the ${variant ? 'three' : 'six'}-key variant but the device has ${expectedVariant ? 'three' : 'six'} keys.`);
  }
  const layerCount = (image[3]! & 3) + 1;
  const startupLayer = (image[3]! >> 2) & 3;
  if (startupLayer >= layerCount) return fail('malformed', `Startup layer ${startupLayer + 1} exceeds layer count ${layerCount}.`);
  if (layerCount > MAX_LAYERS) return fail('malformed', 'Too many layers.');

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
      const decoded = decodeAction(image[base + 2 * i]!, image[base + 2 * i + 1]!, layerCount, i >= keys + 1, pool);
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
    const layer = id >> 4;
    const pair = id & 15;
    if (id & 0xc0) return fail('malformed', `Chord ${i + 1}: reserved identifier bits set.`);
    if (layer >= layerCount) return fail('malformed', `Chord ${i + 1}: layer ${layer + 1} does not exist.`);
    if (pair >= pairCount(variant)) return fail('malformed', `Chord ${i + 1}: pair index ${pair} is invalid.`);
    if (id <= previous) return fail('malformed', `Chord ${i + 1}: identifiers are not strictly ascending.`);
    previous = id;
    const decoded = decodeAction(image[offset + 1]!, image[offset + 2]!, layerCount, false, pool);
    if (typeof decoded === 'string') return fail('malformed', `Chord ${i + 1}: ${decoded}.`);
    const [keyA, keyB] = pairFromIndex(pair, keys);
    chords.push({ layer, keyA, keyB, action: decoded });
  }

  if (imageCrc(image) !== storedCrc(image)) return fail('bad-crc', 'Stored CRC does not match image contents.');

  return {
    ok: true,
    profile: migrateLegacyScrollInversion({ variant, startupLayer, chordWindow: image[8]! & 15, layers, chords }),
  };
}
