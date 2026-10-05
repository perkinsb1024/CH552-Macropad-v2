import { useEffect, useRef, useState } from 'preact/hooks';
import { ask, canRedo, canSave, canUndo, closeDialog, connectHid, connectSimulator, connection, dirty, disconnect, hidSupported, loadFromDevice, profile, redo, save, saveState, undo } from '../store';
import { IconCheck, IconChevron, IconClose, IconReadDevice, IconRefresh, IconSave, IconConnect, IconWarning, IconEye } from './Icons';
import { FORMAT_VERSION, variantName } from '../../model/constants';
import { UnsavedChanges } from './UnsavedChanges';
import { siteUrl } from '../../site';

function ConnectMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div class="menu" ref={ref}>
      <div class="btn-group">
        <button class="btn btn-primary" onClick={() => void connectHid()} disabled={!hidSupported} title={hidSupported ? 'Choose a macropad via WebHID' : 'WebHID is unavailable in this browser'}>
          <IconConnect /> Connect macropad
        </button>
        <button class="btn btn-primary btn-icon" aria-label="More connection options" aria-expanded={open} onClick={() => setOpen(!open)}>
          <IconChevron />
        </button>
      </div>
      {open && (
        <div class="menu-list" role="menu">
          <div class="menu-heading">Try without hardware</div>
          <button role="menuitem" onClick={() => { setOpen(false); void connectSimulator(0); }}>Simulated six-key macropad</button>
          <button role="menuitem" onClick={() => { setOpen(false); void connectSimulator(1); }}>Simulated three-key macropad</button>
          <button role="menuitem" onClick={() => { setOpen(false); void connectSimulator(0, true); }}>Simulated six-key, blank flash</button>
        </div>
      )}
    </div>
  );
}

function SaveButton() {
  const s = saveState.value;
  const c = connection.value;
  if (s.phase === 'busy') {
    const label = s.step === 'uploading' ? 'Uploading' : s.step === 'saving' ? 'Writing flash' : 'Verifying';
    return (
      <button class="btn btn-primary btn-busy" disabled>
        <span class="spinner" /> {label}… {s.step !== 'saving' ? `${Math.round(s.fraction * 100)}%` : ''}
      </button>
    );
  }
  const p = profile.value;
  let title = 'Write the profile to the device and verify it';
  if (c.kind !== 'connected') title = 'Connect a macropad to save';
  else if (p && p.variant !== c.connection.info.variant) title = `This profile is for the ${variantName(p.variant).toLowerCase()} variant`;
  else if (c.connection.info.formatVersion !== FORMAT_VERSION) title = 'This firmware configuration format is not supported';
  else if (!canSave.value) title = 'Fix the listed problems before saving';
  return (
    <button class={`btn btn-primary ${dirty.value && canSave.value ? 'btn-attention' : ''}`} disabled={!canSave.value} onClick={() => void save()} title={title}>
      {s.phase === 'saved' && !dirty.value ? <><IconCheck /> Saved</> : <><IconSave /> Save to device</>}
    </button>
  );
}

export function TopBar({ readOnly = false }: { readOnly?: boolean } = {}) {
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    const app = header?.parentElement;
    if (!header || !app) return;
    const updateOffset = () => app.style.setProperty('--topbar-height', `${header.offsetHeight}px`);
    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const c = connection.value;
  const confirmRead = () => ask({
    title: 'Read from device?',
    body: 'This replaces the profile in the editor and clears its undo history. Unsaved changes will be lost.',
    actions: [
      { label: 'Cancel', tone: 'neutral', onSelect: closeDialog },
      { label: 'Read from device', tone: 'danger', onSelect: () => { closeDialog(); void loadFromDevice(); } },
    ],
  });
  useEffect(() => {
    if (readOnly) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (target?.isContentEditable || tag === 'TEXTAREA' || (tag === 'INPUT' && (target as HTMLInputElement).type !== 'range')) return;
      if (key === 'z') {
        if (event.shiftKey ? canRedo.value : canUndo.value) {
          event.preventDefault();
          if (event.shiftKey) redo(); else undo();
        }
      } else if (key === 'y' && event.ctrlKey && canRedo.value) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readOnly]);
  return (
    <header class="topbar" ref={headerRef}>
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <span /><span /><span /><span /><span /><span />
        </div>
        <div>
          <h1>Universal Macropad</h1>
          <div class="brand-sub">{readOnly ? 'Live View' : 'Configurator'}</div>
        </div>
      </div>

      <div class="conn">
        {c.kind === 'disconnected' && (
          <span class="pill pill-muted"><span class="dot" /> Not connected</span>
        )}
        {c.kind === 'connecting' && (
          <span class="pill pill-muted"><span class="spinner" /> Connecting to {c.label}…</span>
        )}
        {c.kind === 'connected' && (
          <span class={`pill ${c.connection.transport.kind === 'simulator' ? 'pill-sim' : 'pill-ok'}`} title={`${variantName(c.connection.info.variant)} · ${c.connection.info.keyCount} keys · format v${c.connection.info.formatVersion}`}>
            <span class="dot" /> {c.connection.transport.name}
            {!c.connection.status.flashValid && <span class="pill-flag" title="Device profile is missing, old or invalid; device inputs are inactive"><IconWarning /> Device profile is missing, old or invalid</span>}
          </span>
        )}
        {!readOnly && dirty.value && profile.value && <UnsavedChanges />}
      </div>

      <div class="actions">
        <a class="btn" href={siteUrl(readOnly ? './' : 'liveView/')} target="_blank" rel="noreferrer">{!readOnly && <IconEye />}{readOnly ? 'Configurator' : 'Live View'}</a>
        {!readOnly && profile.value && <>
          <button class="btn" onClick={undo} disabled={!canUndo.value} title="Undo (⌘Z / Ctrl+Z)" aria-label="Undo"><IconRefresh mirrored /> Undo</button>
          <button class="btn" onClick={redo} disabled={!canRedo.value} title="Redo (⌘⇧Z / Ctrl+Shift+Z)" aria-label="Redo"><IconRefresh /> Redo</button>
        </>}
        {c.kind === 'connected' ? (
          <>
            <button class="btn" onClick={readOnly ? () => void loadFromDevice() : confirmRead} disabled={saveState.value.phase === 'busy'} title="Read the profile stored on the device">
              <IconReadDevice /> Read from device
            </button>
            {!readOnly && <SaveButton />}
            <button class="btn" onClick={() => void disconnect()} disabled={saveState.value.phase === 'busy'} title="Disconnect" aria-label="Disconnect">
              <IconClose /> Disconnect
            </button>
          </>
        ) : (
          <ConnectMenu />
        )}
      </div>
    </header>
  );
}
