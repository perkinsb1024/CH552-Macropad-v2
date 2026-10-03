import type { Action, Chord, Layer, Profile, TimedAction } from '../model/types';
import { RAINBOW_SPEED_LABELS, DEFAULT_RAINBOW_SPEED, RAINBOW_PHASE_DEGREES, DEFAULT_RAINBOW_PHASE, type Variant, VARIANT_SIX_KEYS, VARIANT_THREE_KEYS, keyCount, maxLayers } from '../model/constants';
import { validateProfile } from '../model/validate';
import { descriptor, ACTION_DESCRIPTORS } from '../model/actions';
import { PALETTE } from '../model/palette';
import { normalizeText } from '../model/strings';
import { migrateLegacyProfile } from '../model/defaults';

export const JSON_FORMAT = 'universal-macropad-profile';
export const JSON_VERSION = 7;
const LEGACY_RAINBOW_SPEED_NAMES = ['double', 'normal', 'half', 'quarter'];

/** Optional editor annotations that never reach the device. */
export interface LocalMetadata {
  layerNames?: string[];
  profileName?: string;
}

export interface ExportedProfile {
  format: typeof JSON_FORMAT;
  version: typeof JSON_VERSION;
  variant: 'six-key' | 'three-key';
  startupLayer: number;
  transparentBlack: boolean;
  chordWindowMs: number;
  rainbowPhaseDegrees: number;
  rainbowSpeed: string;
  layers: Array<{
    keys: Action[];
    encoderButton: Action;
    clockwise: Action;
    counterclockwise: Action;
    leds: string[];
    bootloaderFromRun: boolean;
    indicatorBehavior: number;
    indicatorColor: number;
    indicatorFullBrightness: boolean;
  }>;
  chords: Array<{ layer: number; keys: [number, number]; global?: boolean; action: Action }>;
  timedActions?: TimedAction[];
  localMetadata?: LocalMetadata;
}

export function exportProfile(profile: Profile, meta?: LocalMetadata): string {
  const out: ExportedProfile = {
    format: JSON_FORMAT,
    version: JSON_VERSION,
    variant: profile.variant === VARIANT_THREE_KEYS ? 'three-key' : 'six-key',
    startupLayer: profile.startupLayer,
    transparentBlack: profile.transparentBlack,
    chordWindowMs: profile.chordWindow * 5,
    rainbowPhaseDegrees: RAINBOW_PHASE_DEGREES[profile.rainbowPhase]!,
    rainbowSpeed: RAINBOW_SPEED_LABELS[profile.rainbowSpeed]!.toLowerCase(),
    layers: profile.layers.map((layer) => ({
      keys: layer.keys,
      encoderButton: layer.encoderButton,
      clockwise: layer.clockwise,
      counterclockwise: layer.counterclockwise,
      leds: layer.leds.map((i) => PALETTE[i]?.name ?? String(i)),
      bootloaderFromRun: layer.bootloaderFromRun,
      indicatorBehavior: layer.indicatorBehavior,
      indicatorColor: layer.indicatorColor,
      indicatorFullBrightness: layer.indicatorFullBrightness,
    })),
    chords: profile.chords.map((c) => ({ layer: c.layer, keys: [c.keyA, c.keyB], global: !!c.global, action: c.action })),
  };
  if (profile.timedActions) out.timedActions = profile.timedActions;
  if (meta && (meta.layerNames?.some(Boolean) || meta.profileName)) out.localMetadata = meta;
  return JSON.stringify(out, null, 2) + '\n';
}

export class ImportError extends Error {}

const TYPES = new Set(ACTION_DESCRIPTORS.map((d) => d.type));

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function int(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new ImportError(`${what} must be an integer.`);
  return v;
}

function bool(v: unknown, what: string): boolean {
  if (v === undefined) return false;
  if (typeof v !== 'boolean') throw new ImportError(`${what} must be true or false.`);
  return v;
}

