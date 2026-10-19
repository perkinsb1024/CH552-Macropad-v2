import { visibleText } from './strings';
import { ledSummary } from './ledControl';
import { ActionCode, MOD_ALT, MOD_CTRL, MOD_GUI, MOD_SHIFT, MOUSE_LEFT, MOUSE_MIDDLE, MOUSE_RIGHT, MOUSE_BUTTONS, PREVIOUS_LAYER } from './constants';
import type { Action, ActionType } from './types';
import { keyName } from '../keys/keyboard';
import { consumerName } from '../keys/consumer';

export function isPreviousLayer(action: Action): boolean {
  return (action.type === 'setLayer' || action.type === 'oneShotSetLayer') && action.layer === PREVIOUS_LAYER;
}

export interface ActionDescriptor {
  type: ActionType;
  code: ActionCode;
  label: string;
  group: 'Keyboard' | 'Mouse' | 'Media' | 'Text' | 'Layers' | 'LED Control' | 'None' | 'Macros';
  /** Whether the action needs a physical release, and so cannot be bound to rotation. */
  needsRelease: boolean;
  hint: string;
}

export const ACTION_DESCRIPTORS: readonly ActionDescriptor[] = [
  { type: 'tapHold', code: ActionCode.TapHold, label: 'Tap-Hold', group: 'None', needsRelease: true, hint: 'Tap or hold the input to choose between two actions.' },
  { type: 'macro', code: ActionCode.Macro, label: 'Execute Macro', group: 'Macros', needsRelease: false, hint: 'Run an ordered sequence 1–16 times. Define its steps in Macros.' },
  { type: 'pause', code: ActionCode.Pause, label: 'Pause', group: 'Macros', needsRelease: false, hint: 'Wait up to 4 seconds before the next action' },
  { type: 'ledControl', code: ActionCode.LedControl, label: 'LED Control', group: 'LED Control', needsRelease: false, hint: 'Adjust global lighting at runtime; resets on configuration save or USB reset.' },
  { type: 'none', code: ActionCode.None, label: 'Nothing', group: 'None', needsRelease: false, hint: 'Leave this input unassigned.' },
  { type: 'keyTap', code: ActionCode.KeyTap, label: 'Key Tap', group: 'Keyboard', needsRelease: false, hint: 'Press and release a key combination.' },
  { type: 'keyHold', code: ActionCode.KeyHold, label: 'Key Hold', group: 'Keyboard', needsRelease: true, hint: 'Hold a key combination while the button is held.' },
  { type: 'mouseClick', code: ActionCode.MouseClick, label: 'Mouse Click', group: 'Mouse', needsRelease: false, hint: 'Click one or more mouse buttons.' },
  { type: 'mouseHold', code: ActionCode.MouseHold, label: 'Mouse Hold', group: 'Mouse', needsRelease: true, hint: 'Hold mouse buttons while the button is held.' },
  { type: 'mouseToggle', code: ActionCode.MouseToggle, label: 'Mouse Toggle', group: 'Mouse', needsRelease: false, hint: 'Latch mouse buttons; press again to release.' },
  { type: 'mouseDown', code: ActionCode.MouseDown, label: 'Mouse Down', group: 'Mouse', needsRelease: false, hint: 'Keep selected mouse buttons down until Mouse Up, toggle, a layer change or reset. Repeated down leaves them down.' },
  { type: 'mouseUp', code: ActionCode.MouseUp, label: 'Mouse Up', group: 'Mouse', needsRelease: false, hint: 'Release selected persistent mouse buttons from any input or macro. Physical holds and clicks stay independent.' },
  { type: 'scroll', code: ActionCode.Scroll, label: 'Scroll', group: 'Mouse', needsRelease: false, hint: 'Send a vertical or horizontal wheel step, or repeat while held.' },
  { type: 'mouseX', code: ActionCode.MouseAxis, label: 'Move Pointer X', group: 'Mouse', needsRelease: false, hint: 'Move the pointer horizontally.' },
  { type: 'mouseY', code: ActionCode.MouseAxis, label: 'Move Pointer Y', group: 'Mouse', needsRelease: false, hint: 'Move the pointer vertically.' },
  { type: 'mouseXY', code: ActionCode.MouseXY, label: 'Move Pointer X/Y', group: 'Mouse', needsRelease: false, hint: 'Move both axes together, from 4–64 mouse counts per axis in steps of 4.' },
  { type: 'consumer', code: ActionCode.Consumer, label: 'Media / System', group: 'Media', needsRelease: false, hint: 'Volume, playback, brightness and other consumer controls.' },
  { type: 'consumerHold', code: ActionCode.ConsumerHold, label: 'Media / System Hold', group: 'Media', needsRelease: true, hint: 'Hold a media or system control until release. Repetition depends on the host.' },
  { type: 'consumerModifiedHold', code: ActionCode.ConsumerModifiedHold, label: 'Media / System Hold with Modifiers', group: 'Media', needsRelease: true, hint: 'Hold an 8-bit consumer control and its modifiers until physical release.' },
  { type: 'consumerModified', code: ActionCode.ConsumerModified, label: 'Media / System with Modifiers', group: 'Media', needsRelease: false, hint: 'Tap an 8-bit consumer control with Ctrl, Shift, Alt or GUI. Modifiers release automatically after the control.' },
  { type: 'string', code: ActionCode.String, label: 'Type Text', group: 'Text', needsRelease: false, hint: 'Type a short ASCII string. Uses the US keyboard layout.' },
  { type: 'setLayer', code: ActionCode.SetLayer, label: 'Switch to Layer', group: 'Layers', needsRelease: false, hint: 'Make a layer the active base layer.' },
  { type: 'oneShotSetLayer', code: ActionCode.SetLayer, label: 'Switch to Layer (One-Shot)', group: 'Layers', needsRelease: false, hint: 'Use a layer for the next action, then return to the previous layer.' },
  { type: 'relativeLayer', code: ActionCode.RelativeLayer, label: 'Relative Layer', group: 'Layers', needsRelease: false, hint: 'Move forward or backward through layers, wrapping around. Zero displays the current layer’s indicator.' },
  { type: 'oneShotRelativeLayer', code: ActionCode.RelativeLayer, label: 'Relative Layer (One-Shot)', group: 'Layers', needsRelease: false, hint: 'Use the next relative layer for one action, then return to the previous layer.' },
  { type: 'momentaryRelativeLayer', code: ActionCode.MomentaryRelativeLayer, label: 'Relative Layer While Held', group: 'Layers', needsRelease: true, hint: 'Resolve a relative layer at press time and use it until physical release.' },
  { type: 'momentaryLayer', code: ActionCode.MomentaryLayer, label: 'Layer While Held', group: 'Layers', needsRelease: true, hint: 'Use a layer only while the button is held.' },
];

