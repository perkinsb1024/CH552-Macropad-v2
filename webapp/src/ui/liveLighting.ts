import { computed, effect, signal } from '@preact/signals';
import { liveLedColors } from '../model/liveLeds';
import { connection, liveActivity, liveClock, liveRuntime, profile, selectedLayer } from './store';

export const liveRainbowFrame = signal(0);
export type RainbowAnimation = 'always' | 'brief' | 'never';
export const rainbowAnimation = signal<RainbowAnimation>('brief');
const animationKey = 'macropad.liveView.rainbowAnimation';
const briefDuration = 2500;
const briefRestart = signal(0);
const deviceHovered = signal(false);

export function setLiveDeviceHovered(hovered: boolean): void {
  deviceHovered.value = hovered;
}

export function restartBriefRainbowAnimation(): void {
  if (rainbowAnimation.peek() === 'brief') briefRestart.value = briefRestart.peek() + 1;
}

export function setRainbowAnimation(value: RainbowAnimation): void {
  rainbowAnimation.value = value;
  try { localStorage.setItem(animationKey, value); }
  catch { /* The setting still works when storage is unavailable. */ }
}

function loadRainbowAnimation(): void {
  let saved: string | null = null;
  try { saved = localStorage.getItem(animationKey); } catch { /* Use the default. */ }
  rainbowAnimation.value = saved === 'always' || saved === 'brief' || saved === 'never' ? saved
    : window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'never' : 'brief';
}

export const liveLighting = computed(() => {
  const p = profile.value;
  if (!p) return null;
  const c = connection.value;
  const runtime = liveRuntime.value;
  const activity = liveActivity.value;
  const onDeviceLayer = c.kind === 'connected' && c.connection.status.flashValid &&
    c.connection.status.currentLayer === selectedLayer.value;
  const state = onDeviceLayer && runtime?.state.layer === selectedLayer.value ? runtime.state : null;
  return liveLedColors(p, selectedLayer.value, state, state ? activity?.sample.pressed ?? 0 : 0, liveRainbowFrame.value);
});

/** Mount only in Live View. Animation never sends commands to the device. */
export function startLiveLighting(): () => void {
  loadRainbowAnimation();
  const briefUntil = signal(0);
  const briefActive = signal(false);
  const session = computed(() => {
    const c = connection.value;
    return c.kind === 'connected' ? c.connection : null;
  });
  const generation = computed(() => liveRuntime.value?.state.generation);
  const reset = effect(() => {
    session.value; generation.value;
    liveRainbowFrame.value = 0;
  });
  let previousSession: typeof session.value;
  let previousSignature = '';
  let previousSequence: number | undefined;
  let previousRestart = briefRestart.peek();
  const changes = effect(() => {
    const connected = session.value;
    const runtime = liveRuntime.value;
    const state = runtime?.state;
    const activity = liveActivity.value;
    const p = profile.value;
    const layer = selectedLayer.value;
    const mode = rainbowAnimation.value;
    const restart = briefRestart.value;
    const sample = activity?.sample;
    // Include dispatches as well as state: selecting the same layer or issuing
    // an identical LED command must still open a new animation window.
    const actionType = sample ? sample.first & 15 : -1;
    const lightingTrigger = sample && sample.sequence !== previousSequence &&
      (actionType === 12 || actionType === 13 || sample.source === 0x89 + (p?.timedActions?.length ?? 0));
    const signature = JSON.stringify([mode, layer, state?.generation, state?.layer,
      state?.baseLayer, state?.previousLayer, state?.oneShotReturn,
      state?.rainbowPhase, state?.rainbowSpeed, state?.indicatorPolicy, state?.keyPolicy,
      state?.effect, state?.phases, state?.colorPreview,
      runtime && p ? runtime.timers.high[p.timedActions?.length ?? 0]! & 1 : 0,
      p?.layers[layer], p?.rainbowPhase, p?.rainbowSpeed, p?.transparentBlack,
      p ? liveLedColors(p, layer, state?.layer === layer ? state : null, sample?.pressed ?? 0, 0).colors : null]);
    if (connected !== previousSession || signature !== previousSignature || lightingTrigger || restart !== previousRestart) {
      briefUntil.value = performance.now() + briefDuration;
      briefActive.value = true;
    }
    previousSession = connected;
    previousSignature = signature;
    previousSequence = sample?.sequence;
    previousRestart = restart;
  });
  // A primitive keeps the animation loop running across unchanged telemetry polls.
  const cadence = computed(() => {
    const lighting = liveLighting.value;
    const activity = liveActivity.value;
    const runtime = liveRuntime.value;
    const fresh = activity && runtime && liveClock.value - activity.receivedAt <= 1000 &&
      liveClock.value - runtime.receivedAt <= 1000;
    const mode = rainbowAnimation.value;
    const enabled = mode === 'always' || mode === 'brief' && (briefActive.value || deviceHovered.value);
    return enabled && session.value && fresh && lighting?.animating ? lighting.frameMs : 0;
  });
  const animate = effect(() => {
    const interval = cadence.value;
    if (!interval) return;
    const until = rainbowAnimation.value === 'brief' && !deviceHovered.value ? briefUntil.value : Infinity;
    let previous = performance.now();
    let request = 0;
    const tick = (now: number) => {
      // Hidden tabs pause instead of accumulating an unbounded frame backlog.
      if (document.hidden) previous = now;
      const end = Math.min(now, until);
      const steps = Math.floor((end - previous) / interval);
      if (steps > 0) {
        previous += steps * interval;
        liveRainbowFrame.value = liveRainbowFrame.peek() + steps;
      }
      if (now >= until) {
        briefActive.value = false;
        return;
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  });
  return () => { animate(); changes(); reset(); deviceHovered.value = false; };
}
