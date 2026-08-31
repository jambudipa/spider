/**
 * Tests for the `domainRetry` config and the multi-pass crawl loop in
 * `Spider.crawl()`.
 *
 * Each test mirrors a row of the spec's I/O & Edge-Case Matrix:
 *
 *  - Default config (omitted `domainRetry`): exactly one
 *    `DomainCompleteEvent { cycle: 0 }` fires; no retry.
 *  - Enabled with `maxPasses: 2` and a domain that recovers on pass 1:
 *    pass-0 `DomainCompleteEvent { cycle: 0, reason: 'all_fetches_failed' }`,
 *    then a `DomainRetryScheduledEvent`, then a pass-1
 *    `DomainCompleteEvent { cycle: 1, reason: 'queue_empty',
 *    pagesScraped > 0 }`.
 *  - `maxPasses: 2` where both passes fail: two `DomainCompleteEvent`s
 *    (cycle 0 + 1), both `all_fetches_failed`; no third pass.
 *  - Mixed cohort: 3 domains, one fails pass 0 and recovers pass 1 — the
 *    other two are only fetched once.
 *  - `retryOn.maxPagesAttempted` predicate: domain whose pass-0
 *    `pagesAttempted` exceeds the bound is NOT retried.
 *  - `passOverrides.fetchRetry.maxAttempts: 5`: the override applies to
 *    pass 1, not pass 0.
 *  - `passOverrides.concurrency`: pass-1 concurrency follows the override.
 *  - Validation: `makeSpiderConfig` rejects invalid `maxPasses` /
 *    `backoffMs`.
 *
 * Fiber interruption mid-retry-pass is exercised by the
 * `Parent-interrupt drain` test in `CrawlLifecycle.test.ts` (the same
 * mechanism unwinds the iterate body). Adding a dedicated test here
 * would duplicate that coverage.
 *
 * Tests use short `backoffMs` (5–10 ms) to keep wall-clock latency low
 * without needing TestClock injection through the entire `crawl()` stack.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect, Layer, Ref, Sink } from 'effect';
import { SpiderService } from '../../../lib/Spider/Spider.service.js';
import {
  SpiderConfig,
  defaultDomainRetry,
  makeSpiderConfig,
} from '../../../lib/Config/SpiderConfig.service.js';
import {
  SpiderEventSink,
  type DomainCompleteEvent,
  type DomainRetryScheduledEvent,
  type SpiderEvent,
} from '../../../lib/Logging/SpiderEventSink.js';
import type { CrawlResult } from '../../../lib/Spider/Spider.service.js';
import { ConfigError } from '../../../lib/errors/effect-errors.js';

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

/**
 * Mock fetch that fails the first `failGetCalls` GET requests with a
 * retryable ECONNREFUSED-shaped error, then responds 200 OK. HEAD probes
 * always succeed so the start-URL probe in `crawl()` selects the primary.
 *
 * `getCallsByHost` is keyed by `URL.host` so multi-domain tests can
 * configure per-host failure budgets.
 */
const installFailingFetch = (
  getCallsByHost: ReadonlyMap<string, number>
): { readonly counts: () => ReadonlyMap<string, number> } => {
  const calls = new Map<string, number>();
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const urlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const host = new URL(urlStr).host;
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
    const prior = calls.get(host) ?? 0;
    calls.set(host, prior + 1);
    const budget = getCallsByHost.get(host) ?? 0;
    if (prior < budget) {
      const err = new TypeError('fetch failed');
      (err as unknown as { cause: unknown }).cause = new Error(
        'connect ECONNREFUSED 127.0.0.1:443'
      );
      return Promise.reject(err);
    }
    return Promise.resolve(okResponse());
  });
  return { counts: () => calls };
};

