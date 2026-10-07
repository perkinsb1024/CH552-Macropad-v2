import { keyName } from '../../keys/keyboard';
import { actionTooltip, modifierNames, summarize } from '../../model/actions';
import { ledSummary } from '../../model/ledControl';
import { visibleText } from '../../model/strings';
import type { Action } from '../../model/types';

function NonePill() {
  return <kbd class="shortcut-pill shortcut-none">None</kbd>;
}

export function ShortcutPills({ usage, modifiers, hold = false, showTooltip = true }: { usage: number; modifiers: number; hold?: boolean; showTooltip?: boolean }) {
  return (
    <span class="shortcut-pills">
      {hold && <span class="shortcut-hold">Hold</span>}
      {!!modifiers && <span class="shortcut-modifiers">
        {modifierNames(modifiers).map((name) => <kbd key={name} class="shortcut-pill shortcut-modifier" title={showTooltip ? name : undefined}>{name}</kbd>)}
      </span>}
      {usage ? <kbd class="shortcut-pill shortcut-key" title={showTooltip ? keyName(usage) : undefined}>{keyName(usage)}</kbd> : <NonePill />}
    </span>
  );
}

export function ActionLabel({ action, showTooltip = true }: { action: Action; showTooltip?: boolean }) {
  if (action.type === 'string') return (
    <span class="text-action-preview" title={showTooltip ? actionTooltip(action) : undefined}>
      {action.text.length ? `“${visibleText(action.text)}”` : 'Empty text'}
    </span>
  );
  if (action.type === 'none') return <NonePill />;
  if (action.type === 'ledControl') return (
    <span title={showTooltip ? ledSummary(action.command, action.value, false, action.brightness) : undefined}>{ledSummary(action.command, action.value, true, action.brightness)}</span>
  );
  return action.type === 'keyTap' || action.type === 'keyHold'
    ? <ShortcutPills usage={action.usage} modifiers={action.modifiers} hold={action.type === 'keyHold'} showTooltip={showTooltip} />
    : <>{summarize(action)}</>;
}
