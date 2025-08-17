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

import { Effect, Sink } from 'effect';
import { CrawlResult, makeSpiderConfig, SpiderConfig, SpiderLoggerLive, SpiderService } from '../src/index.js';

const program = Effect.gen(function* () {
  console.log('🕷️ Example 01: Basic Web Crawling');
  console.log('Crawling web-scraping.dev for basic functionality\n');

  // Create a collector sink for results
  const results: CrawlResult[] = [];
  const collectSink = Sink.forEach<CrawlResult, void, never, never>((result) =>
    Effect.sync(() => {
      results.push(result);
      console.log(`✓ Crawled: ${result.pageData.url}`);
      console.log(`  Title: ${result.pageData.title || '(no title)'}`);
      console.log(`  Status: ${result.pageData.statusCode}`);
      console.log(`  Depth: ${result.depth}`);
      console.log(`  Duration: ${result.pageData.scrapeDurationMs}ms\n`);
    })
  );

  // Start the crawl
  const startTime = Date.now();

  const spider = yield* SpiderService;
  yield* spider.crawl(['https://web-scraping.dev/'], collectSink);

  const duration = (Date.now() - startTime) / 1000;

  // Display summary
  console.log('📊 Crawl Summary:');
  console.log(`- Total pages crawled: ${results.length}`);
  console.log(`- Total duration: ${duration.toFixed(2)}s`);
  console.log(`- Average page load time: ${(results.reduce((sum, r) => sum + r.pageData.scrapeDurationMs, 0) / results.length).toFixed(0)}ms`);

  // Analyze results
  const statusCodes = results.reduce((acc, r) => {
    acc[r.pageData.statusCode] = (acc[r.pageData.statusCode] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  console.log('- Status code distribution:', statusCodes);

  // Show pages by depth
  const byDepth = results.reduce((acc, r) => {
    acc[r.depth] = (acc[r.depth] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  console.log('- Pages by depth:', byDepth);

  return results;
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

Effect.runPromise(
  program.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(customConfig)),
    Effect.provide(SpiderLoggerLive)
  )
)
.then((results) => {
  console.log(`\n✅ Example completed successfully! Crawled ${results.length} pages.`);
  process.exit(0);
})
.catch((error) => {
  console.error('\n❌ Example failed:', error);
  process.exit(1);
});
