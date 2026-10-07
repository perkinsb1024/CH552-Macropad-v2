import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDraft, draftKey, loadDraft, storeDraft } from '../src/io/drafts';
import { defaultProfile } from '../src/model/defaults';

afterEach(() => vi.unstubAllGlobals());

describe('versioned drafts', () => {
  it('isolates v10 drafts from the v2 archive while recovering the old shared key', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    const legacy = defaultProfile(0);
    storage.set('universal-macropad:draft:six-key', JSON.stringify({ profile: legacy, meta: {}, savedAt: 'legacy' }));
    const archivedKey = 'universal-macropad:format-v2:draft:six-key';
    storage.set(archivedKey, 'archived draft');
    expect(loadDraft(0)?.profile).toEqual(legacy);
    expect(draftKey(0)).toBe('universal-macropad:format-v11:draft:six-key');
    const current = defaultProfile(0);
    current.transparentBlack = true;
    storeDraft(current, {});
    expect(loadDraft(0)?.profile).toEqual(current);
    clearDraft(0);
    expect(loadDraft(0)).toBeNull();
    expect(storage.get(archivedKey)).toBe('archived draft');
  });
  it('preserves current drafts and migrates version 2 or unversioned drafts', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const profile = defaultProfile(0);
    profile.transparentBlack = true;
    storeDraft(profile, { profileName: 'Test' });
    expect(loadDraft(0)?.profile).toEqual(profile);
    const draft = JSON.parse(storage.get(draftKey(0))!);
    draft.formatVersion = 2;
    delete draft.profile.transparentBlack;
    delete draft.profile.rainbowSpeed;
    draft.profile.layers[0].indicatorBehavior = 1;
    draft.profile.layers[0].invertScroll = true;
    draft.profile.layers[0].keys[0] = { type: 'nextLayer' };
    storage.set(draftKey(0), JSON.stringify(draft));
    const migrated = loadDraft(0)!;
    expect(migrated.formatVersion).toBe(11);
    expect(migrated.profile.transparentBlack).toBe(false);
    expect(migrated.profile.layers[0]!.indicatorBehavior).toBe(1);
    expect(migrated.profile.layers[0]!.clockwise).toEqual({ type: 'scroll', delta: 2 });
    expect(migrated.profile.layers[0]!.keys[0]).toEqual({ type: 'relativeLayer', offset: 0 });
    expect(loadDraft(0)).toEqual(migrated); // Migration does not invert twice on reload.
    delete draft.formatVersion;
    storage.set(draftKey(0), JSON.stringify(draft));
    expect(loadDraft(0)).toEqual(migrated);
    draft.formatVersion = 12;
    storage.set(draftKey(0), JSON.stringify(draft));
    expect(loadDraft(0)).toBeNull();
  });
});

it('recovers a complete v7 draft with timers, text and annotations without rewriting it', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const p = defaultProfile(0);
  p.layers[0]!.keys[0] = { type: 'string', text: 'Work\n' };
  p.timedActions = [{ ticks: 64, resetOnInput: true, consumeInput: true,
    action: { type: 'string', text: 'Work\n' }, resumeAction: { type: 'consumer', usage: 0xfff } }];
  const meta = { profileName: 'Work', layerNames: ['Tools', 'Media'] };
  const key = 'universal-macropad:format-v7:draft:six-key';
  const raw = JSON.stringify({ formatVersion: 7, profile: p, meta, savedAt: 'old' });
  storage.set(key, raw);
  p.timedActions![0]!.ticks = 2048;
  expect(loadDraft(0)).toEqual({ formatVersion: 11, profile: p, meta, savedAt: 'old' });
  expect(storage.get(key)).toBe(raw);
  expect(storage.has(draftKey(0))).toBe(false);
});

it.each([3, 4, 5, 6, 7, 8, 9])('recovers v%s drafts without clearing them or resurrecting them after clearing v10', (version) => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const archivedKey = `universal-macropad:format-v${version}:draft:three-key`;
  const old = defaultProfile(1);
  old.startupLayer = 1;
  const legacy = { ...old } as Partial<typeof old>;
  delete legacy.rainbowPhase;
  delete legacy.rainbowSpeed;
  const archived = JSON.stringify({ formatVersion: version, profile: legacy, meta: {}, savedAt: 'v3' });
  storage.set(archivedKey, archived);
  expect(loadDraft(1)?.profile).toEqual(old);
  expect(loadDraft(1)?.formatVersion).toBe(11);
  clearDraft(1);
  expect(storage.get(archivedKey)).toBe(archived);
  expect(loadDraft(1)).toBeNull();
  storeDraft(old, {});
  expect(loadDraft(1)?.profile).toEqual(old);
});

it.each([7, 8])('recovers version %s double-click drafts in keys, chords and both timer slots', formatVersion => {
  const raw = JSON.parse(JSON.stringify(defaultProfile(0)));
  const legacy = { type: 'mouseDouble', buttons: 5 };
  raw.layers[0].keys[0] = legacy;
  raw.layers[0].encoderButton = legacy;
  raw.layers[0].clockwise = legacy;
  raw.layers[0].counterclockwise = legacy;
  raw.chords = [{ layer: 0, keyA: 0, keyB: 1, action: legacy }];
  raw.timedActions = [{ ticks: 1, resetOnInput: true, consumeInput: false, action: legacy, resumeAction: legacy }];
  const original = JSON.stringify({ formatVersion, profile: raw, meta: { profileName: 'Clicks' }, savedAt: 'old' });
  const key = `universal-macropad:format-v${formatVersion}:draft:six-key`;
  const storage = new Map([[key, original]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null });
  const draft = loadDraft(0)!;
  expect(draft.meta.profileName).toBe('Clicks');
  const layer = draft.profile.layers[0]!;
  for (const action of [layer.keys[0], layer.encoderButton, layer.clockwise, layer.counterclockwise, draft.profile.chords[0]!.action, draft.profile.timedActions![0]!.action, draft.profile.timedActions![0]!.resumeAction]) {
    expect(action).toEqual({ type: 'mouseClick', buttons: 5, clicks: 2 });
  }
  expect(storage.get(key)).toBe(original);
});
