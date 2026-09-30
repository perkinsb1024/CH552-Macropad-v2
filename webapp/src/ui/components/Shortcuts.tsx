import { useState } from 'preact/hooks';
import { filterShortcuts, type ShortcutOS } from '../../model/shortcuts';
import { applyShortcut, endShortcutDrag, startShortcutDrag } from '../drag';
import { selectedSlot } from '../store';
import { IconChevron, IconSearch } from './Icons';

const FILTERS = [
  { value: 'mac', label: 'Mac' },
  { value: 'windows', label: 'Windows' },
] as const;

export function Shortcuts() {
  const [os, setOS] = useState<ShortcutOS>(() =>
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : 'windows');
  const [expanded, setExpanded] = useState(true);
  const [query, setQuery] = useState('');
  const shortcuts = filterShortcuts(os, query);
  return (
    <section class="card shortcuts" aria-labelledby="shortcuts-title">
      <h2 id="shortcuts-title">
        <button type="button" class="shortcuts-toggle" aria-expanded={expanded} aria-controls="shortcuts-content"
          onClick={() => setExpanded(!expanded)}>
          Shortcuts <IconChevron />
        </button>
      </h2>
      <div id="shortcuts-content" class="shortcuts-content" hidden={!expanded}>
        <div class="segmented" role="group" aria-label="Shortcut operating system">
          {FILTERS.map((filter) => (
            <button key={filter.value} type="button" class={os === filter.value ? 'is-selected' : ''}
              aria-pressed={os === filter.value} onClick={() => setOS(filter.value)}>{filter.label}</button>
          ))}
        </div>
        <div class="shortcuts-search">
          <IconSearch />
          <input type="search" aria-label="Search shortcuts" placeholder="Search shortcuts…" value={query}
            onInput={(event) => setQuery((event.target as HTMLInputElement).value)} />
        </div>
        <div class="shortcut-library" role="region" aria-label="Shortcut actions" tabIndex={0}>
          {shortcuts.map((shortcut) => (
            <button key={shortcut.id} type="button" class="shortcut-preset" draggable
              title={shortcut.binding}
              onDragStart={(event) => startShortcutDrag(event, shortcut)} onDragEnd={endShortcutDrag}
              onClick={() => { if (selectedSlot.value) applyShortcut(shortcut, selectedSlot.value); }}>
              <span>{shortcut.name}</span>
            </button>
          ))}
        </div>
        {shortcuts.length === 0 && <p class="empty" role="status">No shortcuts match your search.</p>}
        <p class="hint">Drag a shortcut onto a key, encoder input, or chord. You can also select an input and click a shortcut.</p>
      </div>
    </section>
  );
}
