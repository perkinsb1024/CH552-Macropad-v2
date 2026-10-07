import type { Issue, Profile, Slot } from './types';
import { actionProblem, slotLabel } from './validate';

/** Advisory only: toggles are valid, but timers run them repeatedly. */
export function timedToggleWarnings(profile: Profile): Issue[] {
  return (profile.timedActions ?? []).flatMap((timer, index) => {
    const action = timer.action;
    if (actionProblem(action, { layerCount: profile.layers.length, rotation: false, timed: true })) return [];
    if (action.type !== 'mouseToggle' && !(action.type === 'ledControl' && action.command === 'commonPresetToggle')) return [];
    const slot: Slot = { kind: 'timed', layer: 0, index, resume: false };
    return [{
      where: slotLabel(slot),
      message: action.type === 'ledControl'
        ? 'Timers repeat. Each firing toggles between the selected brightness preset and configured brightness, so LEDs turned off by one firing can turn back on at the next. Use Set common brightness preset to keep a fixed state.'
        : 'Timers repeat. Each firing toggles the selected mouse buttons between pressed and released, so their state alternates instead of staying fixed.',
      slot,
    }];
  });
}
