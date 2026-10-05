import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KeyPicker } from '../src/ui/components/KeyPicker';

// Simulate modifier-driven editor rerenders with a fresh onChange callback.
const hooks = vi.hoisted(() => ({
  capturing: true,
  ref: undefined as undefined | { current: unknown },
  deps: undefined as undefined | unknown[],
  cleanup: undefined as undefined | (() => void),
}));
vi.mock('preact/hooks', () => ({
  useState: () => [hooks.capturing, (value: boolean) => { hooks.capturing = value; }],
  useRef: (value: unknown) => hooks.ref ??= { current: value },
  useLayoutEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    if (hooks.deps && deps.every((value, index) => value === hooks.deps![index])) return;
    hooks.cleanup?.();
    hooks.deps = deps;
    hooks.cleanup = effect() || undefined;
  },
}));
let listeners: Map<string, (event: KeyboardEvent) => void>;
let registrations: string[];
beforeEach(() => {
  hooks.capturing = true;
  hooks.ref = undefined;
  hooks.deps = undefined;
  hooks.cleanup = undefined;
  listeners = new Map();
  registrations = [];
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
      registrations.push(type);
      listeners.set(type, listener);
    },
    removeEventListener: (type: string) => listeners.delete(type),
  });
});
afterEach(() => { hooks.cleanup?.(); vi.unstubAllGlobals(); });
function press(code: string, modifiers: Partial<KeyboardEvent> = {}) {
  listeners.get('keydown')!({
    code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    preventDefault: vi.fn(), stopPropagation: vi.fn(), ...modifiers,
  } as unknown as KeyboardEvent);
}
function render(onChange = vi.fn()) {
  KeyPicker({ usage: 4, modifiers: 0, onChange });
  return onChange;
}
it.each([
  { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, mask: 3 },
  { ctrlKey: false, shiftKey: false, altKey: true, metaKey: true, mask: 12 },
  { ctrlKey: true, shiftKey: true, altKey: true, metaKey: true, mask: 15 },
])('keeps capturing across modifier-driven rerenders ($mask)', ({ mask, ...mods }) => {
  let change = render();
  for (const [flag, code] of [
    ['ctrlKey', 'ControlLeft'], ['shiftKey', 'ShiftLeft'], ['altKey', 'AltLeft'], ['metaKey', 'MetaLeft'],
  ] as const) {
    if (!mods[flag]) continue;
    press(code, mods);
    expect(change).toHaveBeenLastCalledWith(0, mask);
    change = render();
  }
  expect(registrations.filter(type => type === 'keydown')).toHaveLength(1);
  press('KeyD', mods);
  expect(change).toHaveBeenLastCalledWith(7, mask);
  expect(hooks.capturing).toBe(false);
  render();
  expect(listeners.size).toBe(0);
});
it('keeps listening after an unsupported event', () => {
  const change = render();
  press('Unidentified', { altKey: true, metaKey: true });
  expect(hooks.capturing).toBe(true);
  expect(change).not.toHaveBeenCalled();
  press('Space', { altKey: true, metaKey: true });
  expect(change).toHaveBeenLastCalledWith(44, 12);
});
it('ends capture on window blur', () => {
  render();
  listeners.get('blur')!({} as KeyboardEvent);
  expect(hooks.capturing).toBe(false);
  render();
  expect(listeners.size).toBe(0);
});
