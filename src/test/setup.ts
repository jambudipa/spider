import { vi } from 'vitest';

// Setup global test environment
vi.hoisted(() => {
  // Mock fetch if needed
  if (!globalThis.fetch) {
    globalThis.fetch = vi.fn();
  }
});

// Extend test timeout for Effect-based tests and live-site scenario tests
// (Playwright navigation to web-scraping.dev can exceed 10s when the site is
// slow). Matches the global `testTimeout` set in vitest.config.ts.
vi.setConfig({
  testTimeout: 30000,
});
