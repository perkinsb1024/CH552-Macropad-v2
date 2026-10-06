export function buildRequest(opcode, sequence, offset = 0, length = 0, data = []) {
  if (data.length > 23 || length > 23) throw new Error('Oversized HID request');
  const packet = new Uint8Array(31);
  packet.set([0x55, 0x4d, 1, opcode, sequence & 255, offset, length, 0]);
  packet.set(data, 8);
  return packet;
}

export function parseReply(view) {
  if (view.byteLength !== 31) return null;
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (bytes[0] !== 0x55 || bytes[1] !== 0x4d || bytes[2] !== 1 || bytes[6] > 23) return null;
  return { opcode: bytes[3], sequence: bytes[4], offset: bytes[5], status: bytes[7], data: bytes.slice(8, 8 + bytes[6]) };
}

export function decodeStack(data) {
  if (data.length !== 2) throw new Error('Not a stack diagnostic reply');
  const [start, highest] = data;
  if (start < 0x80 || highest < start - 1) throw new Error('Invalid stack bounds');
  return { start, highest, capacity: 256 - start, used: highest - start + 1, free: 255 - highest };
}

export function crc16(image) {
  let crc = 0xffff;
  for (let i = 0; i < image.length; i++) {
    if (i === 6 || i === 7) continue;
    crc ^= image[i] << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc;
}

export class HidLink {
  constructor(device) {
    this.device = device;
    this.sequence = 0;
    this.pending = null;
    this.onInput = (event) => {
      if (event.reportId !== 4) return;
      const reply = parseReply(event.data);
      const pending = this.pending;
      if (!reply || !pending || reply.sequence !== pending.sequence || reply.opcode !== pending.opcode || reply.offset !== pending.offset) return;
      this.pending = null;
      clearTimeout(pending.timer);
      pending.resolve(reply);
    };
    device.addEventListener('inputreport', this.onInput);
  }
  request(opcode, offset = 0, length = 0, data = []) {
    if (this.pending) return Promise.reject(new Error('Another request is pending'));
    const sequence = this.sequence++ & 255;
    return new Promise((resolve, reject) => {
      const pending = { opcode, offset, sequence, resolve, reject };
      pending.timer = setTimeout(() => {
        if (this.pending !== pending) return;
        this.pending = null;
        reject(new Error('HID timeout: stop and reconnect before continuing'));
      }, 3000);
      this.pending = pending;
      this.device.sendReport(3, buildRequest(opcode, sequence, offset, length, data)).catch((error) => {
        if (this.pending !== pending) return;
        clearTimeout(pending.timer);
        this.pending = null;
        reject(error);
      });
    });
  }
  async close() {
    this.device.removeEventListener('inputreport', this.onInput);
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('Device disconnected'));
      this.pending = null;
    }
    if (this.device.opened) await this.device.close();
  }
}

