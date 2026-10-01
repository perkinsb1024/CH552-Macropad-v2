import { effect } from '@preact/signals';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceStatus } from '../src/protocol/packet';
import { SimulatedDevice } from '../src/protocol/simulator';
import { connection, connectSimulator, disconnect, profile, saveState, selectedLayer } from '../src/ui/store';

async function connect() {
  const pending = connectSimulator(0);
  await vi.advanceTimersByTimeAsync(100);
  await pending;
  const c = connection.peek();
  if (c.kind !== 'connected') throw new Error('connection failed');
  return c.connection;
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await disconnect();
  saveState.value = { phase: 'idle' };
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('device status polling', () => {
  it('publishes device layer changes to signal subscribers without changing the profile', async () => {
    const conn = await connect();
    const editorProfile = profile.peek();
    const editorLayer = selectedLayer.peek();
    const layers: number[] = [];
    const dispose = effect(() => {
      const c = connection.value;
      if (c.kind === 'connected') layers.push(c.connection.status.currentLayer);
    });
    try {
      // The simulator reports the layer encoded in its active RAM header.
      const device = conn.transport as SimulatedDevice;
      device.active[3] = (device.active[3]! & ~56) | (3 << 3);
      await vi.advanceTimersByTimeAsync(500);
      expect(conn.status.currentLayer).toBe(3);
      expect(layers).toEqual([0, 3]);
      device.active[3] = device.active[3]! & ~56;
      await vi.advanceTimersByTimeAsync(510);
      expect(layers).toEqual([0, 3, 0]);
      expect(profile.peek()).toBe(editorProfile);
      expect(selectedLayer.peek()).toBe(editorLayer);
    } finally {
      dispose();
    }
  });

  it('pauses during saves and resumes afterward', async () => {
    const conn = await connect();
    const getStatus = vi.spyOn(conn.client, 'getStatus');
    saveState.value = { phase: 'busy', step: 'uploading', fraction: 0 };
    await vi.advanceTimersByTimeAsync(1000);
    expect(getStatus).not.toHaveBeenCalled();
    saveState.value = { phase: 'idle' };
    await vi.advanceTimersByTimeAsync(510);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('retains the last status on failure and retries the next check', async () => {
    const conn = await connect();
    const previous = conn.status;
    const getStatus = vi.spyOn(conn.client, 'getStatus').mockRejectedValueOnce(new Error('temporary failure'));
    await vi.advanceTimersByTimeAsync(500);
    expect(conn.status).toBe(previous);
    await vi.advanceTimersByTimeAsync(510);
    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(conn.status).not.toBe(previous);
  });

  it('does not queue overlapping checks and ignores a reply after disconnect', async () => {
    const conn = await connect();
    let resolve!: (status: DeviceStatus) => void;
    const getStatus = vi.spyOn(conn.client, 'getStatus').mockImplementation(() => new Promise((done) => { resolve = done; }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(getStatus).toHaveBeenCalledTimes(1);
    const previous = conn.status;
    await disconnect();
    resolve({ ...previous, currentLayer: 3 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(connection.peek().kind).toBe('disconnected');
    expect(conn.status).toBe(previous);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('stops polling the old client and starts polling after reconnect', async () => {
    const old = await connect();
    const oldGetStatus = vi.spyOn(old.client, 'getStatus');
    await disconnect();
    const next = await connect();
    const nextGetStatus = vi.spyOn(next.client, 'getStatus');
    await vi.advanceTimersByTimeAsync(1000);
    expect(oldGetStatus).not.toHaveBeenCalled();
    expect(nextGetStatus).toHaveBeenCalledTimes(2);
  });

  it('cancels scheduled checks when the transport reports an unplug', async () => {
    let unplug!: () => void;
    vi.spyOn(SimulatedDevice.prototype, 'onDisconnect').mockImplementation((listener) => {
      unplug = listener;
      return () => undefined;
    });
    const conn = await connect();
    const getStatus = vi.spyOn(conn.client, 'getStatus');
    unplug();
    await vi.advanceTimersByTimeAsync(2000);
    expect(connection.peek().kind).toBe('disconnected');
    expect(getStatus).not.toHaveBeenCalled();
    await conn.transport.close();
  });
});
