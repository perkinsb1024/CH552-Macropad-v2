import type { Action, Profile } from './types';
import { relativeTargetLayer } from './actions';

export interface ReachabilityWarning {
  layer: number;
  message: string;
}

function actionsOnLayer(profile: Profile, layerIndex: number): Action[] {
  const layer = profile.layers[layerIndex]!;
  return [
    ...layer.keys,
    layer.encoderButton,
    layer.clockwise,
    layer.counterclockwise,
    ...profile.chords.filter((chord) => chord.layer === layerIndex).map((chord) => chord.action),
  ];
}

/** Warns about layers that cannot be entered from startup or cannot return to it. */
export function layerReachabilityWarnings(profile: Profile): ReachabilityWarning[] {
  const count = profile.layers.length;
  const startup = profile.startupLayer;
  if (!count || !Number.isInteger(startup) || startup < 0 || startup >= count) return [];

  const edges = Array.from({ length: count }, () => new Set<number>());
  for (let source = 0; source < count; source++) {
    for (const action of actionsOnLayer(profile, source)) {
      if (action.type === 'setLayer' && Number.isInteger(action.layer) && action.layer >= 0 && action.layer < count) {
        edges[source]!.add(action.layer);
      } else if (action.type === 'momentaryLayer' && Number.isInteger(action.layer) && action.layer >= 0 && action.layer < count) {
        edges[source]!.add(action.layer);
        edges[action.layer]!.add(source); // Releasing the momentary input returns to the prior layer.
      } else if (action.type === 'relativeLayer' && Number.isInteger(action.offset) && action.offset >= -3 && action.offset <= 3) {
        edges[source]!.add(relativeTargetLayer(source, action.offset, count));
      }
    }
  }

  const reachableFrom = (from: number): Set<number> => {
    const reached = new Set<number>([from]);
    const queue = [from];
    while (queue.length) {
      const current = queue.shift()!;
      for (const next of edges[current]!) {
        if (reached.has(next)) continue;
        reached.add(next);
        queue.push(next);
      }
    }
    return reached;
  };

  const reachable = reachableFrom(startup);
  const warnings: ReachabilityWarning[] = [];
  for (let layer = 0; layer < count; layer++) {
    if (!reachable.has(layer)) {
      warnings.push({ layer, message: `${name(layer)} cannot be reached from startup ${name(startup)}.` });
    } else if (layer !== startup && !reachableFrom(layer).has(startup)) {
      warnings.push({ layer, message: `There is no path from ${name(layer)} back to startup ${name(startup)}.` });
    }
  }
  return warnings;
}

function name(index: number): string { return `Layer ${index + 1}`; }