function action(v: unknown, what: string): Action {
  if (isRecord(v) && v.type === 'nextLayer') return { type: 'relativeLayer', offset: 0 };
  if (!isRecord(v) || typeof v.type !== 'string' || !TYPES.has(v.type as Action['type'])) throw new ImportError(`${what}: unknown action.`);
  const type = v.type as Action['type'];
  descriptor(type);
  switch (type) {
    case 'ledControl':
      if (typeof v.command !== 'string') throw new ImportError(`${what}: LED command must be a string.`);
      return { type, command: v.command as import('../model/ledControl').LedCommand, value: v.value === 'asConfigured' ? v.value : int(v.value, `${what} LED value`) };
    case 'none':
      return { type };
    case 'relativeLayer':
    case 'oneShotRelativeLayer':
      return { type, offset: int(v.offset, `${what} offset`) };
    case 'keyTap':
    case 'keyHold':
      return { type, usage: int(v.usage ?? 0, `${what} usage`), modifiers: int(v.modifiers ?? 0, `${what} modifiers`) };
    case 'mouseClick':
    case 'mouseDouble':
    case 'mouseHold':
    case 'mouseToggle':
      return { type, buttons: int(v.buttons, `${what} buttons`) };
    case 'scroll':
      return { type, delta: int(v.delta, `${what} delta`) };
    case 'mouseX':
    case 'mouseY':
      return { type, delta: int(v.delta, `${what} delta`), ...(bool(v.hold, `${what} hold`) ? { hold: true } : {}) };
    case 'consumer':
      return { type, usage: int(v.usage, `${what} usage`) };
    case 'string':
      if (typeof v.text !== 'string') throw new ImportError(`${what}: text must be a string.`);
      return { type, text: normalizeText(v.text) };
    case 'setLayer':
    case 'oneShotSetLayer':
    case 'momentaryLayer':
      return { type, layer: int(v.layer, `${what} layer`) };
  }
}

function led(v: unknown, what: string): number {
  if (typeof v === 'number') return int(v, what);
  if (typeof v === 'string') {
    const byName = PALETTE.find((p) => p.name.toLowerCase() === v.toLowerCase() || p.hex.toLowerCase() === v.toLowerCase());
    if (byName) return byName.index;
    const n = Number(v);
    if (Number.isInteger(n)) return n;
  }
  throw new ImportError(`${what}: unknown palette color.`);
}