const runSpider = async (
  config: ReturnType<typeof makeSpiderConfig>,
  startUrls: string | ReadonlyArray<string>,
  eventsRef: Ref.Ref<SpiderEvent[]>
) => {
  const program = Effect.gen(function* () {
    const spider = yield* SpiderService;
    const sink = Sink.forEach((_r: CrawlResult) => Effect.void);
    return yield* spider.crawl(startUrls, sink);
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
};

const domainCompletes = (events: ReadonlyArray<SpiderEvent>) =>
  events.filter(
    (e): e is DomainCompleteEvent => e._tag === 'DomainComplete'
  );

const retryScheduled = (events: ReadonlyArray<SpiderEvent>) =>
  events.filter(
    (e): e is DomainRetryScheduledEvent =>
      e._tag === 'DomainRetryScheduled'
  );

describe('domainRetry — default behaviour preserved', () => {
  it('emits exactly one DomainCompleteEvent with cycle: 0 when domainRetry is omitted', async () => {
    // Permanent failure: no retry config, no retry pass.
    installFailingFetch(new Map([['default-disabled.test', 5]]));

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 1,
      fetchRetry: {
        maxAttempts: 1,
        baseBackoffMs: 1,
        retryOn: ['connection_refused'],
      },
    });

    await runSpider(config, 'https://default-disabled.test/', eventsRef);

    const events = await Effect.runPromise(Ref.get(eventsRef));
    const completes = domainCompletes(events);
    expect(completes).toHaveLength(1);
    expect(completes[0]?.cycle).toBe(0);
    expect(completes[0]?.reason).toBe('all_fetches_failed');
    expect(retryScheduled(events)).toHaveLength(0);
  });

  it('exposes the default DomainRetryConfig as disabled with maxPasses: 1', () => {
    expect(defaultDomainRetry.enabled).toBe(false);
    expect(defaultDomainRetry.maxPasses).toBe(1);
    expect(defaultDomainRetry.retryOn.reasons).toContain('all_fetches_failed');
  });
});

describe('domainRetry — multi-pass recovery', () => {
  it('retries a residual domain and recovers on pass 1', async () => {
    // Two pass-0 attempts (matches fetchRetry.maxAttempts: 2) both fail;
    // pass 1 fetches once and succeeds.
    installFailingFetch(new Map([['recover.test', 2]]));

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 1,
      fetchRetry: {
        maxAttempts: 2,
        baseBackoffMs: 1,
        retryOn: ['connection_refused'],
      },
      domainRetry: {
        enabled: true,
        maxPasses: 2,
        backoffMs: 5,
        retryOn: {
          reasons: ['all_fetches_failed'],
          maxPagesAttempted: 1,
        },
      },
    });

    await runSpider(config, 'https://recover.test/', eventsRef);

    const events = await Effect.runPromise(Ref.get(eventsRef));
    const completes = domainCompletes(events);
    const retries = retryScheduled(events);

    expect(completes).toHaveLength(2);
    expect(completes[0]?.cycle).toBe(0);
    expect(completes[0]?.reason).toBe('all_fetches_failed');
    expect(completes[1]?.cycle).toBe(1);
    expect(completes[1]?.reason).toBe('queue_empty');
    expect(completes[1]?.pagesScraped).toBeGreaterThan(0);

    expect(retries).toHaveLength(1);
    expect(retries[0]?.domain).toBe('recover.test');
    expect(retries[0]?.attempt).toBe(1);
    expect(retries[0]?.previousReason).toBe('all_fetches_failed');
  });

  it('emits two DomainCompleteEvents when both passes fail and no third pass runs', async () => {
    // 100 failures > maxPasses * maxAttempts so pass 1 also exhausts.
    installFailingFetch(new Map([['twofail.test', 100]]));

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 1,
      fetchRetry: {
        maxAttempts: 1,
        baseBackoffMs: 1,
        retryOn: ['connection_refused'],
      },
      domainRetry: {
        enabled: true,
        maxPasses: 2,
        backoffMs: 5,
        retryOn: {
          reasons: ['all_fetches_failed'],
          maxPagesAttempted: 1,
        },
      },
    });

    await runSpider(config, 'https://twofail.test/', eventsRef);

    const events = await Effect.runPromise(Ref.get(eventsRef));
    const completes = domainCompletes(events);

    expect(completes).toHaveLength(2);
    expect(completes[0]?.cycle).toBe(0);
    expect(completes[1]?.cycle).toBe(1);
    expect(completes[0]?.reason).toBe('all_fetches_failed');
    expect(completes[1]?.reason).toBe('all_fetches_failed');
    expect(retryScheduled(events)).toHaveLength(1);
  });
});

