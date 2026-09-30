import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftKey, loadDraft, storeDraft } from '../src/io/drafts';
import { defaultProfile } from '../src/model/defaults';

afterEach(() => vi.unstubAllGlobals());

describe('versioned drafts', () => {
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
    draft.profile.layers[0].indicatorBehavior = 1;
    draft.profile.layers[0].invertScroll = true;
    draft.profile.layers[0].keys[0] = { type: 'nextLayer' };
    storage.set(draftKey(0), JSON.stringify(draft));
    const migrated = loadDraft(0)!;
    expect(migrated.formatVersion).toBe(3);
    expect(migrated.profile.transparentBlack).toBe(false);
    expect(migrated.profile.layers[0]!.indicatorBehavior).toBe(1);
    expect(migrated.profile.layers[0]!.clockwise).toEqual({ type: 'scroll', delta: 2 });
    expect(migrated.profile.layers[0]!.keys[0]).toEqual({ type: 'relativeLayer', offset: 0 });
    expect(loadDraft(0)).toEqual(migrated); // Migration does not invert twice on reload.
    delete draft.formatVersion;
    storage.set(draftKey(0), JSON.stringify(draft));
    expect(loadDraft(0)).toEqual(migrated);
    draft.formatVersion = 4;
    storage.set(draftKey(0), JSON.stringify(draft));
    expect(loadDraft(0)).toBeNull();
  });
});
