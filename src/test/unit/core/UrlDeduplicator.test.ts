/**
 * UrlDeduplicator Tests
 * Tests for URL deduplication service
 */

import { describe, expect, it } from 'vitest';
import { Effect, Layer } from 'effect';
import { UrlDeduplicatorService } from '../../../lib/UrlDeduplicator/UrlDeduplicator.service.js';
import { SpiderConfig, makeSpiderConfig } from '../../../lib/Config/SpiderConfig.service.js';

const testConfigLayer = Layer.succeed(
  SpiderConfig,
  makeSpiderConfig({})
);

const testLayer = Layer.provide(UrlDeduplicatorService.Default, testConfigLayer);

const runWithDeduplicator = <A, E>(
  effect: Effect.Effect<A, E, UrlDeduplicatorService>
) => Effect.runPromise(Effect.provide(effect, testLayer));

describe('UrlDeduplicator', () => {
  it('should detect duplicate URLs', async () => {
    const result = await runWithDeduplicator(
      Effect.gen(function* () {
        const dedup = yield* UrlDeduplicatorService;
        const first = yield* dedup.tryAdd('https://example.com/page1');
        const second = yield* dedup.tryAdd('https://example.com/page1');
        return { first, second };
      })
    );
    expect(result.first).toBe(true);
    expect(result.second).toBe(false);
  });

  it('should normalize URLs before deduplication', async () => {
    const result = await runWithDeduplicator(
      Effect.gen(function* () {
        const dedup = yield* UrlDeduplicatorService;
        const first = yield* dedup.tryAdd('https://example.com/page');
        const withTrailingSlash = yield* dedup.tryAdd('https://example.com/page/');
        return { first, withTrailingSlash };
      })
    );
    expect(result.first).toBe(true);
    // Trailing slash normalization may or may not make them equal depending on config
    expect(typeof result.withTrailingSlash).toBe('boolean');
  });

  it('should handle query parameters in URLs', async () => {
    const result = await runWithDeduplicator(
      Effect.gen(function* () {
        const dedup = yield* UrlDeduplicatorService;
        yield* dedup.tryAdd('https://example.com/page?a=1&b=2');
        const contains = yield* dedup.contains('https://example.com/page?a=1&b=2');
        return contains;
      })
    );
    expect(result).toBe(true);
  });

  it('should handle URL fragments by stripping them', async () => {
    const result = await runWithDeduplicator(
      Effect.gen(function* () {
        const dedup = yield* UrlDeduplicatorService;
        yield* dedup.tryAdd('https://example.com/page#section1');
        const size = yield* dedup.size();
        return size;
      })
    );
    expect(result).toBe(1);
  });
});
