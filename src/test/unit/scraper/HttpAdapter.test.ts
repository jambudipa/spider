/**
 * HttpAdapter Tests
 *
 * Covers the pluggable HTTP adapter slot added in v0.11:
 *   - `resolveAdapter` behaviour for undefined / object / selector forms,
 *     including synchronous selector throws.
 *   - `defaultUndiciAdapter` preserves the v0.10 behaviour when no
 *     `httpAdapter` is configured (regression).
 *   - Custom adapters receive every fetch with the expected request shape.
 *   - Selector form dispatches per-request based on URL.
 *   - Adapter error kinds round-trip into `PageFetchErrorKind` via
 *     `classifyFetchError`, so existing `fetchRetry.retryOn` keys keep
 *     working unchanged.
 *   - ContentTypeError is still raised post-adapter for non-HTML bodies.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cause, Deferred, Effect, Fiber, Option } from 'effect';
import { ScraperService } from '../../../lib/Scraper/Scraper.service.js';
import {
  defaultUndiciAdapter,
  resolveAdapter,
  type HttpAdapter,
  type HttpAdapterRequest,
  type HttpAdapterSelector,
} from '../../../lib/HttpAdapter/index.js';
import {
  classifyFetchError,
  type PageFetchErrorKind,
} from '../../../lib/Spider/Spider.types.js';
import {
  ContentTypeError,
  NetworkError,
  RequestAbortError,
} from '../../../lib/errors/effect-errors.js';
import { expectFailure } from '../../infrastructure/EffectTestUtils.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const runWithScraper = <A, E>(
  effect: Effect.Effect<A, E, ScraperService>
) => Effect.runPromise(Effect.provide(effect, ScraperService.layer));

const runWithScraperExit = <A, E>(
  effect: Effect.Effect<A, E, ScraperService>
) => Effect.runPromise(Effect.provide(effect, ScraperService.layer).pipe(Effect.exit));

const extractFailure = <E>(cause: Cause.Cause<E>): E | undefined => {
  const opt = Cause.findErrorOption(cause);
  return Option.isSome(opt) ? opt.value : undefined;
};

const htmlPage = (title: string, body = '') =>
  `<html><head><title>${title}</title></head><body>${body}</body></html>`;

describe('resolveAdapter', () => {
  const dummyDefault: HttpAdapter = {
    fetch: () =>
      Effect.succeed({
        url: 'about:blank',
        statusCode: 200,
        headers: {},
        body: '',
      }),
  };
  const dummyRequest: HttpAdapterRequest = {
    url: 'https://example.com',
    userAgent: 'ua',
    timeoutMs: 1000,
    requestId: 'r-1',
  };

  it('falls back to default when config is undefined', () => {
    expect(resolveAdapter(undefined, dummyRequest, dummyDefault)).toBe(
      dummyDefault
    );
  });

  it('returns an object form adapter unchanged', () => {
    const custom: HttpAdapter = { fetch: dummyDefault.fetch };
    expect(resolveAdapter(custom, dummyRequest, dummyDefault)).toBe(custom);
  });

  it('invokes a selector with the request', () => {
    let received: HttpAdapterRequest | null = null;
    const custom: HttpAdapter = { fetch: dummyDefault.fetch };
    const selector: HttpAdapterSelector = (req) => {
      received = req;
      return custom;
    };
    const out = resolveAdapter(selector, dummyRequest, dummyDefault);
    expect(out).toBe(custom);
    expect(received).toEqual(dummyRequest);
  });

  it('returns a stub adapter that fails with kind:other when a selector throws', async () => {
    const selector: HttpAdapterSelector = () => {
      throw new Error('selector boom');
    };
    const stub = resolveAdapter(selector, dummyRequest, dummyDefault);
    const exit = await Effect.runPromise(stub.fetch(dummyRequest).pipe(Effect.exit));
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const err = extractFailure(exit.cause) as
        | { kind?: string; message?: string }
        | undefined;
      expect(err?.kind).toBe('other');
      expect(err?.message).toContain('selector boom');
    }
  });
});

describe('defaultUndiciAdapter regression — no behavioural drift from v0.10', () => {
  it('parses HTML when fetched through Scraper with no adapter configured', async () => {
    const html = htmlPage('Default Adapter');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    );

    const { pageData } = await runWithScraper(
      Effect.gen(function* () {
        const scraper = yield* ScraperService;
        return yield* scraper.fetchAndParse('https://example.com', 0);
      })
    );
    expect(pageData.title).toBe('Default Adapter');
    expect(pageData.statusCode).toBe(200);
  });

  it('still raises ContentTypeError for non-HTML responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('PNGDATA', {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    );

    const failure = await expectFailure(
      Effect.provide(
        Effect.gen(function* () {
          const scraper = yield* ScraperService;
          return yield* scraper.fetchAndParse('https://example.com/x.png', 0);
        }),
        ScraperService.layer
      )
    );
    expect(failure).toBeInstanceOf(ContentTypeError);
  });
});

describe('Custom adapter dispatch', () => {
  it('receives every fetch with the expected HttpAdapterRequest shape', async () => {
    const received: HttpAdapterRequest[] = [];
    const adapter: HttpAdapter = {
      fetch: (req) => {
        received.push(req);
        return Effect.succeed({
          url: req.url,
          statusCode: 200,
          headers: { 'content-type': 'text/html' },
          body: htmlPage('From Adapter'),
        });
      },
    };

    const { pageData } = await runWithScraper(
      Effect.gen(function* () {
        const scraper = yield* ScraperService;
        return yield* scraper.fetchAndParse(
          'https://custom.example/page',
          0,
          'TestAgent/1.0',
          adapter
        );
      })
    );

    expect(pageData.title).toBe('From Adapter');
    expect(received).toHaveLength(1);
    expect(received[0]?.url).toBe('https://custom.example/page');
    expect(received[0]?.userAgent).toBe('TestAgent/1.0');
    expect(received[0]?.timeoutMs).toBeGreaterThan(0);
    expect(typeof received[0]?.requestId).toBe('string');
    expect(received[0]?.requestId.length).toBeGreaterThan(0);
  });

  it('selector dispatches different adapters per URL', async () => {
    const recordA: string[] = [];
    const recordB: string[] = [];
    const adapterA: HttpAdapter = {
      fetch: (req) => {
        recordA.push(req.url);
        return Effect.succeed({
          url: req.url,
          statusCode: 200,
          headers: { 'content-type': 'text/html' },
          body: htmlPage('A'),
        });
      },
    };
    const adapterB: HttpAdapter = {
      fetch: (req) => {
        recordB.push(req.url);
        return Effect.succeed({
          url: req.url,
          statusCode: 200,
          headers: { 'content-type': 'text/html' },
          body: htmlPage('B'),
        });
      },
    };

    const promoted = new Set(['promoted.example']);
    const selector: HttpAdapterSelector = (req) =>
      promoted.has(new URL(req.url).hostname) ? adapterA : adapterB;

    await runWithScraper(
      Effect.gen(function* () {
        const scraper = yield* ScraperService;
        yield* scraper.fetchAndParse(
          'https://promoted.example/x',
          0,
          'ua',
          selector
        );
        yield* scraper.fetchAndParse(
          'https://other.example/y',
          0,
          'ua',
          selector
        );
        yield* scraper.fetchAndParse(
          'https://promoted.example/z',
          0,
          'ua',
          selector
        );
      })
    );

    expect(recordA).toEqual([
      'https://promoted.example/x',
      'https://promoted.example/z',
    ]);
    expect(recordB).toEqual(['https://other.example/y']);
  });

  it('a selector that throws synchronously fails the fetch with kind:other', async () => {
    const selector: HttpAdapterSelector = () => {
      throw new Error('boom');
    };
    const exit = await runWithScraperExit(
      Effect.gen(function* () {
        const scraper = yield* ScraperService;
        return yield* scraper.fetchAndParse(
          'https://example.com',
          0,
          'ua',
          selector
        );
      })
    );
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const err = extractFailure(exit.cause);
      expect(err).toBeInstanceOf(NetworkError);
      // The 'other' marker means classifyFetchError returns 'other'
      const classified = classifyFetchError(err, 0, 0);
      expect(classified.kind).toBe<PageFetchErrorKind>('other');
    }
  });

  it('still validates content-type post-adapter (ContentTypeError on non-HTML body)', async () => {
    const adapter: HttpAdapter = {
      fetch: (req) =>
        Effect.succeed({
          url: req.url,
          statusCode: 200,
          headers: { 'content-type': 'application/octet-stream' },
          body: 'binary',
        }),
    };
    const exit = await runWithScraperExit(
      Effect.gen(function* () {
        const scraper = yield* ScraperService;
        return yield* scraper.fetchAndParse(
          'https://example.com/bin',
          0,
          'ua',
          adapter
        );
      })
    );
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const err = extractFailure(exit.cause);
      expect(err).toBeInstanceOf(ContentTypeError);
    }
  });
});

describe('Adapter error kinds round-trip through classifyFetchError', () => {
  const cases: Array<{
    kind: PageFetchErrorKind;
    expected: PageFetchErrorKind;
    statusCode?: number;
  }> = [
    { kind: 'timeout', expected: 'timeout' },
    { kind: 'dns', expected: 'dns' },
    { kind: 'connection_refused', expected: 'connection_refused' },
    { kind: 'http_429', expected: 'http_429', statusCode: 429 },
    { kind: 'http_5xx', expected: 'http_5xx', statusCode: 503 },
    { kind: 'http_4xx', expected: 'http_4xx', statusCode: 404 },
    { kind: 'other', expected: 'other' },
  ];

  for (const c of cases) {
    it(`maps adapter kind=${c.kind} -> typed error -> PageFetchErrorKind ${c.expected}`, async () => {
      const adapter: HttpAdapter = {
        fetch: () =>
          Effect.fail({
            kind: c.kind,
            message: `synthetic ${c.kind}`,
            statusCode: c.statusCode,
          }),
      };

      const exit = await runWithScraperExit(
        Effect.gen(function* () {
          const scraper = yield* ScraperService;
          return yield* scraper.fetchAndParse(
            'https://example.com',
            0,
            'ua',
            adapter
          );
        })
      );
      expect(exit._tag).toBe('Failure');
      if (exit._tag === 'Failure') {
        const err = extractFailure(exit.cause);
        // Adapter errors land as RequestAbortError (timeout) or NetworkError
        // (everything else). classifyFetchError then maps back to a kind.
        if (c.kind === 'timeout') {
          expect(err).toBeInstanceOf(RequestAbortError);
        } else {
          expect(err).toBeInstanceOf(NetworkError);
        }
        const classified = classifyFetchError(err, 100, 1);
        expect(classified.kind).toBe<PageFetchErrorKind>(c.expected);
      }
    });
  }
});

describe('defaultUndiciAdapter — direct invocation', () => {
  it('returns a structured response for a 200 fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(htmlPage('Direct'), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    );
    const response = await Effect.runPromise(
      defaultUndiciAdapter.fetch({
        url: 'https://example.com',
        userAgent: 'ua',
        timeoutMs: 1000,
        requestId: 'r-x',
      })
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Direct');
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('returns 5xx as a successful response (v0.10 parity — no http_5xx failure)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('error body', {
        status: 503,
        headers: { 'content-type': 'text/html' },
      })
    );
    const response = await Effect.runPromise(
      defaultUndiciAdapter.fetch({
        url: 'https://example.com',
        userAgent: 'ua',
        timeoutMs: 1000,
        requestId: 'r-x',
      })
    );
    expect(response.statusCode).toBe(503);
    expect(response.body).toBe('error body');
  });

  it('returns 429 as a successful response (v0.10 parity)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('rate limited', {
        status: 429,
        headers: { 'content-type': 'text/html' },
      })
    );
    const response = await Effect.runPromise(
      defaultUndiciAdapter.fetch({
        url: 'https://example.com',
        userAgent: 'ua',
        timeoutMs: 1000,
        requestId: 'r-x',
      })
    );
    expect(response.statusCode).toBe(429);
  });

  it('does not allow caller-supplied headers to override User-Agent', async () => {
    let sentUa: string | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input, init) => {
        const headers = init?.headers as
          | Record<string, string>
          | undefined;
        sentUa = headers?.['User-Agent'];
        return new Response('ok', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
    );
    await Effect.runPromise(
      defaultUndiciAdapter.fetch({
        url: 'https://example.com',
        userAgent: 'SpiderResolvedUA/1.0',
        timeoutMs: 1000,
        requestId: 'r-ua',
        headers: { 'User-Agent': 'CallerOverride/1.0', 'X-Test': 'yes' },
      })
    );
    expect(sentUa).toBe('SpiderResolvedUA/1.0');
  });
});

describe('Hardened resolveAdapter edge cases', () => {
  const dummyDefault: HttpAdapter = {
    fetch: () =>
      Effect.succeed({
        url: '',
        statusCode: 200,
        headers: {},
        body: '',
      }),
  };
  const dummyRequest: HttpAdapterRequest = {
    url: 'https://example.com',
    userAgent: 'ua',
    timeoutMs: 1000,
    requestId: 'r-1',
  };

  it('treats null config as the default adapter', () => {
    expect(
      resolveAdapter(
        null as unknown as HttpAdapter | HttpAdapterSelector | undefined,
        dummyRequest,
        dummyDefault
      )
    ).toBe(dummyDefault);
  });

  it('returns a failing stub when fetch is not callable', async () => {
    const broken = { fetch: 'not a function' } as unknown as HttpAdapter;
    const stub = resolveAdapter(broken, dummyRequest, dummyDefault);
    const exit = await Effect.runPromise(stub.fetch(dummyRequest).pipe(Effect.exit));
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const err = extractFailure(exit.cause) as
        | { kind?: string; message?: string }
        | undefined;
      expect(err?.kind).toBe('other');
      expect(err?.message).toContain('neither undefined');
    }
  });

  it('returns a failing stub when a selector returns a non-adapter', async () => {
    const selector = (() => ({ notAdapter: true })) as unknown as HttpAdapterSelector;
    const stub = resolveAdapter(selector, dummyRequest, dummyDefault);
    const exit = await Effect.runPromise(stub.fetch(dummyRequest).pipe(Effect.exit));
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const err = extractFailure(exit.cause) as
        | { kind?: string; message?: string }
        | undefined;
      expect(err?.kind).toBe('other');
      expect(err?.message).toContain('not a valid adapter');
    }
  });
});

describe('adapterErrorToTypedError statusCode inference', () => {
  const cases: Array<{ kind: PageFetchErrorKind; expected: PageFetchErrorKind }> = [
    { kind: 'http_4xx', expected: 'http_4xx' },
    { kind: 'http_429', expected: 'http_429' },
    { kind: 'http_5xx', expected: 'http_5xx' },
  ];

  for (const c of cases) {
    it(`round-trips kind=${c.kind} even when adapter omits statusCode`, async () => {
      const adapter: HttpAdapter = {
        fetch: () =>
          Effect.fail({
            kind: c.kind,
            message: `synthetic ${c.kind} with no status`,
          }),
      };
      const exit = await runWithScraperExit(
        Effect.gen(function* () {
          const scraper = yield* ScraperService;
          return yield* scraper.fetchAndParse(
            'https://example.com',
            0,
            'ua',
            adapter
          );
        })
      );
      expect(exit._tag).toBe('Failure');
      if (exit._tag === 'Failure') {
        const err = extractFailure(exit.cause);
        const classified = classifyFetchError(err, 100, 1);
        expect(classified.kind).toBe<PageFetchErrorKind>(c.expected);
      }
    });
  }
});

describe('Adapter interrupt propagation (Acceptance #4)', () => {
  it('an Effect.never adapter is interrupted when the wrapping fiber is interrupted', async () => {
    let adapterStarted = false;
    let adapterInterrupted = false;
    const adapter: HttpAdapter = {
      fetch: () =>
        Effect.gen(function* () {
          adapterStarted = true;
          return yield* Effect.never;
        }).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              adapterInterrupted = true;
            })
          )
        ),
    };

    const stopSignal = await Effect.runPromise(Deferred.make<void>());

    const program = Effect.gen(function* () {
      const scraper = yield* ScraperService;
      // Race the fetch against the stop signal (mirrors the Spider's
      // interrupt path at Spider.service.ts).
      return yield* Effect.raceFirst(
        scraper.fetchAndParse('https://example.com', 0, 'ua', adapter),
        Deferred.await(stopSignal).pipe(Effect.flatMap(() => Effect.interrupt))
      );
    }).pipe(Effect.provide(ScraperService.layer));

    const fiber = Effect.runFork(program);
    // Give the adapter a tick to start.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(adapterStarted).toBe(true);

    const t0 = Date.now();
    await Effect.runPromise(Deferred.succeed(stopSignal, undefined));
    const exit = await Effect.runPromise(Fiber.await(fiber));
    const elapsed = Date.now() - t0;

    // Adapter must have been interrupted (cancellable Effect contract).
    expect(adapterInterrupted).toBe(true);
    // Termination is bounded — well under any reasonable grace period.
    expect(elapsed).toBeLessThan(1000);
    // Exit reflects interruption.
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });
});

describe('defaultUndiciAdapter — defensive checks added in review', () => {
  it('fails with kind:other when timeoutMs is 0', async () => {
    const exit = await Effect.runPromise(
      defaultUndiciAdapter
        .fetch({
          url: 'https://example.com',
          userAgent: 'ua',
          timeoutMs: 0,
          requestId: 'r-bad',
        })
        .pipe(Effect.exit)
    );
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const err = extractFailure(exit.cause) as
        | { kind?: string; message?: string }
        | undefined;
      expect(err?.kind).toBe('other');
      expect(err?.message).toContain('Invalid timeoutMs');
    }
  });

  it('fails with kind:other when timeoutMs is negative', async () => {
    const exit = await Effect.runPromise(
      defaultUndiciAdapter
        .fetch({
          url: 'https://example.com',
          userAgent: 'ua',
          timeoutMs: -1,
          requestId: 'r-bad',
        })
        .pipe(Effect.exit)
    );
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const err = extractFailure(exit.cause) as
        | { kind?: string; message?: string }
        | undefined;
      expect(err?.kind).toBe('other');
    }
  });

  it('fails with kind:other when timeoutMs is NaN', async () => {
    const exit = await Effect.runPromise(
      defaultUndiciAdapter
        .fetch({
          url: 'https://example.com',
          userAgent: 'ua',
          timeoutMs: Number.NaN,
          requestId: 'r-bad',
        })
        .pipe(Effect.exit)
    );
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const err = extractFailure(exit.cause) as
        | { kind?: string }
        | undefined;
      expect(err?.kind).toBe('other');
    }
  });
});

describe('Scraper rejects HttpAdapter contract violations', () => {
  it('fails with ResponseError when adapter body is not a string (null)', async () => {
    const adapter: HttpAdapter = {
      fetch: (req) =>
        Effect.succeed({
          url: req.url,
          statusCode: 200,
          headers: { 'content-type': 'text/html' },
          body: null as unknown as string,
        }),
    };
    const exit = await runWithScraperExit(
      Effect.gen(function* () {
        const scraper = yield* ScraperService;
        return yield* scraper.fetchAndParse(
          'https://example.com',
          0,
          'ua',
          adapter
        );
      })
    );
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const err = extractFailure(exit.cause);
      expect((err as { _tag?: string } | undefined)?._tag).toBe(
        'ResponseError'
      );
    }
  });

  it('fails with ResponseError when adapter body is not a string (Buffer)', async () => {
    const adapter: HttpAdapter = {
      fetch: (req) =>
        Effect.succeed({
          url: req.url,
          statusCode: 200,
          headers: { 'content-type': 'text/html' },
          body: Buffer.from('hello') as unknown as string,
        }),
    };
    const exit = await runWithScraperExit(
      Effect.gen(function* () {
        const scraper = yield* ScraperService;
        return yield* scraper.fetchAndParse(
          'https://example.com',
          0,
          'ua',
          adapter
        );
      })
    );
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const err = extractFailure(exit.cause);
      expect((err as { _tag?: string } | undefined)?._tag).toBe(
        'ResponseError'
      );
    }
  });
});

describe('v0.10 PageData parity — broader regression coverage', () => {
  // Exhaustive parity test: the same Response fed through (a) the default
  // adapter (httpAdapter undefined) and (b) a stub adapter that returns
  // the equivalent HttpAdapterResponse must produce IDENTICAL PageData
  // fields (excluding non-deterministic fields like fetchedAt /
  // scrapeDurationMs). This is the closest practical reproduction of
  // the spec's "byte-identical to v0.10" guarantee within unit-test scope.
  it('default adapter and equivalent stub adapter produce identical PageData', async () => {
    const html = htmlPage(
      'Parity',
      '<p>hello</p>',
    ).replace(
      '</head>',
      '<meta name="description" content="parity test"></head>'
    );

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'x-custom': 'value-1',
        },
      })
    );

    const { pageData: defaultPageData } = await runWithScraper(
      Effect.gen(function* () {
        const scraper = yield* ScraperService;
        return yield* scraper.fetchAndParse(
          'https://example.com/parity',
          3,
          'TestUA/1.0'
        );
      })
    );

    const stubAdapter: HttpAdapter = {
      fetch: (req) =>
        Effect.succeed({
          url: req.url,
          statusCode: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'x-custom': 'value-1',
          },
          body: html,
        }),
    };
    const { pageData: stubPageData } = await runWithScraper(
      Effect.gen(function* () {
        const scraper = yield* ScraperService;
        return yield* scraper.fetchAndParse(
          'https://example.com/parity',
          3,
          'TestUA/1.0',
          stubAdapter
        );
      })
    );

    // Compare every field that is supposed to be deterministic.
    expect(stubPageData.url).toBe(defaultPageData.url);
    expect(stubPageData.html).toBe(defaultPageData.html);
    expect(stubPageData.title).toBe(defaultPageData.title);
    expect(stubPageData.statusCode).toBe(defaultPageData.statusCode);
    expect(stubPageData.depth).toBe(defaultPageData.depth);
    expect(stubPageData.metadata).toEqual(defaultPageData.metadata);
    expect(stubPageData.commonMetadata).toEqual(defaultPageData.commonMetadata);
    expect(stubPageData.headers).toEqual(defaultPageData.headers);
  });

  it('preserves multi-value response headers (Set-Cookie semantics)', async () => {
    // Build a Response with two Set-Cookie headers. undici joins them
    // into a single comma-separated value via Headers.forEach (per Fetch
    // spec). Verify the default adapter does NOT drop one of them.
    const responseHeaders = new Headers();
    responseHeaders.append('content-type', 'text/html');
    responseHeaders.append('set-cookie', 'a=1');
    responseHeaders.append('set-cookie', 'b=2');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(htmlPage('cookies'), {
        status: 200,
        headers: responseHeaders,
      })
    );
    const response = await Effect.runPromise(
      defaultUndiciAdapter.fetch({
        url: 'https://example.com',
        userAgent: 'ua',
        timeoutMs: 1000,
        requestId: 'r-cookie',
      })
    );
    // Set-Cookie is joined per the spec into a single comma-separated
    // string by Headers.forEach. Both values must be present.
    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('a=1');
    expect(setCookie).toContain('b=2');
  });
});

describe('Adapter dns/connection_refused round-trip does not collide with message content', () => {
  it('dns adapter error with message containing "ECONNREFUSED" still classifies as dns', async () => {
    const adapter: HttpAdapter = {
      fetch: () =>
        Effect.fail({
          kind: 'dns',
          message: 'host lookup failed; remember ECONNREFUSED is unrelated',
        }),
    };
    const exit = await runWithScraperExit(
      Effect.gen(function* () {
        const scraper = yield* ScraperService;
        return yield* scraper.fetchAndParse(
          'https://example.com',
          0,
          'ua',
          adapter
        );
      })
    );
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const err = extractFailure(exit.cause);
      const classified = classifyFetchError(err, 100, 1);
      expect(classified.kind).toBe<PageFetchErrorKind>('dns');
    }
  });
});
