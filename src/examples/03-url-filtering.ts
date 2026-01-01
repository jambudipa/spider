/**
 * Example 03: URL Filtering and Domain Restrictions
 *
 * This example demonstrates:
 * - Custom URL filtering with regex patterns
 * - File extension filtering
 * - Domain restrictions
 * - Technical URL filtering (malformed, long URLs, etc.)
 *
 * Tests against: web-scraping.dev with various filters
 */

import { DateTime, Effect, Sink } from 'effect';
import { CrawlResult, makeSpiderConfig, SpiderConfig, SpiderLoggerLive, SpiderService } from '../index.js';

const program = Effect.gen(function* () {
  yield* Effect.logInfo('🕷️ Example 03: URL Filtering and Restrictions');
  yield* Effect.logInfo('Demonstrating various filtering capabilities\n');

  // Track filtered vs processed URLs
  let processedCount = 0;
  const _filteredUrls: string[] = [];

  const collectSink = Sink.forEach<CrawlResult, void, never, never>((result: CrawlResult) =>
    Effect.gen(function* () {
      processedCount++;
      yield* Effect.logInfo(`✓ Processed: ${result.pageData.url}`);
      yield* Effect.logInfo(`  Title: ${result.pageData.title || '(no title)'}`);
      yield* Effect.logInfo(`  Status: ${result.pageData.statusCode}, Depth: ${result.depth}\n`);
    })
  );

  yield* Effect.logInfo('🚀 Starting filtered crawl with restrictions:');
  yield* Effect.logInfo('  - Blocking admin and API paths');
  yield* Effect.logInfo('  - Blocking image and document files');
  yield* Effect.logInfo('  - Limiting to web-scraping.dev domain');
  yield* Effect.logInfo('  - Filtering malformed URLs\n');

  const startTime = yield* DateTime.now;

  const spider = yield* SpiderService;
  yield* spider.crawl(['https://web-scraping.dev/'], collectSink);

  const endTime = yield* DateTime.now;
  const durationMs = DateTime.toEpochMillis(endTime) - DateTime.toEpochMillis(startTime);
  const duration = durationMs / 1000;

  yield* Effect.logInfo('📊 Filtering Results:');
  yield* Effect.logInfo(`- Pages processed: ${processedCount}`);
  yield* Effect.logInfo(`- Total crawl time: ${duration.toFixed(2)}s`);
  yield* Effect.logInfo('- Filtered content: admin paths, API endpoints, media files');

  return processedCount;
});

// Configuration with comprehensive filtering
const config = makeSpiderConfig({
  maxPages: 15,
  maxDepth: 2,
  requestDelayMs: 200,
  ignoreRobotsTxt: false,
  userAgent: 'SpiderExample/1.0',

  // Domain restrictions
  allowedDomains: ['web-scraping.dev'],

  // Custom URL filters (regex patterns)
  customUrlFilters: [
    /\/api\//i,           // Block API endpoints
    /\/admin\//i,         // Block admin areas
    /\/auth\//i,          // Block auth endpoints
    /\/static\//i,        // Block static resources
    /\.(css|js)$/i,       // Block CSS and JS files
    /\/blocked/i,         // Block the blocked test page
    /credentials/i        // Block credentials page
  ],

  // File extension filtering
  fileExtensionFilters: {
    filterArchives: true,
    filterImages: true,      // Block images
    filterAudio: true,
    filterVideo: true,
    filterOfficeDocuments: true,  // Block PDFs, docs, etc.
    filterOther: true       // Block CSS, JS, etc.
  },

  // Technical filters
  technicalFilters: {
    filterUnsupportedSchemes: true,
    filterLongUrls: true,
    maxUrlLength: 200,      // Shorter limit for demo
    filterMalformedUrls: true
  },

  // Enable URL normalization for better deduplication
  normalizeUrlsForDeduplication: true,

  maxConcurrentWorkers: 2
});

const mainEffect = program.pipe(
  Effect.provide(SpiderService.Default),
  Effect.provide(SpiderConfig.Live(config)),
  Effect.provide(SpiderLoggerLive),
  Effect.tap((count) => Effect.logInfo(`\n✅ Filtering example completed! Processed ${count} pages after filtering.`)),
  Effect.tap(() => Effect.logInfo('🎯 Demonstrated: Custom regex filters, file type filtering, domain restrictions')),
  Effect.tapError((error) => Effect.logError(`\n❌ Example failed: ${String(error)}`)),
  Effect.map((count) => {
    process.exit(0);
    return count;
  }),
  Effect.catchAll(() => Effect.sync(() => {
    process.exit(1);
  }))
);

void Effect.runPromise(mainEffect);
