import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultProfile } from '../src/model/defaults';
import { VARIANT_SIX_KEYS } from '../src/model/constants';
import { dialog, profile, selectedSlot, toasts } from '../src/ui/store';
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
    type, target, detail: 1, defaultPrevented: false, preventDefault: vi.fn(),
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
    getSelection: () => ({ isCollapsed: collapsed, removeAllRanges: () => { collapsed = true; } }),
  });
  profile.value = defaultProfile(VARIANT_SIX_KEYS);
  selectedSlot.value = { kind: 'key', layer: 0, index: 0 };
  dialog.value = null;
  toasts.value = [];
  App();
  cleanup = effects[0]!();
});
afterEach(() => {
  cleanup?.();
  effects.length = 0;
  vi.unstubAllGlobals();
});

describe('configuration clipboard event scope', () => {
  it('copies the selected action even after clicking its LED color or another control', () => {
    const copy = fire('copy');
    expect(copy.preventDefault).toHaveBeenCalledOnce();
    expect(copy.clipboardData.setData).toHaveBeenCalledWith('text/plain', expect.stringContaining('universal-macropad-action'));
    fire('pointerdown', new Target());
    fire('click', new Target());
    expect(fire('copy').preventDefault).toHaveBeenCalledOnce();
  });

  it('keeps cut, paste and repeated shortcuts scoped to the still-selected action', () => {
    const copy = fire('copy');
    const text = copy.clipboardData.setData.mock.calls[0]![1] as string;
    fire('click', new Target());
    const before = structuredClone(profile.value);
    expect(fire('cut').preventDefault).toHaveBeenCalledOnce();
    expect(fire('paste', body, { clipboardData: { setData: vi.fn(), getData: vi.fn(() => text) } }).preventDefault).toHaveBeenCalledOnce();
    for (const key of ['c', 'x', 'v']) {
      expect(fire('keydown', body, { key, repeat: true, metaKey: true }).preventDefault).toHaveBeenCalledOnce();
    }
    expect(profile.value).toEqual(before);
  });

  it('clears existing page text on pointer-down regardless of the click target', () => {
    for (const target of [new Target(true), new Target(), new Target(false, null, true)]) {
      collapsed = false;
      fire('pointerdown', target);
      expect(collapsed).toBe(true);
    }
    collapsed = false;
    fire('click', new Target(true), { detail: 0 });
    expect(collapsed).toBe(true);
  });

  it('preserves fresh text-selection drags and native copying and cutting', () => {
    fire('pointerdown', new Target());
    collapsed = false;
    fire('click', new Target());
    const before = structuredClone(profile.value);
    for (const type of ['copy', 'cut']) expect(fire(type).preventDefault).not.toHaveBeenCalled();
    expect(fire('keydown', body, { key: 'c', repeat: true, metaKey: true }).preventDefault).not.toHaveBeenCalled();
    expect(profile.value).toEqual(before);
    expect(toasts.value).toEqual([]);
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

  it('pastes a relative-layer action copied from a chord onto the encoder button', () => {
    profile.value!.chords = [{ layer: 0, keyA: 0, keyB: 1, action: { type: 'relativeLayer', offset: 1 } }];
    selectedSlot.value = { kind: 'chord', layer: 0, keyA: 0, keyB: 1 };
    const chord = new Target(true);
    fire('click', chord);
    const copy = fire('copy', chord);
    const text = copy.clipboardData.setData.mock.calls[0]![1] as string;
    expect(text).toBe('{"format":"universal-macropad-action","version":1,"action":{"type":"relativeLayer","offset":1}}');
    selectedSlot.value = { kind: 'encoderButton', layer: 0 };
    const encoder = new Target(true);
    fire('click', encoder);
    const paste = fire('paste', encoder, { clipboardData: { setData: vi.fn(), getData: vi.fn(() => text) } });
    expect(paste.preventDefault).toHaveBeenCalledOnce();
    expect(profile.value!.layers[0]!.encoderButton).toEqual({ type: 'relativeLayer', offset: 1 });
  });

  it('preserves native clipboard behavior for editors, dialogs and no selection', () => {
    const target = new Target(true);
    fire('click', target);
    expect(fire('copy', new Target(false, null, true)).preventDefault).not.toHaveBeenCalled();
    dialog.value = { title: 'Test' } as typeof dialog.value;
    expect(fire('copy').preventDefault).not.toHaveBeenCalled();
    dialog.value = null;
    selectedSlot.value = null;
    expect(fire('copy').preventDefault).not.toHaveBeenCalled();
  });

  it('reports one descriptive toast per successful operation', () => {
    profile.value!.layers[0]!.keys[0] = { type: 'relativeLayer', offset: 1 };
    const copy = fire('copy');
    expect(toasts.value.map(t => t.text)).toEqual(['Copied "Relative Layer: +1" from Layer 1, Key 1']);
    const text = copy.clipboardData.setData.mock.calls[0]![1] as string;
    fire('cut');
    expect(toasts.value.map(t => t.text)).toEqual([
      'Copied "Relative Layer: +1" from Layer 1, Key 1', 'Cut "Relative Layer: +1" from Layer 1, Key 1',
    ]);
    selectedSlot.value = { kind: 'clockwise', layer: 0 };
    fire('paste', body, { clipboardData: { getData: vi.fn(() => text) } });
    expect(toasts.value.at(-1)!.text).toBe('Pasted "Relative Layer: +1" to Layer 1, Encoder clockwise');
    const count = toasts.value.length;
    fire('paste', body, { clipboardData: { getData: vi.fn(() => 'ordinary text') } });
    expect(toasts.value.length).toBe(count);
  });

  it('reports validation errors without a successful-paste toast', () => {
    const text = JSON.stringify({ format: 'universal-macropad-action', version: 1,
      action: { type: 'keyHold', usage: 4, modifiers: 0 } });
    selectedSlot.value = { kind: 'clockwise', layer: 0 };
    fire('paste', body, { clipboardData: { getData: vi.fn(() => text) } });
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0]!.tone).toBe('error');
    expect(toasts.value[0]!.text).toContain('Cannot paste here:');
  });

  it('removes all clipboard and target listeners on unmount', () => {
    cleanup?.();
    expect(listeners.size).toBe(0);
  });
});
