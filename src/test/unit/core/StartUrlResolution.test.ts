/**
 * Start-URL fallback resolution & cross-domain redirect detection tests.
 *
 * These run the full `crawl` pipeline against mocked `globalThis.fetch` to
 * exercise the probe loop and event emission. Robots and link extraction are
 * not the subject — the test pages have no links and robots is disabled via
 * `ignoreRobotsTxt: true`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect, Layer, Ref, Sink } from 'effect';
import { SpiderService } from '../../../lib/Spider/Spider.service.js';
import {
  SpiderConfig,
  makeSpiderConfig,
} from '../../../lib/Config/SpiderConfig.service.js';
import {
  SpiderEventSink,
  type SpiderEvent,
  type StartUrlChosenEvent,
  type StartUrlRedirectedEvent,
} from '../../../lib/Logging/SpiderEventSink.js';
import type {
  CrawlResult,
  StartUrlEntry,
} from '../../../lib/Spider/Spider.service.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const okResponse = (body = '<html><head></head><body></body></html>') =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });

const errorResponse = (status: number) =>
  new Response('error', {
    status,
    headers: { 'content-type': 'text/html' },
  });

const captureEventsLayer = (eventsRef: Ref.Ref<SpiderEvent[]>) =>
  Layer.succeed(SpiderEventSink, {
    emit: (event) => Ref.update(eventsRef, (xs) => [...xs, event]),
  });

const runCrawl = (
  events: Ref.Ref<SpiderEvent[]>,
  startingUrls: string | StartUrlEntry | ReadonlyArray<string | StartUrlEntry>,
  configOverrides: Parameters<typeof makeSpiderConfig>[0] = {}
) => {
  const config = makeSpiderConfig({
    ignoreRobotsTxt: true,
    requestDelayMs: 0,
    maxConcurrentWorkers: 1,
    concurrency: 1,
    ...configOverrides,
  });
  const program = Effect.gen(function* () {
    const spider = yield* SpiderService;
    const sink = Sink.forEach((_result: CrawlResult) => Effect.void);
    return yield* spider.crawl(startingUrls, sink);
  });
  const provided = program.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(captureEventsLayer(events))
  );
  return Effect.runPromise(provided);
};

describe('Start-URL fallback resolution (CR-4)', () => {
  it('chooses the fallback when the primary probe fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        // Primary returns 503 on probe; fallback returns 200.
        if (url.includes('www.example.org')) return errorResponse(503);
        return okResponse();
      }
    );

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));
    await runCrawl(eventsRef, [
      {
        url: 'https://www.example.org',
        fallbackUrls: ['https://example.org'],
      },
    ]);

    const events = await Effect.runPromise(Ref.get(eventsRef));
    const chosen = events.find(
      (e): e is StartUrlChosenEvent => e._tag === 'StartUrlChosen'
    );
    expect(chosen).toBeDefined();
    expect(chosen!.chosen).toBe('https://example.org');
    expect(chosen!.attempted).toEqual([
      'https://www.example.org',
      'https://example.org',
    ]);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('falls back to the primary URL when every candidate probe fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(errorResponse(500));

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));
    await runCrawl(eventsRef, [
      {
        url: 'https://primary.example.org',
        fallbackUrls: ['https://fallback.example.org'],
      },
    ]);

    const events = await Effect.runPromise(Ref.get(eventsRef));
    const chosen = events.find(
      (e): e is StartUrlChosenEvent => e._tag === 'StartUrlChosen'
    );
    expect(chosen).toBeDefined();
    // Spec: "All failed — proceed with the primary URL and let crawlSingle
    // surface the failure normally (CR-1 will surface it)."
    expect(chosen!.chosen).toBe('https://primary.example.org');
  });
});

describe('Cross-domain redirect detection (CR-5)', () => {
  it('emits StartUrlRedirectedEvent when the start URL response lands on a different host', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        // Probe (HEAD) sees the primary as reachable.
        if (method === 'HEAD') return okResponse();
        // Actual GET resolves to a different TLD via response.url.
        const fakeResponse = okResponse('<html><body></body></html>');
        Object.defineProperty(fakeResponse, 'url', {
          value: 'https://goldcoastmeditation.org.au/',
          configurable: true,
        });
        return fakeResponse;
      }
    );

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));
    await runCrawl(
      eventsRef,
      [{ url: 'https://goldcoastmeditation.org' }],
      { crossDomainRedirects: { enabled: true, maxHops: 3 } }
    );

    const events = await Effect.runPromise(Ref.get(eventsRef));
    const redirected = events.find(
      (e): e is StartUrlRedirectedEvent => e._tag === 'StartUrlRedirected'
    );
    expect(redirected).toBeDefined();
    expect(redirected!.to).toBe('https://goldcoastmeditation.org.au/');
  });

  it('does not emit StartUrlRedirectedEvent when crossDomainRedirects is disabled (default)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const fakeResponse = okResponse();
      Object.defineProperty(fakeResponse, 'url', {
        value: 'https://elsewhere.example/',
        configurable: true,
      });
      return fakeResponse;
    });

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));
    await runCrawl(eventsRef, [{ url: 'https://start.example' }]);

    const events = await Effect.runPromise(Ref.get(eventsRef));
    const redirected = events.find((e) => e._tag === 'StartUrlRedirected');
    expect(redirected).toBeUndefined();
  });
});
