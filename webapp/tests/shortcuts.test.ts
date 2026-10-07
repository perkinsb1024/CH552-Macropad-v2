import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOD_CTRL, MOD_GUI, VARIANT_SIX_KEYS } from '../src/model/constants';
import { defaultProfile } from '../src/model/defaults';
import { filterShortcuts, SHORTCUTS } from '../src/model/shortcuts';
import { actionProblem } from '../src/model/validate';
import { encodeAction, encodeProfile } from '../src/codec/encode';
import { decodeImage } from '../src/codec/decode';
import { applyShortcut, draggedShortcut, endShortcutDrag, shortcutDragOver, shortcutDrop, startShortcutDrag } from '../src/ui/drag';
import { draggedSlot, profile, selectedSlot, slotDrop, undo } from '../src/ui/store';

function dragEvent() {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: { setData: vi.fn(), effectAllowed: '', dropEffect: '' },
  };
}

describe('shortcut library', () => {
  it('filters keyboard variants and keeps shared media actions in every view', () => {
    expect(SHORTCUTS.length).toBeGreaterThan(300);
    for (const os of ['windows', 'mac'] as const) {
      expect(filterShortcuts(os, '').every((shortcut) => shortcut.tags.includes(os))).toBe(true);
      expect(filterShortcuts(os, 'copy')).toContainEqual(
        expect.objectContaining({ name: 'Copy', action: { type: 'keyTap', usage: 6, modifiers: os === 'windows' ? MOD_CTRL : MOD_GUI } }),
      );
    }
    for (const os of ['windows', 'mac', 'all'] as const) {
      expect(filterShortcuts(os, 'volume').map((shortcut) => shortcut.id)).toEqual(expect.arrayContaining(['volume-up', 'volume-down']));
      expect(filterShortcuts(os, 'mute').some((shortcut) => shortcut.id === 'mute')).toBe(true);
    }
    expect(filterShortcuts('all', '  CoPY  ')).toEqual(filterShortcuts('all', 'copy'));
    expect(filterShortcuts('mac', 'unfindable shortcut xyz')).toEqual([]);
  });

  it('has unique IDs, OS and category tags, and encodable firmware actions throughout the catalog', () => {
    const ids = SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.tags.some((tag) => tag === 'windows' || tag === 'mac'), shortcut.id).toBe(true);
      expect(shortcut.tags.some((tag) => tag !== 'windows' && tag !== 'mac'), shortcut.id).toBe(true);
      expect(actionProblem(shortcut.action, { layerCount: 1, rotation: false }), shortcut.id).toBeNull();
      const offsets = shortcut.action.type === 'string' ? new Map([[shortcut.action.text, 0]]) : new Map<string, number>();
      expect(() => encodeAction(shortcut.action, offsets), shortcut.id).not.toThrow();
    }
  });

  it('searches app/context tags and multiple words without leaking across OS filters', () => {
    const word = filterShortcuts('mac', '  MICROSOFT WORD superscript  ');
    expect(word.map((shortcut) => shortcut.name)).toEqual(['Word: Superscript']);
    expect(filterShortcuts('windows', 'Google Docs list').map((shortcut) => shortcut.name)).toEqual([
      'Google Docs: Bulleted list', 'Google Docs: Numbered list', 'Google Docs: Checklist',
    ]);
    expect(filterShortcuts('windows', 'spotlight')).toEqual([]);
    expect(filterShortcuts('mac', 'virtual desktop')).toEqual([]);
    expect(filterShortcuts('mac', 'vim buffer')).toHaveLength(2);
  });

  it('uses exact OS/app-specific bindings, screenshots and literal text commands', () => {
    const preset = (id: string) => SHORTCUTS.find((shortcut) => shortcut.id === id)!;
    expect(preset('windows-security-screen-windows').action).toEqual({ type: 'keyTap', usage: 0x4c, modifiers: 5 });
    expect(preset('previous-space-mac').action).toEqual({ type: 'keyTap', usage: 0x50, modifiers: 1 });
    expect(preset('screenshot-clipboard-selection-mac').action).toEqual({ type: 'keyTap', usage: 0x21, modifiers: 11 });
    expect(preset('word-subscript-windows').action).toEqual({ type: 'keyTap', usage: 0x2d, modifiers: 3 });
    expect(preset('powerpoint-subscript-mac').action).toEqual({ type: 'keyTap', usage: 0x2e, modifiers: 9 });
    expect(preset('google-docs-superscript-mac').action).toEqual({ type: 'keyTap', usage: 0x37, modifiers: 8 });
    expect(preset('markdown-code-block').action).toEqual({ type: 'string', text: '```\n\n```' });
    expect(preset('vim-save').action).toEqual({ type: 'string', text: ':w\n' });
  });

  it('offers shared tmux command keys separately from the prefix with correct punctuation and modifiers', () => {
    const tmux = filterShortcuts('mac', 'tmux');
    expect(filterShortcuts('windows', 'tmux')).toEqual(tmux);
    const preset = (id: string) => tmux.find(shortcut => shortcut.id === id)!;
    expect(preset('tmux-prefix').action).toEqual({ type: 'keyTap', usage: 5, modifiers: MOD_CTRL });
    expect(preset('tmux-new-window').action).toEqual({ type: 'keyTap', usage: 6, modifiers: 0 });
    expect(preset('tmux-split-pane-left-right').action).toEqual({ type: 'keyTap', usage: 0x22, modifiers: 2 });
    expect(preset('tmux-split-pane-top-bottom').action).toEqual({ type: 'keyTap', usage: 0x34, modifiers: 2 });
    expect(preset('tmux-command-prompt').action).toEqual({ type: 'keyTap', usage: 0x33, modifiers: 2 });
    expect(preset('tmux-resize-pane-left-1-cell').action).toEqual({ type: 'keyTap', usage: 0x50, modifiers: MOD_CTRL });
    expect(preset('tmux-resize-pane-left-5-cells').action).toEqual({ type: 'keyTap', usage: 0x50, modifiers: 4 });
    expect(tmux.filter(shortcut => /^tmux: Select window \d$/.test(shortcut.name))).toHaveLength(10);
    for (const shortcut of tmux.filter(shortcut => shortcut.id !== 'tmux-prefix')) {
      expect(shortcut.name).not.toContain('(after prefix)');
      expect(shortcut.note).toContain('Sends only the command key');
      expect(shortcut.action.type).toBe('keyTap');
    }
  });
});

