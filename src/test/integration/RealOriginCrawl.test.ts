/**
 * The shipped crawler against a real origin, with nothing injected.
 *
 * Every other test in this suite supplies its own fake fetch. That proves the
 * machinery around fetching and says nothing about whether the assembled
 * product can reach a website at all. This one runs `SpiderService` with its
 * default layers over a locally served origin: real HTTP, real robots oracle,
 * real scraper. If the package is inert, this is the test that fails.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Effect, Layer, Ref, Sink } from 'effect';
import {
  CrawlResult,
  makeSpiderConfig,
  SpiderConfig,
  SpiderEventSink,
  SpiderService,
  type SpiderEvent,
} from '../../index.js';

const page = (title: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

/** What `/robots.txt` should answer for the current test. */
let robotsStatus = 404;
let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];

    if (path === '/robots.txt') {
      if (robotsStatus === 200) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('User-agent: *\nDisallow: /private\n');
        return;
      }
      res.writeHead(robotsStatus, { 'content-type': 'text/plain' });
      res.end('');
      return;
    }

    if (path === '/alpha') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(page('Alpha', '<h1>Alpha</h1>'));
      return;
    }

    if (path === '/private') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(page('Private', '<h1>Private</h1>'));
      return;
    }

    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        page(
          'Index',
          '<a href="/alpha">Alpha</a> <a href="/private">Private</a>'
        )
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const crawl = async (options: { maxPages: number }) => {
  const results: CrawlResult[] = [];
  const events: SpiderEvent[] = [];

  const sink = Sink.forEach((result: CrawlResult) =>
    Effect.sync(() => {
      results.push(result);
    })
  );

  const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));
  const captureEvents = Layer.succeed(SpiderEventSink, {
    emit: (event: SpiderEvent) => Ref.update(eventsRef, (all) => [...all, event]),
  });

  const config = makeSpiderConfig({
    maxPages: options.maxPages,
    maxDepth: 1,
    requestDelayMs: 0,
    maxConcurrentWorkers: 1,
  });

  await Effect.runPromise(
    Effect.gen(function* () {
      const spider = yield* SpiderService;
      yield* spider.crawl([origin], sink);
    }).pipe(
      Effect.provide(SpiderService.Default),
      Effect.provide(SpiderConfig.Live(config)),
      Effect.provide(captureEvents)
    )
  );

  events.push(...(await Effect.runPromise(Ref.get(eventsRef))));
  return { results, events };
};

describe('the shipped crawler against a real origin', () => {
  it('fetches real pages over real HTTP with no ports injected', async () => {
    robotsStatus = 404;

    const { results } = await crawl({ maxPages: 5 });
    const ok = results.filter(CrawlResult.isOk);

    expect(ok.length).toBeGreaterThan(0);
    const titles = ok.map((r) => r.pageData.title);
    expect(titles).toContain('Index');
    expect(ok.every((r) => r.pageData.statusCode === 200)).toBe(true);
  });

  it('obeys rules the origin actually publishes', async () => {
    robotsStatus = 200;

    const { results, events } = await crawl({ maxPages: 5 });
    const urls = results.filter(CrawlResult.isOk).map((r) => r.pageData.url);

    expect(urls.some((u) => u.endsWith('/alpha'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/private'))).toBe(false);

    const blocked = events.filter((e) => e._tag === 'RobotsBlocked');
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ reason: 'disallowed-by-rule' });
  });

  it('fails closed, and says why, when robots.txt cannot be established', async () => {
    robotsStatus = 503;

    const { results, events } = await crawl({ maxPages: 5 });

    expect(results.filter(CrawlResult.isOk)).toHaveLength(0);

    const blocked = events.filter((e) => e._tag === 'RobotsBlocked');
    expect(blocked.length).toBeGreaterThan(0);
    // The refusal must not read like the target disallowed us.
    expect(blocked[0]).toMatchObject({ reason: 'robots-unavailable' });
  });
});
