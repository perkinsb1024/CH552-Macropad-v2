import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultProfile, emptyLayer } from '../src/model/defaults';
import { storeDraft } from '../src/io/drafts';
import { exportProfile } from '../src/io/json';
import { encodeProfile } from '../src/codec/encode';
import {
  baseline, closeDialog, connection, connectSimulator, dialog, disconnect,
  freshStart, importJsonFile, loadFromDevice, profile, selectedLayer,
  selectedSlot, startOffline,
} from '../src/ui/store';

function startupProfile(layer: number) {
  const p = defaultProfile(0);
  while (p.layers.length <= layer) p.layers.push(emptyLayer(0));
  p.startupLayer = layer;
  return p;
}

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  profile.value = null;
  baseline.value = null;
  selectedLayer.value = 0;
});

afterEach(async () => {
  await disconnect();
  closeDialog();
  profile.value = null;
  baseline.value = null;
  freshStart.value = null;
  vi.unstubAllGlobals();
});

it('selects the startup layer when restoring an offline draft', () => {
  const p = startupProfile(2);
  storeDraft(p, {});
  startOffline(0);
  expect(selectedLayer.value).toBe(2);
  expect(selectedSlot.value).toBeNull();
});

it('selects the startup layer after importing a profile', async () => {
  const p = startupProfile(3);
  await importJsonFile({ name: 'startup.json', text: async () => exportProfile(p) } as File);
  expect(selectedLayer.value).toBe(3);
});

it('selects the saved startup layer on device reads instead of preserving the editor selection', async () => {
  await connectSimulator(0);
  const c = connection.value;
  if (c.kind !== 'connected') throw new Error('not connected');
  const p = startupProfile(2);
  await c.connection.client.saveImage(encodeProfile(p));
  selectedLayer.value = 1;
  await loadFromDevice();
  expect(selectedLayer.value).toBe(2);
});

it('selects the draft startup layer when choosing a draft on connection', async () => {
  const p = startupProfile(3);
  storeDraft(p, {});
  await connectSimulator(0);
  expect(dialog.value?.title).toBe('Restore your draft?');
  dialog.value!.actions.find(a => a.label === 'Use the draft')!.onSelect();
  expect(selectedLayer.value).toBe(3);
  expect(selectedSlot.value).toBeNull();
});
