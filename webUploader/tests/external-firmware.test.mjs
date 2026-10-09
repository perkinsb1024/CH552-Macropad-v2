import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { localFirmware, installationAllowed } from '../src/local-firmware.mjs';
import { parseHex } from '../src/hex.mjs';
import { configuratorPath } from '../src/firmware-format.mjs';
import { previousReleases, selectedFirmware } from '../src/firmware-list.mjs';

function record(address, type, data) {
  const bytes = [data.length, address >> 8, address & 255, type, ...data];
  bytes.push((-bytes.reduce((a, b) => a + b, 0)) & 255);
  return ':' + bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}
const hex = data => `${record(0, 0, data)}\n${record(0, 1, [])}`;
const unknown = { name: 'custom.hex', size: 40, text: async () => hex([1, 2, 3]) };
const recognized = { ...unknown, name: 'macropad.hex', text: async () => hex([0x55, 0x4d, 0x41, 0x43, 1, 12, 1]) };

test('custom uploads require installation confirmation and unknown firmware acknowledgment', () => {
  const state = { local: true, firmware: new Uint8Array(8), identified: false, variantConfirmed: true, unknownConfirmed: true };
  assert.equal(installationAllowed(state), true);
  for (const override of [{ variantConfirmed: false }, { unknownConfirmed: false }, { firmware: null }]) assert.equal(installationAllowed({ ...state, ...override }), false);
  assert.equal(installationAllowed({ ...state, identified: true, unknownConfirmed: false }), true);
});

test('local HEX keeps identity, variant and address checks', () => {
  assert.equal(localFirmware('custom.hex', hex([1]), 3).identified, false);
  assert.equal(localFirmware('pad.hex', hex([0x55, 0x4d, 0x41, 0x43, 1, 12, 1]), 3).identified, true);
  assert.throws(() => localFirmware('pad.hex', hex([0x55, 0x4d, 0x41, 0x43, 1, 12, 1]), 6), /3-key/);
  assert.equal(localFirmware('pad.hex', hex([0x55, 0x4d, 0x41, 0x43, 1, 12, 1])).entry.keys, 3);
  assert.throws(() => localFirmware('pad.hex', hex([0x55, 0x4d, 0x41, 0x43, 1, 12, 1, 0x55, 0x4d, 0x41, 0x43, 1, 12, 1]), 3), /Ambiguous/);
  assert.throws(() => localFirmware('pad.bin', hex([1]), 3), /\.hex/);
  assert.throws(() => localFirmware('pad.hex', `${record(0, 0, [1])}\n${record(0x3800, 0, [1])}\n${record(0, 1, [])}`, 3), /application area/);
});

// Exercise the real page handlers with browser/USB boundaries replaced.
async function page({ manifestFails = false, hidFails = false } = {}) {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: false, disabled: false, checked: false, value: '', textContent: '', dataset: {},
      classList: { add() {}, remove() {} }, events: {},
      setAttribute() {}, replaceChildren() {}, append() {}, focus() {},
      addEventListener(name, handler) { this.events[name] = handler; },
    });
    return nodes.get(id);
  }
  const variants = [3, 6].map(keys => { const button = node(`variant-${keys}`); button.dataset.variant = String(keys); return button; });
  const tabs = ['latest', 'previous', 'custom'].map(source => { const tab = node(`tab-${source}`); tab.dataset.source = source; return tab; });
  let flashes = 0, hidEntries = 0, session;
  class Bootloader {
    ready = true;
    constructor() { session = this; }
    async flash() { flashes++; }
  }
  const published = new TextEncoder().encode(hex([1, 2, 3]));
  const sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', published)).toString('hex');
  const manifest = { currentFormatVersion: 12, firmware: [3, 6].map(keys => ({ keys, name: `pad-${keys}.hex`, bytes: 8, formatVersion: 12, sha256 })), previousFirmware: [] };
  const source = await readFile(new URL('../src/app.mjs', import.meta.url), 'utf8');
  await runInNewContext(`(async () => {\n${source.replace(/^import .*;\n/gm, '')}\n})()`, {
    Ch552Bootloader: Bootloader, localFirmware, installationAllowed,
    parseHex, configuratorPath, previousReleases, selectedFirmware, URLSearchParams, TextDecoder,
    crypto: webcrypto, enterBootloader: async () => { hidEntries++; if (hidFails) throw new Error('Unsupported HID command'); },
    document: { getElementById: node, querySelectorAll: selector => selector === '[data-source]' ? tabs : variants, createElement: () => node('created') },
    window: { isSecureContext: true, location: { search: '' }, addEventListener() {} },
    navigator: { platform: 'Mac', hid: {}, usb: { addEventListener() {} } },
    fetch: async url => { if (manifestFails) throw new Error('Published firmware unavailable'); return url === './firmware.json' ? { ok: true, json: async () => manifest } : { ok: true, arrayBuffer: async () => published.buffer }; },
  });
  return { node, variants, session, flashes: () => flashes, hidEntries: () => hidEntries,
    drop: file => node('hex-drop').events.drop({ preventDefault() {}, dataTransfer: { files: [file] } }) };
}

