import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { archivePages } from './scripts/archive-pages.mjs';

// Relative base so the built site works from any path (GitHub Pages
// project sites, a subdirectory on a static host, or file:// previews).
export default defineConfig({
  base: './',
  plugins: [archivePages(), preact()],
  build: {
    target: 'es2022', sourcemap: true,
    rollupOptions: { input: {
      configurator: 'index.html',
      viewer: 'liveView/index.html',
    } },
  },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,mjs}'] },
});
