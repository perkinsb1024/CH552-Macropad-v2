import { ActionCode, MOD_ALT, MOD_CTRL, MOD_GUI, MOD_SHIFT, MOUSE_LEFT, MOUSE_MIDDLE, MOUSE_RIGHT } from './constants';
import type { Action, ActionType } from './types';
import { keyName } from '../keys/keyboard';
import { consumerName } from '../keys/consumer';

export interface ActionDescriptor {
  type: ActionType;
  code: ActionCode;
  label: string;
  group: 'Keyboard' | 'Mouse' | 'Media' | 'Text' | 'Layers' | 'None';
  /** Whether the action needs a physical release, and so cannot be bound to rotation. */
  needsRelease: boolean;
  hint: string;
}

export const ACTION_DESCRIPTORS: readonly ActionDescriptor[] = [
  { type: 'none', code: ActionCode.None, label: 'Nothing', group: 'None', needsRelease: false, hint: 'Leave this input unassigned.' },
  { type: 'keyTap', code: ActionCode.KeyTap, label: 'Key tap', group: 'Keyboard', needsRelease: false, hint: 'Press and release a key combination.' },
  { type: 'keyHold', code: ActionCode.KeyHold, label: 'Key hold', group: 'Keyboard', needsRelease: true, hint: 'Hold a key combination while the button is held.' },
  { type: 'mouseClick', code: ActionCode.MouseClick, label: 'Mouse click', group: 'Mouse', needsRelease: false, hint: 'Click one or more mouse buttons.' },
  { type: 'mouseDouble', code: ActionCode.MouseDouble, label: 'Mouse double-click', group: 'Mouse', needsRelease: false, hint: 'Double-click one or more mouse buttons.' },
  { type: 'mouseHold', code: ActionCode.MouseHold, label: 'Mouse hold', group: 'Mouse', needsRelease: true, hint: 'Hold mouse buttons while the button is held.' },
  { type: 'mouseToggle', code: ActionCode.MouseToggle, label: 'Mouse toggle', group: 'Mouse', needsRelease: false, hint: 'Latch mouse buttons; press again to release.' },
  { type: 'scroll', code: ActionCode.Scroll, label: 'Scroll', group: 'Mouse', needsRelease: false, hint: 'Send a vertical wheel step.' },
  { type: 'mouseX', code: ActionCode.MouseX, label: 'Move pointer X', group: 'Mouse', needsRelease: false, hint: 'Move the pointer horizontally.' },
  { type: 'mouseY', code: ActionCode.MouseY, label: 'Move pointer Y', group: 'Mouse', needsRelease: false, hint: 'Move the pointer vertically.' },
  { type: 'consumer', code: ActionCode.Consumer, label: 'Media / system', group: 'Media', needsRelease: false, hint: 'Volume, playback, brightness and other consumer controls.' },
  { type: 'string', code: ActionCode.String, label: 'Type text', group: 'Text', needsRelease: false, hint: 'Type a short ASCII string. Uses the US keyboard layout.' },
  { type: 'setLayer', code: ActionCode.SetLayer, label: 'Switch to layer', group: 'Layers', needsRelease: false, hint: 'Make a layer the active base layer.' },
  { type: 'oneShotSetLayer', code: ActionCode.SetLayer, label: 'Switch to layer (one-shot)', group: 'Layers', needsRelease: false, hint: 'Use a layer for the next action, then return to the previous layer.' },
  { type: 'relativeLayer', code: ActionCode.RelativeLayer, label: 'Relative layer', group: 'Layers', needsRelease: false, hint: 'Move forward or backward through layers, wrapping around. Zero has no effect.' },
  { type: 'oneShotRelativeLayer', code: ActionCode.RelativeLayer, label: 'Relative layer (one-shot)', group: 'Layers', needsRelease: false, hint: 'Use the next relative layer for one action, then return to the previous layer.' },
  { type: 'momentaryLayer', code: ActionCode.MomentaryLayer, label: 'Layer while held', group: 'Layers', needsRelease: true, hint: 'Use a layer only while the button is held.' },
];

const BY_TYPE = new Map(ACTION_DESCRIPTORS.map((d) => [d.type, d]));
const BY_CODE = new Map(ACTION_DESCRIPTORS.map((d) => [d.code, d]));

export function descriptor(type: ActionType): ActionDescriptor {
  return BY_TYPE.get(type)!;
}