if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);
  let link = null, info = null, busy = false, running = false;
  const rows = [];
  const keyRows = [];
  const hex = (n) => `0x${n.toString(16).padStart(2, '0')}`;
  const note = (text) => { $('log').value += `${new Date().toISOString()} ${text}\n`; $('log').scrollTop = $('log').scrollHeight; };
  function controls() {
    $('connect').disabled = busy || !!link;
    $('disconnect').disabled = busy || !link;
    for (const id of ['sample', 'monitor', 'stress', 'invalid']) $(id).disabled = busy || !link;
    $('save').disabled = busy || !link || !info || ![0, 1].includes(info[6]);
    $('stop').disabled = !running;
  }
  async function checked(opcode, offset = 0, length = 0, data = []) {
    const reply = await link.request(opcode, offset, length, data);
    if (reply.status) throw new Error(`Opcode ${opcode}: status ${reply.status}`);
    return reply.data;
  }
  async function readImage(opcode) {
    const image = new Uint8Array(128);
    for (let offset = 0; offset < 128; offset += 23) {
      const length = Math.min(23, 128 - offset);
      const data = await checked(opcode, offset, length);
      if (data.length !== length) throw new Error('Short image reply');
      image.set(data, offset);
    }
    return image;
  }
  function same(a, b) { return a.length === b.length && a.every((value, i) => value === b[i]); }
  async function sample() {
    const status = await checked(2);
    if (status.length !== 8) throw new Error('Flash the v10 stack diagnostic firmware; normal firmware has no watermark readout.');
    const result = decodeStack(status.slice(6));
    $('used').textContent = `${result.used} B`;
    $('free').textContent = `${result.free} B`;
    $('free').className = result.free === 0 ? 'error' : '';
    $('capacity').textContent = `${result.capacity} B`;
    const row = [new Date().toISOString(), $('label').value, info[6], result.start, result.highest,
      result.used, result.free, result.capacity, status[0], status[1] + 1, status[3], status[4], status[5]];
    rows.push(row);
    note(`${$('label').value}: used=${result.used} spare=${result.free} capacity=${result.capacity} base=${hex(result.start)} highest=${hex(result.highest)} layer=${status[1] + 1} flashValid=${status[0]} droppedButtons=${status[4]} droppedRotation=${status[5]}${result.free === 0 ? ' TOP OF STACK TOUCHED' : ''}`);
  }
  async function stage(image, declaredCrc = crc16(image)) {
    await checked(5, 0, 3, [128, declaredCrc & 255, declaredCrc >> 8]);
    for (let offset = 0; offset < 128; offset += 23) {
      const chunk = image.slice(offset, offset + 23);
      await checked(6, offset, chunk.length, chunk);
    }
  }
  async function save() {
    const keys = info[6] ? 3 : 6;
    const response = await fetch(`${keys}-key-sanity-profile.bin`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Missing test image; run build-test-images.mjs');
    const image = new Uint8Array(await response.arrayBuffer());
    const crc = crc16(image);
    if (image.length !== 128 || image[0] !== 0x4d || image[1] !== 0x50 || image[2] !== 10 || (image[5] & 1) !== info[6] || image[6] !== (crc & 255) || image[7] !== (crc >> 8)) throw new Error('Invalid v10 test image for this hardware variant');
    await stage(image);
    await checked(7);
    if (!same(await readImage(3), image)) throw new Error('Saved flash differs from test image');
    await checked(7); // Idempotent retry: acknowledges without another flash write.
    note(`Saved and verified ${keys}-key sanity profile; repeated COMMIT acknowledged. Watermark retained.`);
    await checked(8);
    await sample();
  }
  async function invalidUploads() {
    const original = await readImage(3);
    await stage(original, crc16(original) ^ 1);
    let reply = await link.request(7);
    if (reply.status !== 7) throw new Error(`Expected BAD_CRC (7), got ${reply.status}`);
    await checked(8);
    const invalid = original.slice();
    invalid[0] = 0; // Invalid magic with a correct checksum reaches config validation.
    const crc = crc16(invalid);
    invalid[6] = crc & 255; invalid[7] = crc >> 8;
    await stage(invalid, crc);
    reply = await link.request(7);
    if (reply.status !== 6) throw new Error(`Expected BAD_CONFIG (6), got ${reply.status}`);
    await checked(8);
    if (!same(original, await readImage(3))) throw new Error('Flash changed during rejected uploads');
    note('BAD_CRC and BAD_CONFIG returned; stored flash verified unchanged.');
    await sample();
  }
  async function run(operation) {
    if (busy) return;
    busy = true; controls(); $('message').textContent = ''; $('message').className = '';
    try { await operation(); $('sink').focus?.(); }
    catch (error) {
      running = false;
      $('message').textContent = error.message; $('message').className = 'error'; note(`ERROR: ${error.message}`);
      if (link) { await link.close().catch(() => {}); link = null; info = null; }
      $('device').textContent = 'Disconnected after error. Reconnect to continue.';
    } finally { busy = false; controls(); }
  }
  async function connect() {
    if (!navigator.hid) throw new Error('Use Chrome or Edge at http://localhost:8765/Stack%20Test/read-stack.html');
    const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x1209, productId: 0xc55d, usagePage: 0xff00, usage: 1 }] });
    if (!devices.length) return;
    const device = devices[0];
    await device.open(); link = new HidLink(device);
    info = await checked(1);
    if (info.length !== 14 || String.fromCharCode(...info.slice(0, 4)) !== 'UMAC' || info[4] !== 1 || info[5] !== 10) throw new Error('Unexpected device identity');
    $('device').textContent = `${info[7]}-key Universal Macropad · format ${info[5]} · stack diagnostic`;
    await sample();
  }
  async function loop(stress) {
    running = true; controls();
    let cycle = 0;
    try {
      while (running && link) {
        if (stress) {
          await readImage(3); await readImage(4);
          if ($('preview').checked) await checked(9, [0xfd, 0xfc, 0x8d, 0x0c, 0][cycle++ % 5]);
        }
        await sample();
        await new Promise((resolve) => setTimeout(resolve, stress ? 100 : 1000));
      }
    } finally {
      running = false;
      if (stress && link && !link.pending) await checked(9, 0);
    }
  }
  $('connect').onclick = () => run(connect);
  $('disconnect').onclick = () => run(async () => { await link.close(); link = null; info = null; $('device').textContent = 'Disconnected. Device watermark retained.'; });
  $('sample').onclick = () => run(sample);
  $('monitor').onclick = () => { $('sink').focus?.(); return run(() => loop(false)); };
  $('stress').onclick = () => { $('sink').focus?.(); return run(() => loop(true)); };
  $('stop').onclick = () => { running = false; controls(); };
  $('save').onclick = () => run(save);
  $('invalid').onclick = () => run(invalidUploads);
  function downloadCsv(header, data, name) {
    const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
    const csv = [header, ...data].map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `${name}-${Date.now()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('download').onclick = () => downloadCsv(
    ['utc', 'label', 'variant', 'stack_start', 'highest_touched', 'used_bytes', 'untouched_bytes', 'capacity_bytes', 'flash_valid', 'layer', 'upload_state', 'dropped_buttons', 'dropped_rotation'],
    rows, 'macropad-stack');
  $('downloadKeys').onclick = () => downloadCsv(
    ['utc', 'label', 'event_ms', 'type', 'key', 'code', 'shift', 'ctrl', 'alt', 'meta', 'repeat', 'composing'],
    keyRows, 'macropad-keyboard');
  const traceKey = (event) => {
    if (!$('traceKeys').checked) return;
    keyRows.push([new Date().toISOString(), $('label').value, event.timeStamp, event.type,
      event.key, event.code, event.shiftKey, event.ctrlKey, event.altKey, event.metaKey,
      event.repeat, event.isComposing]);
    note(`[keyboard] ${event.type} ${event.code} key=${JSON.stringify(event.key)} shift=${event.shiftKey} ctrl=${event.ctrlKey} alt=${event.altKey} meta=${event.metaKey} repeat=${event.repeat} composing=${event.isComposing}`);
  };
  // Large HID scroll steps still reach the browser but do not move this page
  // or trigger horizontal navigation while the typing target has focus.
  document.addEventListener?.('wheel', event => {
    if (link && document.activeElement === $('sink')) event.preventDefault();
  }, { passive: false });
  $('sink').onkeydown = traceKey;
  $('sink').onkeyup = traceKey;
  navigator.hid?.addEventListener('disconnect', (event) => {
    if (link?.device !== event.device) return;
    running = false;
    link.close().catch(() => {}); link = null; info = null;
    $('device').textContent = 'USB disconnected. A power cycle resets the watermark.'; controls();
  });
  controls();
}
