import { useEffect, useRef, useState } from 'preact/hooks';
import { ask, canRedo, canSave, canUndo, closeDialog, connectHid, connectSimulator, connection, dirty, disconnect, hidSupported, loadFromDevice, profile, redo, save, saveState, undo } from '../store';
import { IconCheck, IconChevron, IconRefresh, IconSave, IconUsb, IconWarning } from './Icons';
import { variantName } from '../../model/constants';

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
          <IconUsb /> Connect macropad
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
  else if (!canSave.value) title = 'Fix the listed problems before saving';
  return (
    <button class={`btn btn-primary ${dirty.value && canSave.value ? 'btn-attention' : ''}`} disabled={!canSave.value} onClick={() => void save()} title={title}>
      {s.phase === 'saved' && !dirty.value ? <><IconCheck /> Saved</> : <><IconSave /> Save to device</>}
    </button>
  );
}

export function TopBar() {
  const c = connection.value;
  const confirmReload = () => ask({
    title: 'Reload from device?',
    body: 'This replaces the profile in the editor and clears its undo history. Unsaved changes will be lost.',
    actions: [
      { label: 'Cancel', tone: 'neutral', onSelect: closeDialog },
      { label: 'Reload from device', tone: 'danger', onSelect: () => { closeDialog(); void loadFromDevice(); } },
    ],
  });
  useEffect(() => {
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
  }, []);
  return (
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <span /><span /><span /><span /><span /><span />
        </div>
        <div>
          <h1>Universal Macropad</h1>
          <div class="brand-sub">Configurator</div>
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
            {!c.connection.status.flashValid && <span class="pill-flag" title="Flash holds no valid profile; the device is running built-in defaults"><IconWarning /> defaults</span>}
          </span>
        )}
        {dirty.value && profile.value && <span class="pill pill-warn">Unsaved changes</span>}
      </div>

      <div class="actions">
        {profile.value && <>
          <button class="btn" onClick={undo} disabled={!canUndo.value} title="Undo (⌘Z / Ctrl+Z)" aria-label="Undo">↶ Undo</button>
          <button class="btn" onClick={redo} disabled={!canRedo.value} title="Redo (⌘⇧Z / Ctrl+Shift+Z)" aria-label="Redo">↷ Redo</button>
        </>}
        {c.kind === 'connected' ? (
          <>
            <button class="btn" onClick={confirmReload} disabled={saveState.value.phase === 'busy'} title="Re-read the profile stored on the device">
              <IconRefresh /> Reload
            </button>
            <SaveButton />
            <button class="btn" onClick={() => void disconnect()} disabled={saveState.value.phase === 'busy'} title="Disconnect" aria-label="Disconnect">
              Disconnect
            </button>
          </>
        ) : (
          <ConnectMenu />
        )}
      </div>
    </header>
  );
}
