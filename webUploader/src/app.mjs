import { Ch552Bootloader } from './bootloader.mjs';
import { parseHex } from './hex.mjs';
import { configuratorPath } from './firmware-format.mjs';
import { firmwareChoices, selectedFirmware } from './firmware-list.mjs';
import { localFirmware } from './local-firmware.mjs';
import { enterDiagnosticBootloader } from './diagnostic-hid.mjs';

const $ = id => document.getElementById(id);
const status = $('status'), connect = $('connect'), install = $('install');
const reboot = $('reboot');
const variantConfirmation = $('confirm-variant');
const releaseSelector = $('firmware-release');
let selectedRelease = 'latest', loadedEntry = null;
let localFile = null;
let bootloaderInfo = null;
const dataFlashUrls = [];
function clearDataFlash() {
  for (const url of dataFlashUrls) URL.revokeObjectURL(url);
  dataFlashUrls.length = 0;
  for (const id of ['dataflash-download', 'dataflash-trace', 'dataflash-hex']) $(id).hidden = true;
  $('dataflash-info').textContent = 'Connect the bootloader before reading.';
}
function dataFlashDownload(id, content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  dataFlashUrls.push(url);
  $(id).href = url;
  $(id).download = name;
  $(id).hidden = false;
}
const variantButtons = Array.from(document.querySelectorAll('[data-variant]'));
let selectedVariant = 3;
const progress = $('progress');
const repository = 'https://github.com/perkinsb1024/CH552-Macropad-v2';
$('boot-guide').href = `${repository}#how-to-upload-the-firmware`;
let manifest, firmware = null, busy = false;
const supported = window.isSecureContext && 'usb' in navigator;
if (!supported) {
  const notice = $('compatibility-notice');
  notice.className = 'beta incompatible';
  notice.setAttribute('role', 'alert');
  $('notice-title').textContent = window.isSecureContext
    ? 'Unable to install firmware'
    : 'A secure connection is required to install firmware';
  $('notice-message').textContent = window.isSecureContext
    ? 'USB access (WebUSB) is unavailable in this browser, please open this page in desktop Chrome or Edge'
    : 'Open this page over HTTPS or localhost in desktop Chrome or Edge to enable USB access';
}
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
  $('enter-bootloader').disabled = busy || !!session?.ready || !window.isSecureContext || !navigator.hid;
  $('hex-file').disabled = busy;
  $('use-published').disabled = busy || !manifest || !localFile;
  connect.disabled = !supported || busy || !!session?.ready;
  reboot.disabled = busy || !session?.ready;
  $('read-dataflash').disabled = busy || !session?.ready;
  for (const button of variantButtons) {
    button.disabled = (!manifest && !localFile) || busy;
    button.setAttribute('aria-pressed', String(Number(button.dataset.variant) === selectedVariant));
  }
  releaseSelector.disabled = !manifest || busy || !!localFile;
  variantConfirmation.disabled = busy || !firmware;
  install.disabled = busy || !session?.ready || !firmware || !variantConfirmation.checked;
}

function releaseChoices() {
  releaseSelector.replaceChildren();
  const current = manifest.firmware.find(entry => entry.keys === selectedVariant);
  for (const [value, label] of [
    ['latest', `Latest release${current ? ` (v${current.formatVersion})` : ''}`],
    ...firmwareChoices(manifest, selectedVariant).map(entry => [entry.name, `v${entry.formatVersion} · ${entry.sourceRevision}`]),
  ]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label;
    releaseSelector.append(option);
  }
  releaseSelector.value = selectedRelease;
}

async function loadFirmware() {
  firmware = null;
  loadedEntry = null;
  $('download').hidden = true;
  controls();
  const entry = selectedFirmware(manifest, selectedVariant, selectedRelease);
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
    loadedEntry = entry;
    $('firmware-info').textContent = `v${entry.formatVersion} · ${entry.name} · ${firmware.length.toLocaleString()} application bytes`;
    $('download').href = `./firmware/${entry.name}`;
    $('download').download = entry.name;
    $('download').hidden = false;
  } catch (error) {
    $('firmware-info').textContent = 'Firmware could not be loaded.';
    report(error.message);
  } finally { busy = false; controls(); }
}

async function loadLocal(file) {
  if (busy) return;
  busy = true;
  localFile = file;
  firmware = loadedEntry = null;
  variantConfirmation.checked = false;
  $('download').hidden = true;
  controls();
  try {
    if (file.size > 1024 * 1024) throw new Error('HEX text file is too large (maximum 1 MiB).');
    const result = localFirmware(file.name, await file.text(), selectedVariant);
    firmware = result.image;
    loadedEntry = result.entry;
    $('firmware-info').textContent = `${file.name} · ${firmware.length.toLocaleString()} application bytes · ${result.identified ? `v${loadedEntry.formatVersion}, ${loadedEntry.keys}-key identity` : 'No recognized identity; confirm hardware compatibility yourself'}`;
    report('Local HEX validated. Confirm the board variant before installing.');
  } catch (error) {
    $('firmware-info').textContent = 'Local firmware could not be loaded.';
    report(error.message);
  } finally { busy = false; controls(); }
}

