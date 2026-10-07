import promptImage from '../../../../images/macos_input_monitoring_prompt.png';
import enableImage from '../../../../images/macos_input_monitoring_enable.png';

export function InputMonitoringHelp() {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform;
  return (
    <div class="permission-help">
      <h3>In your browser · all platforms</h3>
      <p>Use desktop Chrome or Edge, click <strong>Connect macropad</strong>, select the macropad in the device chooser, and click <strong>Connect</strong>.</p>
      <p>In Chrome, open <strong>Settings → Privacy and security → Site settings → Additional permissions → HID devices</strong>. Allow sites to ask to connect to HID devices and remove this site from the blocked list if needed. Reload this page and try connecting again. Edge has similar site permissions.</p>
      <details open={/Mac/.test(platform)}>
      <summary>macOS · Input Monitoring</summary>
      <p>Your browser needs <strong>Input Monitoring</strong> permission. If access was denied before, macOS may not ask again.</p>
      <ol>
        <li>
          <p>If macOS shows a <strong>Keystroke Receiving</strong> prompt, choose <strong>Open System Settings</strong>.</p>
          <img class="permission-prompt" src={promptImage} alt="macOS prompt asking to let Google Chrome receive keystrokes, with an Open System Settings button" />
        </li>
        <li>
          <p>Open <strong>System Settings → Privacy &amp; Security → Input Monitoring</strong> and enable <strong>Google Chrome</strong> (or the browser you use). If it is missing, click <strong>+</strong> and add your browser from <strong>Applications</strong>.</p>
          <img src={enableImage} alt="Input Monitoring settings with the Google Chrome permission switch enabled" />
        </li>
        <li><p>Fully quit your browser with <strong>⌘Q</strong>, reopen it, and try <strong>Connect macropad</strong> again.</p></li>
      </ol>
      <h3>No permission prompt?</h3>
      <p>If you previously denied access, you can enable it manually using the steps above. To make macOS ask Chrome again, fully quit Chrome, run this in Terminal, then reopen Chrome and try connecting:</p>
      <pre><code>tccutil reset ListenEvent com.google.Chrome</code></pre>
      <p>This command resets only Google Chrome’s Input Monitoring permission. Other browsers have different app identifiers.</p>
      </details>
      <details open={/Win/.test(platform)}>
        <summary>Windows · browser permission &amp; HID driver</summary>
        <p>Windows normally has no macOS-style <strong>Input Monitoring</strong> toggle for this connection. The macropad uses Windows’ built-in HID driver; a separate configuration driver is normally unnecessary.</p>
        <ol>
          <li><p>Check the browser’s <strong>HID devices</strong> permission as described above.</p></li>
          <li><p>Close other configurator tabs and apps using the macropad, unplug it, and reconnect it. Try another data-capable USB cable or port if needed.</p></li>
          <li><p>If it still fails, open <strong>Device Manager → Human Interface Devices</strong> and check for a device warning. The configured macropad’s hardware IDs include <code>VID_1209</code> and <code>PID_C55D</code>. Check <strong>Properties → General</strong> for the device status.</p></li>
        </ol>
        <p>On a managed PC, browser or device-access policies may require help from your administrator.</p>
      </details>
      <details open={/Linux/.test(platform)}>
        <summary>Linux · HID device permissions</summary>
        <p>Linux can show the macropad in the chooser but deny access to its <code>hidraw</code> device. There is usually no permission popup; a udev rule grants access.</p>
        <ol>
          <li>
            <p>Using an administrator text editor, create <code>/etc/udev/rules.d/70-ch552-macropad.rules</code> with this single line:</p>
            <pre><code>{'SUBSYSTEM=="hidraw", KERNEL=="hidraw*", ATTRS{idVendor}=="1209", ATTRS{idProduct}=="c55d", MODE="0666"'}</code></pre>
            <p>This rule grants all local users read/write access to this macropad’s HID interfaces. For shared systems, ask your administrator for a group-restricted rule instead.</p>
          </li>
          <li><p>Reload the rules in Terminal:</p><pre><code>sudo udevadm control --reload-rules</code></pre></li>
          <li><p>Unplug and reconnect the macropad, then try <strong>Connect macropad</strong> again.</p></li>
        </ol>
        <p>If access is still denied, a sandboxed browser package may also restrict HID access. Check your package’s device permissions or try an official browser package installed directly for your distribution.</p>
      </details>
      <h3>Still unable to connect?</h3>
      <p>Check the USB connection and close other apps using the macropad, then reconnect. In Chrome, open <code>chrome://device-log</code> in a new tab and look for HID errors after a failed attempt.</p>
    </div>
  );
}
