import { ledCommandCode, ledProblem } from '../model/ledControl';
import {
  TIMED_ENTRY_SIZE, HEADER_RAINBOW_SPEED_SHIFT, HEADER_RAINBOW_PHASE_SHIFT, ActionCode, CHORD_ENTRY_SIZE, FORMAT_VERSION, HEADER_SIZE, IMAGE_SIZE,
  LAYER_OPT_BOOTLOADER_RUN, LAYER_OPT_INDICATOR_SHIFT,
  LAYER_OPT_COLOR_SHIFT, LAYER_OPT_FULL_BRIGHTNESS, keyCount, layerSize,
} from '../model/constants';
import type { Action, Profile } from '../model/types';
import { descriptor } from '../model/actions';
import { sortedChords, stringPool } from '../model/capacity';
import { chordId } from '../model/pairs';
import { validateProfile } from '../model/validate';
import { sealImage } from './crc16';

export class EncodeError extends Error {}

/** Encodes one two-byte action record. */
export function encodeAction(action: Action, stringOffsets: Map<string, number>, macroOffsets: number[] = []): [number, number] {
  const code = descriptor(action.type).code;
  switch (action.type) {
    case 'macro': {
      const offset = macroOffsets[action.macro];
      if (offset === undefined) throw new EncodeError('Macro not present in layout.');
      return [ActionCode.Macro | ((action.repeats - 1) << 4), offset];
    }
    case 'pause': return [ActionCode.Pause, action.ticks];
    case 'ledControl': {
      const problem = ledProblem(action.command, action.value, action.brightness);
      if (problem) throw new EncodeError(problem);
      return [code | ((action.value === 'asConfigured' ? 15 : action.value & 15) << 4), ledCommandCode(action.command, action.brightness)];
    }
    case 'none':
      return [code, 0];
    case 'relativeLayer':
      return [code, action.offset & 0xff];
    case 'oneShotRelativeLayer':
      return [code | 0x10, action.offset & 0xff];
    case 'keyTap':
    case 'keyHold':
      return [code | ((action.modifiers & 15) << 4), action.usage & 0xff];
    case 'mouseClick':
      return [code | (((action.clicks ?? 1) - 1) << 4), action.buttons & 255];
    case 'mouseHold':
    case 'mouseDown':
    case 'mouseUp':
    case 'mouseToggle':
      return [code, action.buttons & 255];
    case 'scroll':
      return [code | (action.hold ? 0x40 : 0) | (action.horizontal ? 0x80 : 0), action.delta & 0xff];
    case 'mouseX':
    case 'mouseY':
      return [code | (action.hold ? 0x10 : 0), action.delta & 0xff];
    case 'consumer':
    case 'consumerHold':
      return [code | (((action.usage >> 8) & 15) << 4), action.usage & 0xff];
    case 'string': {
      const offset = stringOffsets.get(action.text);
      if (offset === undefined) throw new EncodeError('String not present in pool.');
      return [ActionCode.String, offset];
    }
    case 'setLayer':
    case 'momentaryLayer':
      return [code, action.layer & 0xff];
    case 'oneShotSetLayer':
      return [code | 0x10, action.layer & 0xff];
  }
}

/** Produces the canonical 128-byte image. Throws EncodeError when the profile is invalid. */
export function encodeProfile(profile: Profile): Uint8Array {
  const issues = validateProfile(profile);
  if (issues.length) throw new EncodeError(issues.map((i) => `${i.where}: ${i.message}`).join('\n'));

  const keys = keyCount(profile.variant);
  const size = layerSize(profile.variant);
  const image = new Uint8Array(IMAGE_SIZE);

  const pool = stringPool(profile);
  const offsets = new Map<string, number>();
  let poolLength = 0;
  for (const text of pool) {
    offsets.set(text, poolLength);
    poolLength += text.length + 1;
  }

  const chords = sortedChords(profile);
  let macroEnd = HEADER_SIZE + size * profile.layers.length + CHORD_ENTRY_SIZE * chords.length + TIMED_ENTRY_SIZE * (profile.timedActions?.length ?? 0) + poolLength;
  const macroOffsets = (profile.macros ?? []).map(macro => {
    const start = macroEnd;
    macroEnd += 2 * macro.actions.length + 1;
    return start;
  });
  image[0] = 0x4d; // M
  image[1] = 0x50; // P
  image[2] = FORMAT_VERSION;
  const timers = profile.timedActions ?? [];
  image[3] = (profile.layers.length - 1) | (profile.startupLayer << 3) | ((timers.length & 3) << 6);
  image[4] = poolLength | ((timers.length >> 2) << 7);
  image[5] = profile.variant | (chords.length << 1) | (profile.transparentBlack ? 0x80 : 0);
  image[8] = (profile.chordWindow & 15) |
    (profile.rainbowPhase << HEADER_RAINBOW_PHASE_SHIFT) |
    (profile.rainbowSpeed << HEADER_RAINBOW_SPEED_SHIFT);

  profile.layers.forEach((layer, li) => {
    const base = HEADER_SIZE + size * li;
    const records = [...layer.keys, layer.encoderButton, layer.clockwise, layer.counterclockwise];
    records.forEach((action, i) => {
      const [b0, b1] = encodeAction(action, offsets, macroOffsets);
      image[base + 2 * i] = b0;
      image[base + 2 * i + 1] = b1;
    });
    const ledBase = base + 2 * (keys + 3);
    layer.leds.forEach((led, i) => {
      image[ledBase + (i >> 1)]! |= i & 1 ? (led & 15) << 4 : led & 15;
    });
    image[base + size - 1] =
      (layer.indicatorFullBrightness ? LAYER_OPT_FULL_BRIGHTNESS : 0) |
      (layer.bootloaderFromRun ? LAYER_OPT_BOOTLOADER_RUN : 0) |
      ((layer.indicatorBehavior & 3) << LAYER_OPT_INDICATOR_SHIFT) |
      ((layer.indicatorColor & 15) << LAYER_OPT_COLOR_SHIFT);
  });

  let offset = HEADER_SIZE + size * profile.layers.length;
  for (const chord of chords) {
    image[offset] = chordId(chord.layer, chord.keyA, chord.keyB, keys, chord.global);
    const [b0, b1] = encodeAction(chord.action, offsets, macroOffsets);
    image[offset + 1] = b0;
    image[offset + 2] = b1;
    offset += CHORD_ENTRY_SIZE;
  }

  for (const timer of timers) {
    image[offset] = (timer.ticks - 1) & 255;
    image.set(encodeAction(timer.action, offsets, macroOffsets), offset + 1);
    image.set(encodeAction(timer.resumeAction, offsets, macroOffsets), offset + 3);
    image[offset + 5] = ((timer.ticks - 1) >> 8) << 3 | (timer.layer === undefined ? 0 : timer.layer + 1)
      | (timer.consumeInput ? 64 : 0) | (timer.resetOnInput ? 128 : 0);
    offset += TIMED_ENTRY_SIZE;
  }

  for (const text of pool) {
    for (let i = 0; i < text.length; i++) image[offset++] = text.charCodeAt(i);
    image[offset++] = 0;
  }

  for (const macro of profile.macros ?? []) {
    for (const action of macro.actions) {
      image.set(encodeAction(action, offsets, macroOffsets), offset);
      offset += 2;
    }
    if (offset < IMAGE_SIZE) image[offset++] = 0;
  }

  sealImage(image);
  return image;
}
