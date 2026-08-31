/**
 * Example 04: Robots.txt Compliance and Rate Limiting
 *
 * This example demonstrates:
 * - Robots.txt compliance checking
 * - Crawl delay respect from robots.txt
 * - Rate limiting per domain
 * - Request delay configuration
 * - Respectful crawling practices
 *
 * Tests against: web-scraping.dev robots.txt rules
 */

import { Chunk, DateTime, Effect, Layer, Sink } from 'effect';
import {
  CrawlResult,
  makeSpiderConfig,
  SpiderConfig,
  SpiderEventSinkNoop,
  SpiderService,
} from '../index.js';
import { RobotsService } from '../lib/Robots/Robots.service.js';

/** Timestamped page result used to display the delay between completed crawls. */
interface CrawlTiming {
  /** URL whose completion time this record describes. */
  url: string;
  /** Completion time as Unix milliseconds. */
  timestamp: number;
  /** Elapsed milliseconds since the prior completed page. */
  delay: number;
}

/** Demonstrates robots checks and records the observed crawl spacing. */
const program = Effect.gen(function* () {
  yield* Effect.logInfo('🕷️ Example 04: Robots.txt Compliance & Rate Limiting');
  yield* Effect.logInfo('Demonstrating respectful crawling practices\n');

  // First, let's check what robots.txt says
  yield* Effect.logInfo('🤖 Checking robots.txt compliance:');
  const robots = yield* RobotsService;

  // Test some URLs against robots.txt
  const testUrls = [
    'https://web-scraping.dev/',
    'https://web-scraping.dev/products',
    'https://web-scraping.dev/api/graphql',
    'https://web-scraping.dev/blocked',
  ];

  yield* Effect.logInfo('Robots.txt permissions check:');
  for (const url of testUrls) {
    const result = yield* robots.checkUrl(url);
    yield* Effect.logInfo(
      `  ${result.allowed ? '✅' : '❌'} ${url} (delay: ${result.crawlDelay ?? 'default'}ms)`
    );
  }
  yield* Effect.logInfo('');

  // Track timing to demonstrate rate limiting using immutable Chunk
  let crawlTimes: Chunk.Chunk<CrawlTiming> = Chunk.empty();

  const collectSink = Sink.forEach<CrawlResult, void, never, never>(
    (result: CrawlResult) =>
      Effect.gen(function* () {
        if (CrawlResult.isOk(result)) {
          const now = yield* DateTime.now;
          const nowMs = DateTime.toEpochMillis(now);
          const crawlTimesArray = Chunk.toReadonlyArray(crawlTimes);
          const previousTime =
            crawlTimesArray.length > 0
              ? crawlTimesArray[crawlTimesArray.length - 1].timestamp
              : nowMs;
          const actualDelay = nowMs - previousTime;

          crawlTimes = Chunk.append(crawlTimes, {
            url: result.pageData.url,
            timestamp: nowMs,
            delay: actualDelay,
          });

          yield* Effect.logInfo(`✓ ${result.pageData.url}`);
          yield* Effect.logInfo(`  Status: ${result.pageData.statusCode}`);
          yield* Effect.logInfo(`  Delay since last: ${actualDelay}ms`);
          yield* Effect.logInfo(
            `  Scrape time: ${result.pageData.scrapeDurationMs}ms\n`
          );
        } else {
          yield* Effect.logWarning(
            `✗ Failed: ${result.url} (${result.error.kind})`
          );
        }
      })
  );

  yield* Effect.logInfo(
    '🚀 Starting respectful crawl with robots.txt compliance:'
  );

  const startTime = yield* DateTime.now;

  const spider = yield* SpiderService;
  yield* spider.crawl(['https://web-scraping.dev/'], collectSink);

  const endTime = yield* DateTime.now;
  const duration =
    (DateTime.toEpochMillis(endTime) - DateTime.toEpochMillis(startTime)) /
    1000;

  const crawlTimesArray = Chunk.toReadonlyArray(crawlTimes);

  yield* Effect.logInfo('📊 Rate Limiting Analysis:');
  yield* Effect.logInfo(`- Total pages: ${crawlTimesArray.length}`);
  yield* Effect.logInfo(`- Total time: ${duration.toFixed(2)}s`);

  if (crawlTimesArray.length > 1) {
    const delays = crawlTimesArray.slice(1).map((t) => t.delay);
    const avgDelay = delays.reduce((sum, d) => sum + d, 0) / delays.length;
    const minDelay = Math.min(...delays);
    const maxDelay = Math.max(...delays);

    yield* Effect.logInfo(
      `- Average delay between requests: ${avgDelay.toFixed(0)}ms`
    );
    yield* Effect.logInfo(
      `- Min delay: ${minDelay}ms, Max delay: ${maxDelay}ms`
    );
  }

  yield* Effect.logInfo('\n⚡ Rate Limiting Settings Applied:');
  yield* Effect.logInfo('- Base request delay: 800ms');
  yield* Effect.logInfo('- Robots.txt crawl delays: respected');
  yield* Effect.logInfo('- Max requests per second per domain: 1');
  yield* Effect.logInfo('- Concurrent workers: 1 (for clear timing demo)');

  return crawlTimesArray;
});

// Configuration emphasizing respectful crawling
/** Configures a small crawl that exposes robots and rate-limit behavior. */
const config = makeSpiderConfig({
  maxPages: 8,
  maxDepth: 1,

  // Rate limiting settings
  requestDelayMs: 800, // Base delay between requests
  maxRequestsPerSecondPerDomain: 1, // Very conservative rate
  maxConcurrentWorkers: 1, // Single worker for clear timing

  // Robots.txt compliance
  ignoreRobotsTxt: false, // Always respect robots.txt
  maxRobotsCrawlDelayMs: 5000, // Maximum delay we'll accept from robots.txt

  userAgent: 'SpiderExample/1.0',

  // Be selective about what we crawl
  customUrlFilters: [
    /\/api\//, // Skip API endpoints
    /\/static\//, // Skip static resources
    /\.(css|js|png|jpg|gif)$/i, // Skip assets
  ],
});

/** Supplies the robots and spider service layers to the demonstration. */
const runnable = program.pipe(
  Effect.provide(
    SpiderService.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          RobotsService.layer,
          SpiderConfig.layerWith(config),
          SpiderEventSinkNoop
        )
      )
    )
  ),
  Effect.tapError((error) =>
    Effect.logError(`\n❌ Example failed: ${String(error)}`)
  ),
  Effect.tap((crawlTimes) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`\n✅ Respectful crawling example completed!`);
      yield* Effect.logInfo(
        `🤝 Demonstrated: Robots.txt compliance, rate limiting, crawl delays`
      );
      yield* Effect.logInfo(
        `📈 Crawled ${crawlTimes.length} pages with proper delays`
      );
    })
  )
);

void Effect.runPromiseExit(runnable).then((exit) => {
  if (exit._tag === 'Success') {
    process.exit(0);
  } else {
    process.exit(1);
  }
});
