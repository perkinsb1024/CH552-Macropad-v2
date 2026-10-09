const READ_ONLY_OPCODES = new Set([1, 2, 3, 4, 0x70]);

export function buildRequest(opcode, sequence, offset = 0, length = 0) {
  if (!READ_ONLY_OPCODES.has(opcode)) throw new Error('Only diagnostic reads are allowed');
  if (![offset, length].every(Number.isInteger) || offset < 0 || length < 0 || length > 23 ||
      ([3, 4].includes(opcode) ? length === 0 || offset + length > 128 : offset !== 0 || length !== 0)) {
    throw new Error('Invalid read range');
  }
  const packet = new Uint8Array(31);
  packet.set([0x55, 0x4d, 1, opcode, sequence & 255, offset, length, 0]);
  return packet;
}

export function parseReply(view) {
  if (view.byteLength !== 31) return null;
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (bytes[0] !== 0x55 || bytes[1] !== 0x4d || bytes[2] !== 1 || bytes[6] > 23) return null;
  return { opcode: bytes[3], sequence: bytes[4], offset: bytes[5], status: bytes[7], data: bytes.slice(8, 8 + bytes[6]) };
}

export function decodeStack(data, variant) {
  if (data.length !== 6 || data[0] !== 0x53 || data[1] !== 0x57 || data[2] !== 1 || data[3] !== variant) {
    throw new Error('Unexpected stack diagnostic identity');
  }
  const [, , , , start, highest] = data;
  if (start < 0x80 || start === 255 || highest < start - 1) throw new Error('Invalid stack bounds');
  return { start, highest, capacity: 256 - start, used: highest - start + 1, free: 255 - highest };
}

export class HidLink {
  constructor(device, record = () => {}, timeoutMs = 3000) {
    this.device = device;
    this.record = record;
    this.timeoutMs = timeoutMs;
    this.sequence = 0;
    this.pending = null;
    this.failed = false;
    this.closed = false;
    this.onInput = (event) => {
      if (event.reportId !== 4) return;
      this.record({ utc: new Date().toISOString(), direction: 'reply', reportId: 4,
        bytes: Array.from(new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)) });
      const reply = parseReply(event.data);
      const pending = this.pending;
      if (!reply || !pending || reply.sequence !== pending.sequence || reply.opcode !== pending.opcode || reply.offset !== pending.offset) return;
      this.pending = null;
      clearTimeout(pending.timer);
      pending.resolve(reply);
    };
    device.addEventListener('inputreport', this.onInput);
  }

  request(opcode, offset = 0, length = 0) {
    if (this.closed || this.failed) return Promise.reject(new Error('Reconnect before reading again'));
    if (this.pending) return Promise.reject(new Error('Another read is pending'));
    const sequence = this.sequence++ & 255;
    let packet;
    try { packet = buildRequest(opcode, sequence, offset, length); }
    catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const pending = { opcode, offset, sequence, resolve, reject };
      const fail = (error) => {
        if (this.pending !== pending) return;
        clearTimeout(pending.timer);
        this.pending = null;
        this.failed = true;
        reject(error);
      };
      pending.timer = setTimeout(() => fail(new Error('HID timeout; reconnect before continuing')), this.timeoutMs);
      this.pending = pending;
      this.record({ utc: new Date().toISOString(), direction: 'request', reportId: 3, bytes: Array.from(packet) });
      Promise.resolve().then(() => {
        if (this.pending === pending && !this.closed) return this.device.sendReport(3, packet);
      }).catch(fail);
    });
  }

  async close() {
    this.closed = true;
    this.device.removeEventListener('inputreport', this.onInput);
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('Device disconnected'));
      this.pending = null;
    }
    if (this.device.opened) await this.device.close();
  }
}

export async function checked(link, opcode, offset = 0, length = 0) {
  const reply = await link.request(opcode, offset, length);
  if (reply.status) {
    if (opcode === 0x70 && reply.status === 2) throw new Error('Install the v12 stack-test firmware; this build has no stack readout');
    throw new Error(`Read ${opcode}: device status ${reply.status}`);
  }
  return reply.data;
}

export async function readImage(link, opcode) {
  if (![3, 4].includes(opcode)) throw new Error('Expected a flash or active-image read');
  const image = new Uint8Array(128);
  for (let offset = 0; offset < 128; offset += 23) {
    const length = Math.min(23, 128 - offset);
    const data = await checked(link, opcode, offset, length);
    if (data.length !== length) throw new Error('Short image reply');
    image.set(data, offset);
  }
  return image;
}

