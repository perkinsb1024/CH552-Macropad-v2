// One sanity workload, adapted to the physical key count; use the real v10 codec.
import { build } from '../webapp/node_modules/esbuild/lib/main.js';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
const directory = dirname(fileURLToPath(import.meta.url));
const bundle = await build({ stdin: {
  contents: "export { exportProfile, importProfile } from './src/io/json'; export { encodeProfile } from './src/codec/encode'; export { decodeImage } from './src/codec/decode'; export { computeCapacity } from './src/model/capacity';",
  resolveDir: resolve(directory, '../webapp'), loader: 'ts',
}, bundle: true, platform: 'node', format: 'esm', write: false });
const codec = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const text = { type: 'string', text: 'T!a \n' };
const led = (command, value = 0) => ({ type: 'ledControl', command, value });
const scroll = (delta, hold = false, horizontal = false) => ({ type: 'scroll', delta, hold, horizontal });
const actions = [
  { type: 'keyHold', usage: 4, modifiers: 0 }, { type: 'keyTap', usage: 5, modifiers: 2 }, text,
  scroll(127, true), scroll(-127), { type: 'consumerHold', usage: 0xea },
  { type: 'momentaryLayer', layer: 3 }, { type: 'oneShotRelativeLayer', offset: 1 }, led('effectBlink8', 15),
  scroll(127, true, true), scroll(-127, false, true), { type: 'consumer', usage: 0xe9 },
  { type: 'setLayer', layer: 0 }, led('rainbowPhaseRelative', 1), led('commonPresetToggle', 2),
  { type: 'consumerHold', usage: 0xea }, scroll(-127, true), text,
  { type: 'keyHold', usage: 6, modifiers: 2 }, led('restoreAll'), led('effectOn', 10),
  scroll(-127, true, true), { type: 'keyTap', usage: 7, modifiers: 0 }, { type: 'none' },
];
for (const keys of [6, 3]) {
  const variant = keys === 3 ? 1 : 0;
  const count = keys === 3 ? 6 : 4;
  const profile = {
    variant, startupLayer: 0, transparentBlack: true, chordWindow: 8, rainbowPhase: 2, rainbowSpeed: 1,
    layers: Array.from({ length: count }, (_, layer) => ({
      keys: actions.slice(layer * keys, (layer + 1) * keys),
      encoderButton: { type: 'relativeLayer', offset: 1 },
      clockwise: scroll(127, false, !!(layer & 1)), counterclockwise: scroll(-127, false, !!(layer & 1)),
      leds: Array(keys).fill((layer + 1) * 2), bootloaderFromRun: false,
      indicatorBehavior: layer % 4, indicatorColor: (layer + 1) * 2, indicatorFullBrightness: !!(layer & 1),
    })),
    chords: [{ layer: 0, global: true, keyA: 0, keyB: 1, action: text },
      ...(keys === 6 ? [{ layer: 0, keyA: 0, keyB: 2, action: { type: 'oneShotSetLayer', layer: 3 } }] : [])],
    timedActions: [
      { ticks: 1, resetOnInput: false, consumeInput: false, action: led('rainbowPhaseRelative', 1), resumeAction: led('rainbowSpeedRelative', 1) },
      { layer: 1, ticks: 2, resetOnInput: false, consumeInput: false, action: led('effectOn', 15), resumeAction: led('effectRestore') },
      { ticks: 3, resetOnInput: true, consumeInput: false, action: led('effectBlink8', 10), resumeAction: led('restoreAll') },
    ],
  };
  const json = codec.exportProfile(profile, { profileName: 'v10 stack sanity', layerNames: profile.layers.map((_, i) => `Mash ${i + 1}`) });
  const image = codec.encodeProfile(codec.importProfile(json).profile);
  const decoded = codec.decodeImage(image);
  assert.ok(decoded.ok); assert.equal(image[2], 10);
  assert.deepEqual(codec.encodeProfile(decoded.profile), image);
  // Protect the hand-mashing constraints against later edits.
  const bindings = [...profile.layers.flatMap(l => [...l.keys, l.encoderButton, l.clockwise, l.counterclockwise]),
    ...profile.chords.map(c => c.action), ...profile.timedActions.flatMap(t => [t.action,t.resumeAction])];
  for (const action of bindings) {
    if (action.type === 'keyTap' || action.type === 'keyHold') {
      assert.ok(action.usage >= 4 && action.usage <= 7); assert.ok([0,2].includes(action.modifiers));
    }
    if (action.type === 'string') assert.match(action.text, /^[A-Za-z! \n]+$/);
  }
  for (const layer of profile.layers) assert.deepEqual(layer.encoderButton, { type: 'relativeLayer', offset: 1 });
  const name = `${keys}-key-sanity-profile`;
  await writeFile(resolve(directory, `${name}.json`), json);
  await writeFile(resolve(directory, `${name}.bin`), image);
  console.log(`${name}: ${JSON.stringify(codec.computeCapacity(profile))}`);
}
