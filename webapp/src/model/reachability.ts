import type { Action, Profile } from './types';
import { isPreviousLayer, relativeTargetLayer } from './actions';

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
    ...profile.chords.filter((chord) => chord.layer === layerIndex ||
      (chord.global && !profile.chords.some((local) => !local.global && local.layer === layerIndex &&
        local.keyA === chord.keyA && local.keyB === chord.keyB))).map((chord) => chord.action),
  ];
}

interface LayerState {
  base: number;
  previous: number;
  oneShotReturn: number;
  held: number;
  pendingTimers: number;
}

const effectiveLayer = (state: LayerState): number => state.held < 0 ? state.base : state.held;
const stateKey = (state: LayerState): string =>
  `${state.base},${state.previous},${state.oneShotReturn},${state.held},${state.pendingTimers}`;

/** Layer/history analysis, rather than treating Previous as an arbitrary return edge.
 * Timers are optional transitions: timing, consumption and simultaneous inputs are
 * deliberately not simulated. Held visits retain the underlying persistent state;
 * nested holds are approximated by allowing the newest hold or all holds to release.
 */
export function layerReachabilityWarnings(profile: Profile): ReachabilityWarning[] {
  const count = profile.layers.length;
  const startup = profile.startupLayer;
  if (!count || !Number.isInteger(startup) || startup < 0 || startup >= count) return [];

  const bindings = profile.layers.map((_, layer) => actionsOnLayer(profile, layer));
  const timers = profile.timedActions ?? [];
  const states: LayerState[] = [];
  const ids = new Map<string, number>();
  const predecessors: Set<number>[] = [];
  const add = (state: LayerState): number => {
    const key = stateKey(state);
    const existing = ids.get(key);
    if (existing !== undefined) return existing;
    const id = states.length;
    ids.set(key, id);
    states.push(state);
    predecessors.push(new Set());
    return id;
  };
  add({ base: startup, previous: startup, oneShotReturn: -1, held: -1, pendingTimers: 0 });

  const transition = (state: LayerState, action: Action, timed: boolean): LayerState | undefined => {
    // Normal input resolves its binding first, then consumes the pending one-shot.
    // Timer actions use the effective layer and leave that pending return armed.
    const selected = timed ? effectiveLayer(state) : state.base;
    const next = { ...state };
    if (!timed && next.oneShotReturn >= 0) {
      next.base = next.oneShotReturn;
      next.oneShotReturn = -1;
    }
    if (action.type === 'macro') {
      const macro = profile.macros?.[action.macro];
      if (!macro) return next;
      let running = next;
      for (let repeat = 0; repeat < Math.min(16, action.repeats); repeat++) {
        for (const step of macro.actions) {
          if (step.type === 'macro') return; // Malformed editor state: never recurse.
          const advanced = transition(running, step, true);
          if (!advanced) return;
          if (effectiveLayer(advanced) !== effectiveLayer(running)) return advanced;
          running = advanced;
        }
      }
      return running;
    }
    let target: number;
    if (action.type === 'relativeLayer' || action.type === 'oneShotRelativeLayer') {
      if (!Number.isInteger(action.offset) || action.offset < -6 || action.offset > 6) return;
      target = relativeTargetLayer(selected, action.offset, count);
    } else if (action.type === 'setLayer' || action.type === 'oneShotSetLayer' || action.type === 'momentaryLayer') {
      target = isPreviousLayer(action) ? next.previous : action.layer;
      if (!Number.isInteger(target) || target < 0 || target >= count) return;
    } else {
      return next;
    }
    if (action.type === 'momentaryLayer') {
      next.held = target;
    } else {
      if (action.type === 'oneShotSetLayer' || action.type === 'oneShotRelativeLayer') {
        next.oneShotReturn = next.base;
      } else {
        const persistent = next.oneShotReturn < 0 ? next.base : next.oneShotReturn;
        if (target !== persistent) next.previous = persistent;
      }
      next.base = target;
    }
    return next;
  };

  // Discover only states possible from the actual startup history.
  for (let id = 0; id < states.length; id++) {
    const state = states[id]!;
    const connect = (next: LayerState | undefined): void => {
      if (next) predecessors[add(next)]!.add(id);
    };
    for (const action of bindings[effectiveLayer(state)]!) connect(transition(state, action, false));
    timers.forEach((timer, index) => {
      const bit = 1 << index;
      if (timer.layer === undefined || timer.layer === effectiveLayer(state)) {
        const next = transition(state, timer.action, true);
        if (next) connect({ ...next, pendingTimers: next.pendingTimers | bit });
      }
      // Armed resume actions remain possible after leaving the assigned layer.
      if (state.pendingTimers & bit) {
        const next = transition(state, timer.resumeAction, true);
        if (next) connect({ ...next, pendingTimers: next.pendingTimers & ~bit });
      }
    });
    if (state.held >= 0) connect({ ...state, held: -1 });
  }

  // Reverse traversal finds all histories with some route back to startup.
  const canReturn = new Set<number>();
  const queue: number[] = [];
  states.forEach((state, id) => {
    if (effectiveLayer(state) === startup) { canReturn.add(id); queue.push(id); }
  });
  for (let index = 0; index < queue.length; index++) {
    for (const prior of predecessors[queue[index]!]!) {
      if (!canReturn.has(prior)) { canReturn.add(prior); queue.push(prior); }
    }
  }
  const histories = Array.from({ length: count }, () => [] as number[]);
  states.forEach((state, id) => histories[effectiveLayer(state)]!.push(id));
  const warnings: ReachabilityWarning[] = [];
  for (let layer = 0; layer < count; layer++) {
    const visits = histories[layer]!;
    if (!visits.length) {
      warnings.push({ layer, message: `${name(layer)} cannot be reached from startup ${name(startup)}.` });
    } else if (layer !== startup && visits.some(id => !canReturn.has(id))) {
      warnings.push({ layer, message: visits.every(id => !canReturn.has(id))
        ? `There is no path from ${name(layer)} back to startup ${name(startup)}.`
        : `After some layer changes, ${name(layer)} has no path back to startup ${name(startup)}. Returning depends on layer history; Previous layer remembers only one layer.` });
    }
  }
  return warnings;
}

function name(index: number): string { return `Layer ${index + 1}`; }
