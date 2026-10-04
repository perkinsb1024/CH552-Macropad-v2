// Use the editor's real importer/encoder so the reader saves the same profiles.
import { build } from '../webapp/node_modules/esbuild/lib/main.js';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const directory = dirname(fileURLToPath(import.meta.url));
const bundle = await build({
  stdin: {
    contents: "export { importProfile } from './src/io/json'; export { encodeProfile } from './src/codec/encode'; export { decodeImage } from './src/codec/decode'; export { computeCapacity } from './src/model/capacity';",
    resolveDir: resolve(directory, '../webapp'), loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const codec = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
for (let test = 1; test <= 3; test++) {
  const name = `6-key-test-${test}-profile`;
  const { profile } = codec.importProfile(await readFile(resolve(directory, `${name}.json`), 'utf8'));
  const image = codec.encodeProfile(profile);
  const decoded = codec.decodeImage(image);
  if (!decoded.ok || !Buffer.from(codec.encodeProfile(decoded.profile)).equals(Buffer.from(image))) {
    throw new Error(`${name}: codec round trip failed`);
  }
  await writeFile(resolve(directory, `${name}.bin`), image);
  console.log(`${name}: valid 128-byte image; capacity ${JSON.stringify(codec.computeCapacity(profile))}`);
}