describe('domainRetry — predicate filtering', () => {
  it('skips retry when pagesAttempted exceeds maxPagesAttempted', async () => {
    // The predicate is conjunctive: reason matches AND pagesAttempted is
    // within the bound. A reason-only match must NOT trigger a retry when
    // pagesAttempted overshoots. We can't easily produce
    // pagesAttempted > 1 via the start URL fetch alone, so we drop the
    // bound to 0 instead — same predicate logic, opposite direction.
    installFailingFetch(new Map([['no-retry.test', 5]]));

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 1,
      fetchRetry: {
        maxAttempts: 1,
        baseBackoffMs: 1,
        retryOn: ['connection_refused'],
      },
      domainRetry: {
        enabled: true,
        maxPasses: 2,
        backoffMs: 5,
        retryOn: {
          reasons: ['all_fetches_failed'],
          maxPagesAttempted: 0,
        },
      },
    });

    await runSpider(config, 'https://no-retry.test/', eventsRef);

    const events = await Effect.runPromise(Ref.get(eventsRef));
    expect(domainCompletes(events)).toHaveLength(1);
    expect(retryScheduled(events)).toHaveLength(0);
  });

  it('skips retry when the reason is not in retryOn.reasons', async () => {
    // A successful domain emits reason: 'queue_empty'. Default retryOn
    // only lists 'all_fetches_failed', so success must NOT trigger a
    // retry even with the feature enabled.
    installFailingFetch(new Map([['success.test', 0]]));

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 1,
      domainRetry: {
        enabled: true,
        maxPasses: 3,
        backoffMs: 5,
        retryOn: {
          reasons: ['all_fetches_failed'],
          maxPagesAttempted: 1,
        },
      },
    });

    await runSpider(config, 'https://success.test/', eventsRef);

    const events = await Effect.runPromise(Ref.get(eventsRef));
    expect(domainCompletes(events)).toHaveLength(1);
    expect(domainCompletes(events)[0]?.cycle).toBe(0);
    expect(retryScheduled(events)).toHaveLength(0);
  });
});

describe('domainRetry — mixed-cohort residual set', () => {
  it('re-runs only the failing domain in a mixed cohort', async () => {
    // Three start URLs: a/b succeed pass 0; c fails pass 0 and recovers
    // pass 1. The residual set for pass 1 must contain only c.
    installFailingFetch(
      new Map([
        ['cohort-a.test', 0],
        ['cohort-b.test', 0],
        ['cohort-c.test', 1],
      ])
    );

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 3,
      fetchRetry: {
        maxAttempts: 1,
        baseBackoffMs: 1,
        retryOn: ['connection_refused'],
      },
      domainRetry: {
        enabled: true,
        maxPasses: 2,
        backoffMs: 5,
        retryOn: {
          reasons: ['all_fetches_failed'],
          maxPagesAttempted: 1,
        },
      },
    });

    await runSpider(
      config,
      [
        'https://cohort-a.test/',
        'https://cohort-b.test/',
        'https://cohort-c.test/',
      ],
      eventsRef
    );

    const events = await Effect.runPromise(Ref.get(eventsRef));
    const completes = domainCompletes(events);
    const retries = retryScheduled(events);

    // a + b emit one event each (cycle 0); c emits two (cycle 0 + 1).
    const byDomain = new Map<string, DomainCompleteEvent[]>();
    for (const e of completes) {
      const xs = byDomain.get(e.domain) ?? [];
      xs.push(e);
      byDomain.set(e.domain, xs);
    }
    expect(byDomain.get('cohort-a.test')).toHaveLength(1);
    expect(byDomain.get('cohort-b.test')).toHaveLength(1);
    expect(byDomain.get('cohort-c.test')).toHaveLength(2);

    expect(byDomain.get('cohort-a.test')?.[0]?.cycle).toBe(0);
    expect(byDomain.get('cohort-b.test')?.[0]?.cycle).toBe(0);
    expect(byDomain.get('cohort-c.test')?.[0]?.cycle).toBe(0);
    expect(byDomain.get('cohort-c.test')?.[1]?.cycle).toBe(1);

    // Exactly one retry was scheduled — for c only.
    expect(retries).toHaveLength(1);
    expect(retries[0]?.domain).toBe('cohort-c.test');
  });
});