/** Parses exported JSON and validates it with the same rules as interactive edits. */
export function importProfile(text: string): { profile: Profile; meta: LocalMetadata } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError('The file is not valid JSON.');
  }
  if (!isRecord(raw)) throw new ImportError('The file does not contain a profile object.');
  if (raw.format !== JSON_FORMAT) throw new ImportError('This file is not a Universal Macropad profile.');
  if (raw.version !== 1 && raw.version !== 2 && raw.version !== 3 && raw.version !== 4 && raw.version !== 5 && raw.version !== 6 && raw.version !== JSON_VERSION) throw new ImportError(`Profile file version ${String(raw.version)} is not supported.`);
  const variant: Variant = raw.variant === 'three-key' ? VARIANT_THREE_KEYS : raw.variant === 'six-key' ? VARIANT_SIX_KEYS : (() => { throw new ImportError('Unknown variant.'); })();
  const keys = keyCount(variant);
  if (!Array.isArray(raw.layers) || raw.layers.length < 1 || raw.layers.length > maxLayers(variant)) throw new ImportError(`Profile must have 1–${maxLayers(variant)} layers.`);
  const layers: Layer[] = raw.layers.map((l, li): Layer => {
    if (!isRecord(l)) throw new ImportError(`Layer ${li + 1} is malformed.`);
    if (!Array.isArray(l.keys) || l.keys.length !== keys) throw new ImportError(`Layer ${li + 1} must have ${keys} key bindings.`);
    if (!Array.isArray(l.leds) || l.leds.length !== keys) throw new ImportError(`Layer ${li + 1} must have ${keys} LED colors.`);
    const layer: Layer = {
      keys: l.keys.map((a, i) => action(a, `Layer ${li + 1} key ${i + 1}`)),
      encoderButton: action(l.encoderButton, `Layer ${li + 1} encoder button`),
      clockwise: action(l.clockwise, `Layer ${li + 1} clockwise`),
      counterclockwise: action(l.counterclockwise, `Layer ${li + 1} counterclockwise`),
      leds: l.leds.map((c, i) => led(c, `Layer ${li + 1} LED ${i + 1}`)),
      bootloaderFromRun: bool(l.bootloaderFromRun, 'bootloaderFromRun'),
      indicatorBehavior: l.indicatorBehavior === undefined ? 0 : int(l.indicatorBehavior, `Layer ${li + 1} indicatorBehavior`),
      indicatorColor: l.indicatorColor === undefined ? 0 : int(l.indicatorColor, `Layer ${li + 1} indicatorColor`),
      indicatorFullBrightness: bool(l.indicatorFullBrightness, `Layer ${li + 1} indicatorFullBrightness`),
    };
    if (l.invertScroll === true) (layer as Layer & { invertScroll?: boolean }).invertScroll = true;
    return layer;
  });
  const chords: Chord[] = (Array.isArray(raw.chords) ? raw.chords : []).map((c, i): Chord => {
    if (!isRecord(c) || !Array.isArray(c.keys) || c.keys.length !== 2) throw new ImportError(`Chord ${i + 1} is malformed.`);
    const a = int(c.keys[0], `Chord ${i + 1} key`);
    const b = int(c.keys[1], `Chord ${i + 1} key`);
    return { layer: int(c.layer, `Chord ${i + 1} layer`), keyA: Math.min(a, b), keyB: Math.max(a, b), global: bool(c.global, `Chord ${i + 1} global`), action: action(c.action, `Chord ${i + 1}`) };
  });
  const chordWindowMs = int(raw.chordWindowMs ?? 40, 'chordWindowMs');
  if (chordWindowMs % 5 !== 0 || chordWindowMs < 0 || chordWindowMs > 75) throw new ImportError('chordWindowMs must be 0–75 in steps of 5.');
  let rainbowPhase = DEFAULT_RAINBOW_PHASE;
  if (Number(raw.version) >= 5) {
    const degrees = int(raw.rainbowPhaseDegrees, 'rainbowPhaseDegrees');
    // Preserve the fourth preset in profiles exported before it became 150°.
    rainbowPhase = degrees === 120 ? 3
      : RAINBOW_PHASE_DEGREES.indexOf(degrees as typeof RAINBOW_PHASE_DEGREES[number]);
  }
  if (rainbowPhase < 0) throw new ImportError('rainbowPhaseDegrees must be 0, 30, 60 or 150 (legacy 120 is also accepted).');
  const rainbowSpeed = raw.rainbowSpeed === undefined ? DEFAULT_RAINBOW_SPEED
    : typeof raw.rainbowSpeed === 'string' ? RAINBOW_SPEED_LABELS.findIndex((label, i) =>
      label.toLowerCase() === raw.rainbowSpeed || LEGACY_RAINBOW_SPEED_NAMES[i] === raw.rainbowSpeed) : -1;
  if (rainbowSpeed < 0) throw new ImportError('rainbowSpeed must be extra fast, fast, slow or extra slow.');
  const profile: Profile = { rainbowSpeed, rainbowPhase, variant, transparentBlack: bool(raw.transparentBlack, 'transparentBlack'), startupLayer: int(raw.startupLayer ?? 0, 'startupLayer'), chordWindow: chordWindowMs / 5, layers, chords };
  if (raw.timedActions !== undefined) {
    if (raw.version !== JSON_VERSION || !Array.isArray(raw.timedActions)) throw new ImportError('Timed actions require a version 7 list.');
    profile.timedActions = raw.timedActions.map((timer, i) => {
      if (!isRecord(timer)) throw new ImportError(`Timed action ${i + 1} is malformed.`);
      if (typeof timer.resetOnInput !== 'boolean') throw new ImportError('Reset on input must be true or false.');
      return { ticks: int(timer.ticks, 'Timer interval'), resetOnInput: timer.resetOnInput,
        action: action(timer.action, `Timed action ${i + 1}`), resumeAction: action(timer.resumeAction, `Timed action ${i + 1} resume`) };
    });
  }
  migrateLegacyProfile(profile);
  if (Number(raw.version) < 6 && [...profile.layers.flatMap((l) => [...l.keys, l.encoderButton, l.clockwise, l.counterclockwise]), ...profile.chords.map((c) => c.action)].some((a) => a.type === 'ledControl')) throw new ImportError('LED actions require profile version 6.');
  const issues = validateProfile(profile);
  if (issues.length) throw new ImportError(issues.map((i) => `${i.where}: ${i.message}`).join('\n'));
  const meta: LocalMetadata = {};
  if (isRecord(raw.localMetadata)) {
    if (Array.isArray(raw.localMetadata.layerNames)) meta.layerNames = raw.localMetadata.layerNames.map((n) => (typeof n === 'string' ? n : ''));
    if (typeof raw.localMetadata.profileName === 'string') meta.profileName = raw.localMetadata.profileName;
  }
  return { profile, meta };
}
