import { useEffect } from 'preact/hooks';
import { siteUrl } from '../site';
import { FORMAT_VERSION } from '../model/constants';
import { TRANSPORT_VERSION } from '../protocol/packet';
import { clearSelectedAction, connectSimulator, connection, copySelectedConfiguration, cutSelectedConfiguration, dialog, getAction, pasteSelectedConfiguration, profile, selectedSlot } from './store';
import { TopBar } from './components/TopBar';
import { Welcome } from './components/Welcome';
import { ProfilePanel } from './components/ProfilePanel';
import { LayerTabs } from './components/LayerTabs';
import { DeviceView } from './components/DeviceView';
import { TimedActionsPanel } from './components/TimedActionsPanel';
import { ChordPanel } from './components/ChordPanel';
import { LayerOptions } from './components/LayerOptions';
import { Inspector } from './components/Inspector';
import { Sidebar } from './components/Sidebar';
import { Shortcuts } from './components/Shortcuts';
import { StorageMeter } from './components/StorageMeter';
import { IssuesPanel } from './components/IssuesPanel';
import { ToolsPanel } from './components/ToolsPanel';
import { Dialog } from './components/Dialog';
import { Toasts } from './components/Toasts';
import { ArchivedFirmwareNotice } from './components/ArchivedFirmwareNotice';
import { variantName } from '../model/constants';

export function App() {
  useEffect(() => {
    // Clear old page text before a new click/drag. A fresh text-selection drag
    // can then create a selection that still takes precedence over action copying.
    const clearPageSelection = () => window.getSelection()?.removeAllRanges();
    const onClick = (event: MouseEvent) => {
      // Keyboard activation has no pointer-down event.
      if (event.detail === 0) clearPageSelection();
    };
    const isEditing = (target: EventTarget | null) => target instanceof HTMLElement &&
      (target.isContentEditable || !!target.closest('textarea, [role="textbox"], input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="button"]):not([type="submit"]):not([type="reset"])'));
    const canHandleClipboard = (event: Event) => !event.defaultPrevented && !dialog.value &&
      !isEditing(event.target) && !!selectedSlot.value;
    const hasSelectedText = () => window.getSelection()?.isCollapsed === false;
    const onCopyOrCut = (event: ClipboardEvent) => {
      if (!canHandleClipboard(event) || hasSelectedText() || !event.clipboardData) return;
      const text = copySelectedConfiguration(event.type !== 'cut');
      if (text === null) return;
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
      if (event.type === 'cut') cutSelectedConfiguration();
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!canHandleClipboard(event) || !event.clipboardData) return;
      if (pasteSelectedConfiguration(event.clipboardData.getData('text/plain'))) event.preventDefault();
    };
    const onRepeat = (event: KeyboardEvent) => {
      if (event.repeat && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
          ['x', 'c', 'v'].includes(event.key.toLowerCase()) && canHandleClipboard(event) &&
          (event.key.toLowerCase() === 'v' || !hasSelectedText())) event.preventDefault();
    };
    window.addEventListener('pointerdown', clearPageSelection, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('copy', onCopyOrCut);
    window.addEventListener('cut', onCopyOrCut);
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onRepeat);
    return () => {
      window.removeEventListener('pointerdown', clearPageSelection, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('copy', onCopyOrCut);
      window.removeEventListener('cut', onCopyOrCut);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onRepeat);
    };
  }, []);

  useEffect(() => {
    const onDelete = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.key !== 'Backspace' && event.key !== 'Delete') ||
          event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || dialog.value) return;
      const target = event.target;
      if (target instanceof HTMLElement &&
          (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]'))) return;
      const p = profile.value;
      const slot = selectedSlot.value;
      if (!p || !slot || !getAction(p, slot)) return;
      event.preventDefault();
      // Holding Delete must not clear both the action and LED in a single press.
      if (!event.repeat) clearSelectedAction();
    };
    window.addEventListener('keydown', onDelete);
    return () => window.removeEventListener('keydown', onDelete);
  }, []);

  useEffect(() => {
    // ?sim=six|three|blank opens the in-browser simulator (demo links, screenshots).
    const sim = new URLSearchParams(location.search).get('sim');
    if (sim === 'six') void connectSimulator(0);
    else if (sim === 'three') void connectSimulator(1);
    else if (sim === 'blank') void connectSimulator(0, true);
  }, []);

  const p = profile.value;
  const c = connection.value;
  const mismatch = p && c.kind === 'connected' && p.variant !== c.connection.info.variant;

  return (
    <div class="app">
      <TopBar />
      <ArchivedFirmwareNotice />
      {!p ? (
        <Welcome />
      ) : (
        <main class="workspace">
          {mismatch && (
            <div class="notice notice-warn notice-wide">
              The editor holds a <strong>{variantName(p.variant).toLowerCase()}</strong> profile but the connected device has {c.connection.info.keyCount} keys.
              Saving is disabled. Use <em>Reload</em> to edit the device's own profile, or export this one for later.
            </div>
          )}
          <div class="column column-main">
            <ProfilePanel />
            <section class="card card-device">
              <LayerTabs />
              <DeviceView />
              <p class="hint device-drag-hint">Drag actions onto an existing action to swap; drag to an edge or between items to insert and reorder. Hold actions cannot be moved to encoder rotation.</p>
              <ul class="legend device-legend">
                <li><span class="swatch swatch-selected" /> Selected input</li>
                <li><span class="swatch swatch-problem" /> Needs attention before saving</li>
                <li><span class="swatch swatch-chord" /> Key that also participates in a chord</li>
              </ul>
            </section>
            <div class="two-up">
              <ChordPanel />
              <LayerOptions />
            </div>
            <TimedActionsPanel />
          </div>
          <Sidebar>
            <Inspector />
            <IssuesPanel />
            <Shortcuts />
            <StorageMeter />
            <ToolsPanel />
          </Sidebar>
        </main>
      )}
      <footer class="footer">
        <span>Universal Macropad · config format v{FORMAT_VERSION} · transport v{TRANSPORT_VERSION}</span>
        <a href={siteUrl('versions/')}>Older firmware configurators</a>
        <span class="muted">Saves write the device's 128-byte DataFlash and read it back before reporting success.</span>
      </footer>
      <Dialog />
      <Toasts />
    </div>
  );
}
