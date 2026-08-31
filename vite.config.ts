import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'Spider',
      formats: ['es'],
      fileName: 'index'
    },
    rollupOptions: {
      external: [
        'cheerio',
        'domhandler',
        'effect',
        'tslib',
        'tough-cookie',
        'playwright',
        '@playwright/test',
        'fs',
        'path',
        'url',
        'node:fs',
        'node:path',
        'node:url',
        'node:crypto',
        'node:os',
        'node:http',
        'node:https',
        'node:stream',
        'node:buffer',
        'node:events',
      ]
    },
    sourcemap: true,
    target: 'node20',
    minify: false,
    ssr: true
  },
  define: {
    global: 'globalThis'
  }
});
