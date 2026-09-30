import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'public/versions');
let count = 0;
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const folder = resolve(root, entry.name);
  const manifest = JSON.parse(await readFile(resolve(folder, 'archive.json'), 'utf8'));
  for (const [name, expected] of Object.entries(manifest.sha256)) {
    const contents = await readFile(resolve(folder, name));
    const actual = createHash('sha256').update(contents).digest('hex');
    if (actual !== expected) throw new Error(`Frozen archive changed: ${entry.name}/${name}`);
  }
  if (!manifest.sha256['index.html']) throw new Error(`Missing archive entry point: ${entry.name}`);
  console.log(`Verified ${entry.name} (${manifest.sourceCommit})`);
  count++;
}
if (!count) throw new Error('No archived configurators found; refusing to publish without them.');
