/**
 * Example 02: Multiple Starting URLs and Domain Isolation
 *
 * This example demonstrates:
 * - Crawling multiple domains concurrently
 * - Domain isolation and deduplication
 * - Metadata passing through crawl
 * - Concurrent request handling
 *
 * Tests against: Multiple sections of web-scraping.dev
 */

import { Effect, Sink } from 'effect';
import { CrawlResult, makeSpiderConfig, SpiderConfig, SpiderLoggerLive, SpiderService } from '../src/index.js';

const program = Effect.gen(function* () {
  console.log('🕷️ Example 02: Multiple Starting URLs');
  console.log('Testing concurrent crawling with domain isolation\n');

  // Track results by domain/section
  const resultsBySection = new Map<string, CrawlResult[]>();

  const collectSink = Sink.forEach<CrawlResult, void, never, never>((result) =>
    Effect.sync(() => {
      // Get section from metadata or infer from URL
      const section = (result.metadata?.section as string) ||
                     new URL(result.pageData.url).pathname.split('/')[1] || 'home';

      if (!resultsBySection.has(section)) {
        resultsBySection.set(section, []);
      }
      resultsBySection.get(section)!.push(result);

      console.log(`✓ [${section}] ${result.pageData.url}`);
      console.log(`  Status: ${result.pageData.statusCode}, Depth: ${result.depth}, ${result.pageData.scrapeDurationMs}ms`);
    })
  );

  // Multiple starting URLs with metadata
  const startingUrls = [
    {
      url: 'https://web-scraping.dev/products',
      metadata: { section: 'products', category: 'e-commerce' }
    },
    {
      url: 'https://web-scraping.dev/testimonials',
      metadata: { section: 'testimonials', category: 'dynamic' }
    },
    {
      url: 'https://web-scraping.dev/reviews',
      metadata: { section: 'reviews', category: 'interactive' }
    }
  ];

  console.log('🚀 Starting concurrent crawls:');
  startingUrls.forEach(({ url, metadata }) => {
    console.log(`  - ${url} (${metadata.category})`);
  });
  console.log();

  const startTime = Date.now();

  const spider = yield* SpiderService;
  yield* spider.crawl(startingUrls, collectSink);

  const duration = (Date.now() - startTime) / 1000;

  console.log('\n📊 Crawl Statistics:');
  console.log(`- Duration: ${duration.toFixed(2)}s`);
  console.log(`- Sections crawled: ${resultsBySection.size}`);

  console.log('\n📋 Results by Section:');
  for (const [section, results] of resultsBySection) {
    console.log(`\n${section}:`);
    console.log(`  - Pages crawled: ${results.length}`);

    // Show unique domains
    const domains = [...new Set(results.map(r => new URL(r.pageData.url).hostname))];
    console.log(`  - Domains: ${domains.join(', ')}`);

    // Show categories if present in metadata
    const categories = [...new Set(results.map(r => r.metadata?.category).filter(Boolean))];
    if (categories.length > 0) {
      console.log(`  - Categories: ${categories.join(', ')}`);
    }

    // Show unique status codes
    const statusCodes = [...new Set(results.map(r => r.pageData.statusCode))];
    console.log(`  - Status codes: ${statusCodes.join(', ')}`);
  }

  // Demonstrate metadata persistence
  console.log('\n🏷️ Metadata Analysis:');
  const allResults = Array.from(resultsBySection.values()).flat();
  const withMetadata = allResults.filter(r => r.metadata);
  console.log(`- Results with metadata: ${withMetadata.length}/${allResults.length}`);

  return allResults;
});

// Run the example with custom configuration for concurrency
const config = makeSpiderConfig({
  maxPages: 8,
  maxDepth: 1,
  requestDelayMs: 300,
  ignoreRobotsTxt: false,
  userAgent: 'SpiderExample/1.0',
  maxConcurrentWorkers: 3,
  maxConcurrentRequests: 6
});

Effect.runPromise(
  program.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
)
.then((results) => {
  console.log(`\n✅ Example completed! Total pages crawled: ${results.length}`);
  process.exit(0);
})
.catch((error) => {
  console.error('\n❌ Example failed:', error);
  process.exit(1);
});
