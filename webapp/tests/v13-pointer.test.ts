import { legacyV12Codes } from './legacy-image';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createFirmwareValidator } from './firmware-validator.mjs';
import { defaultProfile } from '../src/model/defaults';
import { encodeAction, encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { sealImage } from '../src/codec/crc16';
import { exportProfile, importProfile } from '../src/io/json';
import { actionNeedsRelease, summarize } from '../src/model/actions';
import { actionProblem } from '../src/model/validate';
import type { Action } from '../src/model/types';

let validator: ReturnType<typeof createFirmwareValidator>;
beforeAll(() => { validator = createFirmwareValidator(); });
afterAll(() => validator.close());

it.each([0, 1] as const)('decodes every pointer flag and parameter on variant %s', variant => {
  const p = defaultProfile(variant); p.layers = [p.layers[0]!];
  const image = encodeProfile(p);
  for (const type of [6, 7]) for (let aux = 0; aux < 16; aux++) for (let param = 0; param < 256; param++) {
    image.set([type | aux << 4, param], 9); sealImage(image);
    const valid = type === 6 ? aux < 4 && param !== 128 : aux < 8;
    const decoded = decodeImage(image);
    expect(decoded.ok).toBe(valid);
    if (!decoded.ok) continue;
    const action = decoded.profile.layers[0]!.keys[0]!;
    if (type === 7) expect(encodeAction(action, new Map())).toEqual([type | aux << 4, param]);
    if (type === 6) expect(action).toEqual({ type: aux & 2 ? 'mouseY' : 'mouseX', delta: param > 127 ? param - 256 : param, ...(aux & 1 ? { hold: true } : {}) });
    else expect(action).toEqual({ type: 'mouseXY', x: ((param & 15) + 1) * 4 * (aux & 2 ? -1 : 1), y: ((param >> 4) + 1) * 4 * (aux & 4 ? -1 : 1), ...(aux & 1 ? { hold: true } : {}) });
  }
});

it.each([0, 1] as const)('matches firmware flags at all binding sites on variant %s', variant => {
  const p = defaultProfile(variant); p.layers = [p.layers[0]!];
  p.chords = [{ layer: 0, keyA: 0, keyB: 1, action: { type: 'none' } }];
  p.timedActions = [{ ticks: 1, resetOnInput: false, consumeInput: false, action: { type: 'none' }, resumeAction: { type: 'none' } }];
  p.macros = [{ actions: [{ type: 'mouseXY', x: 4, y: 4 }] }];
  const end = variant ? 24 : 31;
  const sites = [[9, false], [variant ? 15 : 21, false], [variant ? 17 : 23, true], [variant ? 19 : 25, true], [end + 1, false], [end + 4, true], [end + 6, true], [end + 9, true]] as const;
  const original = encodeProfile(p);
  for (const [offset, autonomous] of sites) for (const type of [6, 7]) for (let aux = 0; aux < 16; aux++) for (const param of [0, 128, 255]) {
    const image = original.slice(); image.set([type | aux << 4, param], offset); sealImage(image);
    const valid = (type === 6 ? aux < 4 && param !== 128 : aux < 8) && !(autonomous && (aux & 1));
    expect(decodeImage(image).ok).toBe(valid);
    expect(validator.accepts(image, variant)).toBe(valid);
  }
});

it('encodes exact bytes, preserves JSON, and rejects unrepresentable combined steps', () => {
  expect(encodeAction({ type: 'mouseY', delta: -127, hold: true }, new Map())).toEqual([0x36, 0x81]);
  expect(encodeAction({ type: 'mouseXY', x: -8, y: 64 }, new Map())).toEqual([0x27, 0xf1]);
  expect(encodeAction({ type: 'mouseXY', x: 64, y: -8, hold: true }, new Map())).toEqual([0x57, 0x1f]);
  const p = defaultProfile(0); p.layers[0]!.keys[0] = { type: 'mouseXY', x: -64, y: 4, hold: true };
  expect(importProfile(exportProfile(p)).profile).toEqual(p);
  expect(decodeImage(encodeProfile(p))).toEqual({ ok: true, profile: p });
  expect(summarize(p.layers[0]!.keys[0]!)).toBe('Mouse X -64, Y 4 (Hold)');
  for (const x of [-68, 68, 0, 1, 2, 3, 5, 4.5, NaN, Infinity]) {
    p.layers[0]!.keys[0] = { type: 'mouseXY', x, y: 4 };
    expect(() => encodeProfile(p)).toThrow('steps of 4');
  }
  const hold: Action = { type: 'mouseXY', x: 4, y: -4, hold: true };
  expect(actionNeedsRelease(hold)).toBe(true);
  for (const ctx of [{ rotation: true }, { rotation: false, timed: true }, { rotation: false, macro: true }]) {
    expect(actionProblem(hold, { layerCount: 1, ...ctx })).toContain('release');
    expect(actionProblem({ ...hold, hold: undefined }, { layerCount: 1, ...ctx })).toBeNull();
  }
});

it.each([11, 12])('imports historical single-axis bytes from format %s', version => {
  for (const axis of [0, 1]) for (const hold of [0, 1]) {
    const p = defaultProfile(0); const image = encodeProfile(p);
    legacyV12Codes(image); image[2] = version; image.set([12 + axis | hold << 4, 0x81], 9); sealImage(image);
    const decoded = decodeImage(image);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error(decoded.detail);
    expect(decoded.profile.layers[0]!.keys[0]).toEqual({ type: axis ? 'mouseY' : 'mouseX', delta: -127, ...(hold ? { hold: true } : {}) });
    expect([...encodeProfile(decoded.profile).slice(9, 11)]).toEqual([6 | axis << 5 | hold << 4, 0x81]);
  }
});
