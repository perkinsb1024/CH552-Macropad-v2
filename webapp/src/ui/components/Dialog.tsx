import { useEffect, useRef, useState } from 'preact/hooks';
import { dialog } from '../store';
import { profileChanges } from '../../model/changes';
import { ChangeList } from './ChangeList';

export function Dialog() {
  const spec = dialog.value;
  const [showDifferences, setShowDifferences] = useState(false);
  const differencesLink = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const wasShowingDifferences = useRef(false);
  useEffect(() => { setShowDifferences(false); }, [spec]);
  useEffect(() => {
    if (showDifferences) backButton.current?.focus();
    else if (wasShowingDifferences.current) differencesLink.current?.focus();
    wasShowingDifferences.current = showDifferences;
  }, [showDifferences]);
  useEffect(() => {
    if (!spec) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDifferences) setShowDifferences(false);
        else spec.actions.find((a) => a.tone === 'neutral')?.onSelect();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spec, showDifferences]);
  if (!spec) return null;
  if (showDifferences && spec.comparison) {
    const changes = profileChanges(spec.comparison.device, spec.comparison.editor);
    const editorLabel = spec.comparison.editorLabel ?? 'Editor';
    return (
      <div class="scrim" role="presentation">
        <div class="dialog dialog-comparison" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          <h2 id="dialog-title">Profile differences</h2>
          <p>Device → {editorLabel}. {changes.length} {changes.length === 1 ? 'difference' : 'differences'}.</p>
          <div class="dialog-comparison-content" tabIndex={0} aria-label="Profile differences">
            <ChangeList changes={changes} note={changes.length === 0 ? 'The profiles have identical device settings.' : undefined} />
          </div>
          <div class="dialog-actions">
            <button ref={backButton} class="btn" onClick={() => setShowDifferences(false)}>Back</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div class="scrim" role="presentation">
      <div class={`dialog${spec.textInput ? ' dialog-paste' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">{spec.title}</h2>
        <p>{spec.body}</p>
        {spec.comparison && <button ref={differencesLink} type="button" class="dialog-differences-link" onClick={() => setShowDifferences(true)}>Show differences</button>}
        {spec.textInput && (
          <>
            <label for="dialog-profile-json">{spec.textInput.label}</label>
            <textarea
              key={spec.title}
              id="dialog-profile-json"
              class="dialog-json"
              rows={12}
              placeholder={spec.textInput.placeholder}
              spellcheck={false}
              autoFocus
              onInput={(e) => spec.textInput?.onInput(e.currentTarget.value)}
            />
          </>
        )}
        <div class="dialog-actions">
          {spec.actions.map((a) => (
            <button key={a.label} class={`btn ${a.tone === 'primary' ? 'btn-primary' : a.tone === 'danger' ? 'btn-danger' : ''}`} onClick={a.onSelect}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
