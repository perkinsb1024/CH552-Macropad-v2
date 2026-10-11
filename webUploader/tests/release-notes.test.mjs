import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReleaseNotes } from '../release-notes.mjs';

test('release notes preserve arbitrary editorial wording and strip table formatting', () => {
  const readme = `# Firmware Version History

| Firmware version | Primary features added |
| --- | --- |
| [v14](protocol/config-v14.md) | - **Media / system with modifiers** now supports **Hold**<br> - Added **Relative layer**<br> *Action encodings were reorganized* |
| [v13](protocol/config-v13.md) | - Revised pointer controls |
`;
  assert.deepEqual(parseReleaseNotes(readme), {
    14: 'Media / system with modifiers now supports Hold; Added Relative layer; Action encodings were reorganized',
    13: 'Revised pointer controls',
  });
  const edited = readme.replace('now supports **Hold**', 'can remain active until release');
  assert.equal(parseReleaseNotes(edited)[14], 'Media / system with modifiers can remain active until release; Added Relative layer; Action encodings were reorganized');
});

test('release notes support HTML line-break variants and Windows newlines', () => {
  const readme = '| [v2](protocol/config-v2.md) | **First**<br/> Second<br /> - Third · Fourth |\r\n';
  assert.deepEqual(parseReleaseNotes(readme), { 2: 'First; Second; Third / Fourth' });
});

test('duplicate version rows are rejected rather than replacing an earlier release', () => {
  assert.throws(() => parseReleaseNotes('| [v2](v2.md) | First |\n| [v2](v2.md) | Second |'), /Duplicate release notes for v2/);
});

test('empty release notes are rejected', () => {
  for (const text of ['', '- ', '<br>']) {
    assert.throws(() => parseReleaseNotes(`| [v2](v2.md) | ${text} |`), /Empty release notes for v2/);
  }
});
