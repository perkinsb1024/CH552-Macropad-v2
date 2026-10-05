import type { Profile } from '../model/types';
import { FORMAT_VERSION } from '../model/constants';
import { migrateLegacyProfile } from '../model/defaults';
import { validateProfile } from '../model/validate';
import { isPreviousLayer } from '../model/actions';
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
    const keys = [key];
    if (!localStorage.getItem(`${key}:cleared`)) {
      for (const version of [8, 7, 6, 5, 4, 3, 2]) keys.push(`universal-macropad:format-v${version}:draft:${variant ? 'three-key' : 'six-key'}`);
      keys.push(legacyDraftKey(variant));
    }
    for (const source of keys) {
      try {
        const raw = localStorage.getItem(source);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as Draft;
        if (parsed.formatVersion !== undefined && ![2, 3, 4, 5, 6, 7, 8, FORMAT_VERSION].includes(parsed.formatVersion)) continue;
        if (!parsed.profile || !Array.isArray(parsed.profile.layers) || parsed.profile.variant !== variant) continue;
        parsed.profile = migrateLegacyProfile(parsed.profile);
        const actions = [...parsed.profile.layers.flatMap((l) => [...l.keys, l.encoderButton, l.clockwise, l.counterclockwise]), ...parsed.profile.chords.map((c) => c.action),
          ...(parsed.profile.timedActions ?? []).flatMap(t => [t.action, t.resumeAction])];
        if ((parsed.formatVersion ?? 2) < 6 && actions.some((a) => a.type === 'ledControl')) continue;
        if ((parsed.formatVersion ?? 2) < 7 && (parsed.profile.timedActions?.length || actions.some(a => a.type === 'ledControl' && a.command.startsWith('effect')))) continue;
        if ((parsed.formatVersion ?? 2) < 7 && actions.some(isPreviousLayer)) continue;
        if ((parsed.formatVersion ?? 2) < 8 && actions.some(a => a.type === 'consumerHold' || (a.type === 'scroll' && a.hold))) continue;
        if ((parsed.formatVersion ?? 2) < 9 && actions.some(a => a.type === 'scroll' && a.horizontal)) continue;
        if (validateProfile(parsed.profile).length) continue;
        parsed.formatVersion = FORMAT_VERSION;
        return parsed;
      } catch { /* Try the next recoverable draft; keep every original intact. */ }
    }
    return null;
  } catch { return null; }
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
