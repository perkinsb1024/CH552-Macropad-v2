import { issues, selectedLayer, selectedSlot } from '../store';
import { IconWarning } from './Icons';

export function IssuesPanel() {
  const list = issues.value;
  if (!list.length) return null;
  return (
    <section class="card issues" aria-live="polite">
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
    </section>
  );
}
