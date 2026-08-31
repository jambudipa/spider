/**
 * Tests for crawl-lifecycle invariants:
 *
 *  - Exactly one `DomainCompleteEvent` is emitted per `crawlSingle`
 *    invocation, even if both the failure detector and the normal
 *    completion path could in principle fire (G1).
 *
 *  - Buffered offers in the result channel still drain into the sink
 *    when the parent fiber is interrupted mid-flight (G2 / acquireRelease).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect, Fiber, Layer, Ref, Sink } from 'effect';
import { SpiderService } from '../../../lib/Spider/Spider.service.js';
import {
  SpiderConfig,
  makeSpiderConfig,
} from '../../../lib/Config/SpiderConfig.service.js';
import {
  SpiderEventSink,
  type DomainCompleteEvent,
  type SpiderEvent,
} from '../../../lib/Logging/SpiderEventSink.js';
import type { CrawlResult } from '../../../lib/Spider/Spider.service.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const minimalHtml = '<html><head></head><body></body></html>';
const okResponse = () =>
  new Response(minimalHtml, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });

const captureEventsLayer = (eventsRef: Ref.Ref<SpiderEvent[]>) =>
  Layer.succeed(SpiderEventSink, {
    emit: (event) => Ref.update(eventsRef, (xs) => [...xs, event]),
  });

describe('DomainCompleteEvent emission', () => {
  it('emits exactly one DomainCompleteEvent on the normal success path', async () => {
    // G1 regression test. Pre-fix: `compareAndSet(domainCompleted)` would
    // suppress the normal-path emission because workers had already flipped
    // `domainCompleted` to `true` for loop-exit signalling.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 1,
    });

    const program = Effect.gen(function* () {
      const spider = yield* SpiderService;
      const sink = Sink.forEach((_r: CrawlResult) => Effect.void);
      return yield* spider.crawl('https://lifecycle.test/', sink);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(SpiderService.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(
            SpiderConfig.layerWith(config),
            captureEventsLayer(eventsRef)
          ))
        ))
      )
    );

    const events = await Effect.runPromise(Ref.get(eventsRef));
    const domainCompletes = events.filter(
      (e): e is DomainCompleteEvent => e._tag === 'DomainComplete'
    );
    expect(domainCompletes).toHaveLength(1);
    expect(domainCompletes[0]?.domain).toBe('lifecycle.test');
    // Regression guard for the additive `cycle` field. When `domainRetry`
    // is omitted, every DomainCompleteEvent carries `cycle: 0` — preserving
    // the pre-feature event shape for consumers who never opt in.
    expect(domainCompletes[0]?.cycle).toBe(0);
  });

  it('emits exactly one DomainCompleteEvent across multiple parallel domains', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));
    const startUrls = Array.from(
      { length: 5 },
      (_, i) => `https://multi-${i}.test/`
    );

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 5,
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const spider = yield* SpiderService;
        const sink = Sink.forEach((_r: CrawlResult) => Effect.void);
        return yield* spider.crawl(startUrls, sink);
      }).pipe(
        Effect.provide(SpiderService.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(
            SpiderConfig.layerWith(config),
            captureEventsLayer(eventsRef)
          ))
        ))
      )
    );

    const events = await Effect.runPromise(Ref.get(eventsRef));
    const allCompletes = events.filter(
      (e): e is DomainCompleteEvent => e._tag === 'DomainComplete'
    );
    const completesByDomain = allCompletes.reduce<Map<string, number>>(
      (acc, e) => {
        acc.set(e.domain, (acc.get(e.domain) ?? 0) + 1);
        return acc;
      },
      new Map<string, number>()
    );

    expect(completesByDomain.size).toBe(5);
    for (const [, count] of completesByDomain) {
      expect(count).toBe(1);
    }
    // Regression guard: every multi-domain DomainCompleteEvent carries
    // `cycle: 0` when `domainRetry` is omitted (additive field default).
    for (const e of allCompletes) {
      expect(e.cycle).toBe(0);
    }
  });
});

describe('Parent-interrupt drain', () => {
  it('drains buffered offers into the sink before the channel closes when the parent fiber is interrupted', async () => {
    // G2 acquireRelease test. Mock fetch to delay so results sit in the
    // queue when we interrupt. The acquireRelease finaliser should still
    // shut down the queue, and Stream.fromQueue should drain buffered
    // offers before terminating.
    let fetchCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fetchCount++;
      // Stagger so several pages are buffered before interrupt arrives.
      await new Promise((r) => setTimeout(r, 50));
      return okResponse();
    });

    const sinkCalls = await Effect.runPromise(Ref.make(0));
    const sink = Sink.forEach((_r: CrawlResult) =>
      Ref.update(sinkCalls, (n) => n + 1)
    );

    // Three start URLs so at least some can complete and offer before
    // interrupt fires.
    const startUrls = Array.from(
      { length: 3 },
      (_, i) => `https://drain-${i}.test/`
    );

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 3,
    });

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));

    const program = Effect.gen(function* () {
      const spider = yield* SpiderService;
      // Fork the crawl so we can interrupt it externally.
      const fiber = yield* Effect.forkChild(spider.crawl(startUrls, sink));
      // Wait long enough for at least one fetch to complete and offer.
      yield* Effect.sleep('150 millis');
      // Interrupt while in-flight.
      yield* Fiber.interrupt(fiber);
      // Yield once more so any pending sink work runs.
      yield* Effect.sleep('50 millis');
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(SpiderService.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(
            SpiderConfig.layerWith(config),
            captureEventsLayer(eventsRef)
          ))
        ))
      )
    );

    const calls = await Effect.runPromise(Ref.get(sinkCalls));
    // Some pages must have fetched, and the sink must have processed them
    // — i.e. acquireRelease + queue lifecycle didn't drop buffered items.
    expect(fetchCount).toBeGreaterThan(0);
    expect(calls).toBeGreaterThan(0);
    // Sink received at most as many results as fetches that completed.
    expect(calls).toBeLessThanOrEqual(fetchCount);
  });
});
