/**
 * UrlUtils Tests
 * Tests for URL parsing, normalisation, and manipulation utilities
 */

import { describe, expect, it } from 'vitest';
import { Effect, Option } from 'effect';
import { UrlUtils } from '../../../lib/utils/UrlUtils.js';

const run = <A>(effect: Effect.Effect<A, unknown>) =>
  Effect.runPromise(effect);

describe('UrlUtils', () => {
  describe('parse', () => {
    it('should parse a valid URL', async () => {
      const url = await run(UrlUtils.parse('https://example.com/path?q=1'));
      expect(url.hostname).toBe('example.com');
      expect(url.pathname).toBe('/path');
      expect(url.searchParams.get('q')).toBe('1');
    });

    it('should parse with a base URL', async () => {
      const url = await run(UrlUtils.parse('/relative', 'https://example.com'));
      expect(url.href).toBe('https://example.com/relative');
    });

    it('should fail on invalid input', async () => {
      const result = await Effect.runPromiseExit(UrlUtils.parse('not-a-url'));
      expect(result._tag).toBe('Failure');
    });
  });

  describe('isValid', () => {
    it('should return true for valid URLs', async () => {
      expect(await run(UrlUtils.isValid('https://example.com'))).toBe(true);
    });

    it('should return false for invalid URLs', async () => {
      expect(await run(UrlUtils.isValid('not a url'))).toBe(false);
    });
  });

  describe('normalise', () => {
    it('should remove trailing slashes', async () => {
      const result = await run(UrlUtils.normalise('https://example.com/path/'));
      expect(result).toBe('https://example.com/path');
    });

    it('should keep root path slash', async () => {
      const result = await run(UrlUtils.normalise('https://example.com/'));
      expect(result).toBe('https://example.com/');
    });

    it('should sort query parameters alphabetically', async () => {
      const result = await run(UrlUtils.normalise('https://example.com/path?z=1&a=2'));
      expect(result).toBe('https://example.com/path?a=2&z=1');
    });

    it('should remove default ports', async () => {
      const result = await run(UrlUtils.normalise('https://example.com:443/path'));
      expect(result).toBe('https://example.com/path');
    });

    it('should lowercase hostname', async () => {
      const result = await run(UrlUtils.normalise('https://EXAMPLE.COM/Path'));
      expect(result).toBe('https://example.com/Path');
    });

    it('should remove fragment', async () => {
      const result = await run(UrlUtils.normalise('https://example.com/path#section'));
      expect(result).toBe('https://example.com/path');
    });
  });

  describe('getDomain', () => {
    it('should extract hostname from URL', async () => {
      const domain = await run(UrlUtils.getDomain('https://sub.example.com/page'));
      expect(domain).toBe('sub.example.com');
    });
  });

  describe('getExtension', () => {
    it('should extract file extension', async () => {
      const ext = await run(UrlUtils.getExtension('https://example.com/file.pdf'));
      expect(Option.getOrNull(ext)).toBe('.pdf');
    });

    it('should return none when no extension', async () => {
      const ext = await run(UrlUtils.getExtension('https://example.com/path'));
      expect(Option.isNone(ext)).toBe(true);
    });
  });

  describe('resolve', () => {
    it('should resolve relative URL against base', async () => {
      const result = await run(UrlUtils.resolve('https://example.com/dir/', './page'));
      expect(result).toBe('https://example.com/dir/page');
    });

    it('should resolve absolute path against base', async () => {
      const result = await run(UrlUtils.resolve('https://example.com/dir/', '/other'));
      expect(result).toBe('https://example.com/other');
    });
  });

  describe('isSameOrigin', () => {
    it('should return true for same origin URLs', async () => {
      const result = await run(UrlUtils.isSameOrigin('https://example.com/a', 'https://example.com/b'));
      expect(result).toBe(true);
    });

    it('should return false for different origin URLs', async () => {
      const result = await run(UrlUtils.isSameOrigin('https://example.com/a', 'https://other.com/b'));
      expect(result).toBe(false);
    });
  });

  describe('matchesPattern', () => {
    it('should match URL against URL pattern with wildcards', async () => {
      const result = await run(UrlUtils.matchesPattern('https://example.com/blog/post', 'https://example.com/blog/*'));
      expect(result).toBe(true);
    });

    it('should not match URL against different origin pattern', async () => {
      const result = await run(UrlUtils.matchesPattern('https://example.com/page', 'https://other.com/page'));
      expect(result).toBe(false);
    });
  });
});
