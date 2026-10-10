import { expect, it, vi } from 'vitest';
import { installDragAutoScroll } from '../src/ui/dragAutoScroll';

function setup() {
  const listeners = new Map<string, EventListener>();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const view = {
    innerHeight: 800, innerWidth: 1200, scrollBy: vi.fn(),
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    addEventListener: vi.fn((name: string, listener: EventListener) => listeners.set(name, listener)),
    removeEventListener: vi.fn((name: string) => listeners.delete(name)),
  };
  const cleanup = installDragAutoScroll(view as unknown as Window);
  const dispatch = (type: string, clientY = 400, clientX = 600) => listeners.get(type)!({ clientY, clientX } as unknown as Event);
  const advance = (time: number) => {
    const entry = frames.entries().next().value!;
    frames.delete(entry[0]);
    entry[1](time);
  };
  return { view, frames, listeners, cleanup, dispatch, advance };
}

it('scrolls up and down continuously with speed increasing toward the edge', () => {
  const { view, dispatch, advance } = setup();
  dispatch('dragover', 60); advance(0);
  const nearEdge = view.scrollBy.mock.calls.at(-1)![0].top;
  expect(nearEdge).toBeLessThan(0);
  dispatch('dragover', 5); advance(16);
  expect(view.scrollBy.mock.calls.at(-1)![0].top).toBeLessThan(nearEdge);
  dispatch('dragover', 790); advance(32);
  expect(view.scrollBy.mock.calls.at(-1)![0].top).toBeGreaterThan(0);
  advance(48); // No pointer movement is needed to continue scrolling.
  expect(view.scrollBy).toHaveBeenCalledTimes(4);
  expect(view.addEventListener).toHaveBeenCalledWith('dragover', expect.any(Function), true);
});

it.each(['drop', 'dragend', 'blur'])('stops immediately on %s', type => {
  const { dispatch, advance, frames } = setup();
  dispatch('dragover', 790); advance(0);
  expect(frames.size).toBe(1);
  dispatch(type);
  expect(frames.size).toBe(0);
});

it('stops in the center and outside the viewport, but ignores transitions between children', () => {
  const { dispatch, frames } = setup();
  dispatch('dragover', 790);
  dispatch('dragleave', 790); expect(frames.size).toBe(1);
  dispatch('dragover', 400); expect(frames.size).toBe(0);
  dispatch('dragover', 5);
  dispatch('dragleave', 0); expect(frames.size).toBe(0);
});

it('caps delayed frames and removes listeners and pending animation on cleanup', () => {
  const { view, dispatch, advance, cleanup, frames, listeners } = setup();
  dispatch('dragover', 790); advance(0); advance(1000);
  expect(view.scrollBy.mock.calls.at(-1)![0].top).toBeLessThanOrEqual(50);
  cleanup();
  expect(frames.size).toBe(0);
  expect(listeners.size).toBe(0);
});
