import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { firmwareChoices, previousReleases, selectedFirmware } from '../src/firmware-list.mjs';
import { Ch552Bootloader } from '../dist/bootloader.mjs';
import { parseHex, CODE_LIMIT } from '../src/hex.mjs';
import { firmwareFormat, configuratorPath } from '../src/firmware-format.mjs';

const manifest = JSON.parse(await readFile(new URL('../dist/firmware.json', import.meta.url), 'utf8'));
const constants = await readFile(new URL('../../webapp/src/model/constants.ts', import.meta.url), 'utf8');
const currentFormatVersion = Number(/FORMAT_VERSION\s*=\s*(\d+)/.exec(constants)?.[1]);

function expectedConfiguratorPath(format) {
  return format === currentFormatVersion ? '../' : `../versions/format-v${format}/`;
}

test('published firmware opens its matching configurator', async () => {
  assert.ok(Number.isInteger(currentFormatVersion) && currentFormatVersion >= 2);
  assert.equal(manifest.currentFormatVersion, currentFormatVersion);
  for (const entry of manifest.firmware) {
    const content = await readFile(new URL(`../dist/firmware/${entry.name}`, import.meta.url), 'utf8');
    assert.equal(firmwareFormat(parseHex(content), entry.keys), entry.formatVersion);
    assert.equal(configuratorPath(entry.formatVersion, manifest.currentFormatVersion), expectedConfiguratorPath(entry.formatVersion));
  }
});

test('configurator links support current and archived formats and reject unsupported formats', () => {
  assert.equal(configuratorPath(11, 11), '../');
  assert.equal(configuratorPath(10, 11), '../versions/format-v10/');
  assert.equal(configuratorPath(9, 11), '../versions/format-v9/');
  assert.equal(configuratorPath(10, 10), '../');
  for (const format of [12, 1, 0, 10.5, NaN]) {
    assert.throws(() => configuratorPath(format, 11), /matching configurator/);
  }
  assert.throws(() => firmwareFormat(new Uint8Array(16), 3), /identify/);
});

class FakeBootloader {
  vendorId = 0x4348;
  productId = 0x55e0;
  opened = false;
  configuration = null;
  commands = [];
  flash = new Uint8Array(CODE_LIMIT).fill(0xff);
  id = [1, 2, 3, 4];
  version = [2, 4, 0];
  chip = 0x52;
  errorOn = null;
  shortOn = null;
  hangOn = null;
  bootOptions = 0x01;
  ignoreConfigWrite = false;
  configReadMask = 0x1f;
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async selectConfiguration() {
    this.configuration = { interfaces: [{ interfaceNumber: 0, alternates: [{ interfaceClass: 0xff, endpoints: [
      { direction: 'out', endpointNumber: 2 }, { direction: 'in', endpointNumber: 2 },
    ] }] }] };
  }
  async claimInterface(n) { assert.equal(n, 0); }
  async transferOut(endpoint, buffer) {
    assert.equal(endpoint, 2);
    this.packet = new Uint8Array(buffer).slice();
    this.commands.push(this.packet);
    return { status: 'ok', bytesWritten: buffer.byteLength };
  }
  async transferIn(endpoint) {
    assert.equal(endpoint, 2);
    const p = this.packet, cmd = p[0];
    if (cmd === this.hangOn) return new Promise(() => {});
    const response = new Uint8Array(cmd === 0xa7 ? 30 : 6);
    response[0] = cmd;
    response[2] = response.length - 4;
    if (cmd === 0xa1) { response[4] = this.chip; response[5] = 0x11; }
    else if (cmd === 0xa7) {
      response[4] = this.configReadMask;
      response[10] = this.bootOptions;
      response.set(this.version, 19); response.set(this.id, 22);
    }
    else if (cmd === 0xa8) {
      if (!this.ignoreConfigWrite && cmd !== this.errorOn) this.bootOptions = p[9];
      response.set([2, 0, 0x40, 0], 2);
    }
    else if (cmd === 0xa3) { response[4] = (8 * this.id.reduce((sum, byte) => sum + byte, 0) + this.chip) & 0xff; }
    else if (cmd === 0xa4) this.flash.fill(0xff);
    else if (cmd === 0xa5 || cmd === 0xa6) {
      const address = p[3] + p[4] * 256;
      const sum = this.id.reduce((a, b) => a + b, 0) & 0xff;
      for (let i = 8; i < p.length; i++) {
        const mask = (sum + ((i - 8) % 8 === 7 ? this.chip : 0)) & 0xff;
        const value = p[i] ^ mask;
        if (cmd === 0xa5) this.flash[address + i - 8] = value;
        else if (this.flash[address + i - 8] !== value) response[4] = 1;
      }
    }
    if (cmd === this.errorOn) response[4] = 2;
    const bytes = cmd === this.shortOn ? response.slice(0, 3) : response;
    // Exercise DataView byte-offset handling too.
    const storage = new Uint8Array(bytes.length + 4);
    storage.set(bytes, 2);
    return { status: 'ok', data: new DataView(storage.buffer, 2, bytes.length) };
  }
}

