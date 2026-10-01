import { connectHid, connectSimulator, hidSupported, startOffline } from '../store';
import { IconUsb } from './Icons';

export function Welcome() {
  const secure = typeof window === 'undefined' || window.isSecureContext;
  return (
    <div class="welcome">
      <div class="welcome-card">
        <div class="welcome-art" aria-hidden="true">
          <div class="mini-pad">
            {Array.from({ length: 6 }, (_, i) => <span key={i} class={`mini-key mini-key-${i}`} />)}
            <span class="mini-knob" />
          </div>
        </div>
        <h2>Configure your macropad</h2>
        <p>
          Bind keys, chords and the encoder across five layers on six-key pads or seven on three-key pads, pick LED colors, and save
          everything to the device. Settings live on the macropad, so nothing here needs to run afterwards.
        </p>

        {!hidSupported && (
          <div class="notice notice-warn">
            <strong>This browser cannot talk to USB devices.</strong> WebHID is available in desktop Chrome, Edge and other Chromium browsers.
            {!secure && ' The page must also be served over HTTPS or from localhost.'} You can still edit and export profiles offline.
          </div>
        )}
        {hidSupported && !secure && (
          <div class="notice notice-warn">WebHID needs a secure context. Open this page over HTTPS or from localhost.</div>
        )}

        <div class="welcome-actions">
          <button class="btn btn-primary btn-large" onClick={() => void connectHid()} disabled={!hidSupported}>
            <IconUsb /> Connect macropad
          </button>
          <div class="welcome-secondary">
            <span class="muted">or edit offline for a</span>
            <button class="link" onClick={() => startOffline(0)}>six-key</button>
            <span class="muted">/</span>
            <button class="link" onClick={() => startOffline(1)}>three-key</button>
            <span class="muted">device, or try a</span>
            <button class="link" onClick={() => void connectSimulator(0)}>simulated macropad</button>
          </div>
        </div>

        <details class="welcome-help">
          <summary>Device not showing up?</summary>
          <ul>
            <li>Plug the macropad in directly and make sure it types normally. The configurator uses the same USB connection.</li>
            <li>The chooser lists it as <strong>Universal Macropad</strong>. Older firmware without the configuration interface will not appear.</li>
            <li>On Linux, add a udev rule granting access to VID <code>1209</code> PID <code>c55d</code>, for example: <code>KERNEL=="hidraw*", ATTRS{'{'}idVendor{'}'}=="1209", ATTRS{'{'}idProduct{'}'}=="c55d", MODE="0666"</code>, then replug.</li>
          </ul>
        </details>
      </div>
    </div>
  );
}
