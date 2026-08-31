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
    expect(SPIDER_DEFAULTS.STALE_WORKER_THRESHOLD_MS).toBe(300_000);
    expect(SPIDER_DEFAULTS.STALE_WORKER_CHECK_INTERVAL_MS).toBe(15_000);
    expect(SPIDER_DEFAULTS.MEMORY_THRESHOLD_BYTES).toBe(1024 * 1024 * 1024);
    expect(SPIDER_DEFAULTS.QUEUE_SIZE_THRESHOLD).toBe(10_000);
    expect(SPIDER_DEFAULTS.TASK_ACQUISITION_TIMEOUT).toBe('10 seconds');
    expect(SPIDER_DEFAULTS.FETCH_TIMEOUT).toBe('45 seconds');
    expect(SPIDER_DEFAULTS.FETCH_RETRY_COUNT).toBe(2);
    expect(SPIDER_DEFAULTS.FAILURE_DETECTOR_INTERVAL).toBe('30 seconds');
  });
});

describe('SpiderConfig worker heartbeat options', () => {
  it('should leave the two heartbeat fields undefined when no override is provided', async () => {
    const config = makeSpiderConfig({});
    const opts = await run(config.getOptions());
    expect(opts.staleWorkerThresholdMs).toBeUndefined();
    expect(opts.workerHeartbeatMode).toBeUndefined();
  });

  it('should return the default stale-worker threshold via the getter', async () => {
    const config = makeSpiderConfig({});
    const value = await run(config.getStaleWorkerThreshold());
    expect(value).toBe(300_000);
  });

  it('should return the configured stale-worker threshold via the getter', async () => {
    const config = makeSpiderConfig({ staleWorkerThresholdMs: 90_000 });
    const value = await run(config.getStaleWorkerThreshold());
    expect(value).toBe(90_000);
  });

  it("should return 'per-iteration' for the worker heartbeat mode by default", async () => {
    const config = makeSpiderConfig({});
    const mode = await run(config.getWorkerHeartbeatMode());
    expect(mode).toBe('per-iteration');
  });

  it("should return 'per-attempt' when explicitly configured", async () => {
    const config = makeSpiderConfig({ workerHeartbeatMode: 'per-attempt' });
    const mode = await run(config.getWorkerHeartbeatMode());
    expect(mode).toBe('per-attempt');
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
    2_147_483_648,
  ])(
    'should reject invalid staleWorkerThresholdMs value %p',
    (invalid) => {
      expect(() => makeSpiderConfig({ staleWorkerThresholdMs: invalid })).toThrow(
        expect.objectContaining({
          field: 'staleWorkerThresholdMs',
          value: invalid,
        })
      );
    }
  );

  it('should accept staleWorkerThresholdMs at the documented upper bound', async () => {
    const config = makeSpiderConfig({ staleWorkerThresholdMs: 2_147_483_647 });
    const value = await run(config.getStaleWorkerThreshold());
    expect(value).toBe(2_147_483_647);
  });

  // `null` and `undefined` are intentionally treated as "no override"
  // (per Option.fromNullishOr semantics — matches every other optional config
  // field). The validator rejects only defined non-string or wrong-string
  // values.
  it('should return the default stale-worker check interval via the getter', async () => {
    const config = makeSpiderConfig({});
    const value = await run(config.getStaleWorkerCheckInterval());
    expect(value).toBe(15_000);
  });

  it('should return the configured stale-worker check interval via the getter', async () => {
    const config = makeSpiderConfig({ staleWorkerCheckIntervalMs: 250 });
    const value = await run(config.getStaleWorkerCheckInterval());
    expect(value).toBe(250);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'should reject invalid staleWorkerCheckIntervalMs value %p',
    (invalid) => {
      expect(() =>
        makeSpiderConfig({ staleWorkerCheckIntervalMs: invalid })
      ).toThrow(
        expect.objectContaining({
          field: 'staleWorkerCheckIntervalMs',
          value: invalid,
        })
      );
    }
  );

  it.each(['perAttempt', 'PER-ATTEMPT', '', 'never', 'PerAttempt'])(
    'should reject invalid workerHeartbeatMode value %p',
    (invalid) => {
      expect(() =>
        makeSpiderConfig({
          // Cast to bypass the compile-time check — runtime callers (JSON
          // config, untyped JS) can sneak invalid strings through and this
          // test is the safety net.
          workerHeartbeatMode: invalid as unknown as
            | 'per-iteration'
            | 'per-attempt',
        })
      ).toThrow(
        expect.objectContaining({
          field: 'workerHeartbeatMode',
          value: invalid,
        })
      );
    }
  );
});
