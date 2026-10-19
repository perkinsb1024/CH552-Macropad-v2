import { ledCommandFromCode, ledProblem } from '../model/ledControl';
import {
  SLEEP_TIMEOUT_MINUTES,   PREVIOUS_LAYER, MAX_TIMED_ACTIONS, TIMED_ENTRY_SIZE, DEFAULT_RAINBOW_SPEED, HEADER_RAINBOW_SPEED_SHIFT, DEFAULT_RAINBOW_PHASE, HEADER_RAINBOW_PHASE_SHIFT, CHORD_ENTRY_SIZE, HEADER_MARKER, FORMAT_VERSION, HEADER_SIZE, IMAGE_SIZE, maxLayers,
  LAYER_OPT_FULL_BRIGHTNESS, LAYER_OPT_AUTO_SLEEP, LAYER_OPT_INDICATOR_SHIFT,
  keyCount, layerSize, layerPaletteSize, pairCount, type Variant,
} from '../model/constants';
import type { Action, Chord, Layer, Profile, TimedAction, OrdinaryAction } from '../model/types';
import { branches, holdBindings } from '../model/tapHold';
import { pairFromIndex } from '../model/pairs';
import { imageCrc, storedCrc } from './crc16';
import { migrateProfileColors } from '../model/palette';
import { migrateChordWindow } from '../model/defaults';
import { ActionCode } from './legacyActionCodes';
import { isSupportedUsage } from '../keys/keyboard';

export type DecodeResult =
  | { ok: true; profile: Profile; notices?: string[] }
  | { ok: false; reason: DecodeFailure; detail: string };

export type DecodeFailure = 'no-magic' | 'unsupported-version' | 'malformed' | 'bad-crc';

function toSigned(byte: number): number {
  return byte > 127 ? byte - 256 : byte;
}