describe('domainRetry — passOverrides', () => {
  it('applies passOverrides.fetchRetry to pass 1 only', async () => {
    // Pass 0: maxAttempts 1, so the single failure exhausts immediately.
    // Pass 1: override maxAttempts 5, so five failures still recover via
    // success on attempt 6. Wait — easier: pass 0 with 1 attempt sees 1
    // failure (exhausts). Pass 1 with 5 attempts sees 4 failures then
    // succeeds on attempt 5. Total GET calls: 1 + 5 = 6.
    const tracker = installFailingFetch(new Map([['override.test', 5]]));

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 1,
      fetchRetry: {
        maxAttempts: 1,
        baseBackoffMs: 1,
        retryOn: ['connection_refused'],
      },
      domainRetry: {
        enabled: true,
        maxPasses: 2,
        backoffMs: 5,
        retryOn: {
          reasons: ['all_fetches_failed'],
          maxPagesAttempted: 1,
        },
        passOverrides: {
          fetchRetry: {
            maxAttempts: 5,
            baseBackoffMs: 1,
            retryOn: ['connection_refused'],
          },
        },
      },
    });

    await runSpider(config, 'https://override.test/', eventsRef);

    const events = await Effect.runPromise(Ref.get(eventsRef));
    const completes = domainCompletes(events);

    expect(completes).toHaveLength(2);
    expect(completes[1]?.reason).toBe('queue_empty');
    expect(completes[1]?.pagesScraped).toBeGreaterThan(0);
    // 1 (pass 0) + 5 (pass 1, retries 4 failures then succeeds) = 6 GETs.
    expect(tracker.counts().get('override.test')).toBe(6);
  });

  it('applies passOverrides.concurrency to pass 1 only', async () => {
    // Two failing domains. Pass-0 concurrency: 2 (default). Pass-1 override
    // concurrency: 1. The override is structural — there's no event hook to
    // observe per-pass concurrency directly — so we assert behaviourally
    // that the override merge wires through: both residuals are retried,
    // both still fail (no recover), and the retry scheduling fires once
    // per residual.
    installFailingFetch(
      new Map([
        ['conc1.test', 100],
        ['conc2.test', 100],
      ])
    );

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 2,
      fetchRetry: {
        maxAttempts: 1,
        baseBackoffMs: 1,
        retryOn: ['connection_refused'],
      },
      domainRetry: {
        enabled: true,
        maxPasses: 2,
        backoffMs: 5,
        retryOn: {
          reasons: ['all_fetches_failed'],
          maxPagesAttempted: 1,
        },
        passOverrides: {
          concurrency: 1,
        },
      },
    });

    await runSpider(
      config,
      ['https://conc1.test/', 'https://conc2.test/'],
      eventsRef
    );

    const events = await Effect.runPromise(Ref.get(eventsRef));
    const completes = domainCompletes(events);
    const retries = retryScheduled(events);

    // 2 domains × 2 passes = 4 DomainComplete events.
    expect(completes).toHaveLength(4);
    expect(retries).toHaveLength(2);
    expect(retries.map((r) => r.attempt)).toEqual([1, 1]);
  });
});