const BY_TYPE = new Map(ACTION_DESCRIPTORS.map((d) => [d.type, d]));
const BY_CODE = new Map(ACTION_DESCRIPTORS.map((d) => [d.code, d]));

export function descriptor(type: ActionType): ActionDescriptor {
  return BY_TYPE.get(type)!;
}

/** Includes actions whose release requirement depends on their settings. */
export function actionNeedsRelease(action: Action): boolean {
  return descriptor(action.type).needsRelease ||
    ((action.type === 'scroll' || action.type === 'mouseX' || action.type === 'mouseY' || action.type === 'mouseXY') && !!action.hold);
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
    case 'tapHold': return { type, tap: { type: 'none' }, hold: { type: 'none' } };
    case 'macro': return { type, macro: 0, repeats: 1 };
    case 'pause': return { type, ticks: 16 };
    case 'ledControl': return { type, command: 'commonPresetRelative', value: 1 };
    case 'none':
      return { type };
    case 'momentaryRelativeLayer':
    case 'relativeLayer':
    case 'oneShotRelativeLayer':
      return { type, offset: 1 };
    case 'keyTap':
    case 'keyHold':
      return { type, usage: 0x04, modifiers: 0 };
    case 'consumerModifiedHold':
    case 'consumerModified':
      return { type, usage: 0x6f, modifiers: MOD_ALT | MOD_SHIFT };
    case 'mouseClick':
    case 'mouseHold':
    case 'mouseDown':
    case 'mouseUp':
    case 'mouseToggle':
      return { type, buttons: MOUSE_LEFT };
    case 'scroll':
    case 'mouseX':
    case 'mouseY':
      return { type, delta: type === 'scroll' ? 1 : 10 };
    case 'mouseXY':
      return { type, x: 4, y: 4 };
    case 'consumer':
    case 'consumerHold':
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
  // Keep historical summary order (Left, Right, Middle), then numbered buttons.
  return [MOUSE_BUTTONS[0], MOUSE_BUTTONS[2], MOUSE_BUTTONS[1], ...MOUSE_BUTTONS.slice(3)]
    .filter(button => mask & button.bit).map(button => button.label);
}

