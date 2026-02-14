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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RobotsService', () => {
  it('should parse robots.txt and disallow blocked paths', async () => {
    const robotsTxt = `User-agent: *\nDisallow: /admin\nDisallow: /private`;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(robotsTxt, { status: 200 })
    );

    const result = await runWithRobots(
      Effect.gen(function* () {
        const robots = yield* RobotsService;
        return yield* robots.checkUrl('https://example.com/admin/page');
      })
    );
    expect(result.allowed).toBe(false);
  });

  it('should allow URLs not in robots.txt disallow list', async () => {
    const robotsTxt = `User-agent: *\nDisallow: /admin`;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(robotsTxt, { status: 200 })
    );

    const result = await runWithRobots(
      Effect.gen(function* () {
        const robots = yield* RobotsService;
        return yield* robots.checkUrl('https://example.com/public/page');
      })
    );
    expect(result.allowed).toBe(true);
  });

  it('should handle crawl delay directive', async () => {
    const robotsTxt = `User-agent: *\nCrawl-delay: 5\nDisallow: /secret`;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(robotsTxt, { status: 200 })
    );

    const result = await runWithRobots(
      Effect.gen(function* () {
        const robots = yield* RobotsService;
        return yield* robots.checkUrl('https://example.com/page');
      })
    );
    expect(result.allowed).toBe(true);
    expect(result.crawlDelay).toBe(5);
  });

  it('should handle user agent matching', async () => {
    const robotsTxt = `User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin`;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(robotsTxt, { status: 200 })
    );

    const result = await runWithRobots(
      Effect.gen(function* () {
        const robots = yield* RobotsService;
        // Default user agent is *, so /public should be allowed
        return yield* robots.checkUrl('https://example.com/public');
      })
    );
    expect(result.allowed).toBe(true);
  });

  it('should allow all paths when robots.txt is not found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 404 })
    );

    const result = await runWithRobots(
      Effect.gen(function* () {
        const robots = yield* RobotsService;
        return yield* robots.checkUrl('https://example.com/anything');
      })
    );
    expect(result.allowed).toBe(true);
  });
});
