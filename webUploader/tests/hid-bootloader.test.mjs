import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enterBootloader } from '../src/hid-bootloader.mjs';

function fakeHid(mode = 'success') {
  const listeners = new Set(), commands = [];
  const device = {
    opened: false, closes: 0,
    async open() { this.opened = true; },
    async close() { this.opened = false; this.closes++; },
    addEventListener(name, listener) { assert.equal(name, 'inputreport'); listeners.add(listener); },
    removeEventListener(name, listener) { listeners.delete(listener); },
    async sendReport(id, payload) {
      assert.equal(id, 3);
      assert.equal(payload.length, 31);
      assert.deepEqual([...payload.slice(0, 3)], [0x55, 0x4d, 1]);
      assert.ok(payload.slice(5).every(b => b === 0));
      commands.push(payload[3]);
      if (mode === 'send-failure') throw new Error('Send failed');
      if (mode === 'timeout') return;
      const bytes = new Uint8Array(31);
      bytes.set(payload.slice(0, 5));
      if (payload[3] === 1) {
        bytes[6] = 14;
        bytes.set([0x55, 0x4d, 0x41, 0x43, 1, 12, 0, 6, 6, 5, 128, 3, 255, 255], 8);
        if (mode === 'identity') bytes[8] = 0;
      } else {
        if (mode === 'unsupported') bytes[7] = 2;
        if (mode === 'rejected') bytes[7] = 4;
        if (mode === 'payload') bytes[6] = 1;
        if (mode === 'length') bytes[6] = 24;
      }
      // Unrelated reports and stale sequence numbers cannot satisfy the request.
      for (const listener of listeners) {
        listener({ reportId: 1, data: new DataView(bytes.buffer) });
        const stale = bytes.slice(); stale[4]++;
        listener({ reportId: 4, data: new DataView(stale.buffer) });
        listener({ reportId: 4, data: new DataView(bytes.buffer) });
      }
    },
  };
  return { device, commands, listeners, async requestDevice({ filters }) {
    assert.deepEqual(filters, [{ vendorId: 0x1209, productId: 0xc55d, usagePage: 0xff00, usage: 1 }]);
    return mode === 'cancel' ? [] : [device];
  } };
}

test('identifies normal firmware and acknowledges opcode 0x0A', async () => {
  const hid = fakeHid();
  await enterBootloader(hid);
  assert.deepEqual(hid.commands, [1, 10]);
  assert.equal(hid.device.closes, 1);
  assert.equal(hid.listeners.size, 0);
});

for (const [mode, message] of [
  ['unsupported', /does not support/], ['identity', /Unrecognized/],
  ['timeout', /No HID acknowledgement/], ['send-failure', /Send failed/],
  ['rejected', /status 4/], ['payload', /Unexpected/], ['length', /Invalid/],
  ['cancel', /No macropad/],
]) test(`handles ${mode} and releases the HID device`, async () => {
  const hid = fakeHid(mode);
  await assert.rejects(enterBootloader(hid, 10), message);
  assert.equal(hid.listeners.size, 0);
  assert.equal(hid.device.opened, false);
  if (mode === 'identity') assert.deepEqual(hid.commands, [1]);
});
