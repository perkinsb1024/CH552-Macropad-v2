import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cloneProfile, defaultProfile } from '../src/model/defaults';
import { profileChanges } from '../src/model/changes';
import { exportProfile } from '../src/io/json';
import {
  baseline, changesBaseline, closeDialog, connection, dialog, dirty, freshStart,
  importJsonFile, profile, redo, resetToDefaults, undo, updateProfile,
} from '../src/ui/store';

beforeEach(() => {
  vi.useFakeTimers();
  connection.value = { kind: 'disconnected' };
  freshStart.value = null;
  const saved = defaultProfile(0);
  saved.layers[0]!.keys[0] = { type: 'none' };
  baseline.value = cloneProfile(saved);
  profile.value = cloneProfile(saved);
});

afterEach(() => {
  closeDialog();
  freshStart.value = null;
  profile.value = null;
  baseline.value = null;
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('starts a fresh comparison after reset while keeping the device save reminder', () => {
  const saved = cloneProfile(baseline.value!);
  resetToDefaults();
  dialog.value!.actions.find(a => a.label === 'Reset editor')!.onSelect();
  expect(freshStart.value?.kind).toBe('starter');
  expect(profileChanges(changesBaseline.value, profile.value!)).toEqual([]);
  expect(baseline.value).toEqual(saved);
  expect(dirty.value).toBe(true);

  updateProfile(draft => { draft.chordWindow = 0; });
  expect(profileChanges(changesBaseline.value, profile.value!).map(c => c.where)).toEqual(['Chord window']);
  undo();
  expect(profileChanges(changesBaseline.value, profile.value!)).toEqual([]);
  undo();
  expect(freshStart.value).toBeNull();
  expect(dirty.value).toBe(false);
  redo();
  expect(freshStart.value?.kind).toBe('starter');
  expect(dirty.value).toBe(true);
});

it('starts a fresh comparison after import and can undo the import', async () => {
  const saved = cloneProfile(baseline.value!);
  const imported = defaultProfile(0);
  imported.chordWindow = 0;
  await importJsonFile({ name: 'example.json', text: async () => exportProfile(imported) } as File);
  expect(freshStart.value?.kind).toBe('imported');
  expect(profileChanges(changesBaseline.value, profile.value!)).toEqual([]);
  expect(baseline.value).toEqual(saved);
  expect(dirty.value).toBe(true);
  updateProfile(draft => { draft.layers[0]!.keys[0] = { type: 'none' }; });
  expect(profileChanges(changesBaseline.value, profile.value!).map(c => c.where)).toEqual(['Layer 1 · Key 1']);
  undo();
  undo();
  expect(freshStart.value).toBeNull();
  expect(profile.value).toEqual(saved);
  redo();
  expect(freshStart.value?.kind).toBe('imported');
  expect(profileChanges(changesBaseline.value, profile.value!)).toEqual([]);
});
