import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulatedDevice } from '../src/protocol/simulator';
import { ConfigClient, TimeoutError } from '../src/protocol/client';
import { Opcode } from '../src/protocol/packet';
import { cancelPreview, connection, connectSimulator, disconnect, previewColor } from '../src/ui/store';

const originalSend = SimulatedDevice.prototype.send;

afterEach(async () => {
  await disconnect();
  vi.restoreAllMocks();
});

describe('preview capability for each connection', () => {
  it('sends one cancel at connect, caches support, and probes again after reconnect', async () => {
    const requests: Uint8Array[] = [];
    vi.spyOn(SimulatedDevice.prototype, 'send').mockImplementation(function (this: SimulatedDevice, payload) {
      if (payload[3] === Opcode.GetInfo) this.previewOptions = 0xfd;
      requests.push(payload);
      return originalSend.call(this, payload);
    });
    await connectSimulator(0);
    const c = connection.value;
    expect(c.kind).toBe('connected');
    if (c.kind !== 'connected') throw new Error('connection failed');
    expect(c.connection.previewSupported).toBe(true);
    expect((c.connection.transport as SimulatedDevice).previewOptions).toBe(0);
    const probes = () => requests.filter((r) => r[3] === Opcode.PreviewColor);
    expect(probes()).toHaveLength(1);
    expect(probes()[0]![5]).toBe(0);
    await previewColor(8);
    expect(c.connection.previewSupported).toBe(true);
    await cancelPreview();
    expect(c.connection.previewSupported).toBe(true);
    await disconnect();
    await connectSimulator(1);
    expect(probes()).toHaveLength(4); // Probe, preview, cancel, new connection probe.
  });

  it('connects unsupported firmware and blocks preview commands without repeat errors', async () => {
    const requests: Uint8Array[] = [];
    vi.spyOn(SimulatedDevice.prototype, 'send').mockImplementation(function (this: SimulatedDevice, payload) {
      this.options.previewSupported = false;
      requests.push(payload);
      return originalSend.call(this, payload);
    });
    await connectSimulator(0);
    const c = connection.value;
    expect(c.kind).toBe('connected');
    if (c.kind !== 'connected') throw new Error('connection failed');
    expect(c.connection.previewSupported).toBe(false);
    await previewColor(8);
    await cancelPreview();
    expect(requests.filter((r) => r[3] === Opcode.PreviewColor)).toHaveLength(1);
    expect((await c.connection.client.getStatus()).flashValid).toBe(true);
  });

  it('keeps the device connected and preview usable when support is unknown', async () => {
    const requests: Uint8Array[] = [];
    vi.spyOn(SimulatedDevice.prototype, 'send').mockImplementation(function (this: SimulatedDevice, payload) {
      requests.push(payload);
      return originalSend.call(this, payload);
    });
    vi.spyOn(ConfigClient.prototype, 'detectPreviewSupport').mockResolvedValue(null);
    await connectSimulator(0);
    const c = connection.value;
    expect(c.kind).toBe('connected');
    if (c.kind !== 'connected') throw new TimeoutError(Opcode.PreviewColor);
    expect(c.connection.previewSupported).toBeNull();
    await previewColor(8);
    expect((c.connection.transport as SimulatedDevice).previewOptions).toBe(0x85);
  });
});