$('hex-file').addEventListener('change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) return loadLocal(file);
});
const dropZone = $('hex-drop');
dropZone.addEventListener('dragover', event => {
  event.preventDefault();
  if (!busy) dropZone.classList.add('dragging');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', event => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
  if (busy) return;
  const files = event.dataTransfer.files;
  if (files.length !== 1) { report('Drop exactly one .hex file.'); return; }
  return loadLocal(files[0]);
});
$('use-published').addEventListener('click', () => {
  if (busy || !manifest) return;
  localFile = null;
  variantConfirmation.checked = false;
  return loadFirmware();
});
$('enter-bootloader').addEventListener('click', async () => {
  if (busy || !navigator.hid || session?.ready) return;
  busy = true;
  controls();
  progress.hidden = true;
  report('Select the running diagnostic macropad in the HID picker.');
  try {
    await enterDiagnosticBootloader(navigator.hid);
    report('Bootloader command acknowledged. Click Connect bootloader now.');
  } catch (error) { report(error.message); }
  finally { busy = false; controls(); }
});

for (const button of variantButtons) {
  button.addEventListener('click', () => {
    if (busy || Number(button.dataset.variant) === selectedVariant) return;
    selectedVariant = Number(button.dataset.variant);
    selectedRelease = 'latest';
    if (manifest) releaseChoices();
    variantConfirmation.checked = false;
    if (localFile) return loadLocal(localFile);
    return loadFirmware();
  });
}
releaseSelector.addEventListener('change', () => {
  if (busy) return;
  selectedRelease = releaseSelector.value;
  variantConfirmation.checked = false;
  return loadFirmware();
});
variantConfirmation.addEventListener('change', controls);
connect.addEventListener('click', async () => {
  if (!supported || busy || session.ready) return;
  busy = true;
  controls();
  progress.hidden = true;
  report('Select the CH55x bootloader in the USB picker.');
  clearDataFlash();
  bootloaderInfo = null;
  try {
    const info = await session.connect();
    bootloaderInfo = info;
    $('device-info').textContent = `CH552 · bootloader ${info.version} · chip ID ${info.id.map(b => b.toString(16).padStart(2, '0')).join('')}`;
    report('Bootloader connected. You can read DataFlash or choose firmware to install.');
  } catch (error) {
    $('device-info').textContent = 'No bootloader connected.';
    report(`${error.message} Check the platform instructions above if USB access failed.`);
  } finally { busy = false; controls(); }
});

$('read-dataflash').addEventListener('click', async () => {
  if (busy || !session?.ready) return;
  busy = true;
  clearDataFlash();
  controls();
  progress.hidden = true;
  const capturedUtc = new Date().toISOString();
  const suffix = capturedUtc.replace(/[:.]/g, '-');
  let readError = null;
  try {
    const image = await session.readDataFlash();
    const lines = [];
    for (let offset = 0; offset < image.length; offset += 16) {
      const bytes = [...image.slice(offset, offset + 16)];
      lines.push(`${offset.toString(16).padStart(4, '0')}: ${bytes.map(byte => byte.toString(16).padStart(2, '0')).join(' ')}  ${bytes.map(byte => byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.').join('')}`);
    }
    $('dataflash-hex').textContent = lines.join('\n');
    $('dataflash-hex').hidden = false;
    dataFlashDownload('dataflash-download', image, `ch552-dataflash-${suffix}.bin`, 'application/octet-stream');
    $('dataflash-info').textContent = `Read 128 bytes at ${capturedUtc}. Compare this binary with an application HID capture to confirm the data.`;
    report('DataFlash read completed. No firmware or saved data was written.');
  } catch (error) {
    readError = error.message;
    $('dataflash-info').textContent = 'DataFlash read failed; no binary was exported. The diagnostic log contains the raw exchanges.';
    $('device-info').textContent = 'Bootloader session closed. Re-enter bootloader mode before retrying.';
    report(`DataFlash read stopped: ${error.message}`);
  } finally {
    dataFlashDownload('dataflash-trace', JSON.stringify({ schema: 1, capturedUtc, bootloader: bootloaderInfo,
      complete: readError === null, error: readError, exchanges: session.dataFlashTrace }, null, 2) + '\n',
      `ch552-dataflash-read-${suffix}.json`, 'application/json');
    busy = false;
    controls();
  }
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
    const entry = loadedEntry;
    let path;
    if (Number.isInteger(entry.formatVersion)) {
      try { path = configuratorPath(entry.formatVersion, manifest?.currentFormatVersion); } catch { /* Unknown local firmware has no matching editor. */ }
    }
    if (path) {
      const configuratorLink = document.createElement('a');
      configuratorLink.href = path;
      configuratorLink.textContent = 'Open the macropad configurator to load or save your profile';
      status.append(' ', configuratorLink, '.');
    }
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
  releaseChoices();
  if (!localFile) {
    $('firmware-info').textContent = 'Choose the number of keys on your macropad.';
    report(supported ? 'Ready. Enter bootloader mode and connect when you are ready.' : 'WebUSB is unavailable. Open this page in desktop Chrome or Edge over HTTPS or localhost.');
    await loadFirmware();
  }
} catch (error) { report(error.message); }
controls();
