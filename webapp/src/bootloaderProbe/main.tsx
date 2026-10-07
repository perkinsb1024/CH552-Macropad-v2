import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { MACROPAD_FILTERS, bootloaderPayload, identity, protocolHint, reportBytes, sendBootloaderRequest, supportsWebHubOutput } from './protocol';
import './style.css';

function describe(collections: readonly HIDCollectionInfo[], depth = 0): string {
  return collections.map((c) => {
    const indent = '  '.repeat(depth);
    const reports = (['inputReports', 'outputReports', 'featureReports'] as const).flatMap((kind) =>
      (c[kind] ?? []).map((r) => `${indent}  ${kind.replace('Reports', '')}: ID ${r.reportId}, ${reportBytes(r)} bytes`));
    return [`${indent}Usage page 0x${(c.usagePage ?? 0).toString(16).toUpperCase()}, usage 0x${(c.usage ?? 0).toString(16).toUpperCase()}`,
      ...reports, describe(c.children ?? [], depth + 1)].filter(Boolean).join('\n');
  }).join('\n');
}

function App() {
  const [device, setDevice] = useState<HIDDevice | null>(null);
  const [choices, setChoices] = useState<HIDDevice[]>([]);
  const current = useRef<HIDDevice | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState('No device selected');
  const supported = typeof navigator !== 'undefined' && 'hid' in navigator && window.isSecureContext;
  const log = (message: string) => setLogs((old) => [...old.slice(-199), `${new Date().toISOString()}  ${message}`]);

  useEffect(() => {
    if (!supported) return;
    const disconnected = (event: HIDConnectionEvent) => {
      if (event.device !== current.current) return;
      log(`HID disconnected: ${identity(event.device.vendorId, event.device.productId)}. Bootloader entry is not confirmed.`);
      setStatus('Device disconnected — bootloader entry unconfirmed');
      current.current = null;
      setDevice(null);
    };
    navigator.hid.addEventListener('disconnect', disconnected);
    return () => navigator.hid.removeEventListener('disconnect', disconnected);
  }, [supported]);

  useEffect(() => {
    if (!device) return;
    const received = (event: HIDInputReportEvent) => {
      const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
      log(`RX report ${event.reportId}: ${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ').toUpperCase()}`);
    };
    device.addEventListener('inputreport', received);
    return () => device.removeEventListener('inputreport', received);
  }, [device]);

  async function close() {
    const previous = current.current;
    if (previous?.opened) await previous.close();
    current.current = null;
    setDevice(null);
    setAttempted(false);
    setStatus('No device selected');
  }

  async function select() {
    setBusy(true);
    try {
      const devices = await navigator.hid.requestDevice({ filters: MACROPAD_FILTERS });
      if (!devices.length) { log('Device chooser cancelled. No reports sent.'); return; }
      if (devices.length !== 1) {
        setChoices(devices);
        log(`Chooser returned ${devices.length} HID interfaces. Choose one below; none opened or written.`);
        return;
      }
      await openSelected(devices[0]!);
    } catch (error) { log(`Select/open failed: ${String(error)}`); }
    finally { setBusy(false); }
  }

  async function openSelected(selected: HIDDevice) {
    await close();
    if (!selected.opened) await selected.open();
    current.current = selected;
    setDevice(selected);
    setChoices([]);
    setStatus('Device open — no reports sent');
    log(`Opened ${selected.productName || 'Unnamed device'} ${identity(selected.vendorId, selected.productId)}. No reports sent.`);
    log(protocolHint(selected.vendorId, selected.productId));
    log(`Descriptor:\n${describe(selected.collections)}`);
  }

  async function send() {
    if (busy || attempted || !current.current) return;
    const target = current.current;
    setBusy(true);
    setAttempted(true);
    log(`TX attempt to ${identity(target.vendorId, target.productId)}: output report ID 0, 64-byte payload 06 5A + 62 zero bytes.`);
    try {
      await sendBootloaderRequest(target);
      log('Host accepted the write. No device acknowledgment or bootloader confirmation is implied.');
      if (current.current === target) setStatus('Request sent — check USB enumeration');
    } catch (error) {
      log(`Write failed: ${String(error)}. A disconnect during the write can also cause this error; delivery is unknown. No retry sent.`);
      if (current.current === target) setStatus('Write failed — delivery unknown');
    } finally { setBusy(false); }
  }

  async function checkUsb() {
    setBusy(true);
    try {
      // WebUSB is used only for enumeration; no open, claim, or transfer calls.
      const usb = (navigator as Navigator & { usb?: { requestDevice(options: { filters: { vendorId: number; productId: number }[] }): Promise<{ vendorId: number; productId: number; productName?: string }> } }).usb;
      if (!usb) throw new Error('WebUSB is unavailable in this browser.');
      const found = await usb.requestDevice({ filters: [{ vendorId: 0x4348, productId: 0x55e0 }, { vendorId: 0x1a86, productId: 0x55e0 }] });
      log(`USB chooser identified WCH ISP identity ${identity(found.vendorId, found.productId)} ${found.productName || ''}. No USB transfers sent. This does not prove it is the same physical pad.`);
    } catch (error) { log(`WCH USB check: ${String(error)}. Other MCU bootloaders may have different IDs.`); }
    finally { setBusy(false); }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([logs.join('\n') + '\n'], { type: 'text/plain' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'factory-bootloader-probe.txt';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const eligible = device && supportsWebHubOutput(device.collections);
  return <main>
    <header><span class="eyebrow">FACTORY FIRMWARE · EXPERIMENTAL</span><h1>Bootloader probe</h1>
      <p>Try the documented WebHub bootloader request without opening the macropad.</p></header>
    {!supported && <aside role="alert">WebHID requires Chrome or Edge on HTTPS or localhost. Safari and Firefox are unsupported.</aside>}
    <section><h2>1. Select the factory device</h2>
      <p>Connecting reads its identity and HID descriptors. It sends no application reports. Close other configurators that may have the device open.</p>
      <p>The picker shows only macropad VID/PIDs documented by Knurl. An unlisted pad will not appear; a listed ID does not guarantee support for this command.</p>
      <div class="buttons"><button disabled={!supported || busy} onClick={select}>Select HID device</button>
        <button disabled={!device || busy} onClick={() => { setBusy(true); void close().catch((e) => log(`Close failed: ${String(e)}`)).finally(() => setBusy(false)); }}>Close device</button></div>
      <p class="status" role="status">{status}</p>
      {choices.length > 0 && <div><p>Choose the configuration interface returned by the browser:</p>{choices.map((candidate, index) =>
        <div key={index}><button disabled={busy} onClick={() => {
          setBusy(true);
          void openSelected(candidate).catch((e) => log(`Open failed: ${String(e)}`)).finally(() => setBusy(false));
        }}>Open interface {index + 1} · {identity(candidate.vendorId, candidate.productId)} · {supportsWebHubOutput(candidate.collections) ? '64-byte vendor output ID 0' : 'descriptor does not match'}</button>
          <details><summary>Interface {index + 1} descriptors</summary><pre>{describe(candidate.collections)}</pre></details></div>)}</div>}
      {device && <><h3>{device.productName || 'Unnamed HID device'} · {identity(device.vendorId, device.productId)}</h3>
        <p>{protocolHint(device.vendorId, device.productId)}</p>
        <p>{eligible ? 'Descriptor matches: vendor collection, output report ID 0, 64-byte payload.' : 'Descriptor does not match. Sending is disabled; no alternate report IDs or channels are tried.'}</p>
        <details><summary>HID report descriptors</summary><pre>{describe(device.collections)}</pre></details></>}
    </section>
    <section><h2>2. Send one bootloader request</h2>
      <p>Knurl documents this for WebHub / SDCX / Huali factory firmware. Compatibility with Legacy 1189:8890 and other firmware is unverified. On an unknown protocol this message could have a different meaning.</p>
      <div class="frame"><span>Output report ID <b>0</b> · 64 payload bytes</span><code>{Array.from(bootloaderPayload(), (b) => b.toString(16).padStart(2, '0')).join(' ').toUpperCase()}</code></div>
      <p>The report ID is passed separately to WebHID. The button sends one report; there are no automatic probes, retries, firmware uploads, or configuration-save commands.</p>
      <button class="primary" disabled={!eligible || busy || attempted} onClick={send}>Send 06 5A bootloader request</button>
      {attempted && <p>Select the device again to make another explicit attempt.</p>}
    </section>
    <section><h2>3. Check what changed</h2><p>A successful host write or HID disconnect does not prove bootloader entry. Check macOS System Information → USB, or use the chooser below for CH55x WCH ISP IDs. WebHub pads may use a different MCU and bootloader identity.</p>
      <button disabled={!supported || busy} onClick={checkUsb}>Check for WCH USB bootloader</button>
      <p>If the pad stops responding, unplug and reconnect it normally before further investigation.</p></section>
    <section><div class="log-heading"><h2>Session log</h2><button disabled={!logs.length} onClick={download}>Download log</button></div>
      <pre class="log" aria-label="Session log">{logs.join('\n') || 'No activity. No reports sent.'}</pre></section>
    <footer><a href="https://knurl.site/" target="_blank" rel="noreferrer">Knurl protocol documentation</a><span> · </span><a href="../">Macropad configurator</a></footer>
  </main>;
}

render(<App />, document.getElementById('app')!);
