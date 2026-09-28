import { issues, reachabilityWarnings, selectedLayer, selectedSlot } from '../store';
import { IconWarning } from './Icons';

export function IssuesPanel() {
  const list = issues.value;
  const warnings = reachabilityWarnings.value;
  if (!list.length && !warnings.length) return null;
  return (
    <>
      {list.length > 0 && <section class="card issues issues-error" aria-live="polite">
        <header class="card-head">
          <h2><IconWarning /> Fix before saving</h2>
          <span class="warn">{list.length}</span>
        </header>
        <ul>
          {list.map((issue, i) => (
            <li key={i}>
              {issue.slot ? (
                <button class="link" onClick={() => { selectedLayer.value = issue.slot!.layer; selectedSlot.value = issue.slot!; }}>{issue.where}</button>
              ) : (
                <strong>{issue.where}</strong>
              )}
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      </section>}
      {warnings.length > 0 && <section class="card issues reachability-warning-card" aria-live="polite">
        <header class="card-head">
          <h2><IconWarning /> Layer reachability</h2>
          <span class="warn">{warnings.length}</span>
        </header>
        <p class="hint">Review how to reach these layers and return to startup. These warnings do not block upload.</p>
        <ul>
          {warnings.map((warning, i) => (
            <li key={i}>
              <button class="link" onClick={() => { selectedLayer.value = warning.layer; selectedSlot.value = null; }}>{`Layer ${warning.layer + 1}`}</button>
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      </section>}
    </>
  );
}