if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);
  let link = null, info = null, busy = false, running = false, peak = 0;
  const samples = [], snapshots = [], packets = [], events = [];
  const note = (text) => {
    const utc = new Date().toISOString();
    events.push({ utc, text });
    $('log').value = ($('log').value + `${utc} ${text}\n`).split('\n').slice(-150).join('\n');
    $('log').scrollTop = $('log').scrollHeight;
  };
  function controls() {
    $('connect').disabled = busy || !!link;
    for (const id of ['disconnect', 'sample', 'monitor', 'capture']) $(id).disabled = busy || !link;
    $('stop').disabled = !running;
  }
  async function sample() {
    // Scan first so the subsequent status request does not inflate this sample.
    const stack = decodeStack(await checked(link, 0x70), info[6]);
    const status = await checked(link, 2);
    if (status.length !== 6) throw new Error('Unexpected status reply');
    peak = Math.max(peak, stack.used);
    $('used').textContent = `${stack.used} B`;
    $('peak').textContent = `${peak} B`;
    $('free').textContent = `${stack.free} B`;
    $('capacity').textContent = `${stack.capacity} B`;
    const row = { utc: new Date().toISOString(), label: $('label').value, variant: info[6], ...stack,
      connectionPeak: peak, status: Array.from(status) };
    samples.push(row);
    note(`${row.label}: used=${stack.used}, untouched=${stack.free}, capacity=${stack.capacity}, flashValid=${status[0]}, layer=${status[1] + 1}${stack.free === 0 ? ' — TOP OF STACK TOUCHED' : ''}`);
  }
  async function run(operation) {
    if (busy) return;
    busy = true; controls(); $('message').textContent = '';
    try { await operation(); }
    catch (error) {
      running = false;
      $('message').textContent = error.message;
      note(`ERROR: ${error.message}`);
      if (link) await link.close().catch(() => {});
      link = null; info = null;
      $('device').textContent = 'Disconnected after error. Reconnect to continue.';
    } finally { busy = false; controls(); }
  }
  async function connect() {
    if (!navigator.hid) throw new Error('Use Chrome or Edge on localhost');
    const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x1209, productId: 0xc55d, usagePage: 0xff00, usage: 1 }] });
    if (!devices.length) return;
    const device = devices[0];
    if (!device.opened) await device.open();
    link = new HidLink(device, (packet) => packets.push(packet));
    info = await checked(link, 1);
    if (info.length !== 14 || String.fromCharCode(...info.slice(0, 4)) !== 'UMAC' ||
        info[4] !== 1 || info[5] !== 12 || ![0, 1].includes(info[6]) || info[7] !== (info[6] ? 3 : 6)) {
      throw new Error('Expected a format-12 Universal Macropad');
    }
    peak = 0;
    $('device').textContent = `${info[7]}-key Universal Macropad · format ${info[5]} · stack diagnostic`;
    note('Connected. Automatic polling is off. A USB reconfiguration may have reapplied runtime state.');
    await sample();
  }
  async function capture() {
    await sample();
    const flash = Array.from(await readImage(link, 3));
    const active = Array.from(await readImage(link, 4));
    snapshots.push({ utc: new Date().toISOString(), label: $('label').value,
      info: Array.from(info), sample: samples.at(-1), flash, active });
    note(`Captured 128 flash bytes and 128 active bytes; identical=${flash.every((value, i) => value === active[i])}`);
  }
  $('connect').onclick = () => run(connect);
  $('disconnect').onclick = () => run(async () => {
    await link.close(); link = null; info = null;
    $('device').textContent = 'Disconnected. Device watermark retained until firmware restart.';
  });
  $('sample').onclick = () => run(sample);
  $('capture').onclick = () => run(capture);
  $('monitor').onclick = () => run(async () => {
    running = true; controls();
    try {
      while (running && link) {
        await sample();
        if (running) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } finally { running = false; }
  });
  $('stop').onclick = () => { running = false; controls(); };
  $('download').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schema: 1, downloadedUtc: new Date().toISOString(),
      samples, snapshots, packets, events }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `macropad-v12-stack-${Date.now()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  navigator.hid?.addEventListener('disconnect', (event) => {
    if (link?.device !== event.device) return;
    running = false;
    link.close().catch(() => {}); link = null; info = null;
    $('device').textContent = 'USB disconnected. A firmware restart resets the watermark.';
    note('USB disconnect observed; whether the MCU restarted is unknown.'); controls();
  });
  controls();
}
