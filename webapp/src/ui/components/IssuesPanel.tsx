import { issues, layerChangeWarnings, reachabilityWarnings, timerWarnings, unusedMacros } from '../store';
import { navigateToLayer, navigateToMacro, navigateToSlot } from '../navigation';
import { IconChevron, IconWarning } from './Icons';

export function IssuesPanel() {
  const list = issues.value;
  const warnings = reachabilityWarnings.value;
  const layerWarnings = layerChangeWarnings.value;
  const unused = unusedMacros.value;
  const toggles = timerWarnings.value;
  if (!list.length && !warnings.length && !layerWarnings.length && !toggles.length && !unused.length) return null;
  return (
    <>
      {list.length > 0 && <details class="card issues issues-error" aria-live="polite" open>
        <summary class="card-head">
          <h2><IconWarning /> Fix before saving</h2>
          <span class="warn">{list.length}</span>
          <IconChevron />
        </summary>
        <ul>
          {list.map((issue, i) => (
            <li key={i}>
              {issue.slot ? (
                <button class="link" onClick={() => navigateToSlot(issue.slot!)}>{issue.where}</button>
              ) : (
                <strong>{issue.where}</strong>
              )}
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      </details>}
      {unused.length > 0 && <details class="card issues reachability-warning-card" aria-live="polite">
        <summary class="card-head"><h2><IconWarning /> Macros without triggers</h2><span class="warn">{unused.length}</span><IconChevron /></summary>
        <p class="hint">These warnings do not block saving or upload.</p>
        <ul>{unused.map(index => <li key={index}>
          <button class="link" onClick={() => navigateToMacro(index)}>Macro {index + 1}</button>
          <span>No triggering action is assigned. Assign <strong>Execute macro</strong> to a key, encoder, chord, or timer to run it.</span>
        </li>)}</ul>
      </details>}
      {toggles.length > 0 && <details class="card issues reachability-warning-card" aria-live="polite">
        <summary class="card-head">
          <h2><IconWarning /> Repeating toggle actions</h2>
          <span class="warn">{toggles.length}</span>
          <IconChevron />
        </summary>
        <p class="hint">These timers alternate states each time they fire. This does not block saving or upload.</p>
        <ul>
          {toggles.map((warning, i) => (
            <li key={i}>
              <button class="link" onClick={() => navigateToSlot(warning.slot!)}>{warning.where}</button>
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      </details>}
      {layerWarnings.length > 0 && <details class="card issues reachability-warning-card" aria-live="polite">
        <summary class="card-head">
          <h2><IconWarning /> Self-referential layer changes</h2>
          <span class="warn">{layerWarnings.length}</span>
          <IconChevron />
        </summary>
        <p class="hint">These actions lead to the layer they are used on. This does not block saving or upload.</p>
        <ul>
          {layerWarnings.map((warning, i) => (
            <li key={i}>
              <button class="link" onClick={() => navigateToSlot(warning.slot!)}>{warning.where}</button>
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      </details>}
      {warnings.length > 0 && <details class="card issues reachability-warning-card" aria-live="polite">
        <summary class="card-head">
          <h2><IconWarning /> Layer reachability</h2>
          <span class="warn">{warnings.length}</span>
          <IconChevron />
        </summary>
        <p class="hint">Review how to reach these layers and return to startup. These warnings do not block upload.</p>
        <ul>
          {warnings.map((warning, i) => (
            <li key={i}>
              <button class="link" onClick={() => navigateToLayer(warning.layer)}>{`Layer ${warning.layer + 1}`}</button>
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      </details>}
    </>
  );
}
