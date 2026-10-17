import { connection, dismissToast, liveActivity, liveClock, liveRuntime, profile, toasts, viewerMode } from '../store';

export function liveTelemetryWarning(): string | null {
  if (!viewerMode.value || !profile.value) return null;
  const c = connection.value;
  if (c.kind !== 'connected') return 'Device disconnected. Live updates are unavailable; showing saved layer colors.';
  if (!c.connection.status.live || !c.connection.status.flashValid) return null;
  const activity = liveActivity.value;
  const runtime = liveRuntime.value;
  if (!activity || !runtime || liveClock.value - activity.receivedAt > 1000 || liveClock.value - runtime.receivedAt > 1000) {
    return 'Live updates are paused. LED colors may be out of date. Return to this tab or reconnect your macropad.';
  }
  return null;
}

export function Toasts() {
  const warning = liveTelemetryWarning();
  return (
    <div class="toasts" aria-live="polite">
      {warning && <div class="toast toast-error" role="status"><span>{warning}</span></div>}
      {toasts.value.slice().reverse().map((t) => (
        <div key={t.id} class={`toast toast-${t.tone}`} role="status">
          <span>{t.text}{t.link && <> <a href={t.link.href} target="_blank" rel="noreferrer">{t.link.label}</a></>}</span>
          <button class="toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
