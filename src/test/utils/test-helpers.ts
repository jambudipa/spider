import { Effect, Layer, Sink } from 'effect';
import {
  CrawlResult,
  makeSpiderConfig,
  PageData,
  SpiderConfig,
  SpiderConfigOptions,
  SpiderConfigService,
} from '../../index.js';

/**
 * Run an Effect and return its result as a Promise
 */
export const runEffect = <A, E>(
  effect: Effect.Effect<A, E, never>
): Promise<A> => Effect.runPromise(effect);

/**
 * Run an Effect and return Either<E, A> as a Promise
 */
export const runEffectEither = <A, E>(
  effect: Effect.Effect<A, E, never>
): Promise<{ _tag: 'Left'; left: E } | { _tag: 'Right'; right: A }> =>
  Effect.runPromise(
    Effect.either(effect).pipe(
      Effect.map((either) =>
        either._tag === 'Left'
          ? { _tag: 'Left' as const, left: either.left }
          : { _tag: 'Right' as const, right: either.right }
      )
    )
  );

/**
 * Load mock HTML content - stubbed version
 */
export async function loadMockHtml(filename: string): Promise<string> {
  // Return simple HTML stub since we don't have actual mock files
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Simple Test Page</title>
        <meta name="description" content="A simple test page for Spider">
        <meta name="keywords" content="test, spider, crawling">
        <meta name="author" content="Test Author">
        <meta name="robots" content="index, follow">
      </head>
      <body>
        <h1>Simple Test Page</h1>
        <a href="/page1.html">Page 1</a>
        <a href="/page2.html">Page 2</a>
        <a href="http://example.org/absolute">External Link</a>
        <a href="relative-link.html">Relative Link</a>
        <a href="/privacy.html">Privacy</a>
        <a href="/terms.html">Terms</a>
      </body>
    </html>
  `;
}

/**
 * Create a test configuration layer with custom options
 */
export function createTestConfigLayer(
  options: Partial<SpiderConfigOptions> = {}
): Layer.Layer<SpiderConfigService, never, never> {
  const defaultTestConfig: SpiderConfigOptions = {
    maxPages: 10,
    maxDepth: 2,
    requestDelayMs: 0, // No delay for tests
    ignoreRobotsTxt: true, // Ignore robots.txt for unit tests
    userAgent: 'SpiderTest/1.0',
    followRedirects: true,
    normalizeUrlsForDeduplication: true,
    enableResumability: false,
    maxRequestsPerSecondPerDomain: 100,
    maxConcurrentWorkers: 2,
    maxConcurrentRequests: 10,
    concurrency: 4,
    maxRobotsCrawlDelayMs: 10000,
    allowedProtocols: ['http:', 'https:'],
    respectNoFollow: false,
    customUrlFilters: [],
    ...options,
  };

  return Layer.effect(
    SpiderConfig,
    Effect.succeed(makeSpiderConfig(defaultTestConfig))
  );
}

/**
 * Create a test sink that collects results
 */
export function createCollectingSink<T>(): {
  sink: Sink.Sink<void, T, never, never, never>;
  getResults: () => T[];
} {
  const results: T[] = [];

  const sink: Sink.Sink<void, T, never, never, never> = Sink.forEach(
    (item: T) =>
      Effect.sync(() => {
        results.push(item);
      })
  ) as any;

  return {
    sink,
    getResults: () => [...results],
  };
}

/**
 * Create mock PageData for testing
 */
export function createMockPageData(
  overrides: Partial<PageData> = {}
): PageData {
  return {
    url: 'https://example.com/test',
    html: '<html><body>Test</body></html>',
    title: 'Test Page',
    metadata: {},
    commonMetadata: {
      description: 'Test description',
      keywords: 'test, keywords',
      author: 'Test Author',
      robots: 'index, follow',
    },
    statusCode: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-length': '1000',
    },
    fetchedAt: new Date(),
    scrapeDurationMs: 100,
    depth: 0,
    ...overrides,
  };
}

/**
 * Create mock CrawlResult for testing
 */
export function createMockCrawlResult(
  overrides: Partial<CrawlResult> = {}
): CrawlResult {
  const pageData = overrides.pageData || createMockPageData();
  return {
    pageData,
    depth: pageData.depth || 0,
    timestamp: new Date(),
    metadata: undefined,
    ...overrides,
  };
}

/**
 * Mock fetch implementation for testing
 */
export class MockFetch {
  private responses = new Map<
    string,
    {
      status: number;
      headers: Record<string, string>;
      body: string;
    }
  >();

  addResponse(
    url: string,
    response: {
      status?: number;
      headers?: Record<string, string>;
      body: string;
    }
  ) {
    this.responses.set(url, {
      status: response.status || 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        ...response.headers,
      },
      body: response.body,
    });
  }

  async fetch(url: string): Promise<Response> {
    const response = this.responses.get(url);
    if (!response) {
      return new Response('Not Found', {
        status: 404,
        headers: { 'content-type': 'text/plain' },
      });
    }

    return new Response(response.body, {
      status: response.status,
      headers: new Headers(response.headers),
    });
  }
}
