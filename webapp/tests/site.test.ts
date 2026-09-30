import { describe, expect, it } from 'vitest';
import { siteUrl } from '../src/site';

describe('configurator links', () => {
  it('anchors development archive links to the site root', () => {
    expect(siteUrl('versions/format-v2/', 'http://localhost:5173/src/site.ts'))
      .toBe('http://localhost:5173/versions/format-v2/');
  });

  it('preserves a GitHub Pages project prefix', () => {
    const moduleUrl = 'https://example.github.io/macropad/assets/index-123.js';
    expect(siteUrl('versions/format-v2/', moduleUrl))
      .toBe('https://example.github.io/macropad/versions/format-v2/');
    expect(siteUrl('versions/', moduleUrl)).toBe('https://example.github.io/macropad/versions/');
  });
});
