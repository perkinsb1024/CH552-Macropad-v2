import { useEffect } from 'preact/hooks';
import { connectSimulator, connection, profile, reconnectGranted } from './store';
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
        <span>Universal Macropad · config format v1 · transport v1</span>
        <span class="muted">Saves write the device's 128-byte DataFlash and read it back before reporting success.</span>
      </footer>
      <Dialog />
      <Toasts />
    </div>
  );
}
