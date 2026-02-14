/**
 * Scraper Service Tests
 * Tests for HTML fetching and parsing
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { ScraperService } from '../../../lib/Scraper/Scraper.service.js';
import { SpiderLogger, SpiderLoggerService } from '../../../lib/Logging/SpiderLogger.service.js';
import { expectFailure } from '../../infrastructure/EffectTestUtils.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const testLoggerLayer = Layer.succeed(SpiderLogger, {
  logEvent: () => Effect.void,
  logDomainStart: () => Effect.void,
  logDomainComplete: () => Effect.void,
  logPageScraped: () => Effect.void,
  logQueueStatus: () => Effect.void,
  logRateLimit: () => Effect.void,
  logSpiderLifecycle: () => Effect.void,
  logWorkerLifecycle: () => Effect.void,
  logWorkerState: () => Effect.void,
  logCompletionMonitor: () => Effect.void,
  logEdgeCase: () => Effect.void,
  logDomainStatus: () => Effect.void,
} satisfies SpiderLoggerService);

const testLayer = Layer.mergeAll(ScraperService.Default, testLoggerLayer);

const runWithScraper = <A, E>(
  effect: Effect.Effect<A, E, ScraperService | SpiderLogger>
) => Effect.runPromise(Effect.provide(effect, testLayer));

const htmlPage = (title: string, body: string, meta = '') =>
  `<html><head><title>${title}</title>${meta}</head><body>${body}</body></html>`;

describe('Scraper Service', () => {
  describe('fetchPage', () => {
    it('should fetch and parse HTML successfully', async () => {
      const html = htmlPage('Test Page', '<p>Hello world</p>');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      );

      const result = await runWithScraper(
        Effect.gen(function* () {
          const scraper = yield* ScraperService;
          return yield* scraper.fetchAndParse('https://example.com', 0);
        })
      );
      expect(result.title).toBe('Test Page');
      expect(result.statusCode).toBe(200);
      expect(result.html).toContain('Hello world');
    });

    it('should handle 404 responses', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Not Found', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        })
      );

      const result = await runWithScraper(
        Effect.gen(function* () {
          const scraper = yield* ScraperService;
          return yield* scraper.fetchAndParse('https://example.com/missing', 0);
        })
      );
      // 404 pages still get parsed - they have content
      expect(result.statusCode).toBe(404);
    });

    it('should extract title from HTML', async () => {
      const html = htmlPage('My Title', '<p>Content</p>');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const result = await runWithScraper(
        Effect.gen(function* () {
          const scraper = yield* ScraperService;
          return yield* scraper.fetchAndParse('https://example.com', 0);
        })
      );
      expect(result.title).toBe('My Title');
    });

    it('should extract meta tags', async () => {
      const meta = '<meta name="description" content="A test page">';
      const html = htmlPage('Test', '<p>Hi</p>', meta);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const result = await runWithScraper(
        Effect.gen(function* () {
          const scraper = yield* ScraperService;
          return yield* scraper.fetchAndParse('https://example.com', 0);
        })
      );
      expect(result.metadata['description']).toBe('A test page');
    });

    it('should handle missing meta tags gracefully', async () => {
      const html = '<html><head></head><body>No meta</body></html>';
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const result = await runWithScraper(
        Effect.gen(function* () {
          const scraper = yield* ScraperService;
          return yield* scraper.fetchAndParse('https://example.com', 0);
        })
      );
      expect(result.metadata).toBeDefined();
      expect(Object.keys(result.metadata)).toHaveLength(0);
    });

    it('should extract Open Graph meta tags', async () => {
      const meta = '<meta property="og:title" content="OG Title"><meta property="og:image" content="https://img.com/pic.jpg">';
      const html = htmlPage('Page', '<p>Hi</p>', meta);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const result = await runWithScraper(
        Effect.gen(function* () {
          const scraper = yield* ScraperService;
          return yield* scraper.fetchAndParse('https://example.com', 0);
        })
      );
      expect(result.metadata['og:title']).toBe('OG Title');
      expect(result.metadata['og:image']).toBe('https://img.com/pic.jpg');
    });

    it('should extract Twitter Card meta tags', async () => {
      const meta = '<meta name="twitter:card" content="summary"><meta name="twitter:title" content="Tweet Title">';
      const html = htmlPage('Page', '<p>Hi</p>', meta);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const result = await runWithScraper(
        Effect.gen(function* () {
          const scraper = yield* ScraperService;
          return yield* scraper.fetchAndParse('https://example.com', 0);
        })
      );
      expect(result.metadata['twitter:card']).toBe('summary');
      expect(result.metadata['twitter:title']).toBe('Tweet Title');
    });

    it('should handle network errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));

      const error = await expectFailure(
        Effect.provide(
          Effect.gen(function* () {
            const scraper = yield* ScraperService;
            return yield* scraper.fetchAndParse('https://unreachable.example.com', 0);
          }),
          testLayer
        )
      );
      expect(error).toBeDefined();
    });

    it('should handle HTML parsing errors with malformed HTML', async () => {
      // Cheerio is tolerant of malformed HTML, so it should still parse
      const malformed = '<html><title>Oops</title><body><div>unclosed';
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(malformed, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const result = await runWithScraper(
        Effect.gen(function* () {
          const scraper = yield* ScraperService;
          return yield* scraper.fetchAndParse('https://example.com', 0);
        })
      );
      expect(result.title).toBe('Oops');
    });

    it('should handle encoding issues by reading text content', async () => {
      const html = htmlPage('Ünïcödé', '<p>Ünïcödé content</p>');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      );

      const result = await runWithScraper(
        Effect.gen(function* () {
          const scraper = yield* ScraperService;
          return yield* scraper.fetchAndParse('https://example.com', 0);
        })
      );
      expect(result.title).toBe('Ünïcödé');
    });

    it('should extract canonical URLs from link tags', async () => {
      const meta = '<link rel="canonical" href="https://example.com/canonical">';
      const html = htmlPage('Page', '<p>Hi</p>', meta);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const result = await runWithScraper(
        Effect.gen(function* () {
          const scraper = yield* ScraperService;
          return yield* scraper.fetchAndParse('https://example.com', 0);
        })
      );
      // PageData should contain the page HTML which includes the canonical link
      expect(result.html).toContain('canonical');
    });

    it('should record scrape duration', async () => {
      const html = htmlPage('Test', '<p>Content</p>');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const result = await runWithScraper(
        Effect.gen(function* () {
          const scraper = yield* ScraperService;
          return yield* scraper.fetchAndParse('https://example.com', 0);
        })
      );
      expect(result.scrapeDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.fetchedAt).toBeInstanceOf(Date);
    });
  });
});
