// Configuration reports exclude the report ID in the WebHID payload.
export async function enterDiagnosticBootloader(hid) {
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
            bytes[2] !== 1 || bytes[3] !== opcode || bytes[4] !== sequence || bytes[5] !== 0) return;
        if (bytes[7] === 2) reject(new Error('This firmware does not support diagnostic bootloader entry. Use the encoder button.'));
        else if (bytes[7]) reject(new Error(`Macropad rejected the command (status ${bytes[7]}).`));
        else if (bytes[6] > 23) reject(new Error('Invalid HID reply length.'));
        else resolve(bytes.slice(8, 8 + bytes[6]));
      };
      device.addEventListener('inputreport', listener);
      timer = setTimeout(() => reject(new Error('No HID acknowledgement. Check the device and use the encoder button if needed.')), 3000);
    });
    // Attach a handler before awaiting sendReport, which can fail independently.
    reply.catch(() => {});
    try {
      const payload = new Uint8Array(31);
      payload.set([0x55, 0x4d, 1, opcode, sequence]);
      await device.sendReport(3, payload);
      return await reply;
    } finally {
      clearTimeout(timer);
      device.removeEventListener('inputreport', listener);
    }
  }
  try {
    if (!device.opened) await device.open();
    const identity = await request(0x71, 1);
    if (identity.length !== 11 || identity[0] !== 0x46 || identity[1] !== 0x44 ||
        identity[2] !== 1 || identity[3] > 1 || ![1, 2].includes(identity[4])) {
      throw new Error('Unrecognized diagnostic firmware. Use the encoder button.');
    }
    const reply = await request(0x72, 2);
    if (reply.length) throw new Error('Unexpected bootloader acknowledgement.');
  } finally {
    // USB disappearance after acknowledgement is expected.
    if (device.opened) await device.close().catch(() => {});
  }
}