describe('shortcut assignment', () => {
  beforeEach(() => {
    profile.value = defaultProfile(VARIANT_SIX_KEYS);
    selectedSlot.value = null;
    draggedSlot.value = null;
    endShortcutDrag();
  });

  it('copies a preset onto a key without changing adjacent assignments or LEDs, and supports undo', () => {
    const before = structuredClone(profile.value!);
    const copy = filterShortcuts('mac', 'copy')[0]!;
    const target = { kind: 'key', layer: 0, index: 0 } as const;
    const event = dragEvent();
    startShortcutDrag(event as unknown as DragEvent, copy);
    expect(event.dataTransfer.effectAllowed).toBe('copy');
    expect(shortcutDragOver(event as unknown as DragEvent, target)).toBe(true);
    expect(event.dataTransfer.dropEffect).toBe('copy');
    expect(slotDrop.value).toEqual({ slot: target, position: 'swap' });
    expect(shortcutDrop(event as unknown as DragEvent, target)).toBe(true);
    expect(profile.value!.layers[0]!.keys[0]).toEqual(copy.action);
    expect(profile.value!.layers[0]!.keys.slice(1)).toEqual(before.layers[0]!.keys.slice(1));
    expect(profile.value!.layers[0]!.leds).toEqual(before.layers[0]!.leds);
    expect(selectedSlot.value).toEqual(target);
    expect(draggedShortcut.value).toBeNull();
    expect(slotDrop.value).toBeNull();
    expect(copy.action).toEqual({ type: 'keyTap', usage: 6, modifiers: MOD_GUI });
    undo();
    expect(profile.value).toEqual(before);
  });

  it('assigns an existing global chord without changing its scope or other bindings', () => {
    const p = profile.value!;
    p.chords = [{ layer: 0, keyA: 0, keyB: 1, global: true, action: { type: 'none' } }];
    const keys = structuredClone(p.layers[0]!.keys);
    const mute = SHORTCUTS.find((shortcut) => shortcut.id === 'mute')!;
    const event = dragEvent();
    const slot = { kind: 'chord', layer: 0, keyA: 0, keyB: 1, global: true } as const;
    startShortcutDrag(event as unknown as DragEvent, mute);
    shortcutDragOver(event as unknown as DragEvent, slot);
    shortcutDrop(event as unknown as DragEvent, slot);
    expect(profile.value!.chords).toEqual([{ layer: 0, keyA: 0, keyB: 1, global: true, action: mute.action }]);
    expect(profile.value!.layers[0]!.keys).toEqual(keys);
  });

  it('supports encoder rotation and refuses stale targets', () => {
    const volume = SHORTCUTS.find((shortcut) => shortcut.id === 'volume-up')!;
    applyShortcut(volume, { kind: 'clockwise', layer: 0 });
    expect(profile.value!.layers[0]!.clockwise).toEqual(volume.action);
    const before = structuredClone(profile.value);
    applyShortcut(volume, { kind: 'key', layer: 99, index: 0 });
    applyShortcut(volume, { kind: 'chord', layer: 0, keyA: 4, keyB: 5 });
    expect(profile.value).toEqual(before);
  });

  it('saves and reloads assigned Markdown and Vim snippets with their literal text intact', () => {
    const markdown = SHORTCUTS.find((shortcut) => shortcut.id === 'markdown-code-block')!;
    const vim = SHORTCUTS.find((shortcut) => shortcut.id === 'vim-save')!;
    applyShortcut(markdown, { kind: 'key', layer: 0, index: 0 });
    applyShortcut(vim, { kind: 'key', layer: 0, index: 1 });
    const saved = decodeImage(encodeProfile(profile.value!));
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.detail);
    expect(saved.profile.layers[0]!.keys[0]).toEqual({ type: 'string', text: '```\n\n```' });
    expect(saved.profile.layers[0]!.keys[1]).toEqual({ type: 'string', text: ':w\n' });
  });

  it('leaves existing action drags to their original handlers and clears cancelled shortcut drags', () => {
    const event = dragEvent();
    const slot = { kind: 'key', layer: 0, index: 0 } as const;
    draggedSlot.value = slot;
    expect(shortcutDragOver(event as unknown as DragEvent, slot)).toBe(false);
    expect(shortcutDrop(event as unknown as DragEvent, slot)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    startShortcutDrag(event as unknown as DragEvent, SHORTCUTS[0]!);
    expect(draggedSlot.value).toBeNull();
    shortcutDragOver(event as unknown as DragEvent, slot);
    endShortcutDrag();
    expect(draggedShortcut.value).toBeNull();
    expect(slotDrop.value).toBeNull();
  });
});
