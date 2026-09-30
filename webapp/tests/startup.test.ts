import { afterEach, expect, it, vi } from 'vitest';

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
vi.mock('preact/hooks', async (importOriginal) => ({
  ...await importOriginal<typeof import('preact/hooks')>(),
  useEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
}));

afterEach(() => { effects.length = 0; vi.unstubAllGlobals(); });

it('waits for Connect even when WebHID has previously authorized devices', async () => {
  const getDevices = vi.fn().mockResolvedValue([]);
  const requestDevice = vi.fn().mockResolvedValue([]);
  vi.stubGlobal('navigator', { hid: { getDevices, requestDevice } });
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const { App } = await import('../src/ui/App');
  const { archivedFirmware, connection, connectHid, hidSupported } = await import('../src/ui/store');
  expect(hidSupported).toBe(true);
  App();
  const cleanups = effects.map(effect => effect());
  expect(getDevices).not.toHaveBeenCalled();
  expect(requestDevice).not.toHaveBeenCalled();
  expect(connection.value.kind).toBe('disconnected');
  expect(archivedFirmware.value).toBeNull();
  await connectHid();
  expect(requestDevice).toHaveBeenCalledOnce();
  cleanups.forEach(cleanup => cleanup?.());
});
