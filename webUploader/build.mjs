import { readFile, writeFile, mkdir, cp, mkdtemp, rm, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHex } from './src/hex.mjs';
import { firmwareFormat } from './src/firmware-format.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const upstream = join(root, 'upstream');
const output = resolve(process.argv[2] ?? join(root, 'dist'));
const patch = join(root, 'patches/0001-fix-verification-buffer.patch');
const alignmentPatch = join(root, 'patches/0002-fix-final-packet-alignment.patch');
const temporary = await mkdtemp(join(tmpdir(), 'macropad-uploader-'));
try {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim();
  const original = await readFile(join(upstream, 'bootloaderWebtool/ch55xbl.js'), 'utf8');
  await mkdir(join(temporary, 'bootloaderWebtool'));
  await writeFile(join(temporary, 'bootloaderWebtool/ch55xbl.js'), original);
  // Fail if an upstream update needs a patch review; never mutate the submodule checkout.
  for (const file of [patch, alignmentPatch]) {
    execFileSync('git', ['apply', '--check', file], { cwd: temporary });
    execFileSync('git', ['apply', file], { cwd: temporary });
  }
  const patched = await readFile(join(temporary, 'bootloaderWebtool/ch55xbl.js'), 'utf8');
  const marker = '\nasync function pressUpload()';
  if (!patched.includes(marker)) throw new Error('Upstream UI boundary changed; review the adapter.');
  const core = patched.slice(0, patched.indexOf(marker));
  const factory = `// CH55xDuino ${revision}; LGPL-2.1. See upstream-LICENSE.txt and README.md.
// Modified 2026-10-01 for the CH552 Macropad beta uploader: verification/alignment patches and adapter.
// Adapter: isolate globals, inject USB/status, and exclude upstream DOM/file-picker code.
export function createUpstream({ requestDevice, onStatus }) {
  const navigator = { usb: { requestDevice } };
  let result, resultUint8, i;
${core}
  let lastStatus = '';
  statusDiv = { set innerHTML(text) { lastStatus = String(text); onStatus(lastStatus); } };
  return {
    async connect() {
      bootloaderUploadReady = false;
      await connectCH55xBootloader.call({});
      if (!bootloaderUploadReady) throw new Error(lastStatus || 'Bootloader connection failed.');
      return { version: bootloaderVersion, id: [...bootloaderID] };
    },
    upload: uploadCH55xBootloader,
  };
}
`;
  const releases = resolve(root, '../releases');
  const files = await readdir(releases);
  const firmware = [];
  for (const keys of [3, 6]) {
    const matches = files.filter(name => new RegExp(`^ch552-macropad-${keys}-key-(?:dirty-)?[a-f0-9]+\\.hex$`).test(name));
    if (matches.length !== 1) throw new Error(`Expected one generated ${keys}-key HEX in releases/, found ${matches.length}.`);
    const name = matches[0];
    const content = await readFile(join(releases, name));
    const image = parseHex(content.toString('utf8'));
    firmware.push({ keys, name, bytes: image.length, formatVersion: firmwareFormat(image, keys), sha256: createHash('sha256').update(content).digest('hex') });
  }
  const historicalRoot = join(root, 'firmware-history');
  const archive = JSON.parse(await readFile(join(historicalRoot, 'index.json'), 'utf8'));
  const previousFirmware = [];
  for (const entry of archive.firmware) {
    const match = /^ch552-macropad-(3|6)-key-([a-f0-9]+)\.hex$/.exec(entry.name);
    if (!match || !Number.isInteger(entry.formatVersion) || entry.formatVersion < 2 || entry.formatVersion > Math.max(...firmware.map(f => f.formatVersion))) throw new Error('Invalid historical firmware metadata.');
    const keys = Number(match[1]);
    const content = await readFile(join(historicalRoot, entry.name));
    const digest = createHash('sha256').update(content).digest('hex');
    if (digest !== entry.sha256) throw new Error(`Historical firmware changed: ${entry.name}`);
    const image = parseHex(content.toString('utf8'));
    // Early releases construct GET_INFO byte by byte rather than storing UMAC.
    // Their format comes from the recorded release commit's src/config.h.
    if (entry.formatVersion >= 6 && firmwareFormat(image, keys) !== entry.formatVersion) throw new Error(`Historical format mismatch: ${entry.name}`);
    previousFirmware.push({ ...entry, keys, bytes: image.length });
  }
  await mkdir(join(output, 'firmware'), { recursive: true });
  // Only clean generated firmware files so old releases do not linger in local builds.
  for (const name of await readdir(join(output, 'firmware'))) {
    if (name.endsWith('.hex')) await rm(join(output, 'firmware', name));
  }
  for (const entry of firmware) await cp(join(releases, entry.name), join(output, 'firmware', entry.name));
  for (const entry of previousFirmware) await cp(join(historicalRoot, entry.name), join(output, 'firmware', entry.name));
  for (const name of ['index.html', 'style.css', 'app.mjs', 'bootloader.mjs', 'hex.mjs', 'firmware-format.mjs', 'firmware-list.mjs']) await cp(join(root, 'src', name), join(output, name));
  await writeFile(join(output, 'upstream-patched.mjs'), factory);
  await cp(join(upstream, 'LICENSE'), join(output, 'upstream-LICENSE.txt'));
  await cp(join(root, 'README.md'), join(output, 'README.md'));
  await cp(patch, join(output, 'verification-fix.patch'));
  await cp(alignmentPatch, join(output, 'packet-alignment-fix.patch'));
  await writeFile(join(output, 'upstream-original.js'), original);
  const constants = await readFile(resolve(root, '../webapp/src/model/constants.ts'), 'utf8');
  const currentFormatVersion = Number(/FORMAT_VERSION\s*=\s*(\d+)/.exec(constants)?.[1]);
  if (!currentFormatVersion) throw new Error('Cannot identify current configurator format.');
  await writeFile(join(output, 'firmware.json'), JSON.stringify({ upstreamRevision: revision, currentFormatVersion, firmware, previousFirmware }, null, 2) + '\n');
  console.log(`Built beta uploader: ${output}\nUpstream: ${revision}\nFirmware: ${firmware.map(f => f.name).join(', ')}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