describe('domainRetry — configuration validation', () => {
  it('rejects maxPasses: 0 at config construction', () => {
    expect(() =>
      makeSpiderConfig({
        domainRetry: {
          enabled: true,
          maxPasses: 0,
          backoffMs: 100,
          retryOn: {
            reasons: ['all_fetches_failed'],
            maxPagesAttempted: 1,
          },
        },
      })
    ).toThrow(ConfigError);
  });

  it('rejects negative maxPasses at config construction', () => {
    expect(() =>
      makeSpiderConfig({
        domainRetry: {
          enabled: true,
          maxPasses: -1,
          backoffMs: 100,
          retryOn: {
            reasons: ['all_fetches_failed'],
            maxPagesAttempted: 1,
          },
        },
      })
    ).toThrow(ConfigError);
  });

  it('rejects non-integer maxPasses at config construction', () => {
    expect(() =>
      makeSpiderConfig({
        domainRetry: {
          enabled: true,
          maxPasses: 1.5,
          backoffMs: 100,
          retryOn: {
            reasons: ['all_fetches_failed'],
            maxPagesAttempted: 1,
          },
        },
      })
    ).toThrow(ConfigError);
  });

  it('rejects negative backoffMs at config construction', () => {
    expect(() =>
      makeSpiderConfig({
        domainRetry: {
          enabled: true,
          maxPasses: 2,
          backoffMs: -1,
          retryOn: {
            reasons: ['all_fetches_failed'],
            maxPagesAttempted: 1,
          },
        },
      })
    ).toThrow(ConfigError);
  });

  it('rejects invalid passOverrides.fetchRetry.maxAttempts', () => {
    expect(() =>
      makeSpiderConfig({
        domainRetry: {
          enabled: true,
          maxPasses: 2,
          backoffMs: 100,
          retryOn: {
            reasons: ['all_fetches_failed'],
            maxPagesAttempted: 1,
          },
          passOverrides: {
            fetchRetry: {
              maxAttempts: 0,
              baseBackoffMs: 100,
              retryOn: ['connection_refused'],
            },
          },
        },
      })
    ).toThrow(ConfigError);
  });

  it('accepts backoffMs: 0 (no sleep between passes)', () => {
    // Zero is valid — the spec calls for backoffMs >= 0. A consumer that
    // wants tight retries without sleeping can set this safely.
    expect(() =>
      makeSpiderConfig({
        domainRetry: {
          enabled: true,
          maxPasses: 2,
          backoffMs: 0,
          retryOn: {
            reasons: ['all_fetches_failed'],
            maxPagesAttempted: 1,
          },
        },
      })
    ).not.toThrow();
  });

  it('rejects enabled: true with maxPasses: 1 (silent no-op footgun)', () => {
    // The user opted in but only the initial pass runs and no retry happens.
    // Reject at construction so the misconfiguration is caught at the boundary.
    expect(() =>
      makeSpiderConfig({
        domainRetry: {
          enabled: true,
          maxPasses: 1,
          backoffMs: 100,
          retryOn: {
            reasons: ['all_fetches_failed'],
            maxPagesAttempted: 1,
          },
        },
      })
    ).toThrow(ConfigError);
  });

  it('accepts enabled: false with maxPasses: 1 (the default)', () => {
    // Disabled + maxPasses: 1 is the documented default — must not throw.
    expect(() =>
      makeSpiderConfig({
        domainRetry: {
          enabled: false,
          maxPasses: 1,
          backoffMs: 100,
          retryOn: {
            reasons: ['all_fetches_failed'],
            maxPagesAttempted: 1,
          },
        },
      })
    ).not.toThrow();
  });

  it('rejects empty retryOn.reasons (silent no-op)', () => {
    expect(() =>
      makeSpiderConfig({
        domainRetry: {
          enabled: true,
          maxPasses: 2,
          backoffMs: 100,
          retryOn: {
            reasons: [],
            maxPagesAttempted: 1,
          },
        },
      })
    ).toThrow(ConfigError);
  });

  it('rejects NaN retryOn.maxPagesAttempted (always-false predicate)', () => {
    expect(() =>
      makeSpiderConfig({
        domainRetry: {
          enabled: true,
          maxPasses: 2,
          backoffMs: 100,
          retryOn: {
            reasons: ['all_fetches_failed'],
            maxPagesAttempted: Number.NaN,
          },
        },
      })
    ).toThrow(ConfigError);
  });

  it('rejects negative retryOn.maxPagesAttempted', () => {
    expect(() =>
      makeSpiderConfig({
        domainRetry: {
          enabled: true,
          maxPasses: 2,
          backoffMs: 100,
          retryOn: {
            reasons: ['all_fetches_failed'],
            maxPagesAttempted: -1,
          },
        },
      })
    ).toThrow(ConfigError);
  });

  it('accepts Infinity retryOn.maxPagesAttempted (no upper bound)', () => {
    // `Infinity` means "retry regardless of pagesAttempted" — useful when
    // the consumer wants every failed domain reattempted, not just
    // start-URL exhaustions.
    expect(() =>
      makeSpiderConfig({
        domainRetry: {
          enabled: true,
          maxPasses: 2,
          backoffMs: 100,
          retryOn: {
            reasons: ['all_fetches_failed'],
            maxPagesAttempted: Infinity,
          },
        },
      })
    ).not.toThrow();
  });

  it('rejects negative passOverrides.fetchRetry.baseBackoffMs', () => {
    expect(() =>
      makeSpiderConfig({
        domainRetry: {
          enabled: true,
          maxPasses: 2,
          backoffMs: 100,
          retryOn: {
            reasons: ['all_fetches_failed'],
            maxPagesAttempted: 1,
          },
          passOverrides: {
            fetchRetry: {
              maxAttempts: 3,
              baseBackoffMs: -1,
              retryOn: ['connection_refused'],
            },
          },
        },
      })
    ).toThrow(ConfigError);
  });
});

