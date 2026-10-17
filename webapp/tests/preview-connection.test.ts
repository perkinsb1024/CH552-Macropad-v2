import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulatedDevice } from '../src/protocol/simulator';
import { ConfigClient, TimeoutError } from '../src/protocol/client';
import { Opcode } from '../src/protocol/packet';
import { activeColorPreview, cancelPreview, cancelPreviewOnPageHide, connection, connectSimulator, disconnect, previewColor } from '../src/ui/store';

const originalSend = SimulatedDevice.prototype.send;

afterEach(async () => {
  vi.useRealTimers();
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
    expect(probes()).toHaveLength(5); // Probe, preview, cancel, disconnect cancel, new connection probe.
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

describe('preview lifetime', () => {
  async function setup() {
    await connectSimulator(0);
    const c = connection.value;
    if (c.kind !== 'connected') throw new Error('connection failed');
    vi.useFakeTimers();
    return { client: c.connection.client, device: c.connection.transport as SimulatedDevice };
  }

  async function start(color = 8) {
    const pending = previewColor(color);
    await vi.advanceTimersByTimeAsync(10);
    await pending;
  }

  it('cancels automatically three seconds after the click', async () => {
    const { device } = await setup();
    await start();
    expect(device.previewOptions).toBe(0x85);
    expect(activeColorPreview.value?.color).toBe(8);
    await vi.advanceTimersByTimeAsync(2989);
    expect(device.previewOptions).toBe(0x85);
    await vi.advanceTimersByTimeAsync(10);
    expect(device.previewOptions).toBe(0);
    expect(activeColorPreview.value).toBeNull();
  });

  it('restarts the timer on repeated clicks and removes it on manual cancel', async () => {
    const { client, device } = await setup();
    const cancel = vi.spyOn(client, 'cancelPreview');
    await start();
    const firstId = activeColorPreview.value?.id;
    await vi.advanceTimersByTimeAsync(2000);
    await start(1);
    expect(activeColorPreview.value?.id).not.toBe(firstId);
    await vi.advanceTimersByTimeAsync(1500);
    expect(cancel).not.toHaveBeenCalled();
    expect(device.previewOptions).toBe(0x15);
    const pending = cancelPreview();
    expect(activeColorPreview.value).toBeNull();
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    await vi.advanceTimersByTimeAsync(3000);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(device.previewOptions).toBe(0);
  });

  it('sends cancel before closing the transport, even if cancel fails', async () => {
    const { client, device } = await setup();
    await start();
    const events: string[] = [];
    vi.spyOn(client, 'cancelPreview').mockImplementation(async () => {
      events.push('cancel');
      throw new Error('lost connection');
    });
    vi.spyOn(device, 'close').mockImplementation(async () => { events.push('close'); });
    await disconnect();
    expect(events).toEqual(['cancel', 'close']);
    expect(activeColorPreview.value).toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    expect(events).toEqual(['cancel', 'close']);
  });

  it('sends an immediate best-effort cancel on page hide without awaiting a queued request', async () => {
    const { client, device } = await setup();
    await start();
    const send = vi.spyOn(device, 'send').mockResolvedValue(undefined);
    const pending = client.getStatus().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    send.mockClear();
    cancelPreviewOnPageHide();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0][3]).toBe(Opcode.PreviewColor);
    expect(send.mock.calls[0]![0][5]).toBe(0);
    expect(activeColorPreview.value).toBeNull();
    cancelPreviewOnPageHide();
    expect(send).toHaveBeenCalledTimes(1);
    send.mockRestore();
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
  });

  it('clears the timer on USB disconnect', async () => {
    const { device } = await setup();
    await start();
    device.unplug();
    expect(connection.value.kind).toBe('disconnected');
    expect(activeColorPreview.value).toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    expect(activeColorPreview.value).toBeNull();
  });
});
