import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRequest, checked, decodeStack, HidLink, parseReply, readImage } from './reader.mjs';

function reply(opcode, sequence, data = [], offset = 0, status = 0) {
  const bytes = new Uint8Array(31);
  bytes.set([0x55, 0x4d, 1, opcode, sequence, offset, data.length, status]);
  bytes.set(data, 8);
  return new DataView(bytes.buffer);
}

class Device {
  opened = true;
  listeners = new Set();
  sent = [];
  addEventListener(name, callback) { assert.equal(name, 'inputreport'); this.listeners.add(callback); }
  removeEventListener(name, callback) { this.listeners.delete(callback); }
  async sendReport(id, bytes) { this.sent.push({ id, bytes }); this.respond?.(bytes); }
  emit(data, reportId = 4) { for (const callback of this.listeners) callback({ data, reportId }); }
  async close() { this.opened = false; }
}

test('all possible usage values decode for both actual stack capacities', () => {
  for (const [variant, start] of [[0, 0xb3], [1, 0xb0]]) {
    for (let highest = start - 1; highest <= 255; highest++) {
      const result = decodeStack(Uint8Array.of(0x53, 0x57, 1, variant, start, highest), variant);
      assert.equal(result.used + result.free, result.capacity);
      assert.equal(result.used, highest - start + 1);
    }
  }
  for (const data of [[0xb3, 200], [0x53, 0x57, 2, 0, 0xb3, 200],
    [0x53, 0x57, 1, 1, 0xb3, 200], [0x53, 0x57, 1, 0, 0x7f, 200],
    [0x53, 0x57, 1, 0, 0xb3, 0xb1]]) {
    assert.throws(() => decodeStack(Uint8Array.from(data), 0));
  }
});

test('reader rejects every write/preview opcode and malformed read range', () => {
  for (let opcode = 0; opcode < 256; opcode++) {
    if ([1, 2, 3, 4, 0x70].includes(opcode)) continue;
    assert.throws(() => buildRequest(opcode, 0), /Only diagnostic reads/);
  }
  for (const args of [[3, 0, 127, 2], [4, 0, 0, 24], [3, 0, 0, 0], [2, 0, 1, 0],
    [0x70, 0, 0, 1], [3, 0, -1, 1], [3, 0, 1.5, 1]]) assert.throws(() => buildRequest(...args));
  assert.deepEqual(Array.from(buildRequest(0x70, 257).slice(0, 8)), [0x55, 0x4d, 1, 0x70, 1, 0, 0, 0]);
});

test('reply parsing respects DataView offset and rejects foreign packets', () => {
  const buffer = new Uint8Array(40);
  buffer.set(new Uint8Array(reply(0x70, 7, [1, 2]).buffer), 3);
  assert.deepEqual(Array.from(parseReply(new DataView(buffer.buffer, 3, 31)).data), [1, 2]);
  assert.equal(parseReply(new DataView(buffer.buffer)), null);
  buffer[3] = 0;
  assert.equal(parseReply(new DataView(buffer.buffer, 3, 31)), null);
});

test('only a matching reply resolves a read; concurrent requests are rejected and raw bytes retained', async () => {
  const device = new Device(), packets = [];
  const link = new HidLink(device, (packet) => packets.push(packet));
  const reading = link.request(0x70);
  await assert.rejects(link.request(2), /pending/);
  device.emit(reply(0x70, 0), 1);
  device.emit(reply(0x70, 1));
  device.emit(reply(2, 0));
  device.emit(reply(0x70, 0, [], 1));
  assert.ok(link.pending);
  device.emit(reply(0x70, 0, [0x53, 0x57, 1, 0, 0xb3, 200]));
  assert.equal((await reading).data.length, 6);
  assert.equal(packets.filter((packet) => packet.direction === 'request').length, 1);
  assert.equal(packets.filter((packet) => packet.direction === 'reply').length, 4);
  await link.close();
  assert.equal(device.listeners.size, 0);
});

test('unsupported diagnostic is reported without issuing a write', async () => {
  const device = new Device();
  device.respond = (packet) => device.emit(reply(packet[3], packet[4], [], 0, 2));
  const link = new HidLink(device);
  await assert.rejects(checked(link, 0x70), /Install the v12 stack-test firmware/);
  assert.deepEqual(device.sent.map((packet) => packet.bytes[3]), [0x70]);
  await link.close();
});

test('timeout blocks further requests until reconnection', async () => {
  const device = new Device(), link = new HidLink(device, () => {}, 10);
  await assert.rejects(link.request(0x70), /timeout/);
  await assert.rejects(link.request(2), /Reconnect/);
  assert.equal(device.sent.length, 1);
  await link.close();
});

test('disconnect rejects a pending read and prevents reuse', async () => {
  const link = new HidLink(new Device());
  const reading = link.request(2);
  const rejection = assert.rejects(reading, /disconnected/);
  await link.close();
  await rejection;
  await assert.rejects(link.request(2), /Reconnect/);
});

test('flash/active snapshots serialize bounded reads and preserve all 128 bytes', async () => {
  const device = new Device(), link = new HidLink(device);
  device.respond = (packet) => {
    const [opcode, sequence, offset, length] = packet.slice(3, 7);
    device.emit(reply(opcode, sequence, Array.from({ length }, (_, i) => offset + i), offset));
  };
  for (const opcode of [3, 4]) {
    assert.deepEqual(Array.from(await readImage(link, opcode)), Array.from({ length: 128 }, (_, i) => i));
  }
  assert.equal(device.sent.length, 12);
  assert.ok(device.sent.every(({ id, bytes }) => id === 3 && [3, 4].includes(bytes[3])));
  device.respond = (packet) => device.emit(reply(packet[3], packet[4], [], packet[5]));
  await assert.rejects(readImage(link, 3), /Short image/);
  await link.close();
});
