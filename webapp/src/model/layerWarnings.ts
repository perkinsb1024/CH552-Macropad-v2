import { relativeTargetLayer } from './actions';
import type { Action, Issue, Profile, Slot } from './types';
import { actionProblem, slotLabel } from './validate';

/** Advisory only: self-referential bindings remain valid and encodable. */
export function selfReferentialLayerWarnings(profile: Profile): Issue[] {
  const warnings: Issue[] = [];
  const layerCount = profile.layers.length;
  const check = (action: Action, slot: Slot, source = slot.layer, rotation = false) => {
    if (actionProblem(action, { layerCount, rotation })) return;
    let target: number;
    switch (action.type) {
      case 'setLayer':
      case 'oneShotSetLayer':
      case 'momentaryLayer':
        target = action.layer;
        break;
      case 'relativeLayer':
      case 'oneShotRelativeLayer':
        target = relativeTargetLayer(source, action.offset, layerCount);
        break;
      default:
        return;
    }
    if (target === source) {
      warnings.push({
        where: slotLabel(slot),
        message: `This action leads back to Layer ${source + 1}, so it does not change layers.`,
        slot,
      });
    }
  };

  profile.layers.forEach((layer, li) => {
    layer.keys.forEach((action, index) => check(action, { kind: 'key', layer: li, index }));
    check(layer.encoderButton, { kind: 'encoderButton', layer: li });
    check(layer.clockwise, { kind: 'clockwise', layer: li }, li, true);
    check(layer.counterclockwise, { kind: 'counterclockwise', layer: li }, li, true);
  });
  for (const chord of profile.chords) {
    if (!Number.isInteger(chord.layer) || chord.layer < 0 || chord.layer >= layerCount) continue;
    const slot: Slot = { kind: 'chord', layer: chord.layer, keyA: chord.keyA, keyB: chord.keyB };
    if (!chord.global) {
      check(chord.action, slot);
      continue;
    }
    // Global chords run on every layer unless a local chord overrides the pair.
    for (let source = 0; source < layerCount; source++) {
      if (profile.chords.some((local) => !local.global && local.layer === source &&
        local.keyA === chord.keyA && local.keyB === chord.keyB)) continue;
      check(chord.action, slot, source);
    }
  }
  return warnings;
}
