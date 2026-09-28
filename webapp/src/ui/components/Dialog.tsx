import { useEffect } from 'preact/hooks';
import { dialog } from '../store';

export function Dialog() {
  const spec = dialog.value;
  useEffect(() => {
    if (!spec) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') spec.actions.find((a) => a.tone === 'neutral')?.onSelect();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spec]);
  if (!spec) return null;
  return (
    <div class="scrim" role="presentation">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">{spec.title}</h2>
        <p>{spec.body}</p>
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
