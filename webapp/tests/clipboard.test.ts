import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultProfile } from '../src/model/defaults';
import { VARIANT_SIX_KEYS } from '../src/model/constants';
import { dialog, profile, selectedSlot } from '../src/ui/store';
import { App } from '../src/ui/App';

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
vi.mock('preact/hooks', async (importOriginal) => ({
  ...await importOriginal<typeof import('preact/hooks')>(),
  useEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
}));

// Model the DOM targets used by the handlers in the Node test environment.
class Target {
  isConnected = true;
  isContentEditable = false;
  constructor(public action = false, public parent: Target | null = null, public editing = false) {}
  closest(selector: string): Target | null {
    const matches = selector === '[data-clipboard-target]' ? this.action : this.editing;
    return matches ? this : this.parent?.closest(selector) ?? null;
  }
}
let listeners: Map<string, EventListener>;
let collapsed: boolean;
let cleanup: (() => void) | void;
const body = new Target();
function fire(type: string, target = body, extra: Record<string, unknown> = {}) {
  const event = {
    type, target, defaultPrevented: false, preventDefault: vi.fn(),
    clipboardData: { setData: vi.fn(), getData: vi.fn(() => '') }, ...extra,
  };
  listeners.get(type)!(event as unknown as Event);
  return event;
}

beforeEach(() => {
  effects.length = 0;
  listeners = new Map();
  collapsed = true;
  vi.stubGlobal('Element', Target);
  vi.stubGlobal('HTMLElement', Target);
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    getSelection: () => ({ isCollapsed: collapsed }),
  });
  profile.value = defaultProfile(VARIANT_SIX_KEYS);
  selectedSlot.value = { kind: 'key', layer: 0, index: 0 };
  dialog.value = null;
  App();
  cleanup = effects[0]!();
});
afterEach(() => {
  cleanup?.();
  effects.length = 0;
  vi.unstubAllGlobals();
});

describe('configuration clipboard event scope', () => {
  it('requires clicking an action, including its nested label, before copying', () => {
    expect(fire('copy').preventDefault).not.toHaveBeenCalled();
    fire('click', new Target(false, new Target(true)));
    const copy = fire('copy');
    expect(copy.preventDefault).toHaveBeenCalledOnce();
    expect(copy.clipboardData.setData).toHaveBeenCalledWith('text/plain', expect.stringContaining('universal-macropad-action'));
  });

  it('stops intercepting copy, cut, paste and repeated shortcuts after clicking elsewhere', () => {
    fire('click', new Target(true));
    const copy = fire('copy');
    const text = copy.clipboardData.setData.mock.calls[0]![1] as string;
    fire('click', new Target());
    const before = structuredClone(profile.value);
    for (const type of ['copy', 'cut', 'paste']) {
      const event = fire(type, body, { clipboardData: { setData: vi.fn(), getData: vi.fn(() => text) } });
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.clipboardData.setData).not.toHaveBeenCalled();
    }
    for (const key of ['c', 'x', 'v']) {
      expect(fire('keydown', body, { key, repeat: true, metaKey: true }).preventDefault).not.toHaveBeenCalled();
    }
    expect(profile.value).toEqual(before);
  });

  it('allows text copying after selection drags and even within an action target', () => {
    fire('click', new Target(true));
    fire('pointerdown', new Target());
    expect(fire('copy').preventDefault).not.toHaveBeenCalled();
    fire('click', new Target(true));
    collapsed = false;
    const before = structuredClone(profile.value);
    for (const type of ['copy', 'cut']) expect(fire(type).preventDefault).not.toHaveBeenCalled();
    expect(fire('keydown', body, { key: 'c', repeat: true, metaKey: true }).preventDefault).not.toHaveBeenCalled();
    expect(profile.value).toEqual(before);
  });

  it.each(['key', 'clockwise', 'encoderButton', 'counterclockwise', 'chord'] as const)(
    'still copies, cuts and pastes a clicked %s action', (kind) => {
      profile.value!.chords = [{ layer: 0, keyA: 0, keyB: 1, action: { type: 'keyTap', usage: 4, modifiers: 0 } }];
      selectedSlot.value = kind === 'key' ? { kind, layer: 0, index: 0 }
        : kind === 'chord' ? { kind, layer: 0, keyA: 0, keyB: 1 } : { kind, layer: 0 };
      const target = new Target(true);
      fire('click', target);
      const before = structuredClone(profile.value);
      const copy = fire('copy', target);
      expect(copy.preventDefault).toHaveBeenCalledOnce();
      const text = copy.clipboardData.setData.mock.calls[0]![1] as string;
      expect(fire('cut', target).preventDefault).toHaveBeenCalledOnce();
      expect(fire('paste', target, { clipboardData: { setData: vi.fn(), getData: vi.fn(() => text) } }).preventDefault).toHaveBeenCalledOnce();
      expect(profile.value).toEqual(before);
      expect(fire('keydown', target, { key: 'v', repeat: true, ctrlKey: true }).preventDefault).toHaveBeenCalledOnce();
    },
  );

  it('preserves native clipboard behavior for editors and removed targets', () => {
    const target = new Target(true);
    fire('click', target);
    expect(fire('copy', new Target(false, null, true)).preventDefault).not.toHaveBeenCalled();
    target.isConnected = false;
    expect(fire('copy').preventDefault).not.toHaveBeenCalled();
  });

  it('removes all clipboard and target listeners on unmount', () => {
    cleanup?.();
    expect(listeners.size).toBe(0);
  });
});
