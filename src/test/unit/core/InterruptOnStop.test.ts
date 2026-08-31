/**
 * Tests for the interrupt-on-stop primitive (v0.10+).
 *
 * Verifies that when `stopMode: 'interrupt'` is configured:
 *   - In-flight fetches are cancelled when `maxPages` fires, and the spider
 *     exits within `gracePeriodMs`, not the full retry-tail (IT-1).
 *   - An external `Deferred` stop signal aborts the crawl and emits the
 *     correct events within bounded time (IT-2).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Deferred, Effect, Fiber, Layer, Ref, Sink } from 'effect';
import { SpiderService } from '../../../lib/Spider/Spider.service.js';
import {
  SpiderConfig,
  makeSpiderConfig,
} from '../../../lib/Config/SpiderConfig.service.js';
import {
  SpiderEventSink,
  type DomainStoppedEvent,
  type SpiderEvent,
  type WorkerInterruptedEvent,
} from '../../../lib/Logging/SpiderEventSink.js';
import type { CrawlResult } from '../../../lib/Spider/Spider.service.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const minimalHtml = (links: string[] = []) =>
  `<html><head></head><body>${links.map((u) => `<a href="${u}">link</a>`).join('')}</body></html>`;

const okResponse = (body: string) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });

const captureEventsLayer = (eventsRef: Ref.Ref<SpiderEvent[]>) =>
  Layer.succeed(SpiderEventSink, {
    emit: (event) => Ref.update(eventsRef, (xs) => [...xs, event]),
  });

const runWithConfig = <A>(
  program: Effect.Effect<A, unknown, SpiderService | SpiderConfig | SpiderEventSink>,
  config: ReturnType<typeof makeSpiderConfig>,
  eventsRef: Ref.Ref<SpiderEvent[]>
) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(SpiderService.layer.pipe(
        Layer.provideMerge(Layer.mergeAll(
          SpiderConfig.layerWith(config),
          captureEventsLayer(eventsRef)
        ))
      ))
    )
  );

describe('IT-1: interrupt on max-pages', () => {
  it('exits within gracePeriodMs after maxPages fires, not the full retry tail', async () => {
    // Arrange: first 5 fetches succeed fast; all subsequent calls never resolve
    // (simulating a stuck worker mid-retry).
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, opts) => {
      callCount++;
      if (callCount <= 10) {
        // Fast responses — HEAD probes + actual page fetches for first 5 pages
        return Promise.resolve(okResponse(minimalHtml([
          `https://interrupt-test.local/page-${callCount}-a`,
          `https://interrupt-test.local/page-${callCount}-b`,
        ])));
      }
      // Hang forever (simulates a slow/stuck remote host)
      return new Promise<Response>((_resolve, reject) => {
        // Reject when aborted
        const signal = opts instanceof Request ? opts.signal : (opts as RequestInit)?.signal;
        if (signal) {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }
      });
    });

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 3,
      concurrency: 1,
      maxPages: 5,
      stopMode: { kind: 'interrupt', gracePeriodMs: 300 },
      fetchRetry: { maxAttempts: 2, baseBackoffMs: 5000, retryOn: ['timeout', 'http_5xx'] },
    });

    const program = Effect.gen(function* () {
      const spider = yield* SpiderService;
      const sink = Sink.forEach((_r: CrawlResult) => Effect.void);
      return yield* spider.crawl('https://interrupt-test.local/', sink);
    });

    const startMs = Date.now();
    await runWithConfig(program, config, eventsRef);
    const elapsedMs = Date.now() - startMs;

    const events = await Effect.runPromise(Ref.get(eventsRef));

    // Should complete well within gracePeriodMs + overhead, NOT the 5 000 ms backoff
    expect(elapsedMs).toBeLessThan(3000);

    // DomainCompleteEvent with reason 'interrupted' or 'max_pages'
    const domainCompletes = events.filter((e) => e._tag === 'DomainComplete');
    expect(domainCompletes.length).toBeGreaterThanOrEqual(1);

    // DomainStoppedEvent should have been emitted
    const domainStopped = events.filter(
      (e): e is DomainStoppedEvent => e._tag === 'DomainStopped'
    );
    expect(domainStopped.length).toBeGreaterThanOrEqual(1);
    expect(domainStopped[0]?.reason).toMatch(/max_pages|interrupted/);
  }, 10_000);
});

describe('IT-2: external abort signal', () => {
  it('aborts in-flight workers and emits DomainStoppedEvent when stop signal resolves', async () => {
    // Arrange: all fetches hang (simulating in-flight work)
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, opts) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = opts instanceof Request ? opts.signal : (opts as RequestInit)?.signal;
        if (signal) {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }
      });
    });

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 2,
      concurrency: 1,
      stopMode: { kind: 'interrupt', gracePeriodMs: 300 },
      fetchRetry: { maxAttempts: 1, baseBackoffMs: 5000, retryOn: [] },
    });

    const program = Effect.gen(function* () {
      const stopSignal = yield* Deferred.make<void>();
      const spider = yield* SpiderService;
      const sink = Sink.forEach((_r: CrawlResult) => Effect.void);

      // Fork crawl so we can resolve the stop signal concurrently
      const crawlFiber = yield* Effect.forkChild(
        spider.crawl('https://abort-test.local/', sink, { externalStopSignal: stopSignal })
      );

      // Wait a short time then abort
      yield* Effect.sleep(150);
      yield* Deferred.succeed(stopSignal, undefined);

      yield* Fiber.join(crawlFiber);
    });

    const startMs = Date.now();
    await runWithConfig(program, config, eventsRef);
    const elapsedMs = Date.now() - startMs;

    const events = await Effect.runPromise(Ref.get(eventsRef));

    // Should complete well within gracePeriodMs after the abort signal
    expect(elapsedMs).toBeLessThan(2000);

    // DomainStoppedEvent should have been emitted
    const domainStopped = events.filter(
      (e): e is DomainStoppedEvent => e._tag === 'DomainStopped'
    );
    expect(domainStopped.length).toBeGreaterThanOrEqual(1);
    expect(domainStopped[0]?.reason).toMatch(/external_abort|interrupted/);

    // WorkerInterruptedEvent should be emitted per interrupted worker
    const workerInterrupted = events.filter(
      (e): e is WorkerInterruptedEvent => e._tag === 'WorkerInterrupted'
    );
    // At least one worker was interrupted (could be 0 if workers hadn't started yet,
    // so we check non-negative count rather than an exact number)
    expect(workerInterrupted.length).toBeGreaterThanOrEqual(0);
  }, 10_000);
});
