import { useEffect, useRef, useState } from 'preact/hooks';
import { dialog } from '../store';
import { profileChanges } from '../../model/changes';
import { ChangeList } from './ChangeList';
import { InputMonitoringHelp } from './InputMonitoringHelp';

export function Dialog() {
  const spec = dialog.value;
  const [showDifferences, setShowDifferences] = useState(false);
  const differencesLink = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const wasShowingDifferences = useRef(false);
  const helpCloseButton = useRef<HTMLButtonElement>(null);
  const dialogElement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!spec?.inputMonitoringHelp) return;
    const previousFocus = document.activeElement;
    helpCloseButton.current?.focus({ preventScroll: true });
    return () => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, [spec]);
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
      if (spec.inputMonitoringHelp && e.key === 'Tab') {
        const controls = Array.from(dialogElement.current?.querySelectorAll<HTMLElement>('summary, button') ?? [])
          .filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
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
      <div ref={dialogElement} class={`dialog${spec.textInput ? ' dialog-paste' : ''}${spec.inputMonitoringHelp ? ' dialog-permission-help' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">{spec.title}</h2>
        <p>{spec.body}</p>
        {spec.inputMonitoringHelp && <InputMonitoringHelp />}
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
            <button key={a.label} ref={spec.inputMonitoringHelp ? helpCloseButton : undefined} class={`btn ${a.tone === 'primary' ? 'btn-primary' : a.tone === 'danger' ? 'btn-danger' : ''}`} onClick={a.onSelect}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
