import { Ch552Bootloader } from './bootloader.mjs';
import { parseHex } from './hex.mjs';

const $ = id => document.getElementById(id);
const status = $('status'), connect = $('connect'), install = $('install');
const reboot = $('reboot');
const variantConfirmation = $('confirm-variant');
const variantButtons = Array.from(document.querySelectorAll('[data-variant]'));
let selectedVariant = 3;
const progress = $('progress');
const repository = 'https://github.com/perkinsb1024/CH552-Macropad-v2';
$('boot-guide').href = `${repository}#how-to-upload-the-firmware`;
let manifest, firmware = null, busy = false;
const supported = window.isSecureContext && 'usb' in navigator;
const platform = navigator.userAgentData?.platform || navigator.platform || '';
const currentOS = /mac/i.test(platform) ? 'macos' : /linux/i.test(platform) ? 'linux' : 'windows';
for (const os of ['windows', 'macos', 'linux']) {
  $(`platform-${os}`).open = os === currentOS;
}

function report(text) {
  status.textContent = text;
  const match = /^(flash|verify) package (\d+) of (\d+)$/.exec(text);
  if (match) {
    progress.hidden = false;
    progress.value = (match[1] === 'verify' ? 50 : 0) + Number(match[2]) / Number(match[3]) * 50;
    status.textContent = `${match[1] === 'verify' ? 'Verifying' : 'Programming'} firmware: ${match[2]} of ${match[3]} blocks…`;
  }
}

const session = supported ? new Ch552Bootloader(navigator.usb, report) : null;
function controls() {
  connect.disabled = !supported || busy || !!session?.ready;
  reboot.disabled = busy || !session?.ready;
  for (const button of variantButtons) {
    button.disabled = !manifest || busy;
    button.setAttribute('aria-pressed', String(Number(button.dataset.variant) === selectedVariant));
  }
  variantConfirmation.disabled = busy || !firmware;
  install.disabled = busy || !session?.ready || !firmware || !variantConfirmation.checked;
}

async function loadFirmware() {
  firmware = null;
  $('download').hidden = true;
  controls();
  const entry = manifest.firmware.find(f => f.keys === selectedVariant);
  if (!entry) {
    $('firmware-info').textContent = 'Choose the number of keys on your macropad.';
    return;
  }
  busy = true;
  controls();
  try {
    const response = await fetch(`./firmware/${entry.name}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Firmware download failed (HTTP ${response.status}).`);
    const content = await response.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', content)), b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== entry.sha256) throw new Error('Firmware checksum does not match this published release. Reload the page.');
    firmware = parseHex(new TextDecoder().decode(content));
    if (firmware.length !== entry.bytes) throw new Error('Firmware size does not match the release manifest.');
    $('firmware-info').textContent = `${entry.name} · ${firmware.length.toLocaleString()} application bytes`;
    $('download').href = `./firmware/${entry.name}`;
    $('download').download = entry.name;
    $('download').hidden = false;
  } catch (error) {
    $('firmware-info').textContent = 'Firmware could not be loaded.';
    report(error.message);
  } finally { busy = false; controls(); }
}

for (const button of variantButtons) {
  button.addEventListener('click', () => {
    if (Number(button.dataset.variant) === selectedVariant) return;
    selectedVariant = Number(button.dataset.variant);
    variantConfirmation.checked = false;
    return loadFirmware();
  });
}
variantConfirmation.addEventListener('change', controls);
connect.addEventListener('click', async () => {
  if (!supported || busy || session.ready) return;
  busy = true;
  controls();
  progress.hidden = true;
  report('Select the CH55x bootloader in the USB picker.');
  try {
    const info = await session.connect();
    $('device-info').textContent = `CH552 · bootloader ${info.version} · chip ID ${info.id.map(b => b.toString(16).padStart(2, '0')).join('')}`;
    report('Bootloader connected. Choose the correct firmware, then install.');
  } catch (error) {
    $('device-info').textContent = 'No bootloader connected.';
    report(`${error.message} Check the platform instructions above if USB access failed.`);
  } finally { busy = false; controls(); }
});

reboot.addEventListener('click', async () => {
  if (busy || !session?.ready) return;
  busy = true;
  controls();
  progress.hidden = true;
  report('Sending the restart command…');
  try {
    await session.reboot();
    $('device-info').textContent = 'Bootloader disconnected.';
    report('Restart command sent. No firmware was uploaded.');
  } catch (error) {
    $('device-info').textContent = 'Bootloader disconnected.';
    report(`Could not confirm the restart command: ${error.message} Unplug and reconnect USB to restart the device.`);
  } finally { busy = false; controls(); }
});

install.addEventListener('click', async () => {
  if (busy || !session?.ready || !firmware || !variantConfirmation.checked) return;
  busy = true;
  controls();
  progress.value = 0;
  progress.hidden = false;
  report('Preparing the bootloader and checking boot configuration…');
  try {
    await session.flash(firmware);
    progress.value = 100;
    $('device-info').textContent = 'Installation complete; bootloader session closed.';
    report('Firmware programmed and verified.');
    const configuratorLink = document.createElement('a');
    configuratorLink.href = '../';
    configuratorLink.textContent = 'Open the macropad configurator to load or save your profile';
    status.append(' ', configuratorLink, '.');
  } catch (error) {
    $('device-info').textContent = 'Bootloader session closed. Re-enter bootloader mode before retrying.';
    report(`Installation stopped: ${error.message}`);
  } finally { busy = false; controls(); }
});

if (supported) {
  navigator.usb.addEventListener('disconnect', event => {
    if (event.device !== session.device || busy) return;
    session.disconnect();
    $('device-info').textContent = 'Bootloader disconnected.';
    report('Re-enter bootloader mode and connect again.');
    controls();
  });
  window.addEventListener('beforeunload', event => {
    if (session.busy) { event.preventDefault(); event.returnValue = ''; }
  });
}

try {
  const response = await fetch('./firmware.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Firmware list unavailable (HTTP ${response.status}).`);
  manifest = await response.json();
  $('firmware-info').textContent = 'Choose the number of keys on your macropad.';
  report(supported ? 'Ready. Enter bootloader mode and connect when you are ready.' : 'WebUSB is unavailable. Open this page in desktop Chrome or Edge over HTTPS or localhost.');
  await loadFirmware();
} catch (error) { report(error.message); }
controls();
