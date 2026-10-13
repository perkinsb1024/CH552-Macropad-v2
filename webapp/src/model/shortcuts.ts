import { KEYS } from '../keys/keyboard';
import { CONSUMER_USAGES } from '../keys/consumer';
import { MOD_ALT, MOD_CTRL, MOD_GUI, MOD_SHIFT } from './constants';
import type { Action } from './types';

export type ShortcutOS = 'windows' | 'mac';
export type ShortcutFilter = ShortcutOS | 'all';

export interface Shortcut {
  id: string;
  name: string;
  /** OS, app, category, and context tags for search and future filters. */
  tags: readonly string[];
  binding?: string;
  note?: string;
  action: Action;
}

type Entry = readonly [name: string, binding: string];
type PairedEntry = readonly [name: string, windows: string, mac: string];
const BOTH: readonly ShortcutOS[] = ['windows', 'mac'];
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const aliases: Record<string, string> = {
  Left: 'Left Arrow', Right: 'Right Arrow', Up: 'Up Arrow', Down: 'Down Arrow',
  Minus: '- _', Equal: '= +', '[': '[ {', ']': '] }', '\\': '\\ |',
  ';': '; :', "'": "' \"", '`': '` ~', ',': ', <', '.': '. >', '/': '/ ?',
};
const modifierBits: Record<string, number> = {
  Ctrl: MOD_CTRL, Shift: MOD_SHIFT, Alt: MOD_ALT, Option: MOD_ALT, Cmd: MOD_GUI, Win: MOD_GUI,
};

/** Physical US-layout keys; Shift is explicit for punctuation. */
function keyboardAction(binding: string): Action {
  const parts = binding.split('+');
  const name = parts.pop()!;
  const key = KEYS.find((candidate) => candidate.name === (aliases[name] ?? name));
  if (!key) throw new Error(`Unknown shortcut key: ${binding}`);
  let modifiers = 0;
  for (const modifier of parts) {
    const bit = modifierBits[modifier];
    if (bit === undefined) throw new Error(`Unknown shortcut modifier: ${binding}`);
    modifiers |= bit;
  }
  return { type: 'keyTap', usage: key.usage, modifiers };
}

function keys(os: ShortcutOS, tags: readonly string[], entries: readonly Entry[]): Shortcut[] {
  return entries.map(([name, binding]) => ({
    id: `${slug(name)}-${os}`, name, tags: [os, 'Keyboard', ...tags], binding, action: keyboardAction(binding),
  }));
}

function paired(tags: readonly string[], entries: readonly PairedEntry[]): Shortcut[] {
  return entries.flatMap(([name, windows, mac]) => [
    ...keys('windows', tags, [[name, windows]]), ...keys('mac', tags, [[name, mac]]),
  ]);
}

function snippets(category: string, entries: readonly Entry[]): Shortcut[] {
  return entries.map(([label, text]) => ({
    id: slug(`${category}-${label}`), name: `${category}: ${label}`,
    tags: [...BOTH, category, 'Text', category === 'Vim' ? 'Normal mode' : 'Snippets'],
    binding: text.replace(/\n/g, ' ↵ ').replace(/\t/g, ' ⇥ '),
    note: category === 'Vim' ? 'Start in Vim Normal mode.' : 'Inserts literal text; does not wrap a selection or reposition the cursor.',
    action: { type: 'string', text },
  }));
}

type ModifiedMediaEntry = readonly [name: string, binding: string, usage: number, modifiers: number, note: string, ...tags: string[]];

/** macOS system shortcuts use Consumer Page usages, not keyboard F-keys. */
function macMedia(entries: readonly ModifiedMediaEntry[]): Shortcut[] {
  return entries.map(([name, binding, usage, modifiers, note, ...tags]) => ({
    id: `${slug(name)}-mac`, name, binding, note,
    tags: ['mac', 'macOS', 'Media', 'System', 'Modifiers', ...(modifiers & MOD_ALT ? ['Alt'] : []), ...tags],
    action: { type: 'consumerModified', usage, modifiers },
  }));
}

const DISPLAY_SUPPORT = 'Requires macOS and display support for brightness controls.';
const EXTERNAL_DISPLAY_SUPPORT = 'Adjusts a supported external display; macOS cannot control brightness on every monitor.';
const VOLUME_FEEDBACK = 'Temporarily reverses Play feedback when volume is changed in Sound settings: silent when enabled, audible when disabled.';

