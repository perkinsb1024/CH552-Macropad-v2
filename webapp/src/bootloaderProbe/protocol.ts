export const REPORT_ID = 0;
export const REPORT_BYTES = 64;

// Knurl's documented macropad identities, including Legacy and Extended pads
// whose support for this bootloader command remains unverified.
export const MACROPAD_FILTERS: HIDDeviceFilter[] = [
  ...[0x8890, 0x8840, 0x8830, 0x8831, 0x8832, 0x8833, 0x8810]
    .map((productId) => ({ vendorId: 0x1189, productId })),
  { vendorId: 0x6d7b, productId: 0xdcfa },
  { vendorId: 0x6d7c, productId: 0xdcfb },
  { vendorId: 0x6d7d, productId: 0xdcfc },
  { vendorId: 0x6d7e, productId: 0xdcfd },
  { vendorId: 0x6d7f, productId: 0xdcfe },
  { vendorId: 0x68bd, productId: 0xdcfc },
];

export function bootloaderPayload(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(REPORT_BYTES);
  bytes.set([0x06, 0x5a]);
  return bytes;
}

export function reportBytes(report: HIDReportInfo): number {
  return (report.items ?? []).reduce((bits, item) => bits + (item.reportSize ?? 0) * (item.reportCount ?? 0), 0) / 8;
}

/** Match a vendor collection, including reports nested below it. */
export function supportsWebHubOutput(collections: readonly HIDCollectionInfo[], vendor = false): boolean {
  return collections.some((collection) => {
    const isVendor = vendor || (collection.usagePage ?? 0) >= 0xff00;
    return (isVendor && (collection.outputReports ?? []).some(
      (report) => report.reportId === REPORT_ID && reportBytes(report) === REPORT_BYTES,
    )) || supportsWebHubOutput(collection.children ?? [], isVendor);
  });
}

export async function sendBootloaderRequest(device: Pick<HIDDevice, 'opened' | 'collections' | 'sendReport'>): Promise<void> {
  if (!device.opened) throw new Error('Select and open a device first.');
  if (!supportsWebHubOutput(device.collections)) {
    throw new Error('Requires a vendor HID collection with a 64-byte output report on ID 0.');
  }
  // One output report only. No feature-report fallback, probing, or retries.
  await device.sendReport(REPORT_ID, bootloaderPayload());
}

export function identity(vendorId: number, productId: number): string {
  return [vendorId, productId].map((n) => n.toString(16).padStart(4, '0').toUpperCase()).join(':');
}

export function protocolHint(vendorId: number, productId: number): string {
  const webHubIds = [[0x6d7b, 0xdcfa], [0x6d7c, 0xdcfb], [0x6d7d, 0xdcfc],
    [0x6d7e, 0xdcfd], [0x6d7f, 0xdcfe], [0x68bd, 0xdcfc]];
  if (webHubIds.some(([vid, pid]) => vendorId === vid && productId === pid)) {
    return 'Listed by Knurl as WebHub. Hardware and firmware compatibility still need testing.';
  }
  if (vendorId === 0x1189 && productId === 0x8890) {
    return 'Listed by Knurl as Legacy, not WebHub. The 06 5A command is unverified for this device.';
  }
  if (vendorId === 0x1189 && MACROPAD_FILTERS.some((f) => f.vendorId === vendorId && f.productId === productId)) {
    return 'Listed by Knurl as Extended, not WebHub. The 06 5A command is unverified for this device.';
  }
  return 'Unknown protocol. A matching report descriptor does not establish command compatibility.';
}
