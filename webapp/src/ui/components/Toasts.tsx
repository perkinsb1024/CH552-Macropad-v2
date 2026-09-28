import { dismissToast, toasts } from '../store';

export function Toasts() {
  return (
    <div class="toasts" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast toast-${t.tone}`} role="status">
          <span>{t.text}</span>
          <button class="toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
