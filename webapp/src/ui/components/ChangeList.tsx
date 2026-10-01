import type { ProfileChange } from '../../model/changes';

/** Shared comparison rows for the unsaved popup and device comparison dialog. */
export function ChangeList({ changes, note, onRevert }: {
  changes: ProfileChange[];
  note?: string;
  onRevert?: (change: ProfileChange) => void;
}) {
  return (
    <ul class="changes-list">
      {note && <li>{note}</li>}
      {changes.map((change) => (
        <li key={change.where}>
          <div class="change-heading">
            <span class="change-location">{change.where}</span>
            {change.undo && onRevert && <button
              type="button"
              class="btn btn-small btn-ghost change-undo"
              aria-label={`Revert ${change.where}`}
              onClick={() => onRevert(change)}
            >Revert</button>}
          </div>
          {(change.before !== undefined || change.after !== undefined) && (
            <span class="change-values">
              {change.before !== undefined && <span class="change-before">{change.before}</span>}
              {change.before !== undefined && change.after !== undefined && <span class="change-arrow" aria-label="changed to">→</span>}
              {change.after !== undefined && <span>{change.after}</span>}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
