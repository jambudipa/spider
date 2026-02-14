/**
 * URL Deduplication Tests
 */

import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import {
  parseUrl,
  normalizeUrl,
  deduplicateUrls,
  createUrlDeduplicator,
  DEFAULT_DEDUPLICATION_STRATEGY,
  type DeduplicationStrategy
} from '../../../lib/utils/url-deduplication.js';
import { runTestSync } from '../../infrastructure/EffectTestUtils.js';

describe('URL Deduplication', () => {
  describe('parseUrl', () => {
    it('should parse valid URLs', () => {
      const result = runTestSync(parseUrl('https://example.com/path'));
      expect(result.hostname).toBe('example.com');
      expect(result.pathname).toBe('/path');
    });

    it('should fail on invalid URLs', () => {
      expect(() => 
        runTestSync(parseUrl('not-a-url'))
      ).toThrow();
    });
  });

  describe('normalizeUrl', () => {
    it('should normalize URLs with default strategy', () => {
      const result = runTestSync(normalizeUrl('http://www.example.com/'));
      expect(result.normalized).toBe('https://example.com/');
      expect(result.domain).toBe('example.com');
    });

    it('should handle www subdomain according to strategy', () => {
      const strategies: Array<[DeduplicationStrategy['wwwHandling'], string, string]> = [
        ['ignore', 'http://www.example.com', 'https://example.com/'],
        ['preserve', 'http://www.example.com', 'https://www.example.com/'],
        ['prefer-www', 'http://example.com', 'https://www.example.com/'],
        ['prefer-non-www', 'http://www.example.com', 'https://example.com/']
      ];

      for (const [wwwHandling, input, expected] of strategies) {
        const result = runTestSync(
          normalizeUrl(input, { ...DEFAULT_DEDUPLICATION_STRATEGY, wwwHandling })
        );
        expect(result.normalized).toBe(expected);
      }
    });

    it('should handle trailing slashes', () => {
      const ignoreStrategy: DeduplicationStrategy = {
        ...DEFAULT_DEDUPLICATION_STRATEGY,
        trailingSlashHandling: 'ignore'
      };
      const preserveStrategy: DeduplicationStrategy = {
        ...DEFAULT_DEDUPLICATION_STRATEGY,
        trailingSlashHandling: 'preserve'
      };

      const resultIgnore = runTestSync(normalizeUrl('https://example.com/path/', ignoreStrategy));
      expect(resultIgnore.normalized).toBe('https://example.com/path');

      const resultPreserve = runTestSync(normalizeUrl('https://example.com/path/', preserveStrategy));
      expect(resultPreserve.normalized).toBe('https://example.com/path/');
    });

    it('should handle query parameters', () => {
      const ignoreStrategy: DeduplicationStrategy = {
        ...DEFAULT_DEDUPLICATION_STRATEGY,
        queryParamHandling: 'ignore'
      };
      const sortStrategy: DeduplicationStrategy = {
        ...DEFAULT_DEDUPLICATION_STRATEGY,
        queryParamHandling: 'sort'
      };

      const resultIgnore = runTestSync(normalizeUrl('https://example.com?b=2&a=1', ignoreStrategy));
      expect(resultIgnore.normalized).toBe('https://example.com/');

      const resultSort = runTestSync(normalizeUrl('https://example.com?b=2&a=1', sortStrategy));
      expect(resultSort.normalized).toBe('https://example.com/?a=1&b=2');
    });
  });

  describe('deduplicateUrls', () => {
    it('should deduplicate URLs with same domain', () => {
      const urls = [
        { url: 'https://example.com' },
        { url: 'http://www.example.com' },
        { url: 'https://example.com/path' },
        { url: 'https://different.com' }
      ];

      const result = runTestSync(deduplicateUrls(urls));
      
      expect(result.deduplicated).toHaveLength(2);
      expect(result.stats.unique).toBe(2);
      expect(result.stats.duplicates).toBe(2);
      expect(result.stats.total).toBe(4);
    });

    it('should preserve metadata for kept URLs', () => {
      const urls = [
        { url: 'https://example.com', metadata: { id: 1 } },
        { url: 'http://www.example.com', metadata: { id: 2 } }
      ];

      const result = runTestSync(deduplicateUrls(urls));
      
      expect(result.deduplicated).toHaveLength(1);
      expect(result.deduplicated[0].metadata).toEqual({ id: 1 });
    });

    it('should handle invalid URLs gracefully', () => {
      const urls = [
        { url: 'https://valid.com' },
        { url: 'not-a-url' },
        { url: 'https://another-valid.com' }
      ];

      const result = runTestSync(deduplicateUrls(urls));
      
      expect(result.deduplicated).toHaveLength(2);
      expect(result.stats.invalid).toBe(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toContain('Invalid URL');
    });

    it('should apply www preference correctly', () => {
      const urls = [
        { url: 'https://example.com', metadata: { id: 'non-www' } },
        { url: 'https://www.example.com', metadata: { id: 'www' } }
      ];

      const preferWwwStrategy: DeduplicationStrategy = {
        ...DEFAULT_DEDUPLICATION_STRATEGY,
        wwwHandling: 'prefer-www'
      };

      const result = runTestSync(deduplicateUrls(urls, preferWwwStrategy));
      
      expect(result.deduplicated).toHaveLength(1);
      expect(result.deduplicated[0].metadata).toEqual({ id: 'www' });
    });
  });

  describe('createUrlDeduplicator', () => {
    it('should track seen URLs', () => {
      const program = Effect.gen(function* () {
        const deduplicator = yield* createUrlDeduplicator();
        
        const first = yield* deduplicator.markUrlSeen('https://example.com');
        const second = yield* deduplicator.markUrlSeen('http://www.example.com');
        const third = yield* deduplicator.markUrlSeen('https://different.com');
        
        expect(first).toBe(true);  // New URL
        expect(second).toBe(false); // Duplicate
        expect(third).toBe(true);  // New URL
        
        const stats = yield* deduplicator.getStats();
        expect(stats.processed).toBe(3);
        expect(stats.unique).toBe(2);
        expect(stats.duplicates).toBe(1);
      });

      runTestSync(program);
    });

    it('should check if URL has been seen', () => {
      const program = Effect.gen(function* () {
        const deduplicator = yield* createUrlDeduplicator();
        
        yield* deduplicator.markUrlSeen('https://example.com');
        
        const seen1 = yield* deduplicator.hasSeenUrl('http://www.example.com');
        const seen2 = yield* deduplicator.hasSeenUrl('https://different.com');
        
        expect(seen1).toBe(true);
        expect(seen2).toBe(false);
      });

      runTestSync(program);
    });

    it('should reset state', () => {
      const program = Effect.gen(function* () {
        const deduplicator = yield* createUrlDeduplicator();
        
        yield* deduplicator.markUrlSeen('https://example.com');
        let stats = yield* deduplicator.getStats();
        expect(stats.unique).toBe(1);
        
        yield* deduplicator.reset();
        
        stats = yield* deduplicator.getStats();
        expect(stats.unique).toBe(0);
        
        const seen = yield* deduplicator.hasSeenUrl('https://example.com');
        expect(seen).toBe(false);
      });

      runTestSync(program);
    });
  });
});