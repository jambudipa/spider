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
        'fs',
        'path',
        'url',
        'node:fs',
        'node:path', 
        'node:url',
        'node:crypto',
        'node:os'
      ],
      output: {
        globals: {
          cheerio: 'cheerio',
          domhandler: 'domhandler',
          effect: 'effect',
          tslib: 'tslib',
          fs: 'fs',
          path: 'path',
          url: 'url'
        }
      }
    },
    sourcemap: true,
    target: 'node18',
    minify: false,
    ssr: true
  },
  define: {
    global: 'globalThis'
  }
});
