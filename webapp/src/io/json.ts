import type { Action, Chord, Layer, Profile } from '../model/types';
import { type Variant, VARIANT_SIX_KEYS, VARIANT_THREE_KEYS, keyCount } from '../model/constants';
import { validateProfile } from '../model/validate';
import { descriptor, ACTION_DESCRIPTORS } from '../model/actions';
import { PALETTE } from '../model/palette';
import { normalizeText } from '../model/strings';

export const JSON_FORMAT = 'universal-macropad-profile';
export const JSON_VERSION = 1;

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
  chordWindowMs: number;
  layers: Array<{
    keys: Action[];
    encoderButton: Action;
    clockwise: Action;
    counterclockwise: Action;
    leds: string[];
    invertScroll: boolean;
    bootloaderFromBoot: boolean;
    bootloaderFromRun: boolean;
  }>;
  chords: Array<{ layer: number; keys: [number, number]; action: Action }>;
  localMetadata?: LocalMetadata;
}

export function exportProfile(profile: Profile, meta?: LocalMetadata): string {
  const out: ExportedProfile = {
    format: JSON_FORMAT,
    version: JSON_VERSION,
    variant: profile.variant === VARIANT_THREE_KEYS ? 'three-key' : 'six-key',
    startupLayer: profile.startupLayer,
    chordWindowMs: profile.chordWindow * 5,
    layers: profile.layers.map((layer) => ({
      keys: layer.keys,
      encoderButton: layer.encoderButton,
      clockwise: layer.clockwise,
      counterclockwise: layer.counterclockwise,
      leds: layer.leds.map((i) => PALETTE[i]?.name ?? String(i)),
      invertScroll: layer.invertScroll,
      bootloaderFromBoot: layer.bootloaderFromBoot,
      bootloaderFromRun: layer.bootloaderFromRun,
    })),
    chords: profile.chords.map((c) => ({ layer: c.layer, keys: [c.keyA, c.keyB], action: c.action })),
  };
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
  if (!isRecord(v) || typeof v.type !== 'string' || !TYPES.has(v.type as Action['type'])) throw new ImportError(`${what}: unknown action.`);
  const type = v.type as Action['type'];
  descriptor(type);
  switch (type) {
    case 'none':
    case 'nextLayer':
      return { type };
    case 'keyTap':
    case 'keyHold':
      return { type, usage: int(v.usage ?? 0, `${what} usage`), modifiers: int(v.modifiers ?? 0, `${what} modifiers`) };
    case 'mouseClick':
    case 'mouseDouble':
    case 'mouseHold':
    case 'mouseToggle':
      return { type, buttons: int(v.buttons, `${what} buttons`) };
    case 'scroll':
    case 'mouseX':
    case 'mouseY':
      return { type, delta: int(v.delta, `${what} delta`) };
    case 'consumer':
      return { type, usage: int(v.usage, `${what} usage`) };
    case 'string':
      if (typeof v.text !== 'string') throw new ImportError(`${what}: text must be a string.`);
      return { type, text: normalizeText(v.text) };
    case 'setLayer':
    case 'momentaryLayer':
    case 'toggleLayer':
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
  if (raw.version !== JSON_VERSION) throw new ImportError(`Profile file version ${String(raw.version)} is not supported.`);
  const variant: Variant = raw.variant === 'three-key' ? VARIANT_THREE_KEYS : raw.variant === 'six-key' ? VARIANT_SIX_KEYS : (() => { throw new ImportError('Unknown variant.'); })();
  const keys = keyCount(variant);
  if (!Array.isArray(raw.layers) || raw.layers.length < 1 || raw.layers.length > 4) throw new ImportError('Profile must have 1–4 layers.');
  const layers: Layer[] = raw.layers.map((l, li): Layer => {
    if (!isRecord(l)) throw new ImportError(`Layer ${li + 1} is malformed.`);
    if (!Array.isArray(l.keys) || l.keys.length !== keys) throw new ImportError(`Layer ${li + 1} must have ${keys} key bindings.`);
    if (!Array.isArray(l.leds) || l.leds.length !== keys) throw new ImportError(`Layer ${li + 1} must have ${keys} LED colors.`);
    return {
      keys: l.keys.map((a, i) => action(a, `Layer ${li + 1} key ${i + 1}`)),
      encoderButton: action(l.encoderButton, `Layer ${li + 1} encoder button`),
      clockwise: action(l.clockwise, `Layer ${li + 1} clockwise`),
      counterclockwise: action(l.counterclockwise, `Layer ${li + 1} counterclockwise`),
      leds: l.leds.map((c, i) => led(c, `Layer ${li + 1} LED ${i + 1}`)),
      invertScroll: bool(l.invertScroll, 'invertScroll'),
      bootloaderFromBoot: bool(l.bootloaderFromBoot, 'bootloaderFromBoot'),
      bootloaderFromRun: bool(l.bootloaderFromRun, 'bootloaderFromRun'),
    };
  });
  const chords: Chord[] = (Array.isArray(raw.chords) ? raw.chords : []).map((c, i): Chord => {
    if (!isRecord(c) || !Array.isArray(c.keys) || c.keys.length !== 2) throw new ImportError(`Chord ${i + 1} is malformed.`);
    const a = int(c.keys[0], `Chord ${i + 1} key`);
    const b = int(c.keys[1], `Chord ${i + 1} key`);
    return { layer: int(c.layer, `Chord ${i + 1} layer`), keyA: Math.min(a, b), keyB: Math.max(a, b), action: action(c.action, `Chord ${i + 1}`) };
  });
  const chordWindowMs = int(raw.chordWindowMs ?? 40, 'chordWindowMs');
  if (chordWindowMs % 5 !== 0 || chordWindowMs < 0 || chordWindowMs > 75) throw new ImportError('chordWindowMs must be 0–75 in steps of 5.');
  const profile: Profile = { variant, startupLayer: int(raw.startupLayer ?? 0, 'startupLayer'), chordWindow: chordWindowMs / 5, layers, chords };
  const issues = validateProfile(profile);
  if (issues.length) throw new ImportError(issues.map((i) => `${i.where}: ${i.message}`).join('\n'));
  const meta: LocalMetadata = {};
  if (isRecord(raw.localMetadata)) {
    if (Array.isArray(raw.localMetadata.layerNames)) meta.layerNames = raw.localMetadata.layerNames.map((n) => (typeof n === 'string' ? n : ''));
    if (typeof raw.localMetadata.profileName === 'string') meta.profileName = raw.localMetadata.profileName;
  }
  return { profile, meta };
}
