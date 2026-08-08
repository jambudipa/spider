/**
 * Robots Tests
 * Tests for robots.txt parsing and URL permission checking
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { Effect } from 'effect';
import { RobotsService } from '../../../lib/Robots/Robots.service.js';

const runWithRobots = <A, E>(
  effect: Effect.Effect<A, E, RobotsService>
) => Effect.runPromise(Effect.provide(effect, RobotsService.Default));

const check = (url: string) =>
  runWithRobots(
    Effect.gen(function* () {
      const robots = yield* RobotsService;
      return yield* robots.checkUrl(url);
    })
  );

// A fresh Response per call: a body can only be read once, and a reused one
// would fail the second check for reasons that have nothing to do with rules.
const serveRobots = (body: string, status = 200) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(body, { status }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RobotsService', () => {
  it('should parse robots.txt and disallow blocked paths', async () => {
    serveRobots(`User-agent: *\nDisallow: /admin\nDisallow: /private`);

    const result = await check('https://example.com/admin/page');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('disallowed-by-rule');
    expect(result.disallowRule).toBe('/admin');
  });

  it('should allow URLs not in robots.txt disallow list', async () => {
    serveRobots(`User-agent: *\nDisallow: /admin`);

    const result = await check('https://example.com/public/page');
    expect(result.allowed).toBe(true);
  });

  it('should handle crawl delay directive', async () => {
    serveRobots(`User-agent: *\nCrawl-delay: 5\nDisallow: /secret`);

    const result = await check('https://example.com/page');
    expect(result.allowed).toBe(true);
    expect(result.crawlDelay).toBe(5);
  });

  it('should handle user agent matching', async () => {
    serveRobots(`User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin`);

    // Default user agent is *, so /public should be allowed
    const result = await check('https://example.com/public');
    expect(result.allowed).toBe(true);
  });

  it('should not apply rules from a group that does not name us', async () => {
    serveRobots(`User-agent: BadBot\nDisallow: /\n`);

    const result = await check('https://example.com/anything');
    expect(result.allowed).toBe(true);
  });

  it('should treat consecutive user-agent lines as one group', async () => {
    serveRobots(`User-agent: BadBot\nUser-agent: *\nDisallow: /shared`);

    const result = await check('https://example.com/shared/page');
    expect(result.allowed).toBe(false);
  });

  describe('availability is distinct from permission', () => {
    it('should allow everything when the origin publishes no rules (404)', async () => {
      serveRobots('', 404);

      const result = await check('https://example.com/anything');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('no-rules-published');
    });

    it('should allow everything when the origin publishes no rules (410)', async () => {
      serveRobots('', 410);

      const result = await check('https://example.com/anything');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('no-rules-published');
    });

    it('should refuse when robots.txt answers 5xx — nothing is known', async () => {
      serveRobots('', 503);

      const result = await check('https://example.com/anything');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('robots-unavailable');
      expect(result.unavailableCause).toContain('503');
    });

    it('should refuse when the robots.txt fetch fails outright', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('ECONNREFUSED')
      );

      const result = await check('https://example.com/anything');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('robots-unavailable');
    });

    it('should refuse rather than truncate an oversized robots.txt', async () => {
      // A body over the parse limit: truncating it would silently drop rules
      // and turn a restriction into an apparent permission.
      serveRobots(`User-agent: *\nDisallow: /admin\n${'#'.repeat(600 * 1024)}`);

      const result = await check('https://example.com/anything');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('robots-unavailable');
    });

    it('should fetch robots.txt without credentials', async () => {
      const fetchSpy = serveRobots('User-agent: *\nDisallow:');

      await check('https://example.com/page');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.com/robots.txt',
        expect.objectContaining({ credentials: 'omit' })
      );
    });

    it('should cache the outcome per origin', async () => {
      const fetchSpy = serveRobots('User-agent: *\nDisallow: /admin');

      await runWithRobots(
        Effect.gen(function* () {
          const robots = yield* RobotsService;
          yield* robots.checkUrl('https://example.com/one');
          yield* robots.checkUrl('https://example.com/two');
        })
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('rule precedence', () => {
    it('should let a longer Allow override a shorter Disallow', async () => {
      serveRobots(`User-agent: *\nDisallow: /admin\nAllow: /admin/public`);

      await expect(check('https://example.com/admin/public/x')).resolves.toMatchObject({
        allowed: true,
      });
      await expect(check('https://example.com/admin/secret')).resolves.toMatchObject({
        allowed: false,
      });
    });

    it('should let a longer Disallow override a shorter Allow', async () => {
      serveRobots(`User-agent: *\nAllow: /docs\nDisallow: /docs/internal`);

      const result = await check('https://example.com/docs/internal/x');
      expect(result.allowed).toBe(false);
      expect(result.disallowRule).toBe('/docs/internal');
    });

    it('should give Allow the tie on equal-length patterns', async () => {
      serveRobots(`User-agent: *\nDisallow: /page\nAllow: /page`);

      const result = await check('https://example.com/page');
      expect(result.allowed).toBe(true);
    });

    it('should treat an empty Disallow as permitting everything', async () => {
      serveRobots(`User-agent: *\nDisallow:`);

      const result = await check('https://example.com/anything');
      expect(result.allowed).toBe(true);
    });
  });

  describe('pattern syntax', () => {
    it('should honour the $ end anchor', async () => {
      serveRobots(`User-agent: *\nDisallow: /*.pdf$`);

      await expect(check('https://example.com/report.pdf')).resolves.toMatchObject({
        allowed: false,
      });
      await expect(
        check('https://example.com/report.pdf.html')
      ).resolves.toMatchObject({ allowed: true });
    });

    it('should match against the query string as well as the path', async () => {
      serveRobots(`User-agent: *\nDisallow: /*?sort=`);

      await expect(
        check('https://example.com/list?sort=asc')
      ).resolves.toMatchObject({ allowed: false });
      await expect(check('https://example.com/list')).resolves.toMatchObject({
        allowed: true,
      });
    });

    it('should ignore inline comments', async () => {
      serveRobots(`User-agent: *  # everyone\nDisallow: /admin # staff only`);

      await expect(check('https://example.com/admin')).resolves.toMatchObject({
        allowed: false,
      });
      await expect(check('https://example.com/public')).resolves.toMatchObject({
        allowed: true,
      });
    });
  });
});
