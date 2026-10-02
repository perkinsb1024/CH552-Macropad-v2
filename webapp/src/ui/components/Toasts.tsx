import { dismissToast, toasts } from '../store';
import { useEffect, useRef } from 'preact/hooks';

export function Toasts() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>('.topbar');
    const container = ref.current;
    if (!header || !container) return;
    const updateOffset = () => container.style.setProperty('--topbar-height', `${header.offsetHeight}px`);
    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return (
    <div class="toasts" ref={ref} aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast toast-${t.tone}`} role="status">
          <span>{t.text}</span>
          <button class="toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
