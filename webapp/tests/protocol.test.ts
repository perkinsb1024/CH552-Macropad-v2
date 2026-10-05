import { describe, expect, it } from 'vitest';
import { SimulatedDevice } from '../src/protocol/simulator';
import { ConfigClient, ProtocolError, TimeoutError } from '../src/protocol/client';
import { buildRequest, parseReply, Opcode, Status } from '../src/protocol/packet';
import { encodeProfile } from '../src/codec/encode';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { VARIANT_SIX_KEYS, VARIANT_THREE_KEYS } from '../src/model/constants';
import { decodeImage } from '../src/codec/decode';

describe('packet framing', () => {
  it('builds a 31-byte request with UM signature', () => {
    const payload = buildRequest({ opcode: Opcode.ReadFlash, sequence: 7, offset: 23 });
    expect(payload.length).toBe(31);
    expect([...payload.subarray(0, 8)]).toEqual([0x55, 0x4d, 1, 3, 7, 23, 0, 0]);
  });
  it('parses replies and ignores foreign payloads', () => {
    expect(parseReply(new Uint8Array(31))).toBeNull();
    const reply = new Uint8Array(31);
    reply.set([0x55, 0x4d, 1, 2, 9, 0, 6, 0, 1, 0, 0, 0, 3, 9], 0);
    expect(parseReply(reply)).toMatchObject({ opcode: 2, sequence: 9, status: 0 });
    expect(parseReply(reply)!.data.length).toBe(6);
  });
});

