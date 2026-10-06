import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildRequest, parseReply, decodeStack, crc16, HidLink } from './reader.mjs';

test('stack bounds: untouched, partial, last byte, and malformed replies', () => {
  for (const start of [0xb2, 0xb5]) {
    assert.deepEqual(decodeStack(Uint8Array.of(start, start - 1)), { start, highest: start - 1, capacity: 256 - start, used: 0, free: 256 - start });
    assert.equal(decodeStack(Uint8Array.of(start, start + 39)).used, 40);
    assert.equal(decodeStack(Uint8Array.of(start, 255)).free, 0);
  }
  for (const invalid of [[0, 0x88, 0xa0], [0xb5], [0xb5, 0xb3], [0x70, 0xa0]]) {
    assert.throws(() => decodeStack(Uint8Array.from(invalid)));
  }
});

test('requests match HID v1 and reply parser respects DataView offsets', () => {
  assert.deepEqual([...buildRequest(10, 257)], [85, 77, 1, 10, 1, 0, 0, 0, ...Array(23).fill(0)]);
  const buffer = new Uint8Array(40);
  buffer.set([85, 77, 1, 10, 1, 0, 3, 0, 0xa5, 0x88, 0xa0], 5);
  assert.deepEqual(parseReply(new DataView(buffer.buffer, 5, 31)), { opcode: 10, sequence: 1, offset: 0, status: 0, data: Uint8Array.of(0xa5, 0x88, 0xa0) });
  assert.equal(parseReply(new DataView(buffer.buffer)), null);
  buffer[7] = 2;
  assert.equal(parseReply(new DataView(buffer.buffer, 5, 31)), null);
});

test('profile images carry the checksum used by firmware; invalid configuration is correctly resealed', async () => {
  for (const keys of [6, 3]) {
    const image = new Uint8Array(await readFile(new URL(`${keys}-key-sanity-profile.bin`, import.meta.url)));
    assert.equal(image.length, 128);
    assert.equal(crc16(image), image[6] | image[7] << 8);
    const crc = crc16(image);
    image[6] ^= 1;
    assert.equal(crc16(image), crc); // Stored checksum bytes are excluded.
    image[0] = 0;
    assert.notEqual(crc16(image), crc);
  }
});

class Device extends EventTarget {
  opened = true;
  sent = [];
  async open() { this.opened = true; }
  async sendReport(id, data) { this.sent.push({ id, data }); }
  async close() { this.opened = false; }
  reply(opcode, sequence, offset = 0, reportId = 4) {
    const bytes = buildRequest(opcode, sequence, offset, 2, [0xb5, 0xcd]);
    const event = new Event('inputreport');
    event.reportId = reportId; event.data = new DataView(bytes.buffer);
    this.dispatchEvent(event);
  }
}

test('HID transport ignores foreign/stale packets and permits one outstanding request', async () => {
  const device = new Device(), link = new HidLink(device);
  const pending = link.request(10);
  await assert.rejects(link.request(2), /pending/);
  assert.equal(device.sent[0].id, 3);
  device.reply(10, 0, 0, 1); assert.ok(link.pending);
  device.reply(10, 1); assert.ok(link.pending);
  device.reply(2, 0); assert.ok(link.pending);
  device.reply(10, 0, 1); assert.ok(link.pending);
  device.reply(10, 0);
  assert.equal(decodeStack((await pending).data).used, 25);
  const cancelled = link.request(2);
  const rejected = assert.rejects(cancelled, /disconnected/);
  await link.close(); await rejected;
  assert.equal(device.opened, false);
});

test('failed sends release the pending request', async () => {
  const device = new Device();
  device.sendReport = async () => { throw new Error('send failed'); };
  const link = new HidLink(device);
  await assert.rejects(link.request(10), /send failed/);
  assert.equal(link.pending, null);
  await link.close();
});

