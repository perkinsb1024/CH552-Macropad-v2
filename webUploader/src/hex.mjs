export const CODE_LIMIT = 0x3800;

/** Validate the whole file before any erase; reject data outside CH552 application flash. */
export function parseHex(text) {
  const memory = new Uint8Array(CODE_LIMIT).fill(0xff);
  const occupied = new Uint8Array(CODE_LIMIT);
  let high = 0, end = 0, eof = false;
  for (const [index, raw] of text.trim().split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const fail = message => { throw new Error(`HEX line ${index + 1}: ${message}`); };
    if (eof) fail('data after EOF');
    if (!/^:(?:[0-9a-fA-F]{2}){5,}$/.test(line)) fail('invalid record');
    const bytes = Uint8Array.from(line.slice(1).match(/../g), b => parseInt(b, 16));
    const count = bytes[0], address = bytes[1] * 256 + bytes[2], type = bytes[3];
    if (bytes.length !== count + 5) fail('incorrect record length');
    if (bytes.reduce((a, b) => a + b, 0) % 256) fail('checksum mismatch');
    const data = bytes.slice(4, -1);
    if (type === 0) {
      const start = high + address;
      if (start + count > CODE_LIMIT) fail('outside the 14 KiB application area');
      for (let i = 0; i < count; i++) {
        if (occupied[start + i]) fail('overlapping data records');
        memory[start + i] = data[i];
        occupied[start + i] = 1;
      }
      if (count) end = Math.max(end, start + count);
    } else if (type === 1) {
      if (count !== 0 || address !== 0) fail('invalid EOF');
      eof = true;
    } else if (type === 2 || type === 4) {
      if (count !== 2 || address !== 0) fail('invalid address extension');
      high = (data[0] * 256 + data[1]) * (type === 2 ? 16 : 65536);
    } else if (type === 3 || type === 5) {
      if (count !== 4 || address !== 0) fail('invalid entry address');
    } else fail('unsupported record type');
  }
  if (!eof || !end || !occupied[0]) throw new Error('HEX must have application data at address zero and an EOF record.');
  // The ISP writes aligned eight-byte blocks. Explicit FF padding avoids undefined bytes.
  return memory.slice(0, Math.ceil(end / 8) * 8);
}
