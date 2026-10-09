import { Ch552Bootloader } from './bootloader.mjs';
import { parseHex } from './hex.mjs';
import { configuratorPath } from './firmware-format.mjs';
import { previousReleases, selectedFirmware } from './firmware-list.mjs';
import { localFirmware, installationAllowed } from './local-firmware.mjs';
import { enterBootloader } from './hid-bootloader.mjs';

const $ = id => document.getElementById(id);
const status = $('status'), connect = $('connect'), install = $('install');
const reboot = $('reboot'), progress = $('progress');
const variantConfirmation = $('confirm-variant'), unknownConfirmation = $('confirm-unrecognized');
const releaseSelector = $('firmware-release');
const variantButtons = Array.from(document.querySelectorAll('[data-variant]'));
const sourceTabs = Array.from(document.querySelectorAll('[data-source]'));
let source = 'latest', selectedVariant = 3, selectedRelease = 'latest';
let manifest, firmware = null, loadedEntry = null, localFile = null, busy = false;
let entryState = 'idle';
const repository = 'https://github.com/perkinsb1024/CH552-Macropad-v2';
$('boot-guide').href = `${repository}#how-to-upload-the-firmware`;
const supported = window.isSecureContext && 'usb' in navigator;
if (!supported) {
  const notice = $('compatibility-notice');
  notice.hidden = false;
  notice.className = 'beta incompatible';
  notice.setAttribute('role', 'alert');
  $('notice-title').textContent = window.isSecureContext
    ? 'Unable to Install Firmware'
    : 'A Secure Connection Is Required to Install Firmware';
  $('notice-message').textContent = window.isSecureContext
    ? 'USB access (WebUSB) is unavailable in this browser. Open this page in desktop Chrome or Edge.'
    : 'Open this page over HTTPS or localhost in desktop Chrome or Edge to enable USB access.';
}
const platform = navigator.userAgentData?.platform || navigator.platform || '';
const currentOS = /mac/i.test(platform) ? 'macos' : /linux/i.test(platform) ? 'linux' : 'windows';
for (const os of ['windows', 'macos', 'linux']) $(`platform-${os}`).open = os === currentOS;

