import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { filterShortcuts, type ShortcutOS } from '../../model/shortcuts';
import { draggedShortcut, endShortcutDrag, startShortcutDrag } from '../drag';
import { IconChevron, IconSearch } from './Icons';

const FILTERS = [
  { value: 'mac', label: 'Mac' },
  { value: 'windows', label: 'Windows' },
] as const;

export function Shortcuts() {
  const [os, setOS] = useState<ShortcutOS>(() =>
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : 'windows');
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const shortcuts = filterShortcuts(os, query);
  const libraryRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const library = libraryRef.current;
    const wrapper = library?.parentElement;
    if (!library || !wrapper) return;
    const update = () => {
      wrapper.dataset.moreAbove = String(library.scrollTop > 1);
      wrapper.dataset.moreBelow = String(library.scrollHeight - library.clientHeight - library.scrollTop > 1);
    };
    library.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(library);
    update();
    return () => { library.removeEventListener('scroll', update); observer.disconnect(); };
  }, [expanded, os, query]);
  const showTmuxHint = draggedShortcut.value?.tags.includes('tmux')
    || (shortcuts.length > 0 && shortcuts.every(shortcut => shortcut.tags.includes('tmux')));
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
        <div class="shortcut-library-scroll-shadow"><div ref={libraryRef} class="shortcut-library" role="region" aria-label="Shortcut actions" tabIndex={0}>
          {shortcuts.map((shortcut) => (
            <div key={shortcut.id} class="shortcut-preset" draggable
              title={[shortcut.binding, shortcut.note].filter(Boolean).join(' — ')}
              onDragStart={(event) => startShortcutDrag(event, shortcut)} onDragEnd={endShortcutDrag}>
              <span>{shortcut.name}</span>
            </div>
          ))}
        </div>
        </div>
        {showTmuxHint && <p class="hint" role="status">tmux commands send only the key after the prefix. Send Prefix (Ctrl+B) first, usually before each command. Custom tmux bindings may differ.</p>}
        {shortcuts.length === 0 && <p class="empty" role="status">No shortcuts match your search.</p>}
        <p class="hint">Drag a shortcut onto a key, encoder input, chord, or timed action.</p>
      </div>
    </section>
  );
}
