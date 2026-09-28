import type { Profile } from '../model/types';
import type { LocalMetadata } from './json';

const PREFIX = 'universal-macropad:';

export interface Draft {
  profile: Profile;
  meta: LocalMetadata;
  savedAt: string;
}

/** Drafts are keyed by variant only; VID/PID cannot distinguish individual units. */
export function draftKey(variant: 0 | 1): string {
  return `${PREFIX}draft:${variant ? 'three-key' : 'six-key'}`;
}

export function loadDraft(variant: 0 | 1): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(variant));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    if (!parsed.profile || !Array.isArray(parsed.profile.layers)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeDraft(profile: Profile, meta: LocalMetadata): void {
  try {
    const draft: Draft = { profile, meta, savedAt: new Date().toISOString() };
    localStorage.setItem(draftKey(profile.variant), JSON.stringify(draft));
  } catch {
    /* storage unavailable (private mode, quota) – drafts are optional */
  }
}

export function clearDraft(variant: 0 | 1): void {
  try {
    localStorage.removeItem(draftKey(variant));
  } catch {
    /* ignore */
  }
}
