import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'test/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'examples/**/*.test.ts'
    ],
    coverage: {
      reporter: ['text', 'html', 'lcov', 'json'],
      reportsDirectory: './test-output/vitest/coverage',
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/test/**',
        '**/__tests__/**',
        '**/coverage/**',
        'vitest.config.ts',
        'src/test/**',
        'examples/**',
        'scripts/**'
      ],
      include: ['src/**/*.ts'],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95
      },
      skipFull: false,
      all: true,
    },
    testTimeout: 30000,
    hookTimeout: 10000,
    teardownTimeout: 10000,
    poolOptions: {
      threads: {
        singleThread: false, // Enable parallel execution for faster tests
        maxThreads: 4,
        minThreads: 1
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@test': resolve(__dirname, './src/test'),
    },
  },
});
