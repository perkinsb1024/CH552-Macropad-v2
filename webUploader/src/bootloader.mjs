import { createUpstream } from './upstream-patched.mjs';
import { CODE_LIMIT } from './hex.mjs';

const FILTER = { vendorId: 0x4348, productId: 0x55e0 };

export class Ch552Bootloader {
  constructor(usb, onStatus = () => {}, timeoutMs = 10000) {
    this.usb = usb;
    this.onStatus = onStatus;
    this.timeoutMs = timeoutMs;
    this.device = null;
    this.endpointOut = null;
    this.busy = false;
    this.ready = false;
    this.core = createUpstream({
      requestDevice: async () => {
        this.device = await usb.requestDevice({ filters: [FILTER] });
        if (this.device.vendorId !== FILTER.vendorId || this.device.productId !== FILTER.productId) throw new Error('Select a CH55x bootloader.');
        return this.checkedDevice(this.device);
      },
      onStatus,
    });
  }

  async timed(promise) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('USB transfer timed out. Re-enter bootloader mode and reconnect before retrying.')), this.timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }

  checkedDevice(device) {
    let command;
    let keyChecksum;
    let expectedBootOptions = null;
    return {
      get configuration() { return device.configuration; },
      open: () => this.timed(device.open()),
      selectConfiguration: n => this.timed(device.selectConfiguration(n)),
      claimInterface: n => this.timed(device.claimInterface(n)),
      transferOut: async (endpoint, buffer) => {
        this.endpointOut = endpoint;
        const packet = new Uint8Array(buffer);
        command = packet[0];
        if (command === 0xa8) {
          if (packet.length !== 17 || packet[3] !== 0x07) throw new Error('Unsupported configuration write; application flash was not erased.');
          expectedBootOptions = packet[9] & 0x03;
        }
        if ([0xa3, 0xa4, 0xa5, 0xa6].includes(command) && expectedBootOptions !== null) {
          throw new Error('Configuration readback is required before programming; application flash was not erased.');
        }
        const result = await this.timed(device.transferOut(endpoint, buffer));
        if (result.status !== 'ok' || result.bytesWritten !== buffer.byteLength) throw new Error('USB write failed or was incomplete.');
        return result;
      },
      transferIn: async (endpoint, size) => {
        const result = await this.timed(device.transferIn(endpoint, size));
        const minLength = command === 0xa7 ? 26 : 6;
        if (result.status !== 'ok' || !result.data || result.data.byteLength < minLength) throw new Error('USB returned an incomplete bootloader response.');
        const data = result.data;
        if (command === 0xa1 && (data.getUint8(4) !== 0x52 || data.getUint8(5) !== 0x11)) throw new Error('This beta supports CH552 chips only.');
        if (command === 0xa7) {
          if (expectedBootOptions !== null) {
            // A7: four-byte header, two-byte field mask, then config words.
            // CH552 boot options are config word 1's low byte (reply[10]).
            // Only bits 0–1 are effective; see DeqingSun/vnproch551 main.cpp.
            const actualBootOptions = data.getUint8(10) & 0x03;
            if (data.getUint8(0) !== 0xa7 || data.getUint8(1) !== 0 || data.getUint16(2, true) < 22 || data.byteLength < 4 + data.getUint16(2, true) || (data.getUint16(4, true) & 0x07) !== 0x07 || actualBootOptions !== expectedBootOptions) {
              const reply = Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), b => b.toString(16).padStart(2, '0')).join(' ');
              throw new Error(`Configuration readback failed: expected boot options 0x${expectedBootOptions.toString(16)}, received 0x${actualBootOptions.toString(16)} (reply: ${reply}). Application flash was not erased; reconnect in bootloader mode before retrying.`);
            }
            expectedBootOptions = null;
            this.onStatus('Boot configuration readback verified.');
          }
          const idSum = [22, 23, 24, 25].reduce((sum, offset) => sum + data.getUint8(offset), 0);
          keyChecksum = (8 * idSum + 0x52) & 0xff;
        }
        // A3 returns the XOR-key checksum, not a zero success code.
        // Permit the observed A8 reply 0x40 provisionally; the following A7
        // must confirm both effective CH552 boot-option bits before erase.
        // Keep erase/write/verify strict and reject other configuration replies.
        const invalidKey = command === 0xa3 && (data.getUint8(4) !== keyChecksum || data.getUint8(5) !== 0);
        const invalidConfig = command === 0xa8 && (![0x00, 0x40].includes(data.getUint8(4)) || data.getUint8(5) !== 0);
        const invalidFlash = [0xa4, 0xa5, 0xa6].includes(command) && (data.getUint8(4) || data.getUint8(5));
        if (invalidKey || invalidConfig || invalidFlash) {
          const reply = Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), b => b.toString(16).padStart(2, '0')).join(' ');
          throw new Error(`${command === 0xa6 ? 'Verification' : 'Bootloader command'} failed (0x${command.toString(16)}; reply: ${reply}). Firmware was not confirmed; reconnect in bootloader mode before retrying.`);
        }
        // Upstream reads the buffer from offset zero. Normalize sliced DataViews.
        return { ...result, data: new DataView(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) };
      },
    };
  }

  async connect() {
    if (this.busy) throw new Error('An operation is already running.');
    this.busy = true;
    try {
      await this.disconnect();
      const info = await this.core.connect();
      this.ready = true;
      return info;
    } catch (error) {
      await this.disconnect();
      throw error;
    } finally { this.busy = false; }
  }

  async flash(data) {
    if (this.busy || !this.ready) throw new Error('Connect the bootloader first.');
    if (!(data instanceof Uint8Array) || !data.length || data.length > CODE_LIMIT || data.length % 8) throw new Error('Invalid application image.');
    this.busy = true;
    try {
      await this.core.upload(data);
    } finally {
      this.ready = false;
      this.busy = false;
      await this.disconnect();
    }
  }

  async reboot() {
    if (this.busy || !this.ready) throw new Error('Connect the bootloader first.');
    this.busy = true;
    try {
      // Use the same run-application command as a successful upload, without
      // initialization, erase, write, or verify commands. No reply is expected.
      await this.checkedDevice(this.device).transferOut(this.endpointOut, Uint8Array.of(0xa2, 0x01, 0x00, 0x01).buffer);
    } finally {
      await this.disconnect();
      this.busy = false;
    }
  }

  async disconnect() {
    this.ready = false;
    const device = this.device;
    this.device = null;
    this.endpointOut = null;
    if (device?.opened) await this.timed(device.close()).catch(() => {});
  }
}
