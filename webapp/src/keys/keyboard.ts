/**
 * HID keyboard usages supported by the firmware's US-layout mapper:
 * 0x04–0x65 and 0x68–0x73 (config-v5.md). Modifiers are a separate mask.
 */
export interface KeyInfo {
  usage: number;
  name: string;
  /** KeyboardEvent.code for shortcut capture, when one exists. */
  code?: string;
  group: 'Letters' | 'Digits' | 'Function' | 'Navigation' | 'Editing' | 'Punctuation' | 'Keypad' | 'System';
}

const letters: KeyInfo[] = Array.from({ length: 26 }, (_, i) => {
  const letter = String.fromCharCode(65 + i);
  return { usage: 0x04 + i, name: letter, code: `Key${letter}`, group: 'Letters' as const };
});

const digits: KeyInfo[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((digit, i) => ({
  usage: 0x1e + i,
  name: String(digit),
  code: `Digit${digit}`,
  group: 'Digits' as const,
}));

const main: KeyInfo[] = [
  { usage: 0x28, name: 'Enter', code: 'Enter', group: 'Editing' },
  { usage: 0x29, name: 'Escape', code: 'Escape', group: 'System' },
  { usage: 0x2a, name: 'Backspace', code: 'Backspace', group: 'Editing' },
  { usage: 0x2b, name: 'Tab', code: 'Tab', group: 'Editing' },
  { usage: 0x2c, name: 'Space', code: 'Space', group: 'Editing' },
  { usage: 0x2d, name: '- _', code: 'Minus', group: 'Punctuation' },
  { usage: 0x2e, name: '= +', code: 'Equal', group: 'Punctuation' },
  { usage: 0x2f, name: '[ {', code: 'BracketLeft', group: 'Punctuation' },
  { usage: 0x30, name: '] }', code: 'BracketRight', group: 'Punctuation' },
  { usage: 0x31, name: '\\ |', code: 'Backslash', group: 'Punctuation' },
  { usage: 0x32, name: '# ~ (non-US)', code: 'IntlBackslash', group: 'Punctuation' },
  { usage: 0x33, name: '; :', code: 'Semicolon', group: 'Punctuation' },
  { usage: 0x34, name: "' \"", code: 'Quote', group: 'Punctuation' },
  { usage: 0x35, name: '` ~', code: 'Backquote', group: 'Punctuation' },
  { usage: 0x36, name: ', <', code: 'Comma', group: 'Punctuation' },
  { usage: 0x37, name: '. >', code: 'Period', group: 'Punctuation' },
  { usage: 0x38, name: '/ ?', code: 'Slash', group: 'Punctuation' },
  { usage: 0x39, name: 'Caps Lock', code: 'CapsLock', group: 'System' },
  ...Array.from({ length: 12 }, (_, i) => ({ usage: 0x3a + i, name: `F${i + 1}`, code: `F${i + 1}`, group: 'Function' as const })),
  { usage: 0x46, name: 'Print Screen', code: 'PrintScreen', group: 'System' },
  { usage: 0x47, name: 'Scroll Lock', code: 'ScrollLock', group: 'System' },
  { usage: 0x48, name: 'Pause', code: 'Pause', group: 'System' },
  { usage: 0x49, name: 'Insert', code: 'Insert', group: 'Editing' },
  { usage: 0x4a, name: 'Home', code: 'Home', group: 'Navigation' },
  { usage: 0x4b, name: 'Page Up', code: 'PageUp', group: 'Navigation' },
  { usage: 0x4c, name: 'Delete', code: 'Delete', group: 'Editing' },
  { usage: 0x4d, name: 'End', code: 'End', group: 'Navigation' },
  { usage: 0x4e, name: 'Page Down', code: 'PageDown', group: 'Navigation' },
  { usage: 0x4f, name: 'Right Arrow', code: 'ArrowRight', group: 'Navigation' },
  { usage: 0x50, name: 'Left Arrow', code: 'ArrowLeft', group: 'Navigation' },
  { usage: 0x51, name: 'Down Arrow', code: 'ArrowDown', group: 'Navigation' },
  { usage: 0x52, name: 'Up Arrow', code: 'ArrowUp', group: 'Navigation' },
  { usage: 0x53, name: 'Num Lock', code: 'NumLock', group: 'Keypad' },
  { usage: 0x54, name: 'Keypad /', code: 'NumpadDivide', group: 'Keypad' },
  { usage: 0x55, name: 'Keypad *', code: 'NumpadMultiply', group: 'Keypad' },
  { usage: 0x56, name: 'Keypad -', code: 'NumpadSubtract', group: 'Keypad' },
  { usage: 0x57, name: 'Keypad +', code: 'NumpadAdd', group: 'Keypad' },
  { usage: 0x58, name: 'Keypad Enter', code: 'NumpadEnter', group: 'Keypad' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((digit, i) => ({ usage: 0x59 + i, name: `Keypad ${digit}`, code: `Numpad${digit}`, group: 'Keypad' as const })),
  { usage: 0x63, name: 'Keypad .', code: 'NumpadDecimal', group: 'Keypad' },
  { usage: 0x64, name: '\\ | (non-US)', code: 'IntlBackslash', group: 'Punctuation' },
  { usage: 0x65, name: 'Application (Menu)', code: 'ContextMenu', group: 'System' },
  ...Array.from({ length: 12 }, (_, i) => ({ usage: 0x68 + i, name: `F${i + 13}`, code: `F${i + 13}`, group: 'Function' as const })),
];

export const KEYS: readonly KeyInfo[] = [...letters, ...digits, ...main].sort((a, b) => a.usage - b.usage);

const BY_USAGE = new Map(KEYS.map((k) => [k.usage, k]));
const BY_CODE = new Map<string, KeyInfo>();
for (const key of KEYS) {
  if (key.code && !BY_CODE.has(key.code)) BY_CODE.set(key.code, key);
}

export function isSupportedUsage(usage: number): boolean {
  return usage === 0 || (usage >= 0x04 && usage <= 0x65) || (usage >= 0x68 && usage <= 0x73);
}

export function keyName(usage: number): string {
  if (usage === 0) return 'No key';
  return BY_USAGE.get(usage)?.name ?? `Usage 0x${usage.toString(16).toUpperCase().padStart(2, '0')}`;
}

export function keyForCode(code: string): KeyInfo | undefined {
  return BY_CODE.get(code);
}

export const KEY_GROUPS: readonly KeyInfo['group'][] = ['Letters', 'Digits', 'Function', 'Navigation', 'Editing', 'Punctuation', 'Keypad', 'System'];
