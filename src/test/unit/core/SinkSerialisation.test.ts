/**
 * Concurrency probe for the sink-serialisation invariant.
 *
 * The crawl pipeline is supposed to drain results from all per-domain workers
 * through a single serialiser fiber, so the user-supplied `Sink` is never
 * invoked concurrently. This test runs many concurrent domains against a
 * mocked fetch layer and asserts the maximum observed sink concurrency
 * never exceeds 1.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect, Layer, MutableRef, Ref, Sink } from 'effect';
import { SpiderService } from '../../../lib/Spider/Spider.service.js';
import {
  SpiderConfig,
  makeSpiderConfig,
} from '../../../lib/Config/SpiderConfig.service.js';
import { SpiderEventSink } from '../../../lib/Logging/SpiderEventSink.js';
import type { CrawlResult } from '../../../lib/Spider/Spider.service.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const noopEventSink = Layer.succeed(SpiderEventSink, {
  emit: () => Effect.void,
});

// Minimal HTML — no links so workers don't fan out and inflate the queue.
const minimalHtml = '<html><head><title>x</title></head><body></body></html>';

const okResponse = () =>
  new Response(minimalHtml, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });

describe('Sink serialisation invariant', () => {
  it('never invokes the sink concurrently across many parallel domains', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

    // 20 distinct domains crawl in parallel. Each yields one page (minimal
    // HTML, no links to extract). All 20 results must serialise through one
    // sink fiber.
    const domainCount = 20;
    const startUrls = Array.from(
      { length: domainCount },
      (_, i) => `https://domain-${i}.test/`
    );

    // Track concurrency by incrementing on sink entry, decrementing on exit,
    // and recording the max ever observed.
    const inFlight = MutableRef.make(0);
    const maxObserved = MutableRef.make(0);
    const sink = Sink.forEach((_result: CrawlResult) =>
      Effect.gen(function* () {
        const current = MutableRef.updateAndGet(inFlight, (n) => n + 1);
        MutableRef.update(maxObserved, (m) => Math.max(m, current));
        // Yield to the scheduler so any concurrent invocation has a chance
        // to interleave (and thereby trip the assertion if serialisation
        // is broken). Without this, JS's run-to-completion would mask races.
        yield* Effect.sleep('1 millis');
        MutableRef.update(inFlight, (n) => n - 1);
      })
    );

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      // High concurrency across domains — the whole point of the test.
      concurrency: domainCount,
    });

    const program = Effect.gen(function* () {
      const spider = yield* SpiderService;
      return yield* spider.crawl(startUrls, sink);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(SpiderService.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(
            SpiderConfig.layerWith(config),
            noopEventSink
          ))
        ))
      )
    );

    expect(MutableRef.get(maxObserved)).toBe(1);
  });

  it('also serialises when domains complete out of order', async () => {
    // Earlier domains take longer than later ones — exercises the case where
    // out-of-order completion could otherwise race the sink.
    let callIndex = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const idx = callIndex++;
      // Stagger response times in inverse order so later starts finish first.
      await new Promise((r) => setTimeout(r, Math.max(0, 10 - idx)));
      return okResponse();
    });

    const domainCount = 8;
    const startUrls = Array.from(
      { length: domainCount },
      (_, i) => `https://staggered-${i}.test/`
    );

    const inFlight = await Effect.runPromise(Ref.make(0));
    const maxObserved = await Effect.runPromise(Ref.make(0));
    const sink = Sink.forEach((_result: CrawlResult) =>
      Effect.gen(function* () {
        const current = yield* Ref.updateAndGet(inFlight, (n) => n + 1);
        yield* Ref.update(maxObserved, (m) => Math.max(m, current));
        yield* Effect.sleep('2 millis');
        yield* Ref.update(inFlight, (n) => n - 1);
      })
    );

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: domainCount,
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const spider = yield* SpiderService;
        return yield* spider.crawl(startUrls, sink);
      }).pipe(
        Effect.provide(SpiderService.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(
            SpiderConfig.layerWith(config),
            noopEventSink
          ))
        ))
      )
    );

    const max = await Effect.runPromise(Ref.get(maxObserved));
    expect(max).toBe(1);
  });
});