interface PoolView {
  start: number;
  used: number;
  bytes: Uint8Array;
  macroStart?: number;
  records?: Map<number, { tap: OrdinaryAction; hold: OrdinaryAction }>;
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

function decodeText(pool: PoolView, offset: number): Action | string {
  const text = stringAt(pool, offset);
  return text === null ? `String offset ${offset} does not start a string` : { type: 'string', text };
}

function decodeAction(b0: number, b1: number, layers: number, rotation: boolean, pool: PoolView, version: number): Action | string {
  // Decode using the source format at every action site before re-encoding.
  if (version >= 14) {
    const type = b0 & 15;
    const aux = b0 >> 4;
    if (type === 0xb) {
      if (rotation) return 'Modified consumer hold bound to rotation';
      return b1 ? { type: 'consumerModifiedHold', usage: b1, modifiers: aux } : 'Consumer usage is zero';
    }
    if (type === 0xc) {
      const mode = aux & 3;
      if ((version >= 16 ? (aux & 7) > 6 : aux > 6) || mode === 3) return 'Invalid layer mode';
      if (rotation && mode === 2) return 'Layer hold bound to rotation';
      if (aux & 4) {
        const offset = toSigned(b1);
        if (offset < -6 || offset > 6) return 'Invalid relative-layer offset';
        return { type: mode === 2 ? 'momentaryRelativeLayer' : mode === 1 ? 'oneShotRelativeLayer' : 'relativeLayer', offset };
      }
      if (b1 >= layers && !(mode !== 2 && b1 === PREVIOUS_LAYER)) return `Layer ${b1 + 1} does not exist`;
      return { type: mode === 2 ? 'momentaryLayer' : mode === 1 ? 'oneShotSetLayer' : 'setLayer', layer: b1 };
    }
    if (type === 0xf) {
      if (version < 18) return 'Reserved action type F';
      if (rotation) return 'Tap-Hold needs a physical release';
      const record = pool.records?.get(b1);
      return record ? { type: 'tapHold', ...structuredClone(record), thresholdMs: (aux + 1) * 32 } : 'Invalid Tap-Hold record address';
    }
    if (type === 0) b0 = aux === 1 ? 0x20 : aux === 2 ? 0x10 : b0;
    else {
      const legacyTypes = [0, 1, 2, 3, 5, 6, 12, 13, 7, 8, 4, 0, 0, 14, 15];
      b0 = (b0 & 0xf0) | legacyTypes[type]!;
    }
  }
  let type = b0 & 15;
  if (version < 11 && type === 4) {
    if (version >= 8) return 'Reserved action type 4';
    return b0 >> 4 || b1 < 1 || b1 > 7 ? 'Invalid mouse button mask' : { type: 'mouseClick', buttons: b1, clicks: 2 };
  }
  if (version < 6) {
    if (type === 12) return 'Reserved action type in older format';
    if (type >= 13) type--;
  }
  if (version < 11 && type >= 5) type--;
  const aux = b0 >> 4;
  const nonZeroAux = aux !== 0;
  switch (type) {
    case ActionCode.Macro: {
      const start = pool.macroStart ?? pool.start + pool.used;
      return b1 < start || b1 >= IMAGE_SIZE ? 'Invalid macro offset' : { type: 'macro', macro: b1, repeats: aux + 1 };
    }
    case ActionCode.LedControl: {
      const spec = ledCommandFromCode(b1);
      if (!spec || (version < 7 && b1 >= 0x80)) return 'Unknown LED command';
      const value = version >= 16 && b1 === 0x80 ? 0 : b1 >= 0x80 ? aux : version >= 16 && b1 === 10 ? 0 : spec.relative ? (aux < 8 ? aux : aux - 16) : aux === 15 ? 'asConfigured' : aux;
      const problem = ledProblem(spec.command, value);
      return problem ?? { type: 'ledControl', command: spec.command, value,
        ...(b1 >= 0x91 && b1 <= 0x99 ? { brightness: 'dim' as const } : {}) };
    }
    case ActionCode.None:
      if (version >= 11 && aux === 2) return { type: 'pause', ticks: b1 };
      if (version >= 8 && aux === 1) return decodeText(pool, b1);
      return nonZeroAux || (version < 16 && b1) ? 'None action has non-zero data' : { type: 'none' };
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
      if ((version < 8 && nonZeroAux) || b1 < 1 || (version < 12 && b1 > 7)) return 'Invalid mouse click settings';
      return { type: 'mouseClick', buttons: b1, ...(aux ? { clicks: aux + 1 } : {}) };
    case ActionCode.ConsumerModified:
      if (version < 13) {
        if (rotation) return 'Mouse hold bound to rotation';
        if (nonZeroAux || b1 < 1 || (version < 12 && b1 > 7)) return 'Invalid mouse button mask';
        return { type: 'mouseHold', buttons: b1 };
      }
      if (!b1) return 'Consumer usage is zero';
      return { type: 'consumerModified', usage: b1, modifiers: aux };
    case ActionCode.MouseToggle:
      if (version >= 13 && aux === 3) {
        if (rotation) return 'Mouse hold bound to rotation';
        return b1 < 1 ? 'Invalid mouse button mask' : { type: 'mouseHold', buttons: b1 };
      }
      if (aux > (version >= 12 ? 2 : 0) || b1 < 1 || (version < 12 && b1 > 7)) return 'Invalid persistent mouse settings';
      return { type: aux === 1 ? 'mouseDown' : aux === 2 ? 'mouseUp' : 'mouseToggle', buttons: b1 };
    case ActionCode.Scroll:
      if ((version < 8 ? nonZeroAux : version === 8 ? aux !== 0 && aux !== 4 : !!(aux & 3)) || b1 === 0x80) return 'Invalid scroll settings';
      if (rotation && (aux & 4)) return 'Scroll hold bound to rotation';
      return { type: 'scroll', delta: toSigned(b1), ...(aux & 4 ? { hold: true } : {}), ...(aux & 8 ? { horizontal: true } : {}) };
    case ActionCode.MouseAxis:
    case ActionCode.MouseXY: {
      if (version < 13) {
        if (aux > 1 || b1 === 0x80) return 'Invalid relative delta';
        if (rotation && aux) return 'Pointer hold bound to rotation';
        return { type: type === ActionCode.MouseAxis ? 'mouseX' : 'mouseY', delta: toSigned(b1), ...(aux ? { hold: true } : {}) };
      }
      if (rotation && (aux & 1)) return 'Pointer hold bound to rotation';
      const hold = aux & 1 ? { hold: true } : {};
      if (type === ActionCode.MouseAxis) {
        if ((version < 16 && aux > 3) || b1 === 0x80) return 'Invalid single-axis movement';
        return { type: aux & 2 ? 'mouseY' : 'mouseX', delta: toSigned(b1), ...hold };
      }
      if (version < 16 && aux > 7) return 'Invalid combined movement';
      return { type: 'mouseXY', x: ((b1 & 15) + 1) * 4 * (aux & 2 ? -1 : 1), y: ((b1 >> 4) + 1) * 4 * (aux & 4 ? -1 : 1), ...hold };
    }
    case ActionCode.Consumer:
    case ActionCode.ConsumerHold:
      if (type === ActionCode.ConsumerHold && version < 8) {
        return nonZeroAux ? 'String action has non-zero auxiliary data' : decodeText(pool, b1);
      }
      if (rotation && type === ActionCode.ConsumerHold) return 'Consumer hold bound to rotation';
      if (!nonZeroAux && !b1) return 'Consumer usage is zero';
      return { type: type === ActionCode.ConsumerHold ? 'consumerHold' : 'consumer', usage: (aux << 8) | b1 };
    case ActionCode.SetLayer:
    case ActionCode.MomentaryLayer: {
      const previous = version >= 7 && type === ActionCode.SetLayer && b1 === PREVIOUS_LAYER;
      if ((type === ActionCode.SetLayer ? aux > 1 : nonZeroAux) || (b1 >= layers && !previous)) return `Layer ${b1 + 1} does not exist`;
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
  const board = image[0] === HEADER_MARKER;
  return { magic: board || image[0] === 0x4d && image[1] === 0x50,
    version: image[board ? 1 : 2] ?? 0, variant: ((image[board ? 2 : 5] ?? 0) & 1) as Variant };
}

/** Decodes and fully validates a 128-byte image, mirroring the firmware's configValid. */
export function decodeImage(image: Uint8Array, expectedVariant?: Variant): DecodeResult {
  const fail = (reason: DecodeFailure, detail: string): DecodeResult => ({ ok: false, reason, detail });
  if (image.length !== IMAGE_SIZE) return fail('malformed', `Image is ${image.length} bytes, expected ${IMAGE_SIZE}.`);
  const board = image[0] === HEADER_MARKER;
  const header = peekHeader(image);
  if (!header.magic) return fail('no-magic', 'Missing B or legacy MP marker; no saved profile.');
  const version = header.version;
  if (board ? version < 15 || version > FORMAT_VERSION : version < 2 || version > 15)
    return fail('unsupported-version', `Format version ${version} is not supported for this header.`);
  if (imageCrc(image) !== storedCrc(image)) return fail('bad-crc', 'Stored CRC does not match image contents.');
  if (board && version < 16 && ((image[2]! & 0x80) || (image[3]! & 1) || (image[6]! & 0xe0)))
    return fail('malformed', 'Reserved header bits are non-zero.');
  if (!board && version === 2 && (image[5]! & 0x80)) return fail('malformed', 'Reserved bit set in version 2 byte 5.');
  const extended = version >= 4;
  const configurableRainbow = version >= 5;
  if (!board && version < 7 && image[3]! & (extended ? 0xc0 : 0xf0)) return fail('malformed', 'Reserved bits set in byte 3.');
  if (!board && !configurableRainbow && (image[8]! & 0xf0)) return fail('malformed', 'Reserved bits set in chord-window byte.');

  const variant = header.variant;
  if (expectedVariant !== undefined && variant !== expectedVariant) {
    return fail('malformed', `Image is for the ${variant ? 'three' : 'six'}-key variant but the device has ${expectedVariant ? 'three' : 'six'} keys.`);
  }
  const layerCount = board ? ((image[2]! >> 1) & 7) + 1 : (image[3]! & (extended ? 7 : 3)) + 1;
  const startupLayer = board ? (image[2]! >> 4) & 7 : (image[3]! >> (extended ? 3 : 2)) & (extended ? 7 : 3);
  if (startupLayer >= layerCount) return fail('malformed', `Startup layer ${startupLayer + 1} exceeds layer count ${layerCount}.`);
  if (layerCount > (extended ? maxLayers(variant) : 4)) return fail('malformed', 'Too many layers.');

  const keys = keyCount(variant);
  const size = layerSize(variant);
  const chordCount = board ? image[4]! >> 3 : (image[5]! >> 1) & 63;
  const timerCount = board ? image[4]! & 7 : version >= 7 ? (image[3]! >> 6) | ((image[4]! >> 7) << 2) : 0;
  if (timerCount > (version >= 18 ? MAX_TIMED_ACTIONS : 4)) return fail('malformed', 'Too many timed actions.');
  const poolUsed = board ? image[3]! >> 1 : version >= 7 ? image[4]! & 127 : image[4]!;
  const timerSize = version >= 10 ? TIMED_ENTRY_SIZE : 5;
  const fixedEnd = HEADER_SIZE + size * layerCount;
  if (fixedEnd > IMAGE_SIZE) return fail('malformed', 'Layer records exceed image capacity.');
  let paletteEnd = fixedEnd;
  if (version >= 16) for (let li = 0; li < layerCount; li++) {
    if (image[HEADER_SIZE + size * (li + 1) - 1]! >> 4 === 0) paletteEnd += layerPaletteSize(variant);
  }
  const poolStart = paletteEnd + CHORD_ENTRY_SIZE * chordCount + timerSize * timerCount;
  const end = poolStart + poolUsed;
  if (end > IMAGE_SIZE) return fail('malformed', `Declared content ends at byte ${end}, beyond the 128-byte image.`);
  const pool: PoolView = { start: poolStart, used: poolUsed, bytes: image };
  let macroStart = end;
  const records = new Map<number, { tap: OrdinaryAction; hold: OrdinaryAction }>();
  if (version >= 18 && end < IMAGE_SIZE && (image[end]! & 15) === 15) {
    const count = (image[end]! >> 4) + 1;
    macroStart += 1 + 4 * count;
    if (macroStart > IMAGE_SIZE) return fail('malformed', 'Tap-Hold records exceed image capacity.');
    pool.macroStart = macroStart;
    for (let i = 0; i < count; i++) {
      const address = end + 1 + 4 * i;
      const tap = decodeAction(image[address]!, image[address + 1]!, layerCount, true, pool, version);
      const hold = decodeAction(image[address + 2]!, image[address + 3]!, layerCount, false, pool, version);
      if (typeof tap === 'string' || typeof hold === 'string' || tap.type === 'tapHold' || hold.type === 'tapHold')
        return fail('malformed', `Invalid Tap-Hold pair ${i + 1}.`);
      records.set(address, { tap, hold });
    }
  }
  pool.records = records;
  pool.macroStart = macroStart;

  if (poolUsed && image[poolStart + poolUsed - 1] !== 0) return fail('malformed', 'String pool does not end with a terminator.');
  for (let i = 0; i < poolUsed; i++) {
    const c = image[poolStart + i]!;
    if (c !== 0 && c !== 9 && c !== 10 && (c < 32 || c > 126)) return fail('malformed', `Unsupported string byte 0x${c.toString(16)} in pool.`);
  }
  for (let i = end; version < 11 && i < IMAGE_SIZE; i++) {
    if (image[i] !== 0) return fail('malformed', `Non-zero padding at byte ${i}.`);
  }

  const layers: Layer[] = [];
  for (let li = 0; li < layerCount; li++) {
    const base = HEADER_SIZE + size * li;
    const actions: Action[] = [];
    for (let i = 0; i < keys + 3; i++) {
      const decoded = decodeAction(image[base + 2 * i]!, image[base + 2 * i + 1]!, layerCount, i >= keys + 1, pool, version);
      if (typeof decoded === 'string') return fail('malformed', `Layer ${li + 1}, input ${i + 1}: ${decoded}.`);
      actions.push(decoded);
    }
    const ledBase = base + 2 * (keys + 3);
    if (version < 16 && keys === 3 && image[ledBase + 1]! & 0xf0) return fail('malformed', `Layer ${li + 1}: unused LED nibble is non-zero.`);
    const leds: number[] = [];
    for (let i = 0; i < keys; i++) {
      const byte = image[ledBase + (i >> 1)]!;
      leds.push(i & 1 ? byte >> 4 : byte & 15);
    }
    const options = image[base + size - 1]!;
    // Only v15 assigns bit 1 to auto-sleep; older formats ignore it.
    const layer: Layer = {
      keys: actions.slice(0, keys),
      encoderButton: actions[keys]!,
      clockwise: actions[keys + 1]!,
      counterclockwise: actions[keys + 2]!,
      leds,
      indicatorBehavior: (options >> LAYER_OPT_INDICATOR_SHIFT) & 3,
      indicatorColor: options >> 4,
      indicatorFullBrightness: !!(options & LAYER_OPT_FULL_BRIGHTNESS),
      autoSleep: version >= 15 && !!(options & LAYER_OPT_AUTO_SLEEP),
    };
    layers.push(layer);
  }

  const chords: Chord[] = [];
  let offset = fixedEnd;
  if (version >= 16) for (const layer of layers) {
    if (layer.indicatorColor !== 0) continue;
    layer.idleLeds = Array.from({ length: keys }, (_, i) => (image[offset + (i >> 1)]! >> ((i & 1) * 4)) & 15);
    offset += layerPaletteSize(variant);
  }
  let previous = -1;
  for (let i = 0; i < chordCount; i++, offset += CHORD_ENTRY_SIZE) {
    const id = image[offset]!;
    const scope = (id >> 4) & (extended ? 7 : 3);
    const global = version >= 18 ? scope === 7 : !!(id & 0x80);
    const layer = version >= 18 && global ? 0 : scope;
    if (version >= 18 && (id & 0x80)) return fail('malformed', `Chord ${i + 1}: reserved identifier bit set.`);
    const pair = id & 15;
    if (!extended && (id & 0x40)) return fail('malformed', `Chord ${i + 1}: reserved identifier bit set.`);
    if (layer >= layerCount) return fail('malformed', `Chord ${i + 1}: layer ${layer + 1} does not exist.`);
    if (pair >= pairCount(variant)) return fail('malformed', `Chord ${i + 1}: pair index ${pair} is invalid.`);
    if (id <= previous) return fail('malformed', `Chord ${i + 1}: identifiers are not strictly ascending.`);
    previous = id;
    const decoded = decodeAction(image[offset + 1]!, image[offset + 2]!, layerCount, false, pool, version);
    if (typeof decoded === 'string') return fail('malformed', `Chord ${i + 1}: ${decoded}.`);
    const [keyA, keyB] = pairFromIndex(pair, keys);
    chords.push({ layer, keyA, keyB, global, action: decoded });
  }

  const timedActions: TimedAction[] = [];
  for (let i = 0; i < timerCount; i++, offset += timerSize) {
    const action = decodeAction(image[offset + 1]!, image[offset + 2]!, layerCount, true, pool, version);
    const resumeAction = decodeAction(image[offset + 3]!, image[offset + 4]!, layerCount, true, pool, version);
    if (typeof action === 'string' || typeof resumeAction === 'string')
      return fail('malformed', `Timed action ${i + 1}: ${typeof action === 'string' ? action : resumeAction}.`);
    const current = version >= 10;
    const metadata = image[current ? offset + 5 : offset]!;
    const scope = current ? metadata & 7 : 0;
    if (scope > layerCount) return fail('malformed', `Timed action ${i + 1}: assigned layer does not exist.`);
    timedActions.push({ ticks: current ? (image[offset]! | ((metadata & 56) << 5)) + 1 : ((metadata & 63) + 1) * 32,
      ...(scope ? { layer: scope - 1 } : {}), consumeInput: !!(metadata & 64), resetOnInput: !!(metadata & 128), action, resumeAction });
  }

  const macros: { actions: Action[] }[] = [];
  if (version >= 11) {
    const steps = new Map<number, Action>();
    const starts = new Set<number>();
    let beginning = true;
    let offset = macroStart;
    for (; offset < IMAGE_SIZE;) {
      if (!image[offset]) {
        steps.set(offset++, { type: 'none' });
        beginning = true;
        continue;
      }
      if (offset + 1 >= IMAGE_SIZE) return fail('malformed', 'Non-zero unpaired macro byte.');
      const step = decodeAction(image[offset]!, image[offset + 1]!, layerCount, true, pool, version);
      if (typeof step === 'string' || step.type === 'macro') return fail('malformed', `Macro tail at byte ${offset}: ${typeof step === 'string' ? step : 'Nested macro'}.`);
      steps.set(offset, step);
      if (beginning) { starts.add(offset); beginning = false; }
      offset += 2;
    }
    const bindings = [...layers.flatMap(l => [...l.keys, l.encoderButton, l.clockwise, l.counterclockwise]), ...chords.map(c => c.action), ...timedActions.flatMap(t => [t.action, t.resumeAction])].flatMap(branches);
    bindings.push(...[...records.values()].flatMap(r => [r.tap, r.hold]));
    for (const action of bindings) if (action.type === 'macro') {
      if (!steps.has(action.macro)) return fail('malformed', 'Macro offset points to an action parameter.');
      starts.add(action.macro);
    }
    const addresses = [...starts].sort((a, b) => a - b);
    for (const address of addresses) {
      const actions: Action[] = [];
      for (let cursor = address; cursor < IMAGE_SIZE; cursor += 2) {
        const step = steps.get(cursor)!;
        if (step.type === 'none') break;
        actions.push({ ...step });
      }
      macros.push({ actions });
    }
    for (const action of bindings) if (action.type === 'macro') action.macro = addresses.indexOf(action.macro);
  }

  const led = image[board ? 5 : 8]!;
  const profile: Profile = {
    sleepTimeoutMinutes: board ? SLEEP_TIMEOUT_MINUTES[image[6]! & 3]! : 30,
    consumeWakeInput: board ? !!(image[6]! & 4) : true,
    showLayerIndicatorOnWake: board ? !!(image[6]! & 8) : true,
    dimInsteadOfOff: board && !!(image[6]! & 16),
    variant, transparentBlack: !!(image[5]! & (board ? 8 : 128)), startupLayer,
    chordWindow: board ? 4 + 2 * (led & 7) : led & 15,
    rainbowPhase: configurableRainbow ? (led >> HEADER_RAINBOW_PHASE_SHIFT) & 3 : DEFAULT_RAINBOW_PHASE,
    rainbowSpeed: configurableRainbow ? led >> HEADER_RAINBOW_SPEED_SHIFT : DEFAULT_RAINBOW_SPEED,
    layers, chords, ...(timedActions.length ? { timedActions } : {}), ...(macros.length ? { macros } : {}) };
  const holds = holdBindings(profile);
  if (holds.length) {
    profile.holdThresholdMs = holds[0]!.thresholdMs;
    for (const a of holds) if (a.thresholdMs === profile.holdThresholdMs) delete a.thresholdMs;
  }
  const teal = version < 16 && migrateProfileColors(profile);
  const notices = board ? [] : migrateChordWindow(profile);
  if (teal) notices.push('Teal was replaced with Cyan. Brightness settings are unchanged.');
  return { ok: true, profile, ...(notices.length ? { notices } : {}) };
}

/** Decode a dispatched action without guessing its binding from the current layer. */
export function decodeLiveAction(image: Uint8Array, first: number, second: number): Action | null {
  const decoded = decodeImage(image);
  if (!decoded.ok || image[1] !== FORMAT_VERSION) return null;
  const p = decoded.profile;
  let start = HEADER_SIZE + layerSize(p.variant) * p.layers.length;
  for (const l of p.layers) if (l.indicatorColor === 0) start += layerPaletteSize(p.variant);
  start += CHORD_ENTRY_SIZE * p.chords.length + TIMED_ENTRY_SIZE * (p.timedActions?.length ?? 0);
  const end = start + (image[3]! >> 1);
  const macroStart = end < IMAGE_SIZE && (image[end]! & 15) === 15 ? end + 1 + 4 * ((image[end]! >> 4) + 1) : end;
  const pool = { start, used: image[3]! >> 1, bytes: image, macroStart };
  const action = decodeAction(first, second, p.layers.length, false, pool, FORMAT_VERSION);
  if (typeof action === 'string') return null;
  if (action.type === 'macro') {
    // The decoder sorts referenced macro starts; locate this binding's original address.
    const addresses = new Set<number>();
    let beginning = true;
    for (let cursor = macroStart; cursor < IMAGE_SIZE;) {
      if (!image[cursor]) { cursor++; beginning = true; }
      else { if (beginning) addresses.add(cursor); beginning = false; cursor += 2; }
    }
    const add = (offset: number) => { if ((image[offset]! & 15) === 14) addresses.add(image[offset + 1]!); };
    for (let li = 0; li < p.layers.length; li++) for (let i = 0; i < keyCount(p.variant) + 3; i++) add(HEADER_SIZE + li * layerSize(p.variant) + 2 * i);
    let offset = start - CHORD_ENTRY_SIZE * p.chords.length - TIMED_ENTRY_SIZE * (p.timedActions?.length ?? 0);
    for (let i = 0; i < p.chords.length; i++, offset += CHORD_ENTRY_SIZE) add(offset + 1);
    for (let i = 0; i < (p.timedActions?.length ?? 0); i++, offset += TIMED_ENTRY_SIZE) { add(offset + 1); add(offset + 3); }
    if (macroStart !== end) for (let cursor = end + 1; cursor < macroStart; cursor += 2) add(cursor);
    action.macro = [...addresses].sort((a, b) => a - b).indexOf(second);
    if (action.macro < 0) return null;
  }
  return action;
}
