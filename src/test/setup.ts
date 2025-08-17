import { vi } from 'vitest';

// Setup global test environment
vi.hoisted(() => {
  // Mock fetch if needed
  if (!globalThis.fetch) {
    globalThis.fetch = vi.fn();
  }
});

// Extend test timeout for Effect-based tests
vi.setConfig({
  testTimeout: 10000,
});
