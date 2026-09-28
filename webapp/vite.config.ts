import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// Relative base so the built site works from any path (GitHub Pages
// project sites, a subdirectory on a static host, or file:// previews).
export default defineConfig({
  base: './',
  plugins: [preact()],
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
