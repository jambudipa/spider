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

import { Effect, Sink } from 'effect';
import { CrawlResult, makeSpiderConfig, SpiderConfig, SpiderLoggerLive, SpiderService } from '../src/index.js';

const program = Effect.gen(function* () {
  console.log('🕷️ Example 03: URL Filtering and Restrictions');
  console.log('Demonstrating various filtering capabilities\n');

  // Track filtered vs processed URLs
  let processedCount = 0;
  let filteredUrls: string[] = [];

  const collectSink = Sink.forEach<CrawlResult, void, never, never>((result) =>
    Effect.sync(() => {
      processedCount++;
      console.log(`✓ Processed: ${result.pageData.url}`);
      console.log(`  Title: ${result.pageData.title || '(no title)'}`);
      console.log(`  Status: ${result.pageData.statusCode}, Depth: ${result.depth}\n`);
    })
  );

  console.log('🚀 Starting filtered crawl with restrictions:');
  console.log('  - Blocking admin and API paths');
  console.log('  - Blocking image and document files');
  console.log('  - Limiting to web-scraping.dev domain');
  console.log('  - Filtering malformed URLs\n');

  const startTime = Date.now();

  const spider = yield* SpiderService;
  yield* spider.crawl(['https://web-scraping.dev/'], collectSink);

  const duration = (Date.now() - startTime) / 1000;

  console.log('📊 Filtering Results:');
  console.log(`- Pages processed: ${processedCount}`);
  console.log(`- Total crawl time: ${duration.toFixed(2)}s`);
  console.log('- Filtered content: admin paths, API endpoints, media files');

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

Effect.runPromise(
  program.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
)
.then((count) => {
  console.log(`\n✅ Filtering example completed! Processed ${count} pages after filtering.`);
  console.log('🎯 Demonstrated: Custom regex filters, file type filtering, domain restrictions');
  process.exit(0);
})
.catch((error) => {
  console.error('\n❌ Example failed:', error);
  process.exit(1);
});