function session(device, timeout = 1000) {
  return new Ch552Bootloader({ requestDevice: async ({ filters }) => {
    assert.deepEqual(filters, [{ vendorId: 0x4348, productId: 0x55e0 }]);
    return device;
  } }, () => {}, timeout);
}

test('UI defaults to 3-key and requires renewed confirmation after changing variants', async () => {
  class Element {
    hidden = false;
    disabled = true;
    checked = false;
    dataset = {};
    attributes = {};
    handlers = {};
    children = [];
    get textContent() { return this._textContent ?? ""; }
    set textContent(value) { this._textContent = value; this.children = []; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    focus() {}
    async emit(name) { await this.handlers[name](); }
  }
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const buttons = [3, 6].map(keys => Object.assign(new Element(), { dataset: { variant: String(keys) } }));
  const tabs = ['latest', 'previous', 'custom'].map(source => Object.assign(element(`tab-${source}`), { dataset: { source } }));
  const device = new FakeBootloader();
  const replacements = {
    document: { getElementById: element, querySelectorAll: selector => selector === '[data-source]' ? tabs : buttons, createElement: () => new Element() },
    window: { isSecureContext: true, location: { search: '' }, addEventListener() {} },
    navigator: { platform: 'MacIntel', usb: { requestDevice: async () => device, addEventListener() {} } },
    fetch: async path => new Response(await readFile(new URL(`../dist/${path.slice(2)}`, import.meta.url))),
  };
  const originals = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(replacements)) {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    await import('../dist/app.mjs');
    assert.equal(element('compatibility-notice').attributes.role, undefined);
    assert.equal(element('platform-macos').open, true);
    assert.equal(element('platform-windows').open, false);
    assert.equal(element('platform-linux').open, false);
    assert.equal(buttons[0].attributes['aria-pressed'], 'true');
    assert.equal(buttons[1].attributes['aria-pressed'], 'false');
    assert.match(element('firmware-info').textContent, /3-key/);
    assert.equal(element('connect').disabled, false);
    assert.equal(element('reboot').disabled, true);
    const historyVersions = element('release-history').children.filter((_, index) => index % 2 === 0).map(term => term.children[0]);
    assert.equal(historyVersions[0].textContent, `v${selectedFirmware(manifest, 3, 'latest').formatVersion}`);
    const historical = historyVersions.find(button => button.textContent === 'v9');
    await historical.emit('click');
    assert.equal(element('panel-previous').hidden, false);
    assert.equal(element('release-recommendation').dataset.tone, 'warning');
    assert.equal(element('release-recommendation').textContent, 'The latest version is recommended for most situations');
    assert.match(element('firmware-info').textContent, /v9 for a 3-key/);
    assert.match(element('profile-impact').textContent, /will no longer be valid/);
    assert.equal(element('profile-migration').hidden, true);
    const selectedVersion = element('confirmation-label').children.find(child => typeof child !== 'string');
    assert.match(selectedVersion.className, /previous/);
    assert.equal(element('status').children[0].href, '#connection');
    await historyVersions[0].emit('click');
    assert.equal(element('panel-latest').hidden, false);
    assert.equal(element('release-recommendation').dataset.tone, 'success');
    assert.equal(element('release-recommendation').textContent, 'This version is recommended for most situations');
    assert.equal(element('profile-impact').textContent, 'Installation replaces the application firmware.');
    assert.equal(element('profile-migration').hidden, false);
    await element('connect').emit('click');
    assert.equal(element('connect').disabled, true);
    assert.equal(element('reboot').disabled, false);
    assert.equal(element('install').disabled, true);
    const confirmation = element('confirm-variant');
    confirmation.checked = true;
    await confirmation.emit('change');
    assert.equal(element('install').disabled, false);
    await buttons[0].emit('click');
    assert.equal(confirmation.checked, true);
    await buttons[1].emit('click');
    assert.equal(confirmation.checked, false);
    assert.equal(element('install').disabled, true);
    assert.equal(buttons[1].attributes['aria-pressed'], 'true');
    assert.match(element('firmware-info').textContent, /6-key/);
    await element('tab-previous').emit('click');
    const previous = previousReleases(manifest, 6).find(entry => entry.formatVersion === 9);
    const selector = element('firmware-release');
    confirmation.checked = true;
    selector.value = previous.name; await selector.emit('change');
    assert.equal(confirmation.checked, false);
    assert.equal(element('install').disabled, true);
    assert.match(element('firmware-info').textContent, new RegExp(previous.sourceRevision));
    assert.equal(element('download').download, previous.name);
    const counterpart = manifest.previousFirmware.find(entry => entry.keys === 3 &&
      entry.formatVersion === previous.formatVersion && entry.sourceRevision === previous.sourceRevision);
    confirmation.checked = true;
    await buttons[0].emit('click');
    assert.equal(selector.value, counterpart.name);
    assert.equal(element('download').download, counterpart.name);
    assert.equal(confirmation.checked, false);
    assert.equal(element('install').disabled, true);
    await buttons[1].emit('click');
    assert.equal(selector.value, previous.name);
    assert.equal(element('download').download, previous.name);
    // Even a directly invoked click cannot erase flash without confirmation.
    await element('install').emit('click');
    assert.equal(device.commands.some(p => p[0] === 0xa4), false);
    confirmation.checked = true;
    await confirmation.emit('change');
    assert.equal(element('install').disabled, false);
    confirmation.checked = false;
    await confirmation.emit('change');
    assert.equal(element('install').disabled, true);
    const commandCount = device.commands.length;
    await element('reboot').emit('click');
    assert.deepEqual(device.commands.slice(commandCount), [Uint8Array.of(0xa2, 1, 0, 1)]);
    assert.equal(element('connect').disabled, false);
    assert.equal(element('reboot').disabled, true);
    assert.equal(element('install').disabled, true);
    assert.equal(device.opened, false);
    await element('connect').emit('click');
    confirmation.checked = true;
    await confirmation.emit('change');
    await element('install').emit('click');
    assert.equal(element('status').textContent, 'Firmware programmed and verified');
    assert.equal(element('selection-status').hidden, false);
    const successLink = element('status').children.find(child => typeof child !== 'string');
    assert.equal(successLink.target, '_blank');
    assert.equal(successLink.href, expectedConfiguratorPath(previous.formatVersion));
    assert.equal(successLink.textContent, 'Open the Macropad Configurator');
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('unsupported browsers replace the top beta notice before firmware loading', async () => {
  for (const scenario of ['unsupported', 'insecure', 'manifest-failure']) {
    const elements = new Map();
    const element = id => {
      if (!elements.has(id)) elements.set(id, {
        disabled: true, attributes: {}, dataset: {},
        append() {}, replaceChildren() {},
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener() {},
      });
      return elements.get(id);
    };
    const replacements = {
      document: { getElementById: element, querySelectorAll: () => [], createElement: () => element('created') },
      window: { isSecureContext: scenario !== 'insecure', location: { search: '' } },
      navigator: { platform: 'MacIntel', ...(scenario === 'insecure' ? { usb: {} } : {}) },
      fetch: async path => {
        // The notice must be visible even before the first request completes.
        assert.equal(element('compatibility-notice').attributes.role, 'alert');
        assert.equal(element('compatibility-notice').className, 'beta incompatible');
        assert.match(element('notice-message').textContent, /desktop Chrome or Edge/);
        if (scenario === 'manifest-failure') throw new Error('Firmware list unavailable');
        return new Response(await readFile(new URL(`../dist/${path.slice(2)}`, import.meta.url)));
      },
    };
    const originals = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    try {
      for (const [key, value] of Object.entries(replacements)) {
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
      }
      await import(`../dist/app.mjs?compatibility=${scenario}`);
      assert.equal(element('notice-title').textContent, scenario === 'insecure'
        ? 'A Secure Connection Is Required to Install Firmware'
        : 'Unable to Install Firmware');
      assert.equal(element('connect').disabled, true);
      assert.equal(element('install').disabled, true);
    } finally {
      for (const [key, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  }
});

test('reboot requires a connection and closes the session even if the restart transfer fails', async () => {
  const device = new FakeBootloader(), client = session(device);
  await assert.rejects(client.reboot(), /Connect the bootloader first/);
  assert.equal(device.commands.length, 0);
  await client.connect();
  device.transferOut = async () => { throw new Error('Device disconnected'); };
  await assert.rejects(client.reboot(), /Device disconnected/);
  assert.equal(device.opened, false);
  assert.equal(client.ready, false);
  assert.equal(client.busy, false);
  assert.equal(device.commands.some(p => [0xa4, 0xa5, 0xa6].includes(p[0])), false);
});

for (const entry of [...manifest.firmware, ...manifest.previousFirmware]) {
  test(`${entry.keys}-key release is bundled intact and genuinely verified with A6 packets`, async () => {
    const content = await readFile(new URL(`../dist/firmware/${entry.name}`, import.meta.url));
    assert.equal(createHash('sha256').update(content).digest('hex'), entry.sha256);
    const image = parseHex(content.toString('utf8'));
    assert.equal(image.length, entry.bytes);
    const device = new FakeBootloader(), client = session(device);
    await client.connect();
    await client.flash(image);
    const writes = device.commands.filter(p => p[0] === 0xa5);
    const verifies = device.commands.filter(p => p[0] === 0xa6);
    assert.equal(writes.length, Math.ceil(image.length / 56));
    assert.equal(verifies.length, writes.length);
    assert.equal(writes.reduce((sum, p) => sum + p.length - 8, 0), image.length);
    assert.ok(writes.every(p => (p.length - 8) % 8 === 0));
    verifies.forEach((packet, i) => assert.deepEqual(packet.slice(1), writes[i].slice(1)));
    assert.deepEqual(device.flash.slice(0, image.length), image);
    assert.equal(device.commands.at(-1)[0], 0xa2);
    assert.equal(device.opened, false);
    assert.equal(client.ready, false);
  });
}

test('rejects unsupported chip/version before erase and closes the device', async () => {
  for (const setting of [{ chip: 0x54 }, { version: [2, 3, 0] }, { version: [2, 5, 1] }]) {
    const device = Object.assign(new FakeBootloader(), setting);
    await assert.rejects(session(device).connect(), /CH552|not supported/);
    assert.equal(device.commands.some(p => p[0] === 0xa4), false);
    assert.equal(device.opened, false);
  }
});

test('a full final block programs the whole image through the application boundary', async () => {
  for (const length of [56, 64, CODE_LIMIT]) {
    const image = Uint8Array.from({ length }, (_, i) => i & 255);
    const device = new FakeBootloader(), client = session(device);
    await client.connect();
    await client.flash(image);
    assert.deepEqual(device.flash.slice(0, length), image);
    const writes = device.commands.filter(p => p[0] === 0xa5);
    assert.equal(writes.reduce((sum, p) => sum + p.length - 8, 0), length);
    assert.ok(writes.every(p => p[3] + p[4] * 256 + p.length - 8 <= CODE_LIMIT));
  }
});

test('configuration readback mismatch or missing fields stops before erase, write, or restart', async () => {
  for (const setting of [
    { ignoreConfigWrite: true, bootOptions: 0x00 },
    { ignoreConfigWrite: true, bootOptions: 0x01 },
    { ignoreConfigWrite: true, bootOptions: 0x02 },
    { configReadMask: 0x01 },
  ]) {
    const device = Object.assign(new FakeBootloader(), setting), client = session(device);
    await client.connect();
    await assert.rejects(client.flash(new Uint8Array(64)), /Configuration readback failed.*Application flash was not erased/);
    assert.equal(device.commands.some(p => [0xa3, 0xa4, 0xa5, 0xa6, 0xa2].includes(p[0])), false);
    assert.equal(device.opened, false);
  }
});

test('0x0040 alone is insufficient; matching effective options permit installation', async () => {
  const device = new FakeBootloader(), client = session(device);
  // Reserved bits and unused words need not echo the write packet.
  device.ignoreConfigWrite = true;
  device.bootOptions = 0xff;
  await client.connect();
  await client.flash(new Uint8Array(64));
  const commands = device.commands.map(p => p[0]);
  const init = commands.indexOf(0xa8);
  assert.deepEqual(commands.slice(init, init + 4), [0xa8, 0xa7, 0xa3, 0xa4]);
  assert.equal(commands.at(-1), 0xa2);
});

const observedConfigReadback = Uint8Array.from(
  'a7 fb 1a 00 1f 00 ff ff ff ff 03 00 00 00 ff 52 5d 73 00 02 05 00 83 5d 42 be 00 00 00 00'
    .split(' '), byte => parseInt(byte, 16));

test('observed CH552 v2.5.0 readback with second byte 0xFB permits a verified firmware upload', async () => {
  for (const keys of [3, 6]) {
    const device = new FakeBootloader(), client = session(device);
    device.version = [2, 5, 0];
    device.id = [...observedConfigReadback.slice(22, 26)];
    const receive = device.transferIn.bind(device);
    device.transferIn = async endpoint => {
      const result = await receive(endpoint);
      if (device.packet[0] === 0xa7) {
        const bytes = observedConfigReadback.slice();
        result.data = new DataView(bytes.buffer);
      }
      return result;
    };
    const entry = selectedFirmware(manifest, keys, 'latest');
    const hex = await readFile(new URL(`../dist/firmware/${entry.name}`, import.meta.url), 'utf8');
    const image = parseHex(hex);
    await client.connect();
    await client.flash(image);
    assert.deepEqual(device.flash.slice(0, image.length), image);
    assert.ok(device.commands.some(packet => packet[0] === 0xa6));
    assert.equal(device.commands.at(-1)[0], 0xa2);
    assert.equal(device.opened, false);
  }
});

test('nonzero second A7 byte still rejects malformed or mismatched readback before programming', async () => {
  for (const [reason, damage] of [
    ['unexpected reply command', bytes => { bytes[0] = 0xa8; }],
    ['invalid reply length', bytes => { bytes[2] = 21; }],
    ['invalid reply length', bytes => { bytes[2] = 27; }],
    ['missing configuration fields', bytes => { bytes[4] = 1; }],
    ['boot options did not match', bytes => { bytes[10] = 2; }],
  ]) {
    const device = new FakeBootloader(), client = session(device);
    await client.connect();
    const receive = device.transferIn.bind(device);
    device.transferIn = async endpoint => {
      const result = await receive(endpoint);
      if (device.packet[0] === 0xa7) {
        const bytes = observedConfigReadback.slice();
        damage(bytes);
        result.data = new DataView(bytes.buffer);
      }
      return result;
    };
    await assert.rejects(client.flash(new Uint8Array(64)), new RegExp(`Configuration readback failed: ${reason}`));
    assert.equal(device.commands.some(packet => [0xa3, 0xa4, 0xa5, 0xa6, 0xa2].includes(packet[0])), false);
    assert.equal(device.opened, false);
  }
});

test('initialization failure reports the actual reply and stops before erase', async () => {
  const device = new FakeBootloader(), client = session(device);
  device.errorOn = 0xa8;
  await client.connect();
  await assert.rejects(client.flash(new Uint8Array(64)), /0xa8; reply: a8 00 02 00 02 00/);
  assert.equal(device.commands.some(p => [0xa4, 0xa5, 0xa6, 0xa2].includes(p[0])), false);
  assert.equal(device.opened, false);
});

test('key setup, write, erase, and verification failures stop without a restart or success', async () => {
  for (const command of [0xa3, 0xa4, 0xa5, 0xa6]) {
    const device = new FakeBootloader(), client = session(device);
    device.errorOn = command;
    await client.connect();
    await assert.rejects(client.flash(new Uint8Array(64)), /failed/);
    assert.equal(device.commands.some(p => p[0] === 0xa2), false);
    assert.equal(client.ready, false);
    assert.equal(device.opened, false);
    if (command === 0xa3) assert.equal(device.commands.some(p => p[0] === 0xa4), false);
  }
});

test('short replies, stalled transfers, and canceled selection fail cleanly', async () => {
  const short = new FakeBootloader(); short.shortOn = 0xa7;
  await assert.rejects(session(short).connect(), /incomplete/);
  const hanging = new FakeBootloader(); hanging.hangOn = 0xa7;
  await assert.rejects(session(hanging, 10).connect(), /timed out/);
  assert.equal(hanging.opened, false);
  const canceled = new Ch552Bootloader({ requestDevice: async () => { throw new Error('No device selected'); } });
  await assert.rejects(canceled.connect(), /No device selected/);
  assert.equal(canceled.ready, false);
});

function record(address, type, data) {
  const bytes = [data.length, address >> 8, address & 255, type, ...data];
  bytes.push((-bytes.reduce((a, b) => a + b, 0)) & 255);
  return ':' + bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}
const eof = ':00000001FF';
test('validates HEX boundaries, checksums, overlap, EOF, and FF alignment padding', () => {
  const start = record(0, 0, [1, 2, 3]);
  assert.deepEqual(parseHex(`${start}\n${eof}`), Uint8Array.of(1, 2, 3, 255, 255, 255, 255, 255));
  assert.throws(() => parseHex(`${start.slice(0, -2)}00\n${eof}`), /checksum/);
  assert.throws(() => parseHex(`${start}\n${start}\n${eof}`), /overlapping/);
  assert.throws(() => parseHex(`${start}\n${record(0x3800, 0, [1])}\n${eof}`), /application area/);
  assert.throws(() => parseHex(start), /EOF/);
  assert.throws(() => parseHex(`${start}\n${eof}\n${start}`), /after EOF/);
});

test('the beta UI includes platform sources and the published source/license', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  for (const text of ['Beta', 'Windows', 'macOS', 'Linux', 'zadig.akeo.ie', 'MODE="0660"', 'udevadm.html', 'upstream-LICENSE.txt', 'verification-fix.patch']) assert.ok(html.includes(text), text);
});


test('all historical releases match their exact committed HEX, metadata and checksums', async () => {
  const source = JSON.parse(await readFile(new URL('../firmware-history/index.json', import.meta.url), 'utf8'));
  assert.equal(source.firmware.length, 30);
  assert.equal(manifest.previousFirmware.length, source.firmware.length);
  for (const entry of manifest.previousFirmware) {
    const content = await readFile(new URL(`../dist/firmware/${entry.name}`, import.meta.url));
    const recorded = execFileSync('git', ['show', `${entry.releaseCommit}:releases/${entry.name}`]);
    assert.deepEqual(content, recorded);
    assert.equal(createHash('sha256').update(content).digest('hex'), entry.sha256);
    assert.equal(parseHex(content.toString()).length, entry.bytes);
    const header = execFileSync('git', ['show', `${entry.releaseCommit}:src/config.h`], { encoding: 'utf8' });
    assert.equal(Number(/#define CONFIG_VERSION\s+(\d+)/.exec(header)[1]), entry.formatVersion);
    assert.equal(configuratorPath(entry.formatVersion, currentFormatVersion), expectedConfiguratorPath(entry.formatVersion));
    if (entry.formatVersion >= 6) assert.equal(firmwareFormat(parseHex(content.toString()), entry.keys), entry.formatVersion);
  }
});

test('historical selection retains the default release and cannot cross board variants', () => {
  for (const keys of [3, 6]) {
    assert.equal(selectedFirmware(manifest, keys), manifest.firmware.find(entry => entry.keys === keys));
    const choices = firmwareChoices(manifest, keys);
    assert.equal(choices.length, 15);
    assert.ok(choices.every(entry => entry.keys === keys));
    for (const entry of choices) {
      assert.equal(selectedFirmware(manifest, keys, entry.name), entry);
      assert.equal(selectedFirmware(manifest, keys === 3 ? 6 : 3, entry.name), undefined);
    }
    assert.equal(selectedFirmware(manifest, keys, 'missing'), undefined);
  }
});

test('previous release choices show each version once and select its newest build', () => {
  for (const keys of [3, 6]) {
    const choices = previousReleases(manifest, keys);
    assert.deepEqual(choices.map(entry => entry.formatVersion), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    for (const entry of choices) {
      const builds = firmwareChoices(manifest, keys).filter(build => build.formatVersion === entry.formatVersion);
      assert.ok(builds.every(build => build.publishedAt <= entry.publishedAt));
      assert.ok(manifest.releaseNotes[entry.formatVersion]?.length);
    }
  }
  assert.match(manifest.releaseNotes[11], /32ms/);
});
