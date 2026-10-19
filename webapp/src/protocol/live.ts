import type { FastLiveState, RuntimeState, TimerState } from './packet';
export type TriggerKind = 'tap' | 'hold' | 'unknown';
export type TriggerClassifier = (sample: FastLiveState | null, input: number) => TriggerKind;

export const counterDelta = (next: number, before: number) => (next - before) & 255;
export function sourceKeys(source: number): number[] {
  if (source & 128) return [];
  const keys = [source & 15];
  const partner = source >> 4;
  if (partner) keys.push(partner - 1);
  return keys;
}
export interface LiveActivity {
  sample: FastLiveState;
  receivedAt: number;
  hotUntil: number[];
  turns: number[];
  turnUntil: number[];
  latest: FastLiveState | null;
  latestAt: number;
  bindingDelta: number;
  triggerKinds?: TriggerKind[];
  latestGesture?: TriggerKind;
}
/** Establish a fresh baseline after a long gap; do not replay old activity. */
export function advanceActivity(previous: LiveActivity | null, sample: FastLiveState, now: number, classify: TriggerClassifier = () => 'tap'): LiveActivity {
  if (!previous || now - previous.receivedAt > 1000) return {
    sample, receivedAt: now, hotUntil: Array(9).fill(0), triggerKinds: Array(9).fill('unknown'), turns: [0, 0], turnUntil: [0, 0], latest: null, latestAt: 0, bindingDelta: 0,
  };
  const hotUntil = [...previous.hotUntil];
  const triggerKinds = [...(previous.triggerKinds ?? Array(9).fill('tap'))];
  sample.bindings.forEach((count, i) => {
    if (counterDelta(count, previous.sample.bindings[i]!)) { hotUntil[i] = now + 180; triggerKinds[i] = classify(null, i); }
  });
  const delta = counterDelta(sample.sequence, previous.sample.sequence);
  const latestInputs = sample.source === 0x87 ? [7] : sample.source === 0x88 ? [8] : sourceKeys(sample.source);
  if (delta) for (const key of latestInputs) { hotUntil[key] = now + 180; triggerKinds[key] = classify(sample, key); }
  const turnDeltas = [counterDelta(sample.clockwise, previous.sample.clockwise), counterDelta(sample.counterclockwise, previous.sample.counterclockwise)];
  const turns = turnDeltas.map((count, i) => count + (previous.turnUntil[i]! > now ? previous.turns[i]! : 0));
  const turnUntil = [...previous.turnUntil];
  turnDeltas.forEach((count, i) => { if (count) turnUntil[i] = now + 180; });
  return { sample, receivedAt: now, hotUntil, triggerKinds, turns, turnUntil,
    latestGesture: delta ? classify(sample, latestInputs[0] ?? -1) : previous.latestGesture,
    latest: delta ? sample : previous.latest, latestAt: delta ? now : previous.latestAt,
    bindingDelta: delta || previous.bindingDelta };
}
export interface LiveRuntime { state: RuntimeState; timers: TimerState; receivedAt: number; timersReceivedAt: number }
export function timerRemaining(state: TimerState, slot: number, intervalTicks: number): number {
  const ticks = state.age[slot]! + ((state.high[slot]! & 56) << 5) + state.fraction[slot]! / 256;
  return Math.max(0, (intervalTicks - ticks) * 4.096);
}