function report(text, state = busy ? 'working' : 'info') {
  status.textContent = text.replace(/ · /g, ' / ').replace(/\.$/, '');
  status.dataset.state = state;
  const match = /^(flash|verify) package (\d+) of (\d+)$/.exec(text);
  if (match) {
    progress.hidden = false;
    progress.value = (match[1] === 'verify' ? 50 : 0) + Number(match[2]) / Number(match[3]) * 50;
    status.textContent = `${match[1] === 'verify' ? 'Verifying' : 'Programming'} firmware: ${match[2]} of ${match[3]} blocks…`;
  }
}
function connectionMessage(text, state = 'info') {
  $('connection-status').textContent = text;
  $('connection-status').dataset.state = state;
}
function deviceMessage(text, state = 'info') {
  $('device-info').textContent = text;
  $('device-info').dataset.state = state;
}
const session = supported ? new Ch552Bootloader(navigator.usb, report) : null;
function canInstall() {
  return installationAllowed({ local: source === 'custom', firmware,
    identified: Number.isInteger(loadedEntry?.formatVersion),
    variantConfirmed: variantConfirmation.checked, unknownConfirmed: unknownConfirmation.checked });
}
function resetConfirmations() {
  variantConfirmation.checked = unknownConfirmation.checked = false;
  $('unrecognized-warning').hidden = true;
}
function confirmationLabel() {
  const label = $('confirmation-label');
  label.replaceChildren();
  if (!firmware) { label.textContent = 'Choose firmware to confirm installation'; return; }
  const pill = text => {
    const span = document.createElement('span'); span.className = 'firmware-pill'; span.textContent = text; return span;
  };
  if (Number.isInteger(loadedEntry?.formatVersion)) {
    label.append('I confirm that I want to install ', pill(`v${loadedEntry.formatVersion}`), ' for a ', pill(`${loadedEntry.keys}-key`), ' macropad');
  } else {
    label.textContent = 'I confirm that I want to install this custom firmware on my CH552 macropad';
  }
}
function controls() {
  $('enter-bootloader').disabled = busy || !!session?.ready || !window.isSecureContext || !navigator.hid;
  $('hex-file').disabled = busy || source !== 'custom';
  unknownConfirmation.disabled = busy || !firmware;
  connect.disabled = !supported || busy || !!session?.ready;
  reboot.disabled = busy || !session?.ready;
  for (const button of variantButtons) {
    button.disabled = !manifest || busy;
    button.setAttribute('aria-pressed', String(Number(button.dataset.variant) === selectedVariant));
  }
  for (const tab of sourceTabs) {
    tab.disabled = busy;
    const active = tab.dataset.source === source;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(`panel-${tab.dataset.source}`).hidden = !active;
  }
  $('board-selection').hidden = source === 'custom';
  $('unrecognized-warning').hidden = source !== 'custom' || !firmware || Number.isInteger(loadedEntry?.formatVersion);
  releaseSelector.disabled = !manifest || busy || source !== 'previous';
  variantConfirmation.disabled = busy || !firmware;
  install.disabled = busy || !session?.ready || !canInstall();
  $('entry-step').dataset.state = session?.ready ? 'success' : entryState;
  $('connect-step').dataset.state = session?.ready ? 'success' : entryState === 'success' ? 'next' : 'idle';
  confirmationLabel();
}
function releaseChoices() {
  releaseSelector.replaceChildren();
  const entries = previousReleases(manifest, selectedVariant);
  for (const entry of entries) {
    const option = document.createElement('option'); option.value = entry.name; option.textContent = `v${entry.formatVersion}`;
    releaseSelector.append(option);
  }
  if (source === 'previous' && !entries.some(entry => entry.name === selectedRelease)) selectedRelease = entries[0]?.name ?? '';
  releaseSelector.value = selectedRelease;
  $('release-history').replaceChildren();
  for (const entry of entries) {
    const version = document.createElement('dt'); version.textContent = `v${entry.formatVersion}`;
    const notes = document.createElement('dd'); notes.textContent = manifest.releaseNotes?.[entry.formatVersion] ?? 'Published firmware release';
    $('release-history').append(version, notes);
  }
}
async function loadFirmware() {
  resetConfirmations();
  firmware = loadedEntry = null;
  $('download').hidden = true;
  const entry = selectedFirmware(manifest, selectedVariant, selectedRelease);
  if (!entry) {
    $('firmware-info').textContent = 'No published firmware is available for this selection';
    controls(); return;
  }
  busy = true;
  $('firmware-info').textContent = 'Loading and checking firmware…';
  controls();
  try {
    const response = await fetch(`./firmware/${entry.name}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Firmware download failed (HTTP ${response.status}).`);
    const content = await response.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', content)), b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== entry.sha256) throw new Error('Firmware checksum does not match this published release. Reload the page.');
    const image = parseHex(new TextDecoder().decode(content));
    if (image.length !== entry.bytes) throw new Error('Firmware size does not match the release manifest.');
    firmware = image;
    loadedEntry = entry;
    $('firmware-info').textContent = `v${entry.formatVersion} for a ${entry.keys}-key macropad\n${entry.name}\n${firmware.length.toLocaleString()} application bytes`;
    $('download').href = `./firmware/${entry.name}`;
    $('download').download = entry.name;
    $('download').hidden = false;
    const notes = manifest.releaseNotes?.[entry.formatVersion] ?? '';
    $(source === 'latest' ? 'latest-notes' : 'release-notes').textContent = notes;
    report(session?.ready ? 'Bootloader connected. Review your firmware selection and confirm to install' : 'Enter bootloader mode, then select Connect Bootloader', 'info');
  } catch (error) {
    firmware = loadedEntry = null;
    $('firmware-info').textContent = 'Firmware could not be loaded';
    report(error.message, 'error');
  } finally { busy = false; controls(); }
}
async function loadLocal(file) {
  if (source !== 'custom' || busy) return;
  busy = true;
  localFile = file;
  firmware = loadedEntry = null;
  resetConfirmations();
  $('download').hidden = true;
  controls();
  try {
    if (file.size > 1024 * 1024) throw new Error('HEX text file is too large (maximum 1 MiB).');
    const result = localFirmware(file.name, await file.text());
    firmware = result.image;
    loadedEntry = result.entry;
    $('unrecognized-warning').hidden = result.identified;
    $('firmware-info').textContent = `${result.identified ? `v${loadedEntry.formatVersion} for a ${loadedEntry.keys}-key macropad` : 'Board variant unknown'}\n${file.name}\n${firmware.length.toLocaleString()} application bytes`;
    report(result.identified ? 'Custom firmware validated. Review the detected board variant and confirm to install' : 'Custom HEX validated. Confirm that this firmware is compatible with your hardware', 'info');
  } catch (error) {
    firmware = loadedEntry = null;
    $('firmware-info').textContent = 'Custom firmware could not be loaded';
    report(error.message, 'error');
  } finally { busy = false; controls(); }
}
async function selectSource(next) {
  if (busy || source === next) return;
  const previousVersion = loadedEntry?.formatVersion;
  source = next;
  resetConfirmations();
  firmware = loadedEntry = null;
  $('download').hidden = true;
  if (source === 'custom') {
    $('firmware-info').textContent = 'Choose a HEX file to see its firmware details';
    controls();
    if (localFile) await loadLocal(localFile);
    else report('Choose a custom firmware HEX file');
  } else if (manifest) {
    selectedRelease = source === 'latest' ? 'latest' : previousReleases(manifest, selectedVariant).find(entry => entry.formatVersion === previousVersion)?.name ?? '';
    releaseChoices(); await loadFirmware();
  } else {
    $('firmware-info').textContent = 'Published firmware is unavailable. You can choose a custom HEX file';
    controls();
  }
}
for (const tab of sourceTabs) {
  tab.addEventListener('click', () => selectSource(tab.dataset.source));
  tab.addEventListener('keydown', async event => {
    const index = sourceTabs.indexOf(tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % sourceTabs.length
      : event.key === 'ArrowLeft' ? (index + sourceTabs.length - 1) % sourceTabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? sourceTabs.length - 1 : -1;
    if (next < 0 || busy) return;
    event.preventDefault();
    await selectSource(sourceTabs[next].dataset.source);
    sourceTabs[next].focus();
  });
}
$('hex-file').addEventListener('change', event => {
  const file = event.target.files[0]; event.target.value = '';
  if (file) return loadLocal(file);
});
const dropZone = $('hex-drop');
dropZone.addEventListener('dragover', event => {
  event.preventDefault();
  if (source === 'custom' && !busy) dropZone.classList.add('dragging');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', event => {
  event.preventDefault(); dropZone.classList.remove('dragging');
  if (source !== 'custom' || busy) return;
  const files = event.dataTransfer.files;
  if (files.length !== 1) { report('Drop exactly one .hex file', 'error'); return; }
  return loadLocal(files[0]);
});
$('enter-bootloader').addEventListener('click', async () => {
  if (busy || !window.isSecureContext || !navigator.hid || session?.ready) return;
  busy = true; entryState = 'working';
  $('entry-status').textContent = 'Select the running macropad in the HID picker';
  $('entry-status').dataset.state = 'working';
  controls(); progress.hidden = true;
  try {
    await enterBootloader(navigator.hid);
    entryState = 'success';
    $('entry-status').textContent = 'Bootloader entry command succeeded';
    $('entry-status').dataset.state = 'success';
    connectionMessage('Next: select Connect Bootloader now');
    report('Bootloader entry command succeeded. Select Connect Bootloader now', 'success');
  } catch (error) {
    entryState = 'error';
    $('entry-status').textContent = `Bootloader entry failed: ${error.message.replace(/\.$/, '')}`;
    $('entry-status').dataset.state = 'error';
    connectionMessage('Use the hardware instructions above, then connect');
    report(error.message, 'error');
  } finally {
    busy = false; controls();
    if (entryState === 'success' && supported) connect.focus();
  }
});
for (const button of variantButtons) {
  button.addEventListener('click', async () => {
    if (busy || source === 'custom' || !manifest || Number(button.dataset.variant) === selectedVariant) return;
    const version = loadedEntry?.formatVersion;
    selectedVariant = Number(button.dataset.variant);
    selectedRelease = source === 'latest' ? 'latest' : previousReleases(manifest, selectedVariant).find(entry => entry.formatVersion === version)?.name ?? '';
    releaseChoices(); await loadFirmware();
  });
}
releaseSelector.addEventListener('change', () => {
  if (busy || source !== 'previous') return;
  selectedRelease = releaseSelector.value; return loadFirmware();
});
variantConfirmation.addEventListener('change', controls);
unknownConfirmation.addEventListener('change', controls);
connect.addEventListener('click', async () => {
  if (!supported || busy || session.ready) return;
  busy = true; controls(); progress.hidden = true;
  connectionMessage('Select the CH55x bootloader in the USB picker', 'working');
  try {
    const info = await session.connect();
    deviceMessage(`CH552 supported\nBootloader ${info.version} supported\nChip ID ${info.id.map(b => b.toString(16).padStart(2, '0')).join('')}`, 'success');
    connectionMessage('Bootloader connected', 'success');
    if (entryState !== 'success') {
      $('entry-status').textContent = 'Bootloader mode confirmed by USB connection';
      $('entry-status').dataset.state = 'success';
    }
    report('Bootloader connected. Review your firmware selection and confirm to install', 'success');
  } catch (error) {
    deviceMessage('Bootloader connection failed', 'error');
    connectionMessage('Connection failed. Re-enter bootloader mode and try again', 'error');
    report(`${error.message} Check the platform instructions above if USB access failed.`, 'error');
  } finally { busy = false; controls(); }
});
function closedConnection(message, state = 'info') {
  entryState = 'idle';
  $('entry-status').textContent = 'Enter bootloader mode to connect again';
  $('entry-status').dataset.state = 'info';
  connectionMessage('Bootloader disconnected', state);
  deviceMessage(message, state);
}
reboot.addEventListener('click', async () => {
  if (busy || !session?.ready) return;
  busy = true; controls(); progress.hidden = true;
  report('Sending the restart command…');
  try {
    await session.reboot();
    closedConnection('Bootloader disconnected');
    report('Restart command sent. No firmware was uploaded', 'success');
  } catch (error) {
    closedConnection('Bootloader disconnected', 'error');
    report(`Could not confirm the restart command: ${error.message} Unplug and reconnect USB to restart the device.`, 'error');
  } finally { busy = false; controls(); }
});
install.addEventListener('click', async () => {
  if (busy || !session?.ready || !canInstall()) return;
  busy = true; controls(); progress.value = 0; progress.hidden = false;
  report('Preparing the bootloader and checking boot configuration…');
  try {
    await session.flash(firmware);
    progress.value = 100;
    closedConnection('Firmware installed and verified', 'success');
    report('Firmware programmed and verified', 'success');
    let path;
    if (Number.isInteger(loadedEntry.formatVersion)) {
      try { path = configuratorPath(loadedEntry.formatVersion, manifest?.currentFormatVersion); } catch { /* No editor for an unknown format. */ }
    }
    if (path) {
      const configuratorLink = document.createElement('a');
      configuratorLink.href = path;
      configuratorLink.textContent = 'Open the Macropad Configurator';
      status.append(' ', configuratorLink);
    }
  } catch (error) {
    closedConnection('Installation stopped. Re-enter bootloader mode before retrying', 'error');
    report(`Installation stopped: ${error.message}`, 'error');
  } finally { busy = false; resetConfirmations(); controls(); }
});
if (supported) {
  navigator.usb.addEventListener('disconnect', event => {
    if (event.device !== session.device || busy) return;
    session.disconnect();
    closedConnection('Bootloader disconnected');
    report('Re-enter bootloader mode and connect again'); controls();
  });
  window.addEventListener('beforeunload', event => {
    if (session.busy) { event.preventDefault(); event.returnValue = ''; }
  });
}
controls();
try {
  const response = await fetch('./firmware.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Firmware list unavailable (HTTP ${response.status}).`);
  manifest = await response.json();
  releaseChoices();
  if (source !== 'custom') await loadFirmware();
} catch (error) {
  if (source !== 'custom') $('firmware-info').textContent = 'Published firmware is unavailable. You can choose a custom HEX file';
  report(error.message, 'error');
}
if (!supported) report('WebUSB is unavailable. Open this page in desktop Chrome or Edge over HTTPS or localhost', 'error');
controls();
