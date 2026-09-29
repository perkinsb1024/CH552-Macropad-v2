import { useEffect } from 'preact/hooks';
import { FORMAT_VERSION } from '../model/constants';
import { TRANSPORT_VERSION } from '../protocol/packet';
import { clearSelectedAction, connectSimulator, connection, dialog, getAction, profile, reconnectGranted, selectedSlot } from './store';
import { TopBar } from './components/TopBar';
import { Welcome } from './components/Welcome';
import { ProfilePanel } from './components/ProfilePanel';
import { LayerTabs } from './components/LayerTabs';
import { DeviceView } from './components/DeviceView';
import { ChordPanel } from './components/ChordPanel';
import { LayerOptions } from './components/LayerOptions';
import { Inspector } from './components/Inspector';
import { StorageMeter } from './components/StorageMeter';
import { IssuesPanel } from './components/IssuesPanel';
import { ToolsPanel } from './components/ToolsPanel';
import { Dialog } from './components/Dialog';
import { Toasts } from './components/Toasts';
import { variantName } from '../model/constants';

export function App() {
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
    // Otherwise silently resume a device the user already granted; never touches its configuration.
    else void reconnectGranted();
  }, []);

  const p = profile.value;
  const c = connection.value;
  const mismatch = p && c.kind === 'connected' && p.variant !== c.connection.info.variant;

  return (
    <div class="app">
      <TopBar />
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
          </div>
          <aside class="column column-side">
            <Inspector />
            <IssuesPanel />
            <StorageMeter />
            <ToolsPanel />
          </aside>
        </main>
      )}
      <footer class="footer">
        <span>Universal Macropad · config format v{FORMAT_VERSION} · transport v{TRANSPORT_VERSION}</span>
        <span class="muted">Saves write the device's 128-byte DataFlash and read it back before reporting success.</span>
      </footer>
      <Dialog />
      <Toasts />
    </div>
  );
}
