import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let store: typeof import('../src/ui/store');

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.stubGlobal('navigator', { hid: {}, platform: 'MacIntel' });
  store = await import('../src/ui/store');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('Input Monitoring help', () => {
  it('opens help on every failed device-open attempt on macOS and preserves the error toast', async () => {
    // Import the transport from the same module registry as the store.
    const { WebHidTransport } = await import('../src/protocol/transport');
    vi.spyOn(WebHidTransport, 'request').mockRejectedValue(new DOMException('Failed to open the device.', 'NotAllowedError'));
    for (let attempt = 0; attempt < 2; attempt++) {
      await store.connectHid();
      expect(store.dialog.value?.inputMonitoringHelp).toBe(true);
      expect(store.toasts.value.at(-1)?.text).toBe('Device selection failed: Failed to open the device.');
      store.closeDialog();
    }
  });

  it.each(['Win32', 'Linux x86_64', ''])('keeps the error toast without opening macOS help on platform %s', async (platform) => {
    vi.stubGlobal('navigator', { hid: {}, platform });
    const { WebHidTransport } = await import('../src/protocol/transport');
    vi.spyOn(WebHidTransport, 'request').mockRejectedValue(new DOMException('Failed to open the device.', 'NotAllowedError'));
    await store.connectHid();
    expect(store.dialog.value).toBeNull();
    expect(store.toasts.value.at(-1)?.text).toBe('Device selection failed: Failed to open the device.');
  });

  it('does not open permission help for other errors or chooser cancellation', async () => {
    const { WebHidTransport } = await import('../src/protocol/transport');
    const request = vi.spyOn(WebHidTransport, 'request').mockRejectedValue(new Error('Device disconnected'));
    await store.connectHid();
    expect(store.dialog.value).toBeNull();
    request.mockResolvedValue(null);
    await store.connectHid();
    expect(store.dialog.value).toBeNull();
  });

  it('can open and close help without connecting a device', () => {
    store.showInputMonitoringHelp();
    expect(store.dialog.value?.inputMonitoringHelp).toBe(true);
    store.dialog.value!.actions[0]!.onSelect();
    expect(store.dialog.value).toBeNull();
    expect(store.connection.value.kind).toBe('disconnected');
  });
});
