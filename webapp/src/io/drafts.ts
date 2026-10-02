import type { Profile } from '../model/types';
import { FORMAT_VERSION } from '../model/constants';
import { migrateLegacyProfile } from '../model/defaults';
import { validateProfile } from '../model/validate';
import type { LocalMetadata } from './json';

const PREFIX = `universal-macropad:format-v${FORMAT_VERSION}:`;

export interface Draft {
  formatVersion: number;
  profile: Profile;
  meta: LocalMetadata;
  savedAt: string;
}

/** Drafts are keyed by variant only; VID/PID cannot distinguish individual units. */
export function draftKey(variant: 0 | 1): string {
  return `${PREFIX}draft:${variant ? 'three-key' : 'six-key'}`;
}

function legacyDraftKey(variant: 0 | 1): string {
  return `universal-macropad:draft:${variant ? 'three-key' : 'six-key'}`;
}

export function loadDraft(variant: 0 | 1): Draft | null {
  try {
    const key = draftKey(variant);
    const archived = localStorage.getItem(`${key}:cleared`) ? null
      : localStorage.getItem(`universal-macropad:format-v4:draft:${variant ? 'three-key' : 'six-key'}`)
        ?? localStorage.getItem(`universal-macropad:format-v3:draft:${variant ? 'three-key' : 'six-key'}`);
    const raw = localStorage.getItem(key) ?? archived ?? localStorage.getItem(legacyDraftKey(variant));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    if (parsed.formatVersion !== undefined && parsed.formatVersion !== 2 && parsed.formatVersion !== 3 && parsed.formatVersion !== 4 && parsed.formatVersion !== FORMAT_VERSION) return null;
    if (!parsed.profile || !Array.isArray(parsed.profile.layers) || parsed.profile.variant !== variant) return null;
    parsed.profile = migrateLegacyProfile(parsed.profile);
    if (validateProfile(parsed.profile).length) return null;
    parsed.formatVersion = FORMAT_VERSION;
    return parsed;
  } catch {
    return null;
  }
}

export function storeDraft(profile: Profile, meta: LocalMetadata): void {
  try {
    const draft: Draft = { formatVersion: FORMAT_VERSION, profile, meta, savedAt: new Date().toISOString() };
    localStorage.setItem(draftKey(profile.variant), JSON.stringify(draft));
  } catch {
    /* storage unavailable (private mode, quota) – drafts are optional */
  }
}

export function clearDraft(variant: 0 | 1): void {
  try {
    localStorage.removeItem(draftKey(variant));
    localStorage.setItem(`${draftKey(variant)}:cleared`, '1'); // Do not resurrect the archived draft.
    localStorage.removeItem(legacyDraftKey(variant));
  } catch {
    /* ignore */
  }
}
