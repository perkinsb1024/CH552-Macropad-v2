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

// References and firmware limits: webapp/SHORTCUTS.md.
export const SHORTCUTS: readonly Shortcut[] = [
  ...paired(['Editing', 'Clipboard'], [
    ['Cut', 'Ctrl+X', 'Cmd+X'], ['Copy', 'Ctrl+C', 'Cmd+C'], ['Paste', 'Ctrl+V', 'Cmd+V'],
    ['Select all', 'Ctrl+A', 'Cmd+A'], ['Undo', 'Ctrl+Z', 'Cmd+Z'], ['Redo', 'Ctrl+Y', 'Cmd+Shift+Z'],
    ['Paste without formatting', 'Ctrl+Shift+V', 'Cmd+Shift+Option+V'],
  ]),
  ...paired(['Documents', 'Productivity'], [
    ['New document', 'Ctrl+N', 'Cmd+N'], ['Open', 'Ctrl+O', 'Cmd+O'], ['Save', 'Ctrl+S', 'Cmd+S'],
    ['Save as', 'Ctrl+Shift+S', 'Cmd+Shift+S'], ['Print', 'Ctrl+P', 'Cmd+P'], ['Find', 'Ctrl+F', 'Cmd+F'],
    ['Bold', 'Ctrl+B', 'Cmd+B'], ['Italic', 'Ctrl+I', 'Cmd+I'], ['Underline', 'Ctrl+U', 'Cmd+U'],
  ]),
  ...paired(['Browser', 'Google Chrome', 'Microsoft Edge'], [
    ['New tab', 'Ctrl+T', 'Cmd+T'], ['Close tab', 'Ctrl+W', 'Cmd+W'],
    ['Reopen closed tab', 'Ctrl+Shift+T', 'Cmd+Shift+T'], ['New browser window', 'Ctrl+N', 'Cmd+N'],
    ['New private window', 'Ctrl+Shift+N', 'Cmd+Shift+N'],
    ['Next tab', 'Ctrl+Tab', 'Ctrl+Tab'], ['Previous tab', 'Ctrl+Shift+Tab', 'Ctrl+Shift+Tab'],
    ['Address bar', 'Ctrl+L', 'Cmd+L'], ['Reload page', 'Ctrl+R', 'Cmd+R'],
    ['Reload (ignore cache)', 'Ctrl+Shift+R', 'Cmd+Shift+R'],
    ['Find next', 'Ctrl+G', 'Cmd+G'], ['Find previous', 'Ctrl+Shift+G', 'Cmd+Shift+G'],
    ['Bookmark page', 'Ctrl+D', 'Cmd+D'], ['Bookmark all tabs', 'Ctrl+Shift+D', 'Cmd+Shift+D'],
    ['Bookmarks bar', 'Ctrl+Shift+B', 'Cmd+Shift+B'], ['Downloads', 'Ctrl+J', 'Cmd+Shift+J'],
    ['Browser history', 'Ctrl+H', 'Cmd+Y'], ['Zoom in', 'Ctrl+Equal', 'Cmd+Equal'],
    ['Zoom out', 'Ctrl+Minus', 'Cmd+Minus'], ['Reset zoom', 'Ctrl+0', 'Cmd+0'],
    ['Browser back', 'Alt+Left', 'Cmd+['], ['Browser forward', 'Alt+Right', 'Cmd+]'],
    ['Developer tools console', 'Ctrl+Shift+J', 'Cmd+Option+J'],
  ]),
  ...Array.from({ length: 9 }, (_, i) => paired(['Browser', 'Tabs'], [
    [`Switch to tab ${i === 8 ? 'last' : i + 1}`, `Ctrl+${i + 1}`, `Cmd+${i + 1}`],
  ])).flat(),

  ...keys('mac', ['macOS', 'Navigation', 'Windows management'], [
    ['Previous space', 'Ctrl+Left'], ['Next space', 'Ctrl+Right'], ['Mission Control', 'Ctrl+Up'],
    ['App windows (App Exposé)', 'Ctrl+Down'], ['Quit app', 'Cmd+Q'], ['Close window', 'Cmd+W'],
    ['Close all windows', 'Cmd+Option+W'], ['Force Quit dialog', 'Cmd+Option+Escape'],
    ['Switch app', 'Cmd+Tab'], ['Switch app (previous)', 'Cmd+Shift+Tab'],
    ['Switch window', 'Cmd+`'], ['Switch window (previous)', 'Cmd+Shift+`'],
    ['Hide app', 'Cmd+H'], ['Hide other apps', 'Cmd+Option+H'], ['Minimize window', 'Cmd+M'],
    ['Minimize all windows', 'Cmd+Option+M'], ['Toggle full screen', 'Ctrl+Cmd+F'],
    ['Toggle Dock', 'Cmd+Option+D'], ['App settings', 'Cmd+,'],
  ]),
  ...keys('mac', ['macOS', 'System'], [
    ['Spotlight', 'Cmd+Space'], ['Emoji picker', 'Ctrl+Cmd+Space'],
    ['Lock screen', 'Ctrl+Cmd+Q'], ['Log out (confirm)', 'Cmd+Shift+Q'],
    ['Log out (immediately)', 'Cmd+Shift+Option+Q'], ['Accessibility options', 'Cmd+Option+F5'],
    ['Previous input source', 'Ctrl+Space'], ['Next input source', 'Ctrl+Option+Space'],
  ]),
  ...keys('mac', ['macOS', 'Screenshot', 'Screen recording'], [
    ['Screenshot (save, full screen)', 'Cmd+Shift+3'], ['Screenshot (clipboard, full screen)', 'Ctrl+Cmd+Shift+3'],
    ['Screenshot (save, selection)', 'Cmd+Shift+4'], ['Screenshot (clipboard, selection)', 'Ctrl+Cmd+Shift+4'],
    ['Screenshot / recording toolbar', 'Cmd+Shift+5'],
  ]),
  ...keys('mac', ['macOS', 'Siri', 'macOS 27+'], [
    ['Siri (active window, macOS 27+)', 'Cmd+Shift+Space'], ['Siri (selection, macOS 27+)', 'Cmd+Shift+6'],
  ]).map((shortcut) => ({ ...shortcut, note: 'Requires macOS 27 or later with Siri AI enabled.' })),
  ...keys('mac', ['macOS', 'Finder', 'Files'], [
    ['Finder: New window', 'Cmd+N'], ['Finder: New folder', 'Cmd+Shift+N'],
    ['Finder: Go to folder', 'Cmd+Shift+G'], ['Finder: Home folder', 'Cmd+Shift+H'],
    ['Finder: Desktop', 'Cmd+Shift+D'], ['Finder: Documents', 'Cmd+Shift+O'],
    ['Finder: Downloads', 'Cmd+Option+L'], ['Finder: Utilities', 'Cmd+Shift+U'],
    ['Finder: Computer', 'Cmd+Shift+C'], ['Finder: AirDrop', 'Cmd+Shift+R'],
    ['Finder: iCloud Drive', 'Cmd+Shift+I'], ['Finder: Connect to server', 'Cmd+K'],
    ['Finder: Get info', 'Cmd+I'], ['Finder: Duplicate', 'Cmd+D'], ['Finder: Quick Look', 'Space'],
    ['Finder: Move to Trash', 'Cmd+Backspace'], ['Finder: Empty Trash (confirm)', 'Cmd+Shift+Backspace'],
    ['Finder: Move pasted files', 'Cmd+Option+V'], ['Finder: Eject selected disk', 'Cmd+E'],
    ['Finder: Parent folder', 'Cmd+Up'], ['Finder: Open selection', 'Cmd+Down'],
    ['Finder: Icons view', 'Cmd+1'], ['Finder: List view', 'Cmd+2'],
    ['Finder: Columns view', 'Cmd+3'], ['Finder: Gallery view', 'Cmd+4'],
    ['Finder: Toggle hidden files', 'Cmd+Shift+.'], ['Finder: View options', 'Cmd+J'],
  ]),

  ...keys('windows', ['Windows', 'System'], [
    ['Run', 'Win+R'], ['Windows Security screen', 'Ctrl+Alt+Delete'], ['Close window / app', 'Alt+F4'],
    ['Task Manager', 'Ctrl+Shift+Escape'], ['Lock screen', 'Win+L'], ['Start menu', 'Ctrl+Escape'],
    ['Settings', 'Win+I'], ['File Explorer', 'Win+E'], ['Search', 'Win+S'],
    ['Quick Link menu', 'Win+X'], ['Quick Settings', 'Win+A'], ['Notifications', 'Win+N'],
    ['Clipboard history', 'Win+V'], ['Emoji picker', 'Win+.'], ['Voice typing', 'Win+H'],
    ['Project display', 'Win+P'], ['Connect wireless display', 'Win+K'],
    ['Switch keyboard language', 'Win+Space'], ['Accessibility settings', 'Win+U'],
    ['Magnifier zoom in', 'Win+Equal'], ['Magnifier zoom out', 'Win+Minus'],
    ['Close Magnifier', 'Win+Escape'], ['Color filters', 'Win+Ctrl+C'],
  ]),
  ...keys('windows', ['Windows', 'Navigation', 'Windows management'], [
    ['Switch app', 'Alt+Tab'], ['Switch app (previous)', 'Alt+Shift+Tab'], ['Task View', 'Win+Tab'],
    ['Show desktop', 'Win+D'], ['Minimize all windows', 'Win+M'],
    ['Restore minimized windows', 'Win+Shift+M'], ['Snap window left', 'Win+Left'],
    ['Snap window right', 'Win+Right'], ['Maximize window', 'Win+Up'],
    ['Restore / minimize window', 'Win+Down'], ['Snap layouts', 'Win+Z'],
    ['Move window to previous monitor', 'Win+Shift+Left'], ['Move window to next monitor', 'Win+Shift+Right'],
    ['New virtual desktop', 'Win+Ctrl+D'], ['Close virtual desktop', 'Win+Ctrl+F4'],
    ['Previous virtual desktop', 'Win+Ctrl+Left'], ['Next virtual desktop', 'Win+Ctrl+Right'],
    ['Window system menu', 'Alt+Space'], ['Context menu', 'Shift+F10'],
  ]),
  ...keys('windows', ['Windows', 'Screenshot', 'Screen recording'], [
    ['Screenshot (selection / snipping)', 'Win+Shift+S'], ['Screenshot (save, full screen)', 'Win+Print Screen'],
    ['Screenshot (clipboard, active window)', 'Alt+Print Screen'], ['Xbox Game Bar', 'Win+G'],
    ['Record active app', 'Win+Alt+R'],
  ]),
  ...keys('windows', ['Windows', 'File Explorer', 'Files'], [
    ['Refresh', 'F5'], ['Rename', 'F2'], ['File Explorer: New folder', 'Ctrl+Shift+N'],
    ['File Explorer: Properties', 'Alt+Enter'], ['File Explorer: Parent folder', 'Alt+Up'],
    ['File Explorer: Preview pane', 'Alt+P'], ['File Explorer: Address bar', 'Alt+D'],
    ['File Explorer: New window', 'Ctrl+N'], ['File Explorer: Delete permanently', 'Shift+Delete'],
  ]),

  ...paired(['Navigation', 'Text editing'], [
    ['Previous word', 'Ctrl+Left', 'Option+Left'], ['Next word', 'Ctrl+Right', 'Option+Right'],
    ['Previous paragraph', 'Ctrl+Up', 'Option+Up'], ['Next paragraph', 'Ctrl+Down', 'Option+Down'],
    ['Line start', 'Home', 'Cmd+Left'], ['Line end', 'End', 'Cmd+Right'],
    ['Document start', 'Ctrl+Home', 'Cmd+Up'], ['Document end', 'Ctrl+End', 'Cmd+Down'],
    ['Select previous word', 'Ctrl+Shift+Left', 'Option+Shift+Left'], ['Select next word', 'Ctrl+Shift+Right', 'Option+Shift+Right'],
    ['Select to line start', 'Shift+Home', 'Cmd+Shift+Left'], ['Select to line end', 'Shift+End', 'Cmd+Shift+Right'],
    ['Select to document start', 'Ctrl+Shift+Home', 'Cmd+Shift+Up'], ['Select to document end', 'Ctrl+Shift+End', 'Cmd+Shift+Down'],
    ['Delete previous word', 'Ctrl+Backspace', 'Option+Backspace'], ['Delete next word', 'Ctrl+Delete', 'Option+Delete'],
  ]),
  ...keys('mac', ['Text editing', 'Terminal'], [
    ['Delete to line start', 'Cmd+Backspace'], ['Emacs: Line start', 'Ctrl+A'], ['Emacs: Line end', 'Ctrl+E'],
    ['Emacs: Delete to line end', 'Ctrl+K'], ['Emacs: Previous character', 'Ctrl+B'], ['Emacs: Next character', 'Ctrl+F'],
    ['Emacs: Previous line', 'Ctrl+P'], ['Emacs: Next line', 'Ctrl+N'],
  ]),

  ...paired(['Microsoft Word', 'Microsoft Office', 'Formatting'], [
    ['Word: Superscript', 'Ctrl+Shift+Equal', 'Cmd+Shift+Equal'], ['Word: Subscript', 'Ctrl+Shift+Minus', 'Cmd+Shift+Minus'],
    ['Word: Bulleted list', 'Ctrl+Shift+L', 'Cmd+Shift+L'], ['Word: Align left', 'Ctrl+L', 'Cmd+L'],
    ['Word: Center', 'Ctrl+E', 'Cmd+E'], ['Word: Align right', 'Ctrl+R', 'Cmd+R'], ['Word: Justify', 'Ctrl+J', 'Cmd+J'],
    ['Word: Insert link', 'Ctrl+K', 'Cmd+K'], ['Word: Increase font size', 'Ctrl+Shift+.', 'Cmd+Shift+.'],
    ['Word: Decrease font size', 'Ctrl+Shift+,', 'Cmd+Shift+,'], ['Word: Increase font by 1 point', 'Ctrl+]', 'Cmd+]'],
    ['Word: Decrease font by 1 point', 'Ctrl+[', 'Cmd+['], ['Word: Show paragraph marks', 'Ctrl+Shift+8', 'Cmd+8'],
    ['Word: Normal style', 'Ctrl+Shift+N', 'Cmd+Shift+N'], ['Word: Heading 1', 'Ctrl+Alt+1', 'Cmd+Option+1'],
    ['Word: Heading 2', 'Ctrl+Alt+2', 'Cmd+Option+2'], ['Word: Heading 3', 'Ctrl+Alt+3', 'Cmd+Option+3'],
    ['Word: Page break', 'Ctrl+Enter', 'Cmd+Enter'], ['Word: Line break', 'Shift+Enter', 'Shift+Enter'],
    ['Word: Small caps', 'Ctrl+Shift+K', 'Cmd+Shift+K'], ['Word: Double underline', 'Ctrl+Shift+D', 'Cmd+Shift+D'],
  ]),
  ...keys('windows', ['Microsoft Word', 'Review'], [
    ['Word: Track changes', 'Ctrl+Shift+E'], ['Word: Insert comment', 'Ctrl+Alt+M'],
    ['Word: Clear character formatting', 'Ctrl+Space'], ['Word: Clear paragraph formatting', 'Ctrl+Q'],
    ['Word: Find and replace', 'Ctrl+H'], ['Word: Spelling and grammar', 'F7'],
  ]),
  ...paired(['Google Docs', 'Google Workspace', 'Formatting'], [
    ['Google Docs: Insert link', 'Ctrl+K', 'Cmd+K'], ['Google Docs: Superscript', 'Ctrl+.', 'Cmd+.'],
    ['Google Docs: Subscript', 'Ctrl+,', 'Cmd+,'], ['Google Docs: Bold', 'Ctrl+B', 'Cmd+B'],
    ['Google Docs: Italic', 'Ctrl+I', 'Cmd+I'], ['Google Docs: Underline', 'Ctrl+U', 'Cmd+U'],
    ['Google Docs: Strikethrough', 'Alt+Shift+5', 'Cmd+Shift+X'],
    ['Google Docs: Bulleted list', 'Ctrl+Shift+8', 'Cmd+Shift+8'], ['Google Docs: Numbered list', 'Ctrl+Shift+7', 'Cmd+Shift+7'],
    ['Google Docs: Checklist', 'Ctrl+Shift+9', 'Cmd+Shift+9'], ['Google Docs: Align left', 'Ctrl+Shift+L', 'Cmd+Shift+L'],
    ['Google Docs: Center', 'Ctrl+Shift+E', 'Cmd+Shift+E'], ['Google Docs: Align right', 'Ctrl+Shift+R', 'Cmd+Shift+R'],
    ['Google Docs: Justify', 'Ctrl+Shift+J', 'Cmd+Shift+J'], ['Google Docs: Increase indent', 'Ctrl+]', 'Cmd+]'],
    ['Google Docs: Decrease indent', 'Ctrl+[', 'Cmd+['], ['Google Docs: Clear formatting', 'Ctrl+\\', 'Cmd+\\'],
    ['Google Docs: Copy formatting', 'Ctrl+Alt+C', 'Cmd+Option+C'], ['Google Docs: Paste formatting', 'Ctrl+Alt+V', 'Cmd+Option+V'],
    ['Google Docs: Increase font size', 'Ctrl+Shift+.', 'Cmd+Shift+.'], ['Google Docs: Decrease font size', 'Ctrl+Shift+,', 'Cmd+Shift+,'],
    ['Google Docs: Insert comment', 'Ctrl+Alt+M', 'Cmd+Option+M'], ['Google Docs: Page break', 'Ctrl+Enter', 'Cmd+Enter'],
    ['Google Docs: Menu search', 'Alt+/', 'Option+/'], ['Google Docs: Keyboard shortcuts', 'Ctrl+/', 'Cmd+/'],
  ]),
  ...Array.from({ length: 7 }, (_, i) => paired(['Google Docs', 'Styles'], [
    [`Google Docs: ${i === 0 ? 'Normal text' : `Heading ${i}`}`, `Ctrl+Alt+${i}`, `Cmd+Option+${i}`],
  ])).flat(),

  ...paired(['Microsoft PowerPoint', 'Microsoft Office', 'Presentations'], [
    ['PowerPoint: New slide', 'Ctrl+M', 'Cmd+Shift+N'], ['PowerPoint: Duplicate slide', 'Ctrl+Shift+D', 'Cmd+Shift+D'],
    ['PowerPoint: Duplicate object', 'Ctrl+D', 'Cmd+D'], ['PowerPoint: New presentation', 'Ctrl+N', 'Cmd+N'],
    ['PowerPoint: Insert link', 'Ctrl+K', 'Cmd+K'], ['PowerPoint: Insert comment', 'Ctrl+Alt+M', 'Cmd+Shift+M'],
    ['PowerPoint: Font dialog', 'Ctrl+T', 'Cmd+T'],
    ['PowerPoint: Superscript', 'Ctrl+Shift+Equal', 'Cmd+Ctrl+Shift+Equal'],
    ['PowerPoint: Subscript', 'Ctrl+Equal', 'Cmd+Ctrl+Equal'],
    ['PowerPoint: Align left', 'Ctrl+L', 'Cmd+L'], ['PowerPoint: Center', 'Ctrl+E', 'Cmd+E'],
    ['PowerPoint: Align right', 'Ctrl+R', 'Cmd+R'], ['PowerPoint: Justify', 'Ctrl+J', 'Cmd+J'],
    ['PowerPoint: Next slide', 'Page Down', 'Page Down'], ['PowerPoint: Previous slide', 'Page Up', 'Page Up'],
    ['PowerPoint: Zoom in', 'Ctrl+Equal', 'Cmd+Equal'], ['PowerPoint: Zoom out', 'Ctrl+Minus', 'Cmd+Minus'],
    ['PowerPoint: Fit to window', 'Ctrl+Alt+O', 'Cmd+Option+O'],
    ['PowerPoint: Present from beginning', 'F5', 'Cmd+Shift+Enter'],
    ['PowerPoint: Present from current slide', 'Shift+F5', 'Cmd+Enter'],
  ]),
  ...keys('windows', ['Microsoft PowerPoint', 'Outline'], [
    ['PowerPoint: Promote paragraph', 'Alt+Shift+Left'], ['PowerPoint: Demote paragraph', 'Alt+Shift+Right'],
    ['PowerPoint: Move paragraph up', 'Alt+Shift+Up'], ['PowerPoint: Move paragraph down', 'Alt+Shift+Down'],
  ]),
  ...[['Black screen', 'B'], ['White screen', 'W'], ['End slideshow', 'Escape'], ['Next build / slide', 'N'], ['Previous build / slide', 'P']].map(([name, binding]): Shortcut => ({
    id: slug(`powerpoint-slideshow-${name}`), name: `PowerPoint: ${name}`,
    tags: [...BOTH, 'Microsoft PowerPoint', 'Slideshow'], binding: binding!, action: keyboardAction(binding!),
  })),

  ...paired(['Visual Studio Code', 'VS Code', 'Programming'], [
    ['VS Code: Command palette', 'Ctrl+Shift+P', 'Cmd+Shift+P'], ['VS Code: Quick open', 'Ctrl+P', 'Cmd+P'],
    ['VS Code: Go to line', 'Ctrl+G', 'Ctrl+G'], ['VS Code: Go to symbol', 'Ctrl+Shift+O', 'Cmd+Shift+O'],
    ['VS Code: Search files', 'Ctrl+Shift+F', 'Cmd+Shift+F'], ['VS Code: Replace in files', 'Ctrl+Shift+H', 'Cmd+Shift+H'],
    ['VS Code: Toggle comment', 'Ctrl+/', 'Cmd+/'], ['VS Code: Format document', 'Alt+Shift+F', 'Option+Shift+F'],
    ['VS Code: Delete line', 'Ctrl+Shift+K', 'Cmd+Shift+K'], ['VS Code: Insert line below', 'Ctrl+Enter', 'Cmd+Enter'],
    ['VS Code: Insert line above', 'Ctrl+Shift+Enter', 'Cmd+Shift+Enter'],
    ['VS Code: Select next match', 'Ctrl+D', 'Cmd+D'], ['VS Code: Select all matches', 'Ctrl+Shift+L', 'Cmd+Shift+L'],
    ['VS Code: Toggle sidebar', 'Ctrl+B', 'Cmd+B'], ['VS Code: Toggle panel', 'Ctrl+J', 'Cmd+J'],
    ['VS Code: Integrated terminal', 'Ctrl+`', 'Ctrl+`'], ['VS Code: Split editor', 'Ctrl+\\', 'Cmd+\\'],
    ['VS Code: Problems', 'Ctrl+Shift+M', 'Cmd+Shift+M'], ['VS Code: Settings', 'Ctrl+,', 'Cmd+,'],
  ]),
  ...['Up', 'Down'].flatMap((direction) => paired(['Visual Studio Code', 'VS Code', 'Programming'], [
    [`VS Code: Move line ${direction.toLowerCase()}`, `Alt+${direction}`, `Option+${direction}`],
    [`VS Code: Copy line ${direction.toLowerCase()}`, `Alt+Shift+${direction}`, `Option+Shift+${direction}`],
  ])),
  ...[['Rename symbol', 'F2'], ['Start / continue debugging', 'F5'], ['Next problem', 'F8'], ['Toggle breakpoint', 'F9'], ['Step over', 'F10'], ['Step into', 'F11'], ['Go to definition', 'F12']].map(([name, binding]): Shortcut => ({
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
    ['New window', 'C'], ['Next window', 'N'], ['Previous window', 'P'],
    ['Last window', 'L'], ['Choose window', 'W'], ['Rename window', ','],
    ['Split pane left/right', 'Shift+5'], ['Split pane top/bottom', "Shift+'"],
    ['Next pane', 'O'], ['Last pane', ';'], ['Show pane numbers', 'Q'],
    ['Toggle pane zoom', 'Z'], ['Next pane layout', 'Space'],
    ['Break pane into window', 'Shift+1'], ['Swap pane with previous', 'Shift+['],
    ['Swap pane with next', 'Shift+]'], ['Close pane (confirm)', 'X'],
    ['Close window (confirm)', 'Shift+7'], ['Choose session', 'S'],
    ['Rename session', 'Shift+4'], ['Detach client', 'D'],
    ['Copy mode', '['], ['Paste buffer', ']'], ['Command prompt', 'Shift+;'],
    ['List key bindings', 'Shift+/'],
    ...Array.from({ length: 10 }, (_, i): Entry => [`Select window ${i}`, `${i}`]),
    ...['Left', 'Right', 'Up', 'Down'].flatMap((direction): Entry[] => [
      [`Select pane ${direction.toLowerCase()}`, direction],
      [`Resize pane ${direction.toLowerCase()} (1 cell)`, `Ctrl+${direction}`],
      [`Resize pane ${direction.toLowerCase()} (5 cells)`, `Alt+${direction}`],
    ]),
  ] satisfies Entry[]).map(([name, binding]): Shortcut => ({
    id: slug(`tmux-${name}`), name: `tmux: ${name}`,
    tags: [...BOTH, 'tmux', 'Terminal', 'Keyboard', 'After prefix'],
    binding: `After prefix: ${binding}`,
    note: 'Sends only the command key. Press the tmux prefix first (default Ctrl+B), usually before each command. Uses default tmux bindings and a US keyboard layout.',
    action: keyboardAction(binding),
  })),

  ...snippets('Markdown', [
    ['Inline code markers', '``'], ['Code block', '```\n\n```'], ['Code fence (opening)', '```\n'],
    ['Block quote', '> '], ['Nested block quote', '> > '], ['Bulleted list', '- '], ['Numbered list', '1. '],
    ['Task list (unchecked)', '- [ ] '], ['Task list (checked)', '- [x] '], ['Bold markers', '****'],
    ['Italic markers', '**'], ['Strikethrough markers (GFM)', '~~~~'], ['Link template', '[text](url)'],
    ['Image template', '![alt](url)'], ['Horizontal rule', '\n---\n'],
    ['Table template (GFM)', '| Column | Column |\n| --- | --- |\n|  |  |'],
    ...Array.from({ length: 6 }, (_, i): Entry => [`Heading ${i + 1}`, `${'#'.repeat(i + 1)} `]),
  ]),
  ...snippets('Vim', [
    ['Move left', 'h'], ['Move down', 'j'], ['Move up', 'k'], ['Move right', 'l'],
    ['Next word', 'w'], ['Previous word', 'b'], ['End of word', 'e'], ['Next WORD (whitespace)', 'W'],
    ['Line start', '0'], ['First nonblank character', '^'], ['Line end', '$'],
    ['Document start', 'gg'], ['Document end', 'G'], ['Matching bracket', '%'],
    ['Next paragraph', '}'], ['Previous paragraph', '{'],
    ['Insert before cursor', 'i'], ['Append after cursor', 'a'], ['Insert at line start', 'I'],
    ['Append at line end', 'A'], ['Open line below', 'o'], ['Open line above', 'O'],
    ['Delete character', 'x'], ['Delete line', 'dd'], ['Delete word', 'dw'], ['Delete to line end', 'D'],
    ['Change word', 'cw'], ['Change line', 'cc'], ['Change to line end', 'C'],
    ['Yank line', 'yy'], ['Yank word', 'yw'], ['Paste after', 'p'], ['Paste before', 'P'],
    ['Undo', 'u'], ['Repeat last change', '.'], ['Join lines', 'J'], ['Toggle case', '~'],
    ['Visual mode', 'v'], ['Visual line mode', 'V'], ['Search forward', '/'], ['Search backward', '?'],
    ['Next search match', 'n'], ['Previous search match', 'N'], ['Search word forward', '*'], ['Search word backward', '#'],
    ['Indent line', '>>'], ['Unindent line', '<<'], ['Center cursor line', 'zz'], ['Cursor line to top', 'zt'], ['Cursor line to bottom', 'zb'],
    ['Save', ':w\n'], ['Save and quit', ':wq\n'], ['Quit', ':q\n'], ['Quit without saving', ':q!\n'],
    ['Clear search highlighting', ':nohlsearch\n'], ['Next buffer', ':bnext\n'], ['Previous buffer', ':bprevious\n'],
    ['Split horizontally', ':split\n'], ['Split vertically', ':vsplit\n'], ['Toggle line numbers', ':set number!\n'],
  ]),
  ...keys('windows', ['Vim', 'Normal mode'], [
    ['Vim: Normal mode (Escape)', 'Escape'], ['Vim: Redo', 'Ctrl+R'], ['Vim: Page down', 'Ctrl+F'],
    ['Vim: Page up', 'Ctrl+B'], ['Vim: Half page down', 'Ctrl+D'], ['Vim: Half page up', 'Ctrl+U'],
    ['Vim: Visual block mode', 'Ctrl+V'],
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
    id: slug(control.name), name: control.group === 'Browser' ? `Media key: ${control.name}` : control.name,
    tags: [...BOTH, 'Media', control.group, ...(control.group === 'Display' ? ['System', 'Hardware dependent'] : [])],
    note: 'Host, application, or display support is required for consumer media keys.',
    action: { type: 'consumer', usage: control.usage },
  })),
];

export function filterShortcuts(os: ShortcutFilter, query: string): readonly Shortcut[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return SHORTCUTS.filter((shortcut) => {
    if (os !== 'all' && !shortcut.tags.includes(os)) return false;
    const searchable = `${shortcut.name} ${shortcut.binding ?? ''} ${shortcut.tags.join(' ')}`.toLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}
