/**
 * Spider Config & Defaults Tests
 * Tests for SpiderConfig service and Spider operational defaults
 */

import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { makeSpiderConfig } from '../../../lib/Config/SpiderConfig.service.js';
import { SPIDER_DEFAULTS } from '../../../lib/Spider/Spider.defaults.js';

const run = <A>(effect: Effect.Effect<A, unknown>) =>
  Effect.runPromise(effect);

describe('SpiderConfig', () => {
  it('should apply default config values when none provided', async () => {
    const config = makeSpiderConfig({});
    const opts = await run(config.getOptions());
    expect(opts.maxConcurrentWorkers).toBe(5);
    expect(opts.concurrency).toBe(4);
    expect(opts.requestDelayMs).toBe(1000);
    expect(opts.userAgent).toBe('JambudipaSpider/1.0');
    expect(opts.followRedirects).toBe(true);
    expect(opts.respectNoFollow).toBe(true);
  });

  it('should override defaults with provided options', async () => {
    const config = makeSpiderConfig({
      maxPages: 50,
      maxDepth: 3,
      concurrency: 8,
      userAgent: 'CustomBot/2.0',
    });
    const opts = await run(config.getOptions());
    expect(opts.maxPages).toBe(50);
    expect(opts.maxDepth).toBe(3);
    expect(opts.concurrency).toBe(8);
    expect(opts.userAgent).toBe('CustomBot/2.0');
  });

  it('should respect maxPages limit via config getter', async () => {
    const config = makeSpiderConfig({ maxPages: 100 });
    const maxPages = await run(config.getMaxPages());
    expect(maxPages).toBe(100);
  });

  it('should respect maxDepth limit via config getter', async () => {
    const config = makeSpiderConfig({ maxDepth: 5 });
    const maxDepth = await run(config.getMaxDepth());
    expect(maxDepth).toBe(5);
  });

  it('should filter URLs with disallowed protocols', async () => {
    const config = makeSpiderConfig({});
    const result = await run(config.shouldFollowUrl('javascript:void(0)'));
    expect(result.follow).toBe(false);
    expect(result.reason).toContain('Protocol');
  });

  it('should allow URLs with permitted protocols', async () => {
    const config = makeSpiderConfig({});
    const result = await run(config.shouldFollowUrl('https://example.com/page'));
    expect(result.follow).toBe(true);
  });

  it('should filter URLs exceeding max length', async () => {
    const config = makeSpiderConfig({});
    const longUrl = 'https://example.com/' + 'a'.repeat(2100);
    const result = await run(config.shouldFollowUrl(longUrl));
    expect(result.follow).toBe(false);
    expect(result.reason).toContain('URL length');
  });

  it('should filter file extensions like images and archives', async () => {
    const config = makeSpiderConfig({});
    const result = await run(config.shouldFollowUrl('https://example.com/photo.jpg'));
    expect(result.follow).toBe(false);
    expect(result.reason).toContain('image');
  });

  it('should filter blocked domains', async () => {
    const config = makeSpiderConfig({
      blockedDomains: ['spam.example.com'],
    });
    const result = await run(config.shouldFollowUrl('https://spam.example.com/page'));
    expect(result.follow).toBe(false);
    expect(result.reason).toContain('blocked');
  });

  it('should restrict to allowed domains when configured', async () => {
    const config = makeSpiderConfig({
      allowedDomains: ['example.com'],
    });
    const allowed = await run(config.shouldFollowUrl('https://example.com/page'));
    expect(allowed.follow).toBe(true);

    const blocked = await run(config.shouldFollowUrl('https://other.com/page'));
    expect(blocked.follow).toBe(false);
    expect(blocked.reason).toContain('allowlist');
  });

  it('should handle malformed URLs gracefully', async () => {
    const config = makeSpiderConfig({});
    const result = await run(config.shouldFollowUrl('not a valid url'));
    expect(result.follow).toBe(false);
    expect(result.reason).toContain('Malformed');
  });
});

describe('SPIDER_DEFAULTS', () => {
  it('should be frozen and immutable', () => {
    expect(Object.isFrozen(SPIDER_DEFAULTS)).toBe(true);
  });

  it('should contain all expected operational defaults', () => {
    expect(SPIDER_DEFAULTS.STALE_WORKER_THRESHOLD_MS).toBe(60_000);
    expect(SPIDER_DEFAULTS.HEALTH_CHECK_INTERVAL).toBe('15 seconds');
    expect(SPIDER_DEFAULTS.MEMORY_THRESHOLD_BYTES).toBe(1024 * 1024 * 1024);
    expect(SPIDER_DEFAULTS.QUEUE_SIZE_THRESHOLD).toBe(10_000);
    expect(SPIDER_DEFAULTS.TASK_ACQUISITION_TIMEOUT).toBe('10 seconds');
    expect(SPIDER_DEFAULTS.FETCH_TIMEOUT).toBe('45 seconds');
    expect(SPIDER_DEFAULTS.FETCH_RETRY_COUNT).toBe(2);
    expect(SPIDER_DEFAULTS.FAILURE_DETECTOR_INTERVAL).toBe('30 seconds');
  });
});
