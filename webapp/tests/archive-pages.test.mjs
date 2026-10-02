import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { archivePages } from '../scripts/archive-pages.mjs';

describe('archived pages in development', () => {
  let server;
  let origin;
  beforeAll(async () => {
    server = await createServer({
      configFile: false, plugins: [archivePages()],
      server: { host: '127.0.0.1', port: 0, hmr: false },
    });
    await server.listen();
    origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  });
  afterAll(async () => { await server?.close(); });

  it.each([2, 3, 4])('serves frozen v%s HTML, including direct index URLs and query strings', async (version) => {
    const frozen = await readFile(new URL(`../public/versions/format-v${version}/index.html`, import.meta.url), 'utf8');
    for (const path of [`/versions/format-v${version}/`, `/versions/format-v${version}/?sim=six`, `/versions/format-v${version}/index.html`]) {
      const response = await fetch(origin + path);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(frozen);
    }
    const asset = frozen.match(/src="(.+?)"/)[1];
    expect((await fetch(new URL(asset, origin + `/versions/format-v${version}/`))).status).toBe(200);
  });

  it('serves the archive catalog and redirects directory URLs to a trailing slash', async () => {
    const response = await fetch(origin + '/versions/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('./format-v2/');
    const redirect = await fetch(origin + '/versions/format-v2?sim=six', { redirect: 'manual' });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe('/versions/format-v2/?sim=six');
  });

  it('does not serve the current editor for nonexistent archive paths', async () => {
    for (const path of ['/versions/format-v2/versions/format-v2/', '/versions/missing/', '/versions/missing.js']) {
      expect((await fetch(origin + path)).status).toBe(404);
    }
    expect(await (await fetch(origin + '/')).text()).toContain('./src/main.tsx');
  });
});