describe('client against simulator', () => {
  it('probes support by canceling preview, including on blank flash', async () => {
    const device = new SimulatedDevice({ variant: VARIANT_SIX_KEYS, blankFlash: true });
    const client = new ConfigClient(device);
    await client.previewColor(15, true, true);
    expect(await client.detectPreviewSupport()).toBe(true);
    expect(device.previewOptions).toBe(0);
    expect((await client.getStatus()).flashValid).toBe(false);
  });
  it('recognizes firmware without preview without disrupting other commands', async () => {
    const device = new SimulatedDevice({ variant: VARIANT_SIX_KEYS, previewSupported: false });
    const client = new ConfigClient(device);
    expect(await client.detectPreviewSupport()).toBe(false);
    await expect(client.cancelPreview()).rejects.toMatchObject({ status: Status.BadOpcode });
    expect((await client.getInfo()).keyCount).toBe(6);
  });
  it('leaves support unknown after a timeout and sends only one probe', async () => {
    const device = new SimulatedDevice({ variant: VARIANT_SIX_KEYS });
    const client = new ConfigClient(device, { timeoutMs: 10, retries: 3 });
    let requests = 0;
    device.send = async () => { requests++; };
    expect(await client.detectPreviewSupport()).toBeNull();
    expect(requests).toBe(1);
  });
  it('does not mistake other protocol errors for lack of support', async () => {
    const device = new SimulatedDevice({ variant: VARIANT_SIX_KEYS });
    const client = new ConfigClient(device);
    const send = device.send.bind(device);
    device.send = (payload) => {
      const malformed = payload.slice();
      malformed[6] = 1; // BadRange: cancel requires zero length.
      return send(malformed);
    };
    expect(await client.detectPreviewSupport()).toBeNull();
  });
  it('previews without changing config, cancels on input, and supports blank flash', async () => {
    const device = new SimulatedDevice({ variant: VARIANT_SIX_KEYS, blankFlash: true });
    const client = new ConfigClient(device);
    const before = await client.readFlash();
    await client.previewColor(15, true, true);
    expect(device.previewOptions).toBe(0xfd);
    await client.getStatus();
    expect(device.previewOptions).toBe(0xfd);
    await client.previewColor(8, false);
    expect(device.previewOptions).toBe(0x84);
    device.triggerInput();
    expect(device.previewOptions).toBe(0);
    await client.previewColor(15);
    expect(device.previewOptions).toBe(0xf5);
    await client.cancelPreview();
    await client.cancelPreview();
    expect(device.previewOptions).toBe(0);
    expect(await client.readFlash()).toEqual(before);
    expect(await client.readActive()).toEqual(before);
    await expect(client.previewColor(16)).rejects.toThrow(RangeError);
    await expect(client.previewColor(-1)).rejects.toThrow(RangeError);
  });
  it('does not restart an input-canceled preview after a lost acknowledgment', async () => {
    const device = new SimulatedDevice({ variant: VARIANT_SIX_KEYS });
    const client = new ConfigClient(device, { timeoutMs: 10, retries: 3 });
    // Process the command but swallow the reply, then cancel with physical input.
    device.onReply = () => () => undefined;
    const send = device.send.bind(device);
    let requests = 0;
    device.send = async (payload) => {
      requests++;
      await send(payload);
      device.triggerInput();
    };
    await expect(client.previewColor(0)).rejects.toBeInstanceOf(TimeoutError);
    expect(requests).toBe(1);
    expect(device.previewOptions).toBe(0);
  });
  it('identifies the device and reads flash', async () => {
    const device = new SimulatedDevice({ variant: VARIANT_SIX_KEYS });
    const client = new ConfigClient(device);
    const info = await client.getInfo();
    expect(info).toMatchObject({ transportVersion: 1, formatVersion: 8, variant: 0, keyCount: 6, maxLayers: 5, imageSize: 128, actionMask: 0xffef });
    const status = await client.getStatus();
    expect(status.flashValid).toBe(true);
    const flash = await client.readFlash();
    expect(decodeImage(flash)).toMatchObject({ ok: true });
  });
  it('blank flash reports invalid with no active profile', async () => {
    const device = new SimulatedDevice({ variant: VARIANT_THREE_KEYS, blankFlash: true });
    const client = new ConfigClient(device);
    expect((await client.getStatus()).flashValid).toBe(false);
    expect(decodeImage(await client.readFlash())).toMatchObject({ ok: false, reason: 'no-magic' });
    expect(decodeImage(await client.readActive())).toMatchObject({ ok: false, reason: 'no-magic' });
  });
  it('saves, verifies and reads back the same image', async () => {
    const device = new SimulatedDevice({ variant: VARIANT_SIX_KEYS });
    const client = new ConfigClient(device);
    const profile = defaultProfile(VARIANT_SIX_KEYS);
    profile.layers.push(emptyLayer(VARIANT_SIX_KEYS));
    profile.layers[1]!.keys[0] = { type: 'string', text: 'saved' };
    profile.chords.push({ layer: 0, keyA: 0, keyB: 1, action: { type: 'setLayer', layer: 1 } });
    const image = encodeProfile(profile);
    const phases: string[] = [];
    await client.saveImage(image, (phase) => phases.push(phase));
    expect(phases).toContain('uploading');
    expect(phases).toContain('saving');
    expect(phases).toContain('verifying');
    expect([...device.flash]).toEqual([...image]);
    expect(decodeImage(await client.readFlash())).toMatchObject({ ok: true });
  });
  it('rejects cross-variant images', async () => {
    const device = new SimulatedDevice({ variant: VARIANT_THREE_KEYS });
    const client = new ConfigClient(device);
    const image = encodeProfile(defaultProfile(VARIANT_SIX_KEYS));
    await expect(client.saveImage(image)).rejects.toMatchObject({ status: Status.BadConfig });
  });
  it('reports flash verification failures', async () => {
    const device = new SimulatedDevice({ variant: VARIANT_SIX_KEYS, failNextCommit: true });
    const client = new ConfigClient(device);
    await expect(client.saveImage(encodeProfile(defaultProfile(VARIANT_SIX_KEYS)))).rejects.toBeInstanceOf(ProtocolError);
    expect((await client.getStatus()).flashValid).toBe(false);
  });
  it('times out and retries when the device is silent', async () => {
    const device = new SimulatedDevice({ variant: VARIANT_SIX_KEYS });
    let drops = 2;
    const original = device.send.bind(device);
    device.send = async (payload) => {
      if (drops-- > 0) return; // swallow the request
      return original(payload);
    };
    const client = new ConfigClient(device, { timeoutMs: 20, retries: 3 });
    const info = await client.getInfo();
    expect(info.keyCount).toBe(6);
  });
});