for (const keys of [6, 3]) test(`${keys}-key reader saves/verifies the sanity profile, rejects bad uploads and stresses USB`, async () => {
  const image = new Uint8Array(await readFile(new URL(`${keys}-key-sanity-profile.bin`, import.meta.url)));
  const variant = keys === 3 ? 1 : 0;
  const start = variant ? 0xb2 : 0xb5;
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', disabled: false, checked: false, className: '', focus() { globalThis.document.activeElement = this; } });
    return elements.get(id);
  };
  element('label').value = 'simulation';
  class Firmware extends Device {
    flash = image.slice();
    staged = null; expectedCrc = 0; upload = 0; commits = 0; onSend = null;
    async sendReport(id, packet) {
      assert.equal(id, 3); assert.equal(packet.length, 31);
      const request = parseReply(new DataView(packet.buffer));
      let data = [], status = 0;
      switch (request.opcode) {
        case 1: data = [85, 77, 65, 67, 1, 10, variant, keys, keys, variant ? 7 : 5, 128, 3, 255, 255]; break;
        case 2: data = [1, 0, 0, this.upload, 3, 9, start, start + 36]; break;
        case 3: case 4: data = this.flash.slice(request.offset, request.offset + request.data.length); break;
        case 5:
          this.staged = new Uint8Array(128); this.upload = 1;
          this.expectedCrc = request.data[1] | request.data[2] << 8; break;
        case 6: this.staged.set(request.data, request.offset); break;
        case 7:
          if (this.upload === 2) break;
          if (crc16(this.staged) !== this.expectedCrc) status = 7;
          else if (this.staged[0] !== 0x4d) status = 6;
          else { this.flash = this.staged.slice(); this.upload = 2; this.commits++; }
          break;
        case 8: this.upload = 0; break;
        case 9: break;
        default: throw new Error(`Unexpected opcode ${request.opcode}`);
      }
      const bytes = buildRequest(request.opcode, request.sequence, request.offset, data.length, data);
      bytes[7] = status;
      const event = new Event('inputreport'); event.reportId = 4; event.data = new DataView(bytes.buffer);
      queueMicrotask(() => this.dispatchEvent(event));
      this.onSend?.(request);
    }
  }
  const device = new Firmware();
  const hid = new EventTarget(); hid.requestDevice = async () => [device];
  const oldDocument = globalThis.document, oldFetch = globalThis.fetch;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let wheelHandler;
  globalThis.document = { getElementById: element, addEventListener(type, handler, options) {
    assert.equal(type, 'wheel'); assert.equal(options.passive, false); wheelHandler = handler;
  } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { hid } });
  globalThis.fetch = async (name) => {
    assert.equal(name, `${keys}-key-sanity-profile.bin`);
    return { ok: true, arrayBuffer: async () => image.slice().buffer };
  };
  try {
    await import(`./reader.mjs?workflow-test-${keys}`);
    await element('connect').onclick();
    assert.equal(element('used').textContent, '37 B');
    assert.equal(element('free').textContent, `${219 - start} B`);
    assert.equal(element('save').disabled, false);
    assert.equal(globalThis.document.activeElement, element('sink'));
    let prevented = false;
    wheelHandler({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    globalThis.document.activeElement = element('label');
    prevented = false;
    wheelHandler({ preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
    element('sink').focus();
    element('traceKeys').checked = true;
    const enter = { type: 'keydown', key: 'Enter', code: 'Enter', timeStamp: 123,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false };
    element('sink').onkeydown(enter);
    assert.match(element('log').value, /\[keyboard\] keydown Enter key="Enter" shift=false ctrl=false alt=false meta=false/);
    element('sink').onkeyup({ ...enter, type: 'keyup', timeStamp: 131 });
    assert.match(element('log').value, /\[keyboard\] keyup Enter/);
    element('traceKeys').checked = false;
    const logBefore = element('log').value;
    element('sink').onkeydown({ ...enter, shiftKey: true });
    assert.equal(element('log').value, logBefore);
    await element('save').onclick();
    assert.deepEqual(device.flash, image);
    assert.equal(element('message').textContent, '');
    assert.equal(device.commits, 1); // Retry COMMIT did not rewrite.
    const before = device.flash.slice();
    await element('invalid').onclick();
    assert.deepEqual(device.flash, before);
    assert.match(element('log').value, /BAD_CRC and BAD_CONFIG returned/);
    element('preview').checked = true;
    const traffic = [];
    device.onSend = (request) => {
      traffic.push(request.opcode);
      if (request.opcode === 2) element('stop').onclick();
    };
    await element('stress').onclick();
    assert.equal(traffic.filter((opcode) => opcode === 3).length, 6);
    assert.equal(traffic.filter((opcode) => opcode === 4).length, 6);
    assert.equal(traffic.filter((opcode) => opcode === 9).length, 2); // Preview and cancel.
    assert.equal(element('message').textContent, '');
    await element('disconnect').onclick();
    assert.equal(element('sample').disabled, true);
    // A normal v10 device has only six status bytes; reject it rather than
    // presenting an invented watermark or allowing a profile save.
    const diagnosticSend = device.sendReport.bind(device);
    device.sendReport = async (id, packet) => {
      if (packet[3] !== 2) return diagnosticSend(id, packet);
      const bytes = buildRequest(2, packet[4], 0, 6, [1,0,0,0,0,0]);
      const event = new Event('inputreport'); event.reportId = 4; event.data = new DataView(bytes.buffer);
      queueMicrotask(() => device.dispatchEvent(event));
    };
    await element('connect').onclick();
    assert.match(element('message').textContent, /v10 stack diagnostic/);
    assert.equal(element('save').disabled, true);
  } finally {
    globalThis.document = oldDocument; globalThis.fetch = oldFetch;
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else delete globalThis.navigator;
  }
});
