import { describe, expect, it, vi } from 'vitest';
import { sendBootloaderRequest, supportsWebHubOutput } from '../src/bootloaderProbe/protocol';

function collection(usagePage = 0xff00, reportId = 0, reportCount = 64, children: HIDCollectionInfo[] = []): HIDCollectionInfo {
  return { usagePage, usage: 1, type: 1, children, inputReports: [], featureReports: [],
    outputReports: [{ reportId, items: [{ reportSize: 8, reportCount } as HIDReportItem] }] };
}

describe('factory WebHub bootloader request', () => {
  it('writes exactly one 64-byte output payload with the report ID separate', async () => {
    const sendReport = vi.fn().mockResolvedValue(undefined);
    await sendBootloaderRequest({ opened: true, collections: [collection()], sendReport });
    expect(sendReport).toHaveBeenCalledTimes(1);
    const [id, payload] = sendReport.mock.calls[0]!;
    expect(id).toBe(0);
    expect(Array.from(payload)).toEqual([0x06, 0x5a, ...Array(62).fill(0)]);
  });

  it('rejects closed devices and incompatible report layouts without writing', async () => {
    for (const device of [
      { opened: false, collections: [collection()] },
      { opened: true, collections: [collection(0x01)] },
      { opened: true, collections: [collection(0xff00, 3)] },
      { opened: true, collections: [collection(0xff00, 0, 63)] },
    ]) {
      const sendReport = vi.fn();
      await expect(sendBootloaderRequest({ ...device, sendReport })).rejects.toThrow();
      expect(sendReport).not.toHaveBeenCalled();
    }
  });

  it('finds a report in a nested vendor collection', () => {
    const parent = collection(0xff01, 1, 1, [collection(0, 0, 64)]);
    expect(supportsWebHubOutput([parent])).toBe(true);
  });

  it('does not retry a rejected write or try a different report ID', async () => {
    const sendReport = vi.fn().mockRejectedValue(new Error('Device disconnected'));
    await expect(sendBootloaderRequest({ opened: true, collections: [collection()], sendReport })).rejects.toThrow('Device disconnected');
    expect(sendReport).toHaveBeenCalledTimes(1);
  });
});
