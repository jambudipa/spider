/**
 * Tests for the per-attempt worker heartbeat refresh (v0.12+).
 *
 * The spider fires `reportWorkerHealth(workerId)` at the top of every
 * worker-loop iteration, and — when `workerHeartbeatMode: 'per-attempt'`
 * is configured — additionally on every retry decision via the
 * `Schedule.tapInput` hook installed by `buildFetchRetrySchedule`.
 *
 * These tests compare heartbeat counts across modes for the same
 * workload, asserting the per-attempt mode produces exactly
 * `maxAttempts - 1` additional heartbeat records. They also assert that
 * `maxAttempts: 1` produces no per-attempt taps (no retry decisions
 * occur, so the schedule never receives input).
 *
 * Observation hook: `reportWorkerHealth` emits an `Effect.logDebug`
 * record with `event: 'worker_heartbeat'`. Tests capture log records
 * via a custom `Logger` layer at debug level.
 *
 * Death-warning detection is exercised by lowering both the threshold
 * and the monitor's check interval via `staleWorkerCheckIntervalMs`
 * (also new in v0.12+) so the full path runs in real time within a
 * few seconds.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Deferred, Effect, Fiber, Layer, Logger, References, Ref, Sink } from 'effect';
import { SpiderService } from '../../../lib/Spider/Spider.service.js';
import {
  SpiderConfig,
  makeSpiderConfig,
} from '../../../lib/Config/SpiderConfig.service.js';
import {
  SpiderEventSink,
  type SpiderEvent,
} from '../../../lib/Logging/SpiderEventSink.js';
import type { CrawlResult } from '../../../lib/Spider/Spider.service.js';

afterEach(() => {
  vi.restoreAllMocks();
});

interface CapturedLog {
  readonly level: string;
  readonly message: string;
  readonly annotations: Record<string, unknown>;
}

const captureLogsLayer = (records: CapturedLog[]): Layer.Layer<never> => {
  const logger = Logger.make((opts) => {
    const annotations: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(
      opts.fiber.getRef(References.CurrentLogAnnotations)
    )) {
      annotations[k] = v;
    }
    const message = Array.isArray(opts.message)
      ? opts.message.map((m) => String(m)).join(' ')
      : String(opts.message);
    records.push({ level: opts.logLevel, message, annotations });
  });
  return Layer.merge(
    Logger.layer([logger]),
    Layer.succeed(References.MinimumLogLevel, 'Debug')
  );
};

const captureEventsLayer = (eventsRef: Ref.Ref<SpiderEvent[]>) =>
  Layer.succeed(SpiderEventSink, {
    emit: (event) => Ref.update(eventsRef, (xs) => [...xs, event]),
  });

const okHtml = '<html><head><title>x</title></head><body></body></html>';
const okResponse = () =>
  new Response(okHtml, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });

/**
 * Mock that throws ECONNREFUSED for the first `failCount` non-HEAD
 * requests (classified by the adapter as `kind: 'connection_refused'`,
 * which is retryable), then returns 200 OK with a minimal HTML document.
 * HEAD probes always succeed so the retry only fires on the GET path.
 *
 * 5xx response bodies are NOT classified as retryable fetch errors by
 * the default undici adapter (the adapter forwards every status code to
 * the spider as a successful `HttpAdapterResponse`), so we trigger the
 * retry by rejecting the underlying fetch promise instead.
 */
const installFailingFetch = (failCount: number) => {
  let getCalls = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const method =
      (init?.method ?? (input instanceof Request ? input.method : 'GET'))
        .toString()
        .toUpperCase();
    if (method === 'HEAD') {
      return Promise.resolve(
        new Response('', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );
    }
    getCalls += 1;
    if (getCalls <= failCount) {
      const err = new TypeError('fetch failed');
      // The default adapter inspects `error.cause` and the string form
      // for `ECONNREFUSED` to map to `kind: 'connection_refused'`.
      (err as unknown as { cause: unknown }).cause = new Error('connect ECONNREFUSED 127.0.0.1:443');
      return Promise.reject(err);
    }
    return Promise.resolve(okResponse());
  });
};

