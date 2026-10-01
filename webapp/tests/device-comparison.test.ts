import { afterEach, expect, it } from 'vitest';
import { cloneProfile, defaultProfile } from '../src/model/defaults';
import { profileChanges } from '../src/model/changes';
import {
  baseline, closeDialog, connectSimulator, dialog, dirty, disconnect, freshStart, profile,
} from '../src/ui/store';

afterEach(async () => {
  await disconnect();
  closeDialog();
  profile.value = null;
  baseline.value = null;
  freshStart.value = null;
});

async function connectWithEdits() {
  const edited = defaultProfile(0);
  edited.chordWindow = 0;
  profile.value = cloneProfile(edited);
  baseline.value = null;
  // The comparison must use the device even after an import/reset fresh start.
  freshStart.value = { profile: cloneProfile(edited), kind: 'imported' };
  await connectSimulator(0);
  return edited;
}

it('compares the device with the editor without changing either or resolving the prompt', async () => {
  const edited = await connectWithEdits();
  const prompt = dialog.value!;
  expect(prompt.title).toBe('Keep your unsaved edits?');
  const comparison = prompt.comparison!;
  expect(comparison.editor).toEqual(edited);
  expect(profileChanges(comparison.device, comparison.editor).map(c => c.where)).toEqual(['Chord window']);
  expect(profile.value).toEqual(edited);
  expect(baseline.value).toBeNull();
  expect(dirty.value).toBe(true);
  expect(dialog.value).toBe(prompt);
  // Snapshots remain stable even if the live editor changes.
  profile.value!.chordWindow = 1;
  expect(comparison.editor.chordWindow).toBe(0);
});

it('still keeps the editor when Keep my edits is selected', async () => {
  const edited = await connectWithEdits();
  const prompt = dialog.value!;
  const device = cloneProfile(prompt.comparison!.device);
  prompt.actions.find(a => a.label === 'Keep my edits')!.onSelect();
  expect(dialog.value).toBeNull();
  expect(profile.value).toEqual(edited);
  expect(baseline.value).toEqual(device);
  expect(dirty.value).toBe(true);
});

it('still replaces the editor and clears the fresh start when Load from device is selected', async () => {
  await connectWithEdits();
  const prompt = dialog.value!;
  const device = cloneProfile(prompt.comparison!.device);
  prompt.actions.find(a => a.label === 'Load from device')!.onSelect();
  expect(dialog.value).toBeNull();
  expect(profile.value).toEqual(device);
  expect(baseline.value).toEqual(device);
  expect(freshStart.value).toBeNull();
  expect(dirty.value).toBe(false);
});
