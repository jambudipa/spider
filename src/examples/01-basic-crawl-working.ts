/**
 * Example 01: Basic Web Crawling
 *
 * This example demonstrates:
 * - Basic Spider setup and configuration
 * - Single URL crawling with depth control
 * - Result collection and processing
 * - Error handling
 *
 * Tests against: web-scraping.dev (static content)
 */

import { Chunk, DateTime, Effect, Sink } from 'effect';
import { CrawlResult, makeSpiderConfig, SpiderConfig, SpiderLoggerLive, SpiderService } from '../index.js';

const program = Effect.gen(function* () {
  yield* Effect.logInfo('🕷️ Example 01: Basic Web Crawling');
  yield* Effect.logInfo('Crawling web-scraping.dev for basic functionality\n');

  // Create a collector sink for results using immutable Chunk
  let results: Chunk.Chunk<CrawlResult> = Chunk.empty();
  const collectSink = Sink.forEach<CrawlResult, void, never, never>((result: CrawlResult) =>
    Effect.gen(function* () {
      results = Chunk.append(results, result);
      yield* Effect.logInfo(`✓ Crawled: ${result.pageData.url}`);
      yield* Effect.logInfo(`  Title: ${result.pageData.title || '(no title)'}`);
      yield* Effect.logInfo(`  Status: ${result.pageData.statusCode}`);
      yield* Effect.logInfo(`  Depth: ${result.depth}`);
      yield* Effect.logInfo(`  Duration: ${result.pageData.scrapeDurationMs}ms\n`);
    })
  );

  // Start the crawl
  const startTime = yield* DateTime.now;

  const spider = yield* SpiderService;
  yield* spider.crawl(['https://web-scraping.dev/'], collectSink);

  const endTime = yield* DateTime.now;
  const duration = DateTime.toEpochMillis(endTime) - DateTime.toEpochMillis(startTime);
  const durationSeconds = duration / 1000;

  // Convert to array for processing
  const resultsArray = Chunk.toReadonlyArray(results);

  // Display summary
  yield* Effect.logInfo('📊 Crawl Summary:');
  yield* Effect.logInfo(`- Total pages crawled: ${resultsArray.length}`);
  yield* Effect.logInfo(`- Total duration: ${durationSeconds.toFixed(2)}s`);
  const avgLoadTime = resultsArray.length > 0
    ? resultsArray.reduce<number>((sum, r) => sum + r.pageData.scrapeDurationMs, 0) / resultsArray.length
    : 0;
  yield* Effect.logInfo(`- Average page load time: ${avgLoadTime.toFixed(0)}ms`);

  // Analyze results
  const statusCodes = resultsArray.reduce<Record<number, number>>((acc, r) => {
    const code = r.pageData.statusCode;
    acc[code] = (acc[code] ?? 0) + 1;
    return acc;
  }, {});

  yield* Effect.logInfo(`- Status code distribution:`, statusCodes);

  // Show pages by depth
  const byDepth = resultsArray.reduce<Record<number, number>>((acc, r) => {
    const depth = r.depth;
    acc[depth] = (acc[depth] ?? 0) + 1;
    return acc;
  }, {});

  yield* Effect.logInfo(`- Pages by depth:`, byDepth);

  return resultsArray;
});

// Run the example with proper layers
const customConfig = makeSpiderConfig({
  maxPages: 5,
  maxDepth: 1,
  requestDelayMs: 500,
  ignoreRobotsTxt: false,
  userAgent: 'SpiderExample/1.0',
  maxConcurrentWorkers: 2
});

const runnable = program.pipe(
  Effect.provide(SpiderService.Default),
  Effect.provide(SpiderConfig.Live(customConfig)),
  Effect.provide(SpiderLoggerLive),
  Effect.tapBoth({
    onSuccess: (results) => Effect.logInfo(`\n✅ Example completed successfully! Crawled ${results.length} pages.`),
    onFailure: (error) => Effect.logError(`\n❌ Example failed: ${String(error)}`)
  })
);

void Effect.runPromiseExit(runnable).then((exit) => {
  if (exit._tag === 'Success') {
    process.exit(0);
  } else {
    process.exit(1);
  }
});