/** Short label used on key caps and lists. */
export function summarize(action: Action): string {
  switch (action.type) {
    case 'tapHold': return `Tap: ${summarize(action.tap)}; Hold: ${summarize(action.hold)}`;
    case 'macro': return `Macro ${action.macro + 1}${action.repeats > 1 ? ` (×${action.repeats})` : ''}`;
    case 'pause': return `Pause ${action.ticks * 16}ms`;
    case 'ledControl': return ledSummary(action.command, action.value, false, action.brightness);
    case 'none':
      return '—';
    case 'keyTap':
    case 'keyHold': {
      const parts = modifierNames(action.modifiers);
      if (action.usage) parts.push(keyName(action.usage));
      const combo = parts.length ? parts.join(' + ') : 'No Key';
      return action.type === 'keyHold' ? `Hold ${combo}` : combo;
    }
    case 'consumerModifiedHold':
    case 'consumerModified':
      return `${action.type === 'consumerModifiedHold' ? 'Hold ' : ''}${[...modifierNames(action.modifiers), consumerName(action.usage)].join(' + ')}`;
    case 'mouseClick':
      return `Mouse ${(action.clicks ?? 1) === 1 ? 'Click' : action.clicks === 2 ? 'Double' : `${action.clicks} Clicks`} ${mouseButtonNames(action.buttons).join('+') || '?'}`;
    case 'mouseHold':
      return `Mouse Hold ${mouseButtonNames(action.buttons).join('+') || '?'}`;
    case 'mouseDown':
      return `Mouse Down ${mouseButtonNames(action.buttons).join('+') || '?'}`;
    case 'mouseUp':
      return `Mouse Up ${mouseButtonNames(action.buttons).join('+') || '?'}`;
    case 'mouseToggle':
      return `Mouse Toggle ${mouseButtonNames(action.buttons).join('+') || '?'}`;
    case 'scroll':
      return `${action.delta < 0 ? `Scroll ${action.horizontal ? 'Left' : 'Up'} ${-action.delta}` : `Scroll ${action.horizontal ? 'Right' : 'Down'} ${action.delta}`}${action.hold ? ' (Hold)' : ''}`;
    case 'mouseX':
      return `Mouse X ${action.delta}${action.hold ? ' (Hold)' : ''}`;
    case 'mouseY':
      return `Mouse Y ${action.delta}${action.hold ? ' (Hold)' : ''}`;
    case 'mouseXY':
      return `Mouse X ${action.x}, Y ${action.y}${action.hold ? ' (Hold)' : ''}`;
    case 'consumer':
      return consumerName(action.usage);
    case 'consumerHold':
      return `Hold ${consumerName(action.usage)}`;
    case 'string': {
      const text = visibleText(action.text);
      return text.length ? `“${text.length > 14 ? text.slice(0, 13) + '…' : text}”` : 'Empty Text';
    }
    case 'setLayer':
      return isPreviousLayer(action) ? 'Previous Layer' : `Layer ${action.layer + 1}`;
    case 'oneShotSetLayer':
      return isPreviousLayer(action) ? 'Previous Layer (One-Shot)' : `Layer ${action.layer + 1} (One-Shot)`;
    case 'momentaryLayer':
      return `Layer ${action.layer + 1} (Hold)`;
    case 'momentaryRelativeLayer':
    case 'relativeLayer':
      return `Relative Layer${action.type === 'momentaryRelativeLayer' ? ' (Hold)' : ''}: ${action.offset > 0 ? '+' : ''}${action.offset}`;
    case 'oneShotRelativeLayer':
      return `Relative Layer (One-Shot): ${action.offset > 0 ? '+' : ''}${action.offset}`;
  }
}

/** Full action description for trigger tooltips, without key-cap truncation. */
export function actionTooltip(action: Action): string {
  const label = descriptor(action.type).label;
  switch (action.type) {
    case 'tapHold': return `Tap: ${actionTooltip(action.tap)}; Hold: ${actionTooltip(action.hold)}`;
    case 'none': return label;
    case 'keyTap':
    case 'keyHold': {
      const parts = modifierNames(action.modifiers);
      if (action.usage) parts.push(keyName(action.usage));
      return `${label}: ${parts.join(' + ') || 'No Key'}`;
    }
    case 'string': return `${label}: ${action.text.length ? `“${visibleText(action.text)}”` : 'Empty Text'}`;
    case 'mouseHold':
    case 'mouseDown':
    case 'mouseUp':
    case 'mouseToggle': return `${label}: ${mouseButtonNames(action.buttons).join(' + ') || '?'}`;
    case 'consumerHold': return `${label}: ${consumerName(action.usage)}`;
    case 'momentaryRelativeLayer':
    case 'relativeLayer':
    case 'oneShotRelativeLayer': return `${label}: ${action.offset > 0 ? '+' : ''}${action.offset}`;
    default: return `${label}: ${summarize(action)}`;
  }
}

export function actionsEqual(a: Action, b: Action): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
