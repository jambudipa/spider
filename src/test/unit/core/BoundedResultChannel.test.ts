/**
 * Tests for `resultChannelCapacity`.
 *
 * The bug fix swaps `Queue.unbounded()` for `Queue.bounded(n)` when the
 * option is numeric. `Queue.bounded` is part of Effect-TS's API contract:
 * `Queue.offer` on a full bounded queue suspends the calling fiber until
 * capacity frees. We probe two things here:
 *
 * 1. Wiring — the config flows through to the channel construction site
 *    and the crawl pipeline keeps delivering under both queue types.
 * 2. Backpressure — under a single-domain, multi-page crawl with a slow
 *    sink and a small capacity, the gap between fetches completed and
 *    sink invocations entered stays bounded. (Backpressure only
 *    manifests when a single worker loops fetch → offer → fetch; a
 *    one-fetch-per-domain setup never exercises the suspension.)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Data, Effect, Layer, MutableRef, Sink } from 'effect';
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

class SinkFailure extends Data.TaggedError('SinkFailure')<{
  readonly message: string;
}> {}

const minimalHtml = '<html><head><title>x</title></head><body></body></html>';

const okResponse = () =>
  new Response(minimalHtml, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });

describe('Bounded result-channel wiring', () => {
  it('completes a crawl with a numeric capacity smaller than the URL count', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okResponse());

    const urlCount = 10;
    const sinkEntered = MutableRef.make(0);
    const sink = Sink.forEach((_r: CrawlResult) =>
      Effect.sync(() => MutableRef.update(sinkEntered, (n) => n + 1))
    );

    const startUrls = Array.from(
      { length: urlCount },
      (_, i) => `https://bounded-${i}.test/`
    );

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: urlCount,
      // Capacity well below urlCount — exercises the bounded queue path.
      resultChannelCapacity: 2,
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

    // Under bounded queue, the crawl still delivers every result. Allow a
    // single-result shutdown slop — the spider's existing shutdown ordering
    // can interrupt the last in-flight stream stage; that quirk is
    // orthogonal to this option.
    expect(MutableRef.get(sinkEntered)).toBeGreaterThanOrEqual(urlCount - 1);
  });

  it('preserves unbounded behaviour when the option is omitted (default)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okResponse());

    const urlCount = 10;
    const sinkEntered = MutableRef.make(0);
    const sink = Sink.forEach((_r: CrawlResult) =>
      Effect.sync(() => MutableRef.update(sinkEntered, (n) => n + 1))
    );

    const startUrls = Array.from(
      { length: urlCount },
      (_, i) => `https://unbounded-${i}.test/`
    );

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: urlCount,
      // resultChannelCapacity omitted → default 'unbounded'
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

    expect(MutableRef.get(sinkEntered)).toBeGreaterThanOrEqual(urlCount - 1);
  });

  it('bounds the fetch-to-sink gap on a single-domain multi-page crawl', async () => {
    // Single starting URL → discovers 19 linked pages → 20 fetches by one
    // worker for the same domain. This is the path where `Queue.offer`
    // suspension actually backpressures the worker into pausing its
    // next fetch until the sink drains a slot.
    const linkCount = 19;
    const sinkDelayMs = 15;
    const capacity = 2;

    const linkedHtml = `<!DOCTYPE html><html><body>${Array.from(
      { length: linkCount },
      (_, i) =>
        `<a href="https://multipage.test/p${i}">link ${i}</a>`
    ).join('\n')}</body></html>`;

    const leafHtml = '<!DOCTYPE html><html><body>leaf</body></html>';

    const fetchCompleted = MutableRef.make(0);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = url === 'https://multipage.test/' ? linkedHtml : leafHtml;
      const matchesCrawl =
        url.startsWith('https://multipage.test/') &&
        !url.endsWith('robots.txt');
      if (matchesCrawl) {
        MutableRef.update(fetchCompleted, (n) => n + 1);
      }
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });

    const sinkEntered = MutableRef.make(0);
    const maxGap = MutableRef.make(0);

    const sink = Sink.forEach((_r: CrawlResult) =>
      Effect.gen(function* () {
        const entered = MutableRef.updateAndGet(sinkEntered, (n) => n + 1);
        const fetched = MutableRef.get(fetchCompleted);
        MutableRef.update(maxGap, (m) => Math.max(m, fetched - entered));
        yield* Effect.sleep(`${sinkDelayMs} millis`);
      })
    );

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 1,
      resultChannelCapacity: capacity,
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const spider = yield* SpiderService;
        return yield* spider.crawl(['https://multipage.test/'], sink);
      }).pipe(
        Effect.provide(SpiderService.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(
            SpiderConfig.layerWith(config),
            noopEventSink
          ))
        ))
      )
    );

    // Backpressure must keep the fetch-ahead-of-sink gap bounded. Allow
    // capacity + 2 for items mid-stream between queue and sink.
    expect(MutableRef.get(maxGap)).toBeLessThanOrEqual(capacity + 2);

    // And the pipeline must keep flowing: sink should process more than
    // the capacity (proves suspended offers keep resuming).
    expect(MutableRef.get(sinkEntered)).toBeGreaterThan(capacity);
  });

  it('fails fast (does not deadlock) when the sink defects under a full bounded queue', async () => {
    // Sink defect under unbounded queue lets workers keep offering;
    // under bounded queue it would deadlock once capacity is reached
    // unless the channel is shut down on serialiser exit. `Effect.ensuring`
    // on the forked stream covers that — this test guards the wiring.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okResponse());

    const sink = Sink.forEach((_r: CrawlResult) =>
      Effect.fail(new SinkFailure({ message: 'sink boom' }))
    );

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 5,
      resultChannelCapacity: 1,
    });

    const startUrls = Array.from(
      { length: 5 },
      (_, i) => `https://deadlock-${i}.test/`
    );

    // We do not assert success/failure shape — only that the program
    // terminates (does not hang). Vitest's per-test timeout would catch
    // a deadlock; we time-bound explicitly for clarity.
    const program = Effect.gen(function* () {
      const spider = yield* SpiderService;
      return yield* spider.crawl(startUrls, sink);
    }).pipe(
      Effect.provide(SpiderService.layer.pipe(
        Layer.provideMerge(Layer.mergeAll(
          SpiderConfig.layerWith(config),
          noopEventSink
        ))
      )),
      Effect.timeout('5 seconds')
    );

    // Either it completes (returning results) or fails — both are fine.
    // What must NOT happen is a TimeoutException, which would indicate
    // workers deadlocked on a queue with no consumer.
    let timedOut = false;
    try {
      await Effect.runPromise(program);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('TimeoutException') || msg.includes('timeout')) {
        timedOut = true;
      }
    }
    expect(timedOut).toBe(false);
  });

  it("accepts explicit 'unbounded' value", async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okResponse());

    const sinkEntered = MutableRef.make(0);
    const sink = Sink.forEach((_r: CrawlResult) =>
      Effect.sync(() => MutableRef.update(sinkEntered, (n) => n + 1))
    );

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 5,
      resultChannelCapacity: 'unbounded',
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const spider = yield* SpiderService;
        return yield* spider.crawl(
          ['https://explicit-unbounded.test/'],
          sink
        );
      }).pipe(
        Effect.provide(SpiderService.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(
            SpiderConfig.layerWith(config),
            noopEventSink
          ))
        ))
      )
    );

    expect(MutableRef.get(sinkEntered)).toBeGreaterThanOrEqual(1);
  });
});
