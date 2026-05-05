import { describe, expect, it } from 'vitest';
import { Effect, Layer } from 'effect';
import {
  makeSpiderConfig,
  SpiderConfig,
  type DomainEquivalenceConfig,
} from '../../../lib/Config/SpiderConfig.service.js';
import { runTest } from '../../infrastructure/EffectTestUtils.js';

const followUrl = (
  domainEquivalence: Partial<DomainEquivalenceConfig> | undefined,
  url: string,
  start: string
) => {
  const equiv: DomainEquivalenceConfig | undefined = domainEquivalence
    ? {
        wwwHandling: 'ignore',
        protocolHandling: 'permissive',
        subdomainHandling: 'strict',
        ...domainEquivalence,
      }
    : undefined;
  const config = makeSpiderConfig(equiv ? { domainEquivalence: equiv } : {});
  const layer = Layer.succeed(SpiderConfig, config);
  return runTest(
    Effect.gen(function* () {
      const cfg = yield* SpiderConfig;
      return yield* cfg.shouldFollowUrl(url, undefined, start);
    }).pipe(Effect.provide(layer))
  );
};

describe('DomainEquivalenceConfig', () => {
  describe('wwwHandling', () => {
    it('defaults to ignore: www.X start, X target → follow', async () => {
      const result = await followUrl(
        undefined,
        'https://example.org/page',
        'https://www.example.org'
      );
      expect(result.follow).toBe(true);
    });

    it('defaults to ignore: X start, www.X target → follow', async () => {
      const result = await followUrl(
        undefined,
        'https://www.example.org/page',
        'https://example.org'
      );
      expect(result.follow).toBe(true);
    });

    it('strict: www.X start, X target → not follow', async () => {
      const result = await followUrl(
        { wwwHandling: 'strict' },
        'https://example.org/page',
        'https://www.example.org'
      );
      expect(result.follow).toBe(false);
    });
  });

  describe('protocolHandling', () => {
    it('permissive (default): http start, https target → follow', async () => {
      const result = await followUrl(
        undefined,
        'https://example.org/page',
        'http://example.org'
      );
      expect(result.follow).toBe(true);
    });

    it('strict: http start, https target → not follow', async () => {
      const result = await followUrl(
        { protocolHandling: 'strict' },
        'https://example.org/page',
        'http://example.org'
      );
      expect(result.follow).toBe(false);
    });
  });

  describe('subdomainHandling', () => {
    it('default strict: example.org start, sub.example.org target → not follow', async () => {
      const result = await followUrl(
        undefined,
        'https://sub.example.org/page',
        'https://example.org'
      );
      expect(result.follow).toBe(false);
    });

    it('ignore: example.org start, sub.example.org target → follow', async () => {
      const result = await followUrl(
        { subdomainHandling: 'ignore' },
        'https://sub.example.org/page',
        'https://example.org'
      );
      expect(result.follow).toBe(true);
    });
  });

  describe('cross-domain', () => {
    it('always rejects different bare domain', async () => {
      const result = await followUrl(
        undefined,
        'https://other.com/page',
        'https://example.org'
      );
      expect(result.follow).toBe(false);
    });
  });

  describe('multi-www stripping', () => {
    it('treats www.www.X as equivalent to X with default ignore', async () => {
      const result = await followUrl(
        undefined,
        'https://example.org/page',
        'https://www.www.example.org'
      );
      expect(result.follow).toBe(true);
    });

    it('treats X as equivalent to www.www.X with default ignore', async () => {
      const result = await followUrl(
        undefined,
        'https://www.www.example.org/page',
        'https://example.org'
      );
      expect(result.follow).toBe(true);
    });
  });

  describe('allowedProtocols permissive mode', () => {
    // G4 fix: `permissive` should respect `allowedProtocols` rather than
    // hard-coding ['http:', 'https:']. Default `allowedProtocols` includes
    // file: and ftp:, so they should be followable as start URLs.
    it('allows file: start URL with default allowedProtocols', async () => {
      const result = await followUrl(
        undefined,
        'file:///tmp/page.html',
        'file:///tmp/start.html'
      );
      expect(result.follow).toBe(true);
    });

    it('allows ftp: start URL with default allowedProtocols', async () => {
      const result = await followUrl(
        undefined,
        'ftp://example.org/file.txt',
        'ftp://example.org'
      );
      expect(result.follow).toBe(true);
    });

    it('rejects protocol not in allowedProtocols even under permissive', async () => {
      // gopher: is not in default allowedProtocols. Permissive shouldn't
      // accept it just because the equivalence rule is loose.
      const result = await followUrl(
        undefined,
        'gopher://example.org/page',
        'http://example.org'
      );
      expect(result.follow).toBe(false);
    });
  });

  describe('IDN / punycode equivalence', () => {
    // URL.hostname returns punycode (xn--…) for IDN inputs in Node 18+.
    // After normalisation both sides should round-trip to the same form
    // regardless of which form the user provided.
    const idnUnicode = 'https://例え.jp/';
    const idnPunycode = 'https://xn--r8jz45g.jp/page';

    it('treats Unicode start URL and punycode link as same domain', async () => {
      const result = await followUrl(undefined, idnPunycode, idnUnicode);
      expect(result.follow).toBe(true);
    });

    it('treats punycode start URL and Unicode link as same domain', async () => {
      // Note: Unicode forms in href values are uncommon but legal — Node's
      // URL parser punycode-encodes them before exposing `hostname`.
      const result = await followUrl(undefined, idnUnicode, idnPunycode);
      expect(result.follow).toBe(true);
    });
  });
});