test('custom firmware works without a query parameter and HID success points to connection', async () => {
  const p = await page();
  assert.equal(p.node('panel-custom').hidden, true);
  await p.node('tab-custom').events.click();
  assert.equal(p.node('panel-custom').hidden, false);
  assert.equal(p.node('board-selection').hidden, true);
  assert.equal(p.node('hex-file').disabled, false);
  await p.drop(unknown);
  assert.match(p.node('firmware-info').textContent, /custom.hex/);
  p.session.ready = false;
  await p.node('enter-bootloader').events.click();
  assert.equal(p.hidEntries(), 1);
  assert.equal(p.node('entry-status').dataset.state, 'success');
  assert.match(p.node('connection-status').textContent, /Next: select Connect Bootloader now/);
});

test('unrecognized confirmation blocks both button and handler, resets on every selection', async () => {
  const p = await page();
  await p.node('tab-custom').events.click();
  await p.drop(unknown);
  assert.equal(p.node('unrecognized-warning').hidden, false);
  p.node('confirm-variant').checked = true;
  p.node('confirm-variant').events.change();
  assert.equal(p.node('install').disabled, true);
  await p.node('install').events.click();
  assert.equal(p.flashes(), 0);
  p.node('confirm-unrecognized').checked = true;
  p.node('confirm-unrecognized').events.change();
  assert.equal(p.node('install').disabled, false);
  await p.node('install').events.click();
  assert.equal(p.flashes(), 1);
  await p.drop(unknown);
  assert.equal(p.node('confirm-unrecognized').checked, false);
  assert.equal(p.node('confirm-variant').checked, false);
  await p.drop(recognized);
  assert.equal(p.node('unrecognized-warning').hidden, true);
  p.node('confirm-variant').checked = true;
  p.node('confirm-variant').events.change();
  assert.equal(p.node('install').disabled, false);
  await p.node('tab-latest').events.click();
  await p.variants[1].events.click();
  assert.match(p.node('firmware-info').textContent, /pad-6/);
  assert.equal(p.node('install').disabled, true);
  await p.node('tab-custom').events.click();
  assert.match(p.node('firmware-info').textContent, /3-key/);
  assert.equal(p.node('board-selection').hidden, true);
  await p.drop({ ...unknown, text: async () => 'bad HEX' });
  assert.equal(p.node('install').disabled, true);
  assert.equal(p.node('status').dataset.state, 'error');
});

test('custom files remain usable when the published manifest fails', async () => {
  const p = await page({ manifestFails: true });
  await p.node('tab-custom').events.click();
  await p.drop(recognized);
  p.node('confirm-variant').checked = true;
  p.node('confirm-variant').events.change();
  assert.equal(p.node('install').disabled, false);
  await p.node('install').events.click();
  assert.equal(p.flashes(), 1);
});

test('failed HID entry is shown separately from USB connection', async () => {
  const p = await page({ hidFails: true });
  p.session.ready = false;
  await p.node('enter-bootloader').events.click();
  assert.equal(p.node('entry-status').dataset.state, 'error');
  assert.match(p.node('entry-status').textContent, /Unsupported HID command/);
  assert.equal(p.node('connect').disabled, false);
});

test('unrecognized warning uses the agreed text', async () => {
  const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('I understand that this is not recognized CH552 Macropad firmware and installing it may cause unexpected behavior and/or prevent me from entering bootloader mode'));
});
