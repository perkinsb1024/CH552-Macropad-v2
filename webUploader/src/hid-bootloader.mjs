// WebHID payloads exclude the report ID. This uses the normal transport-v1 protocol.
export async function enterBootloader(hid, timeoutMs = 3000) {
  const devices = await hid.requestDevice({ filters: [
    { vendorId: 0x1209, productId: 0xc55d, usagePage: 0xff00, usage: 1 },
  ] });
  const device = devices[0];
  if (!device) throw new Error('No macropad selected.');

  async function request(opcode, sequence) {
    let listener, timer;
    const reply = new Promise((resolve, reject) => {
      listener = event => {
        if (event.reportId !== 4) return;
        const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
        if (bytes.length !== 31 || bytes[0] !== 0x55 || bytes[1] !== 0x4d ||
            bytes[2] !== 1 || bytes[3] !== opcode || bytes[4] !== sequence) return;
        if (bytes[5] || bytes[6] > 23) reject(new Error('Invalid HID reply.'));
        else if (bytes[7] === 2) reject(new Error('This firmware does not support the bootloader command. Hold the encoder while reconnecting USB.'));
        else if (bytes[7]) reject(new Error(`Macropad rejected the command (status ${bytes[7]}).`));
        else resolve(bytes.slice(8, 8 + bytes[6]));
      };
      device.addEventListener('inputreport', listener);
      timer = setTimeout(() => reject(new Error('No HID acknowledgement. Hold the encoder while reconnecting USB if needed.')), timeoutMs);
    });
    reply.catch(() => {}); // Also handle a synchronous sendReport failure.
    try {
      const payload = new Uint8Array(31);
      payload.set([0x55, 0x4d, 1, opcode, sequence]);
      const [, data] = await Promise.all([device.sendReport(3, payload), reply]);
      return data;
    } finally {
      clearTimeout(timer);
      device.removeEventListener('inputreport', listener);
    }
  }

  try {
    if (!device.opened) await device.open();
    const info = await request(1, 1);
    if (info.length !== 14 || info[0] !== 0x55 || info[1] !== 0x4d ||
        info[2] !== 0x41 || info[3] !== 0x43 || info[4] !== 1 || info[6] > 1 ||
        info[7] !== (info[6] ? 3 : 6) || info[8] !== info[7] || info[10] !== 128) {
      throw new Error('Unrecognized macropad reply. Hold the encoder while reconnecting USB.');
    }
    const reply = await request(0x0a, 2);
    if (reply.length) throw new Error('Unexpected bootloader acknowledgement.');
  } finally {
    // USB disappearance after acknowledgement is expected.
    if (device.opened) await device.close().catch(() => {});
  }
}