const runCrawl = async (
  config: ReturnType<typeof makeSpiderConfig>,
  records: CapturedLog[]
) => {
  const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));
  const program = Effect.gen(function* () {
    const spider = yield* SpiderService;
    const sink = Sink.forEach((_r: CrawlResult) => Effect.void);
    return yield* spider.crawl('https://heartbeat-test.local/', sink);
  });
  await Effect.runPromise(
    program.pipe(
      Effect.provide(SpiderService.layer.pipe(
        Layer.provideMerge(Layer.mergeAll(
          SpiderConfig.layerWith(config),
          captureEventsLayer(eventsRef),
          captureLogsLayer(records)
        ))
      ))
    )
  );
};

const heartbeatRecords = (records: CapturedLog[]) =>
  records.filter((r) => r.annotations['event'] === 'worker_heartbeat');

describe('worker heartbeat — per-iteration (default) vs per-attempt', () => {
  it('per-attempt mode fires exactly (maxAttempts - 1) extra heartbeats vs per-iteration on the same workload', async () => {
    // Workload: one URL, two 503 failures then a success, maxAttempts 3.
    // Per-iteration mode: heartbeat fires only at worker-loop entry.
    // Per-attempt mode: additionally fires on each retry-decision input
    // = 2 extra heartbeats for this workload.
    const baseConfig = {
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 1,
      maxPages: 1,
      fetchRetry: {
        maxAttempts: 3,
        baseBackoffMs: 1,
        retryOn: ['connection_refused'] as const,
      },
    };

    const perIterRecords: CapturedLog[] = [];
    installFailingFetch(2);
    await runCrawl(makeSpiderConfig(baseConfig), perIterRecords);
    const perIterCount = heartbeatRecords(perIterRecords).length;

    vi.restoreAllMocks();

    const perAttemptRecords: CapturedLog[] = [];
    installFailingFetch(2);
    await runCrawl(
      makeSpiderConfig({ ...baseConfig, workerHeartbeatMode: 'per-attempt' }),
      perAttemptRecords
    );
    const perAttemptCount = heartbeatRecords(perAttemptRecords).length;

    expect(perAttemptCount - perIterCount).toBe(2);
  }, 10_000);

  it('per-attempt mode with maxAttempts: 1 fires no extra heartbeat', async () => {
    const baseConfig = {
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 1,
      maxPages: 1,
      fetchRetry: {
        maxAttempts: 1,
        baseBackoffMs: 1,
        retryOn: ['connection_refused'] as const,
      },
    };

    const perIterRecords: CapturedLog[] = [];
    installFailingFetch(Number.POSITIVE_INFINITY);
    await runCrawl(makeSpiderConfig(baseConfig), perIterRecords);
    const perIterCount = heartbeatRecords(perIterRecords).length;

    vi.restoreAllMocks();

    const perAttemptRecords: CapturedLog[] = [];
    installFailingFetch(Number.POSITIVE_INFINITY);
    await runCrawl(
      makeSpiderConfig({ ...baseConfig, workerHeartbeatMode: 'per-attempt' }),
      perAttemptRecords
    );
    const perAttemptCount = heartbeatRecords(perAttemptRecords).length;

    // Effect v4 runs the Schedule.tap hook only when it permits a retry.
    // maxAttempts: 1 permits none, so no extra heartbeat is emitted.
    expect(perAttemptCount - perIterCount).toBe(0);
  }, 10_000);

  it('captures worker_heartbeat records annotated with the per-worker workerId', async () => {
    const records: CapturedLog[] = [];
    installFailingFetch(0);
    await runCrawl(
      makeSpiderConfig({
        ignoreRobotsTxt: true,
        requestDelayMs: 0,
        maxConcurrentWorkers: 1,
        concurrency: 1,
        maxPages: 1,
        fetchRetry: { maxAttempts: 1, baseBackoffMs: 1, retryOn: [] },
      }),
      records
    );
    const beats = heartbeatRecords(records);
    expect(beats.length).toBeGreaterThan(0);
    for (const beat of beats) {
      expect(beat.annotations['workerId']).toBeDefined();
      expect(beat.annotations['domain']).toBeDefined();
    }
  }, 10_000);

  it('per-attempt heartbeats during retries carry the same workerId as the owning task', async () => {
    // Guards against a regression where Schedule.tapInput could capture a
    // stale workerId or close over the wrong worker scope. With
    // maxConcurrentWorkers: 1 and one task, every heartbeat record for the
    // domain must agree on workerId.
    const records: CapturedLog[] = [];
    installFailingFetch(2);
    await runCrawl(
      makeSpiderConfig({
        ignoreRobotsTxt: true,
        requestDelayMs: 0,
        maxConcurrentWorkers: 1,
        concurrency: 1,
        maxPages: 1,
        workerHeartbeatMode: 'per-attempt',
        fetchRetry: {
          maxAttempts: 3,
          baseBackoffMs: 1,
          retryOn: ['connection_refused'],
        },
      }),
      records
    );
    const beats = heartbeatRecords(records);
    expect(beats.length).toBeGreaterThanOrEqual(3); // 1 top + 2 retry taps
    const ids = new Set(beats.map((b) => b.annotations['workerId']));
    expect(ids.size).toBe(1);
  }, 10_000);

  it('does not flag a worker stale when one slow-but-successful fetch completes inside the threshold', async () => {
    // Per-iteration mode (default) + a deliberately-slow single fetch that
    // succeeds well before staleWorkerThresholdMs elapses. The worker should
    // not be flagged stale and no `worker_death_detected` log record should
    // be emitted for it.
    const records: CapturedLog[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const method =
        (init?.method ?? (input instanceof Request ? input.method : 'GET'))
          .toString()
          .toUpperCase();
      if (method === 'HEAD') {
        return Promise.resolve(
          new Response('', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
        );
      }
      return new Promise((resolve) => {
        setTimeout(() => resolve(okResponse()), 150);
      });
    });
    await runCrawl(
      makeSpiderConfig({
        ignoreRobotsTxt: true,
        requestDelayMs: 0,
        maxConcurrentWorkers: 1,
        concurrency: 1,
        maxPages: 1,
        staleWorkerThresholdMs: 5_000,
        fetchRetry: { maxAttempts: 1, baseBackoffMs: 1, retryOn: [] },
      }),
      records
    );
    const deaths = records.filter(
      (r) => r.annotations['event'] === 'worker_death_detected'
    );
    expect(deaths).toHaveLength(0);
  }, 10_000);

  it('emits worker_death_detected when a fetch hangs past the staleness threshold', async () => {
    // Hung fetch that resolves only when aborted. Combined with a short
    // monitor interval and threshold, the health monitor crosses the
    // threshold and flags the worker dead within a second of real time.
    // External stop signal unblocks the crawl once the warning has fired.
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const method =
        (init?.method ?? (input instanceof Request ? input.method : 'GET'))
          .toString()
          .toUpperCase();
      if (method === 'HEAD') {
        return Promise.resolve(
          new Response('', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
        );
      }
      return new Promise<Response>((_resolve, reject) => {
        const signal =
          init?.signal ??
          (input instanceof Request ? input.signal : undefined);
        if (signal) {
          signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        }
      });
    });
    const records: CapturedLog[] = [];
    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));
    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 1,
      maxPages: 1,
      staleWorkerThresholdMs: 200,
      staleWorkerCheckIntervalMs: 100,
      stopMode: { kind: 'interrupt', gracePeriodMs: 300 },
      fetchRetry: { maxAttempts: 1, baseBackoffMs: 1, retryOn: [] },
    });

    const program = Effect.gen(function* () {
      const stopSignal = yield* Deferred.make<void>();
      const spider = yield* SpiderService;
      const sink = Sink.forEach((_r: CrawlResult) => Effect.void);
      const crawlFiber = yield* Effect.forkChild(
        spider.crawl('https://heartbeat-death-test.local/', sink, {
          externalStopSignal: stopSignal,
        })
      );
      // Give the monitor time to tick twice past the 200 ms threshold.
      yield* Effect.sleep(700);
      yield* Deferred.succeed(stopSignal, undefined);
      yield* Fiber.join(crawlFiber);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(SpiderService.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(
            SpiderConfig.layerWith(config),
            captureEventsLayer(eventsRef),
            captureLogsLayer(records)
          ))
        ))
      )
    );

    const deaths = records.filter(
      (r) => r.annotations['event'] === 'worker_death_detected'
    );
    expect(deaths.length).toBeGreaterThanOrEqual(1);
    expect(deaths[0]?.annotations['workerId']).toBeDefined();
  }, 15_000);
});