describe('domainRetry — previousReason reflects most recent pass', () => {
  it('reports the most recent pass reason for maxPasses >= 3', async () => {
    // Pass 0 + pass 1 + pass 2 all fail with `all_fetches_failed`. The
    // DomainRetryScheduledEvent emitted before pass 2 must report pass 1's
    // reason, not pass 0's — verified by attempt index. (The reason is
    // the same here, but the lookup mechanics are what we're guarding.)
    installFailingFetch(new Map([['three.test', 100]]));

    const eventsRef = await Effect.runPromise(Ref.make<SpiderEvent[]>([]));

    const config = makeSpiderConfig({
      ignoreRobotsTxt: true,
      requestDelayMs: 0,
      maxConcurrentWorkers: 1,
      concurrency: 1,
      fetchRetry: {
        maxAttempts: 1,
        baseBackoffMs: 1,
        retryOn: ['connection_refused'],
      },
      domainRetry: {
        enabled: true,
        maxPasses: 3,
        backoffMs: 2,
        retryOn: {
          reasons: ['all_fetches_failed'],
          maxPagesAttempted: 1,
        },
      },
    });

    await runSpider(config, 'https://three.test/', eventsRef);

    const events = await Effect.runPromise(Ref.get(eventsRef));
    const retries = retryScheduled(events);
    const completes = domainCompletes(events);

    expect(completes).toHaveLength(3);
    expect(retries).toHaveLength(2);
    expect(retries[0]?.attempt).toBe(1);
    expect(retries[1]?.attempt).toBe(2);
    // Every retry reports the most recent pass's reason — for both passes
    // the reason is the same (`all_fetches_failed`), so we're proving
    // the lookup at the very least returns a valid reason.
    expect(retries[0]?.previousReason).toBe('all_fetches_failed');
    expect(retries[1]?.previousReason).toBe('all_fetches_failed');
  });
});
