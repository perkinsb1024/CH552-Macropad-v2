import { keyName } from '../../keys/keyboard';
import { modifierNames, summarize } from '../../model/actions';
import { ledSummary } from '../../model/ledControl';
import type { Action } from '../../model/types';

function NonePill() {
  return <kbd class="shortcut-pill shortcut-none">None</kbd>;
}

export function ShortcutPills({ usage, modifiers, hold = false }: { usage: number; modifiers: number; hold?: boolean }) {
  return (
    <span class="shortcut-pills">
      {hold && <span class="shortcut-hold">Hold</span>}
      {!!modifiers && <span class="shortcut-modifiers">
        {modifierNames(modifiers).map((name) => <kbd key={name} class="shortcut-pill shortcut-modifier" title={name}>{name}</kbd>)}
      </span>}
      {usage ? <kbd class="shortcut-pill shortcut-key" title={keyName(usage)}>{keyName(usage)}</kbd> : <NonePill />}
    </span>
  );
}

export function ActionLabel({ action }: { action: Action }) {
  if (action.type === 'none') return <NonePill />;
  if (action.type === 'ledControl') return (
    <span title={ledSummary(action.command, action.value, false, action.brightness)}>{ledSummary(action.command, action.value, true, action.brightness)}</span>
  );
  return action.type === 'keyTap' || action.type === 'keyHold'
    ? <ShortcutPills usage={action.usage} modifiers={action.modifiers} hold={action.type === 'keyHold'} />
    : <>{summarize(action)}</>;
}