/** Includes actions whose release requirement depends on their settings. */
export function actionNeedsRelease(action: Action): boolean {
  return descriptor(action.type).needsRelease ||
    ((action.type === 'mouseX' || action.type === 'mouseY') && !!action.hold);
}

export function descriptorForCode(code: number): ActionDescriptor | undefined {
  return BY_CODE.get(code as ActionCode);
}

export function relativeTargetLayer(source: number, offset: number, layerCount: number): number {
  return ((source + offset) % layerCount + layerCount) % layerCount;
}

/** A fresh, valid instance of the given action type. */
export function blankAction(type: ActionType): Action {
  switch (type) {
    case 'none':
      return { type };
    case 'relativeLayer':
    case 'oneShotRelativeLayer':
      return { type, offset: 1 };
    case 'keyTap':
    case 'keyHold':
      return { type, usage: 0x04, modifiers: 0 };
    case 'mouseClick':
    case 'mouseDouble':
    case 'mouseHold':
    case 'mouseToggle':
      return { type, buttons: MOUSE_LEFT };
    case 'scroll':
    case 'mouseX':
    case 'mouseY':
      return { type, delta: type === 'scroll' ? 1 : 10 };
    case 'consumer':
      return { type, usage: 0xe9 };
    case 'string':
      return { type, text: '' };
    case 'setLayer':
    case 'oneShotSetLayer':
    case 'momentaryLayer':
      return { type, layer: 0 };
  }
}

export function modifierNames(mask: number): string[] {
  const names: string[] = [];
  if (mask & MOD_CTRL) names.push('Ctrl');
  if (mask & MOD_SHIFT) names.push('Shift');
  if (mask & MOD_ALT) names.push('Alt');
  if (mask & MOD_GUI) names.push('GUI');
  return names;
}

export function mouseButtonNames(mask: number): string[] {
  const names: string[] = [];
  if (mask & MOUSE_LEFT) names.push('Left');
  if (mask & MOUSE_RIGHT) names.push('Right');
  if (mask & MOUSE_MIDDLE) names.push('Middle');
  return names;
}

/** Short label used on key caps and lists. */
export function summarize(action: Action): string {
  switch (action.type) {
    case 'none':
      return '—';
    case 'keyTap':
    case 'keyHold': {
      const parts = modifierNames(action.modifiers);
      if (action.usage) parts.push(keyName(action.usage));
      const combo = parts.length ? parts.join(' + ') : 'No key';
      return action.type === 'keyHold' ? `Hold ${combo}` : combo;
    }
    case 'mouseClick':
      return `Click ${mouseButtonNames(action.buttons).join('+') || '?'}`;
    case 'mouseDouble':
      return `Double ${mouseButtonNames(action.buttons).join('+') || '?'}`;
    case 'mouseHold':
      return `Hold ${mouseButtonNames(action.buttons).join('+') || '?'}`;
    case 'mouseToggle':
      return `Toggle ${mouseButtonNames(action.buttons).join('+') || '?'}`;
    case 'scroll':
      return action.delta < 0 ? `Scroll up ${-action.delta}` : `Scroll down ${action.delta}`;
    case 'mouseX':
      return `Mouse ${action.delta < 0 ? 'left' : 'right'} ${Math.abs(action.delta)}${action.hold ? ' (hold)' : ''}`;
    case 'mouseY':
      return `Mouse ${action.delta < 0 ? 'up' : 'down'} ${Math.abs(action.delta)}${action.hold ? ' (hold)' : ''}`;
    case 'consumer':
      return consumerName(action.usage);
    case 'string':
      return action.text.length ? `“${action.text.length > 14 ? action.text.slice(0, 13) + '…' : action.text}”` : 'Empty text';
    case 'setLayer':
      return `Layer ${action.layer + 1}`;
    case 'oneShotSetLayer':
      return `Layer ${action.layer + 1} (one-shot)`;
    case 'momentaryLayer':
      return `Layer ${action.layer + 1} (hold)`;
    case 'relativeLayer':
      return `Relative Layer: ${action.offset > 0 ? '+' : ''}${action.offset}`;
    case 'oneShotRelativeLayer':
      return `Relative Layer (one-shot): ${action.offset > 0 ? '+' : ''}${action.offset}`;
  }
}

export function actionsEqual(a: Action, b: Action): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