// References and firmware limits: webapp/SHORTCUTS.md.
export const SHORTCUTS: readonly Shortcut[] = [
  ...paired(['Editing', 'Clipboard'], [
    ['Cut', 'Ctrl+X', 'Cmd+X'], ['Copy', 'Ctrl+C', 'Cmd+C'], ['Paste', 'Ctrl+V', 'Cmd+V'],
    ['Select All', 'Ctrl+A', 'Cmd+A'], ['Undo', 'Ctrl+Z', 'Cmd+Z'], ['Redo', 'Ctrl+Y', 'Cmd+Shift+Z'],
    ['Paste without Formatting', 'Ctrl+Shift+V', 'Cmd+Shift+Option+V'],
  ]),
  ...paired(['Documents', 'Productivity'], [
    ['New Document', 'Ctrl+N', 'Cmd+N'], ['Open', 'Ctrl+O', 'Cmd+O'], ['Save', 'Ctrl+S', 'Cmd+S'],
    ['Save As', 'Ctrl+Shift+S', 'Cmd+Shift+S'], ['Print', 'Ctrl+P', 'Cmd+P'], ['Find', 'Ctrl+F', 'Cmd+F'],
    ['Bold', 'Ctrl+B', 'Cmd+B'], ['Italic', 'Ctrl+I', 'Cmd+I'], ['Underline', 'Ctrl+U', 'Cmd+U'],
  ]),
  ...paired(['Browser', 'Google Chrome', 'Microsoft Edge'], [
    ['New Tab', 'Ctrl+T', 'Cmd+T'], ['Close Tab', 'Ctrl+W', 'Cmd+W'],
    ['Reopen Closed Tab', 'Ctrl+Shift+T', 'Cmd+Shift+T'], ['New Browser Window', 'Ctrl+N', 'Cmd+N'],
    ['New Private Window', 'Ctrl+Shift+N', 'Cmd+Shift+N'],
    ['Next Tab', 'Ctrl+Tab', 'Ctrl+Tab'], ['Previous Tab', 'Ctrl+Shift+Tab', 'Ctrl+Shift+Tab'],
    ['Address Bar', 'Ctrl+L', 'Cmd+L'], ['Reload Page', 'Ctrl+R', 'Cmd+R'],
    ['Reload (Ignore Cache)', 'Ctrl+Shift+R', 'Cmd+Shift+R'],
    ['Find Next', 'Ctrl+G', 'Cmd+G'], ['Find Previous', 'Ctrl+Shift+G', 'Cmd+Shift+G'],
    ['Bookmark Page', 'Ctrl+D', 'Cmd+D'], ['Bookmark All Tabs', 'Ctrl+Shift+D', 'Cmd+Shift+D'],
    ['Bookmarks Bar', 'Ctrl+Shift+B', 'Cmd+Shift+B'], ['Downloads', 'Ctrl+J', 'Cmd+Shift+J'],
    ['Browser History', 'Ctrl+H', 'Cmd+Y'], ['Zoom In', 'Ctrl+Equal', 'Cmd+Equal'],
    ['Zoom Out', 'Ctrl+Minus', 'Cmd+Minus'], ['Reset Zoom', 'Ctrl+0', 'Cmd+0'],
    ['Browser Back', 'Alt+Left', 'Cmd+['], ['Browser Forward', 'Alt+Right', 'Cmd+]'],
    ['Developer Tools Console', 'Ctrl+Shift+J', 'Cmd+Option+J'],
  ]),
  ...Array.from({ length: 9 }, (_, i) => paired(['Browser', 'Tabs'], [
    [`Switch to tab ${i === 8 ? 'last' : i + 1}`, `Ctrl+${i + 1}`, `Cmd+${i + 1}`],
  ])).flat(),

  ...keys('mac', ['macOS', 'Navigation', 'Windows management'], [
    ['Previous Space', 'Ctrl+Left'], ['Next Space', 'Ctrl+Right'], ['Mission Control', 'Ctrl+Up'],
    ['App Windows (App Exposé)', 'Ctrl+Down'], ['Quit App', 'Cmd+Q'], ['Close Window', 'Cmd+W'],
    ['Close All Windows', 'Cmd+Option+W'], ['Force Quit Dialog', 'Cmd+Option+Escape'],
    ['Switch App', 'Cmd+Tab'], ['Switch App (Previous)', 'Cmd+Shift+Tab'],
    ['Switch Window', 'Cmd+`'], ['Switch Window (Previous)', 'Cmd+Shift+`'],
    ['Hide App', 'Cmd+H'], ['Hide Other Apps', 'Cmd+Option+H'], ['Minimize Window', 'Cmd+M'],
    ['Minimize All Windows', 'Cmd+Option+M'], ['Toggle Full Screen', 'Ctrl+Cmd+F'],
    ['Toggle Dock', 'Cmd+Option+D'], ['App Settings', 'Cmd+,'],
  ]),
  ...keys('mac', ['macOS', 'System'], [
    ['Spotlight', 'Cmd+Space'], ['Emoji Picker', 'Ctrl+Cmd+Space'],
    ['Lock Screen', 'Ctrl+Cmd+Q'], ['Log Out (Confirm)', 'Cmd+Shift+Q'],
    ['Log Out (Immediately)', 'Cmd+Shift+Option+Q'], ['Accessibility Options', 'Cmd+Option+F5'],
    ['Previous Input Source', 'Ctrl+Space'], ['Next Input Source', 'Ctrl+Option+Space'],
  ]),
  ...keys('mac', ['macOS', 'Screenshot', 'Screen recording'], [
    ['Screenshot (Save, Full Screen)', 'Cmd+Shift+3'], ['Screenshot (Clipboard, Full Screen)', 'Ctrl+Cmd+Shift+3'],
    ['Screenshot (Save, Selection)', 'Cmd+Shift+4'], ['Screenshot (Clipboard, Selection)', 'Ctrl+Cmd+Shift+4'],
    ['Screenshot / Recording Toolbar', 'Cmd+Shift+5'],
  ]),
  ...keys('mac', ['macOS', 'Siri', 'macOS 27+'], [
    ['Siri (Active Window, macOS 27+)', 'Cmd+Shift+Space'], ['Siri (Selection, macOS 27+)', 'Cmd+Shift+6'],
  ]).map((shortcut) => ({ ...shortcut, note: 'Requires macOS 27 or later with Siri AI enabled.' })),
  ...keys('mac', ['macOS', 'Finder', 'Files'], [
    ['Finder: New Window', 'Cmd+N'], ['Finder: New Folder', 'Cmd+Shift+N'],
    ['Finder: Go to Folder', 'Cmd+Shift+G'], ['Finder: Home Folder', 'Cmd+Shift+H'],
    ['Finder: Desktop', 'Cmd+Shift+D'], ['Finder: Documents', 'Cmd+Shift+O'],
    ['Finder: Downloads', 'Cmd+Option+L'], ['Finder: Utilities', 'Cmd+Shift+U'],
    ['Finder: Computer', 'Cmd+Shift+C'], ['Finder: AirDrop', 'Cmd+Shift+R'],
    ['Finder: iCloud Drive', 'Cmd+Shift+I'], ['Finder: Connect to Server', 'Cmd+K'],
    ['Finder: Get Info', 'Cmd+I'], ['Finder: Duplicate', 'Cmd+D'], ['Finder: Quick Look', 'Space'],
    ['Finder: Move to Trash', 'Cmd+Backspace'], ['Finder: Empty Trash (Confirm)', 'Cmd+Shift+Backspace'],
    ['Finder: Move Pasted Files', 'Cmd+Option+V'], ['Finder: Eject Selected Disk', 'Cmd+E'],
    ['Finder: Parent Folder', 'Cmd+Up'], ['Finder: Open Selection', 'Cmd+Down'],
    ['Finder: Icons View', 'Cmd+1'], ['Finder: List View', 'Cmd+2'],
    ['Finder: Columns View', 'Cmd+3'], ['Finder: Gallery View', 'Cmd+4'],
    ['Finder: Toggle Hidden Files', 'Cmd+Shift+.'], ['Finder: View Options', 'Cmd+J'],
  ]),

  ...keys('windows', ['Windows', 'System'], [
    ['Run', 'Win+R'], ['Windows Security Screen', 'Ctrl+Alt+Delete'], ['Close Window / App', 'Alt+F4'],
    ['Task Manager', 'Ctrl+Shift+Escape'], ['Lock Screen', 'Win+L'], ['Start Menu', 'Ctrl+Escape'],
    ['Settings', 'Win+I'], ['File Explorer', 'Win+E'], ['Search', 'Win+S'],
    ['Quick Link Menu', 'Win+X'], ['Quick Settings', 'Win+A'], ['Notifications', 'Win+N'],
    ['Clipboard History', 'Win+V'], ['Emoji Picker', 'Win+.'], ['Voice Typing', 'Win+H'],
    ['Project Display', 'Win+P'], ['Connect Wireless Display', 'Win+K'],
    ['Switch Keyboard Language', 'Win+Space'], ['Accessibility Settings', 'Win+U'],
    ['Magnifier Zoom In', 'Win+Equal'], ['Magnifier Zoom Out', 'Win+Minus'],
    ['Close Magnifier', 'Win+Escape'], ['Color Filters', 'Win+Ctrl+C'],
  ]),
  ...keys('windows', ['Windows', 'Navigation', 'Windows management'], [
    ['Switch App', 'Alt+Tab'], ['Switch App (Previous)', 'Alt+Shift+Tab'], ['Task View', 'Win+Tab'],
    ['Show Desktop', 'Win+D'], ['Minimize All Windows', 'Win+M'],
    ['Restore Minimized Windows', 'Win+Shift+M'], ['Snap Window Left', 'Win+Left'],
    ['Snap Window Right', 'Win+Right'], ['Maximize Window', 'Win+Up'],
    ['Restore / Minimize Window', 'Win+Down'], ['Snap Layouts', 'Win+Z'],
    ['Move Window to Previous Monitor', 'Win+Shift+Left'], ['Move Window to Next Monitor', 'Win+Shift+Right'],
    ['New Virtual Desktop', 'Win+Ctrl+D'], ['Close Virtual Desktop', 'Win+Ctrl+F4'],
    ['Previous Virtual Desktop', 'Win+Ctrl+Left'], ['Next Virtual Desktop', 'Win+Ctrl+Right'],
    ['Window System Menu', 'Alt+Space'], ['Context Menu', 'Shift+F10'],
  ]),
  ...keys('windows', ['Windows', 'Screenshot', 'Screen recording'], [
    ['Screenshot (Selection / Snipping)', 'Win+Shift+S'], ['Screenshot (Save, Full Screen)', 'Win+Print Screen'],
    ['Screenshot (Clipboard, Active Window)', 'Alt+Print Screen'], ['Xbox Game Bar', 'Win+G'],
    ['Record Active App', 'Win+Alt+R'],
  ]),
  ...keys('windows', ['Windows', 'File Explorer', 'Files'], [
    ['Refresh', 'F5'], ['Rename', 'F2'], ['File Explorer: New Folder', 'Ctrl+Shift+N'],
    ['File Explorer: Properties', 'Alt+Enter'], ['File Explorer: Parent Folder', 'Alt+Up'],
    ['File Explorer: Preview Pane', 'Alt+P'], ['File Explorer: Address Bar', 'Alt+D'],
    ['File Explorer: New Window', 'Ctrl+N'], ['File Explorer: Delete Permanently', 'Shift+Delete'],
  ]),

  ...paired(['Navigation', 'Text editing'], [
    ['Previous Word', 'Ctrl+Left', 'Option+Left'], ['Next Word', 'Ctrl+Right', 'Option+Right'],
    ['Previous Paragraph', 'Ctrl+Up', 'Option+Up'], ['Next Paragraph', 'Ctrl+Down', 'Option+Down'],
    ['Line Start', 'Home', 'Cmd+Left'], ['Line End', 'End', 'Cmd+Right'],
    ['Document Start', 'Ctrl+Home', 'Cmd+Up'], ['Document End', 'Ctrl+End', 'Cmd+Down'],
    ['Select Previous Word', 'Ctrl+Shift+Left', 'Option+Shift+Left'], ['Select Next Word', 'Ctrl+Shift+Right', 'Option+Shift+Right'],
    ['Select to Line Start', 'Shift+Home', 'Cmd+Shift+Left'], ['Select to Line End', 'Shift+End', 'Cmd+Shift+Right'],
    ['Select to Document Start', 'Ctrl+Shift+Home', 'Cmd+Shift+Up'], ['Select to Document End', 'Ctrl+Shift+End', 'Cmd+Shift+Down'],
    ['Delete Previous Word', 'Ctrl+Backspace', 'Option+Backspace'], ['Delete Next Word', 'Ctrl+Delete', 'Option+Delete'],
  ]),
  ...keys('mac', ['Text editing', 'Terminal'], [
    ['Delete to Line Start', 'Cmd+Backspace'], ['Emacs: Line Start', 'Ctrl+A'], ['Emacs: Line End', 'Ctrl+E'],
    ['Emacs: Delete to Line End', 'Ctrl+K'], ['Emacs: Previous Character', 'Ctrl+B'], ['Emacs: Next Character', 'Ctrl+F'],
    ['Emacs: Previous Line', 'Ctrl+P'], ['Emacs: Next Line', 'Ctrl+N'],
  ]),

  ...paired(['Microsoft Word', 'Microsoft Office', 'Formatting'], [
    ['Word: Superscript', 'Ctrl+Shift+Equal', 'Cmd+Shift+Equal'], ['Word: Subscript', 'Ctrl+Shift+Minus', 'Cmd+Shift+Minus'],
    ['Word: Bulleted List', 'Ctrl+Shift+L', 'Cmd+Shift+L'], ['Word: Align Left', 'Ctrl+L', 'Cmd+L'],
    ['Word: Center', 'Ctrl+E', 'Cmd+E'], ['Word: Align Right', 'Ctrl+R', 'Cmd+R'], ['Word: Justify', 'Ctrl+J', 'Cmd+J'],
    ['Word: Insert Link', 'Ctrl+K', 'Cmd+K'], ['Word: Increase Font Size', 'Ctrl+Shift+.', 'Cmd+Shift+.'],
    ['Word: Decrease Font Size', 'Ctrl+Shift+,', 'Cmd+Shift+,'], ['Word: Increase Font by 1 Point', 'Ctrl+]', 'Cmd+]'],
    ['Word: Decrease Font by 1 Point', 'Ctrl+[', 'Cmd+['], ['Word: Show Paragraph Marks', 'Ctrl+Shift+8', 'Cmd+8'],
    ['Word: Normal Style', 'Ctrl+Shift+N', 'Cmd+Shift+N'], ['Word: Heading 1', 'Ctrl+Alt+1', 'Cmd+Option+1'],
    ['Word: Heading 2', 'Ctrl+Alt+2', 'Cmd+Option+2'], ['Word: Heading 3', 'Ctrl+Alt+3', 'Cmd+Option+3'],
    ['Word: Page Break', 'Ctrl+Enter', 'Cmd+Enter'], ['Word: Line Break', 'Shift+Enter', 'Shift+Enter'],
    ['Word: Small Caps', 'Ctrl+Shift+K', 'Cmd+Shift+K'], ['Word: Double Underline', 'Ctrl+Shift+D', 'Cmd+Shift+D'],
  ]),
  ...keys('windows', ['Microsoft Word', 'Review'], [
    ['Word: Track Changes', 'Ctrl+Shift+E'], ['Word: Insert Comment', 'Ctrl+Alt+M'],
    ['Word: Clear Character Formatting', 'Ctrl+Space'], ['Word: Clear Paragraph Formatting', 'Ctrl+Q'],
    ['Word: Find and Replace', 'Ctrl+H'], ['Word: Spelling and Grammar', 'F7'],
  ]),
  ...paired(['Google Docs', 'Google Workspace', 'Formatting'], [
    ['Google Docs: Insert Link', 'Ctrl+K', 'Cmd+K'], ['Google Docs: Superscript', 'Ctrl+.', 'Cmd+.'],
    ['Google Docs: Subscript', 'Ctrl+,', 'Cmd+,'], ['Google Docs: Bold', 'Ctrl+B', 'Cmd+B'],
    ['Google Docs: Italic', 'Ctrl+I', 'Cmd+I'], ['Google Docs: Underline', 'Ctrl+U', 'Cmd+U'],
    ['Google Docs: Strikethrough', 'Alt+Shift+5', 'Cmd+Shift+X'],
    ['Google Docs: Bulleted List', 'Ctrl+Shift+8', 'Cmd+Shift+8'], ['Google Docs: Numbered List', 'Ctrl+Shift+7', 'Cmd+Shift+7'],
    ['Google Docs: Checklist', 'Ctrl+Shift+9', 'Cmd+Shift+9'], ['Google Docs: Align Left', 'Ctrl+Shift+L', 'Cmd+Shift+L'],
    ['Google Docs: Center', 'Ctrl+Shift+E', 'Cmd+Shift+E'], ['Google Docs: Align Right', 'Ctrl+Shift+R', 'Cmd+Shift+R'],
    ['Google Docs: Justify', 'Ctrl+Shift+J', 'Cmd+Shift+J'], ['Google Docs: Increase Indent', 'Ctrl+]', 'Cmd+]'],
    ['Google Docs: Decrease Indent', 'Ctrl+[', 'Cmd+['], ['Google Docs: Clear Formatting', 'Ctrl+\\', 'Cmd+\\'],
    ['Google Docs: Copy Formatting', 'Ctrl+Alt+C', 'Cmd+Option+C'], ['Google Docs: Paste Formatting', 'Ctrl+Alt+V', 'Cmd+Option+V'],
    ['Google Docs: Increase Font Size', 'Ctrl+Shift+.', 'Cmd+Shift+.'], ['Google Docs: Decrease Font Size', 'Ctrl+Shift+,', 'Cmd+Shift+,'],
    ['Google Docs: Insert Comment', 'Ctrl+Alt+M', 'Cmd+Option+M'], ['Google Docs: Page Break', 'Ctrl+Enter', 'Cmd+Enter'],
    ['Google Docs: Menu Search', 'Alt+/', 'Option+/'], ['Google Docs: Keyboard Shortcuts', 'Ctrl+/', 'Cmd+/'],
  ]),
  ...Array.from({ length: 7 }, (_, i) => paired(['Google Docs', 'Styles'], [
    [`Google Docs: ${i === 0 ? 'Normal text' : `Heading ${i}`}`, `Ctrl+Alt+${i}`, `Cmd+Option+${i}`],
  ])).flat(),

  ...paired(['Microsoft PowerPoint', 'Microsoft Office', 'Presentations'], [
    ['PowerPoint: New Slide', 'Ctrl+M', 'Cmd+Shift+N'], ['PowerPoint: Duplicate Slide', 'Ctrl+Shift+D', 'Cmd+Shift+D'],
    ['PowerPoint: Duplicate Object', 'Ctrl+D', 'Cmd+D'], ['PowerPoint: New Presentation', 'Ctrl+N', 'Cmd+N'],
    ['PowerPoint: Insert Link', 'Ctrl+K', 'Cmd+K'], ['PowerPoint: Insert Comment', 'Ctrl+Alt+M', 'Cmd+Shift+M'],
    ['PowerPoint: Font Dialog', 'Ctrl+T', 'Cmd+T'],
    ['PowerPoint: Superscript', 'Ctrl+Shift+Equal', 'Cmd+Ctrl+Shift+Equal'],
    ['PowerPoint: Subscript', 'Ctrl+Equal', 'Cmd+Ctrl+Equal'],
    ['PowerPoint: Align Left', 'Ctrl+L', 'Cmd+L'], ['PowerPoint: Center', 'Ctrl+E', 'Cmd+E'],
    ['PowerPoint: Align Right', 'Ctrl+R', 'Cmd+R'], ['PowerPoint: Justify', 'Ctrl+J', 'Cmd+J'],
    ['PowerPoint: Next Slide', 'Page Down', 'Page Down'], ['PowerPoint: Previous Slide', 'Page Up', 'Page Up'],
    ['PowerPoint: Zoom In', 'Ctrl+Equal', 'Cmd+Equal'], ['PowerPoint: Zoom Out', 'Ctrl+Minus', 'Cmd+Minus'],
    ['PowerPoint: Fit to Window', 'Ctrl+Alt+O', 'Cmd+Option+O'],
    ['PowerPoint: Present from Beginning', 'F5', 'Cmd+Shift+Enter'],
    ['PowerPoint: Present from Current Slide', 'Shift+F5', 'Cmd+Enter'],
  ]),
  ...keys('windows', ['Microsoft PowerPoint', 'Outline'], [
    ['PowerPoint: Promote Paragraph', 'Alt+Shift+Left'], ['PowerPoint: Demote Paragraph', 'Alt+Shift+Right'],
    ['PowerPoint: Move Paragraph Up', 'Alt+Shift+Up'], ['PowerPoint: Move Paragraph Down', 'Alt+Shift+Down'],
  ]),
  ...[['Black Screen', 'B'], ['White Screen', 'W'], ['End Slideshow', 'Escape'], ['Next Build / Slide', 'N'], ['Previous Build / Slide', 'P']].map(([name, binding]): Shortcut => ({
    id: slug(`powerpoint-slideshow-${name}`), name: `PowerPoint: ${name}`,
    tags: [...BOTH, 'Microsoft PowerPoint', 'Slideshow'], binding: binding!, action: keyboardAction(binding!),
  })),

  ...paired(['Visual Studio Code', 'VS Code', 'Programming'], [
    ['VS Code: Command Palette', 'Ctrl+Shift+P', 'Cmd+Shift+P'], ['VS Code: Quick Open', 'Ctrl+P', 'Cmd+P'],
    ['VS Code: Go to Line', 'Ctrl+G', 'Ctrl+G'], ['VS Code: Go to Symbol', 'Ctrl+Shift+O', 'Cmd+Shift+O'],
    ['VS Code: Search Files', 'Ctrl+Shift+F', 'Cmd+Shift+F'], ['VS Code: Replace in Files', 'Ctrl+Shift+H', 'Cmd+Shift+H'],
    ['VS Code: Toggle Comment', 'Ctrl+/', 'Cmd+/'], ['VS Code: Format Document', 'Alt+Shift+F', 'Option+Shift+F'],
    ['VS Code: Delete Line', 'Ctrl+Shift+K', 'Cmd+Shift+K'], ['VS Code: Insert Line Below', 'Ctrl+Enter', 'Cmd+Enter'],
    ['VS Code: Insert Line Above', 'Ctrl+Shift+Enter', 'Cmd+Shift+Enter'],
    ['VS Code: Select Next Match', 'Ctrl+D', 'Cmd+D'], ['VS Code: Select All Matches', 'Ctrl+Shift+L', 'Cmd+Shift+L'],
    ['VS Code: Toggle Sidebar', 'Ctrl+B', 'Cmd+B'], ['VS Code: Toggle Panel', 'Ctrl+J', 'Cmd+J'],
    ['VS Code: Integrated Terminal', 'Ctrl+`', 'Ctrl+`'], ['VS Code: Split Editor', 'Ctrl+\\', 'Cmd+\\'],
    ['VS Code: Problems', 'Ctrl+Shift+M', 'Cmd+Shift+M'], ['VS Code: Settings', 'Ctrl+,', 'Cmd+,'],
  ]),
  ...['Up', 'Down'].flatMap((direction) => paired(['Visual Studio Code', 'VS Code', 'Programming'], [
    [`VS Code: Move Line ${direction}`, `Alt+${direction}`, `Option+${direction}`],
    [`VS Code: Copy Line ${direction}`, `Alt+Shift+${direction}`, `Option+Shift+${direction}`],
  ])),
  ...[['Rename Symbol', 'F2'], ['Start / Continue Debugging', 'F5'], ['Next Problem', 'F8'], ['Toggle Breakpoint', 'F9'], ['Step Over', 'F10'], ['Step Into', 'F11'], ['Go to Definition', 'F12']].map(([name, binding]): Shortcut => ({
    id: slug(`vscode-${name}`), name: `VS Code: ${name}`,
    tags: [...BOTH, 'Visual Studio Code', 'VS Code', 'Programming', 'Debugging'], binding: binding!, action: keyboardAction(binding!),
  })),

  {
    id: 'tmux-prefix', name: 'tmux: Prefix (Ctrl+B)',
    tags: [...BOTH, 'tmux', 'Terminal', 'Keyboard', 'Prefix'], binding: 'Ctrl+B',
    note: 'Default tmux prefix. Send it before a command key; customized tmux bindings may differ.',
    action: keyboardAction('Ctrl+B'),
  },
  ...([
    ['New Window', 'C'], ['Next Window', 'N'], ['Previous Window', 'P'],
    ['Last Window', 'L'], ['Choose Window', 'W'], ['Rename Window', ','],
    ['Split Pane Left/Right', 'Shift+5'], ['Split Pane Top/Bottom', "Shift+'"],
    ['Next Pane', 'O'], ['Last Pane', ';'], ['Show Pane Numbers', 'Q'],
    ['Toggle Pane Zoom', 'Z'], ['Next Pane Layout', 'Space'],
    ['Break Pane into Window', 'Shift+1'], ['Swap Pane with Previous', 'Shift+['],
    ['Swap Pane with Next', 'Shift+]'], ['Close Pane (Confirm)', 'X'],
    ['Close Window (Confirm)', 'Shift+7'], ['Choose Session', 'S'],
    ['Rename Session', 'Shift+4'], ['Detach Client', 'D'],
    ['Copy Mode', '['], ['Paste Buffer', ']'], ['Command Prompt', 'Shift+;'],
    ['List Key Bindings', 'Shift+/'],
    ...Array.from({ length: 10 }, (_, i): Entry => [`Select Window ${i}`, `${i}`]),
    ...['Left', 'Right', 'Up', 'Down'].flatMap((direction): Entry[] => [
      [`Select Pane ${direction}`, direction],
      [`Resize Pane ${direction} (1 Cell)`, `Ctrl+${direction}`],
      [`Resize Pane ${direction} (5 Cells)`, `Alt+${direction}`],
    ]),
  ] satisfies Entry[]).map(([name, binding]): Shortcut => ({
    id: slug(`tmux-${name}`), name: `tmux: ${name}`,
    tags: [...BOTH, 'tmux', 'Terminal', 'Keyboard', 'After prefix'],
    binding: `After prefix: ${binding}`,
    note: 'Sends only the command key. Press the tmux prefix first (default Ctrl+B), usually before each command. Uses default tmux bindings and a US keyboard layout.',
    action: keyboardAction(binding),
  })),

  ...snippets('Markdown', [
    ['Inline Code Markers', '``'], ['Code Block', '```\n\n```'], ['Code Fence (Opening)', '```\n'],
    ['Block Quote', '> '], ['Nested Block Quote', '> > '], ['Bulleted List', '- '], ['Numbered List', '1. '],
    ['Task List (Unchecked)', '- [ ] '], ['Task List (Checked)', '- [x] '], ['Bold Markers', '****'],
    ['Italic Markers', '**'], ['Strikethrough Markers (GFM)', '~~~~'], ['Link Template', '[text](url)'],
    ['Image Template', '![alt](url)'], ['Horizontal Rule', '\n---\n'],
    ['Table Template (GFM)', '| Column | Column |\n| --- | --- |\n|  |  |'],
    ...Array.from({ length: 6 }, (_, i): Entry => [`Heading ${i + 1}`, `${'#'.repeat(i + 1)} `]),
  ]),
  ...snippets('Vim', [
    ['Move Left', 'h'], ['Move Down', 'j'], ['Move Up', 'k'], ['Move Right', 'l'],
    ['Next Word', 'w'], ['Previous Word', 'b'], ['End of Word', 'e'], ['Next WORD (Whitespace)', 'W'],
    ['Line Start', '0'], ['First Nonblank Character', '^'], ['Line End', '$'],
    ['Document Start', 'gg'], ['Document End', 'G'], ['Matching Bracket', '%'],
    ['Next Paragraph', '}'], ['Previous Paragraph', '{'],
    ['Insert Before Cursor', 'i'], ['Append After Cursor', 'a'], ['Insert at Line Start', 'I'],
    ['Append at Line End', 'A'], ['Open Line Below', 'o'], ['Open Line Above', 'O'],
    ['Delete Character', 'x'], ['Delete Line', 'dd'], ['Delete Word', 'dw'], ['Delete to Line End', 'D'],
    ['Change Word', 'cw'], ['Change Line', 'cc'], ['Change to Line End', 'C'],
    ['Yank Line', 'yy'], ['Yank Word', 'yw'], ['Paste After', 'p'], ['Paste Before', 'P'],
    ['Undo', 'u'], ['Repeat Last Change', '.'], ['Join Lines', 'J'], ['Toggle Case', '~'],
    ['Visual Mode', 'v'], ['Visual Line Mode', 'V'], ['Search Forward', '/'], ['Search Backward', '?'],
    ['Next Search Match', 'n'], ['Previous Search Match', 'N'], ['Search Word Forward', '*'], ['Search Word Backward', '#'],
    ['Indent Line', '>>'], ['Unindent Line', '<<'], ['Center Cursor Line', 'zz'], ['Cursor Line to Top', 'zt'], ['Cursor Line to Bottom', 'zb'],
    ['Save', ':w\n'], ['Save and Quit', ':wq\n'], ['Quit', ':q\n'], ['Quit without Saving', ':q!\n'],
    ['Clear Search Highlighting', ':nohlsearch\n'], ['Next Buffer', ':bnext\n'], ['Previous Buffer', ':bprevious\n'],
    ['Split Horizontally', ':split\n'], ['Split Vertically', ':vsplit\n'], ['Toggle Line Numbers', ':set number!\n'],
  ]),
  ...keys('windows', ['Vim', 'Normal mode'], [
    ['Vim: Normal Mode (Escape)', 'Escape'], ['Vim: Redo', 'Ctrl+R'], ['Vim: Page Down', 'Ctrl+F'],
    ['Vim: Page Up', 'Ctrl+B'], ['Vim: Half Page Down', 'Ctrl+D'], ['Vim: Half Page Up', 'Ctrl+U'],
    ['Vim: Visual Block Mode', 'Ctrl+V'],
  ]).map((shortcut) => ({ ...shortcut, id: shortcut.id.replace(/-windows$/, ''), tags: [...BOTH, 'Vim', 'Normal mode', 'Keyboard'] })),
  ...KEYS.map((key): Shortcut => ({
    id: `key-${key.usage.toString(16)}`, name: key.name, tags: [...BOTH, 'Standard keys', 'Keyboard', key.group],
    binding: key.name, action: { type: 'keyTap', usage: key.usage, modifiers: 0 },
  })),
  ...['Left', 'Right', 'Up', 'Down'].map((direction): Shortcut => ({
    id: `select-${direction.toLowerCase()}`, name: `Select ${direction.toLowerCase()}`,
    tags: [...BOTH, 'Text editing', 'Selection'], binding: `Shift+${direction}`, action: keyboardAction(`Shift+${direction}`),
  })),
  ...CONSUMER_USAGES.map((control): Shortcut => ({
    id: slug(control.name), name: control.group === 'Browser' ? `Media Key: ${control.name}` : control.name,
    tags: [...BOTH, 'Media', control.group, ...(control.group === 'Display' ? ['System', 'Hardware dependent'] : [])],
    note: 'Host, application, or display support is required for consumer media keys.',
    action: { type: 'consumer', usage: control.usage },
  })),
  ...macMedia([
    ['Fine Brightness Up', 'Option+Shift+Brightness Up', 0x6f, MOD_ALT | MOD_SHIFT, DISPLAY_SUPPORT, 'Display', 'Fine', 'Small steps', 'Hardware dependent'],
    ['Fine Brightness Down', 'Option+Shift+Brightness Down', 0x70, MOD_ALT | MOD_SHIFT, DISPLAY_SUPPORT, 'Display', 'Fine', 'Small steps', 'Hardware dependent'],
    ['Fine Volume Up', 'Option+Shift+Volume Up', 0xe9, MOD_ALT | MOD_SHIFT, 'Adjusts macOS volume in smaller steps; the audio output must support volume control.', 'Volume', 'Audio', 'Fine', 'Small steps'],
    ['Fine Volume Down', 'Option+Shift+Volume Down', 0xea, MOD_ALT | MOD_SHIFT, 'Adjusts macOS volume in smaller steps; the audio output must support volume control.', 'Volume', 'Audio', 'Fine', 'Small steps'],
    ['Volume Up (Reverse Audio Feedback)', 'Shift+Volume Up', 0xe9, MOD_SHIFT, VOLUME_FEEDBACK, 'Volume', 'Audio', 'Silent', 'Without audio feedback'],
    ['Volume Down (Reverse Audio Feedback)', 'Shift+Volume Down', 0xea, MOD_SHIFT, VOLUME_FEEDBACK, 'Volume', 'Audio', 'Silent', 'Without audio feedback'],
    ['Open Display Settings', 'Option+Brightness Up', 0x6f, MOD_ALT, 'Opens macOS Displays settings.', 'Display', 'Brightness', 'Settings'],
    ['Open Sound Settings', 'Option+Volume Up', 0xe9, MOD_ALT, 'Opens macOS Sound settings.', 'Volume', 'Audio', 'Settings'],
    ['External Display Brightness Up', 'Ctrl+Brightness Up', 0x6f, MOD_CTRL, EXTERNAL_DISPLAY_SUPPORT, 'Display', 'External monitor', 'Hardware dependent'],
    ['External Display Brightness Down', 'Ctrl+Brightness Down', 0x70, MOD_CTRL, EXTERNAL_DISPLAY_SUPPORT, 'Display', 'External monitor', 'Hardware dependent'],
    ['Fine External Display Brightness Up', 'Ctrl+Option+Shift+Brightness Up', 0x6f, MOD_CTRL | MOD_ALT | MOD_SHIFT, EXTERNAL_DISPLAY_SUPPORT, 'Display', 'External monitor', 'Fine', 'Small steps', 'Hardware dependent'],
    ['Fine External Display Brightness Down', 'Ctrl+Option+Shift+Brightness Down', 0x70, MOD_CTRL | MOD_ALT | MOD_SHIFT, EXTERNAL_DISPLAY_SUPPORT, 'Display', 'External monitor', 'Fine', 'Small steps', 'Hardware dependent'],
    ['Toggle Display Mirroring', 'Cmd+Brightness Down', 0x70, MOD_GUI, 'Toggles macOS video mirroring when more than one display is connected.', 'Display', 'External monitor', 'Mirroring'],
  ]),
];

export function filterShortcuts(os: ShortcutFilter, query: string): readonly Shortcut[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return SHORTCUTS.filter((shortcut) => {
    if (os !== 'all' && !shortcut.tags.includes(os)) return false;
    const searchable = `${shortcut.name} ${shortcut.binding ?? ''} ${shortcut.tags.join(' ')}`.toLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}
