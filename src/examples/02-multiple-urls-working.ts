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

import {
  DateTime,
  Effect,
  HashMap,
  HashSet,
  Layer,
  Option,
  Sink,
} from 'effect';
import {
  CrawlResult,
  makeSpiderConfig,
  SpiderConfig,
  SpiderEventSinkNoop,
  SpiderService,
} from '../index.js';

const program = Effect.gen(function* () {
  yield* Effect.logInfo('🕷️ Example 02: Multiple Starting URLs');
  yield* Effect.logInfo('Testing concurrent crawling with domain isolation\n');

  // Track results by domain/section using Effect's HashMap
  let resultsBySection = HashMap.empty<string, CrawlResult[]>();

  const collectSink = Sink.forEach<CrawlResult, void, never, never>(
    (result: CrawlResult) =>
      Effect.gen(function* () {
        if (CrawlResult.isOk(result)) {
          // Get section from metadata or infer from URL
          const metadataSection = result.metadata?.section;
          const sectionFromMetadata =
            typeof metadataSection === 'string'
              ? Option.some(metadataSection)
              : Option.none();
          const sectionFromUrl = new URL(result.pageData.url).pathname.split(
            '/'
          )[1];
          const section = Option.getOrElse(
            sectionFromMetadata,
            () => sectionFromUrl ?? 'home'
          );

          const existing = HashMap.get(resultsBySection, section);
          if (existing._tag === 'None') {
            resultsBySection = HashMap.set(resultsBySection, section, [result]);
          } else {
            resultsBySection = HashMap.set(resultsBySection, section, [
              ...existing.value,
              result,
            ]);
          }

          yield* Effect.logInfo(`✓ [${section}] ${result.pageData.url}`);
          yield* Effect.logInfo(
            `  Status: ${result.pageData.statusCode}, Depth: ${result.depth}, ${result.pageData.scrapeDurationMs}ms`
          );
        } else {
          yield* Effect.logWarning(
            `✗ Failed: ${result.url} (${result.error.kind})`
          );
        }
      })
  );

  // Multiple starting URLs with metadata
  const startingUrls = [
    {
      url: 'https://web-scraping.dev/products',
      metadata: { section: 'products', category: 'e-commerce' },
    },
    {
      url: 'https://web-scraping.dev/testimonials',
      metadata: { section: 'testimonials', category: 'dynamic' },
    },
    {
      url: 'https://web-scraping.dev/reviews',
      metadata: { section: 'reviews', category: 'interactive' },
    },
  ];

  yield* Effect.logInfo('🚀 Starting concurrent crawls:');
  for (const { url, metadata } of startingUrls) {
    yield* Effect.logInfo(`  - ${url} (${metadata.category})`);
  }
  yield* Effect.logInfo('');

  const startTime = yield* DateTime.now;

  const spider = yield* SpiderService;
  yield* spider.crawl(startingUrls, collectSink);

  const endTime = yield* DateTime.now;
  const durationMs =
    DateTime.toEpochMillis(endTime) - DateTime.toEpochMillis(startTime);
  const duration = durationMs / 1000;

  yield* Effect.logInfo('\n📊 Crawl Statistics:');
  yield* Effect.logInfo(`- Duration: ${duration.toFixed(2)}s`);
  yield* Effect.logInfo(
    `- Sections crawled: ${HashMap.size(resultsBySection)}`
  );

  yield* Effect.logInfo('\n📋 Results by Section:');
  for (const [section, results] of HashMap.toEntries(resultsBySection)) {
    yield* Effect.logInfo(`\n${section}:`);
    yield* Effect.logInfo(`  - Pages crawled: ${results.length}`);

    const okResults = results.filter(CrawlResult.isOk);

    // Show unique domains using HashSet
    const domainsSet = HashSet.fromIterable(
      okResults.map((r) => new URL(r.pageData.url).hostname)
    );
    const domains = Array.from(domainsSet);
    yield* Effect.logInfo(`  - Domains: ${domains.join(', ')}`);

    // Show categories if present in metadata
    const categoriesSet = HashSet.fromIterable(
      okResults
        .map((r) => r.metadata?.category)
        .filter((c): c is string => typeof c === 'string')
    );
    const categories = Array.from(categoriesSet);
    if (categories.length > 0) {
      yield* Effect.logInfo(`  - Categories: ${categories.join(', ')}`);
    }

    // Show unique status codes using HashSet
    const statusCodesSet = HashSet.fromIterable(
      okResults.map((r) => r.pageData.statusCode)
    );
    const statusCodes = Array.from(statusCodesSet);
    yield* Effect.logInfo(`  - Status codes: ${statusCodes.join(', ')}`);
  }

  // Demonstrate metadata persistence
  yield* Effect.logInfo('\n🏷️ Metadata Analysis:');
  const allResults = Array.from(HashMap.values(resultsBySection)).flat();
  const withMetadata = allResults.filter((r: CrawlResult) => r.metadata);
  yield* Effect.logInfo(
    `- Results with metadata: ${withMetadata.length}/${allResults.length}`
  );

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
  maxConcurrentRequests: 6,
});

const mainEffect = program.pipe(
  Effect.provide(
    SpiderService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(SpiderConfig.layerWith(config), SpiderEventSinkNoop)
      )
    )
  ),
  Effect.tap((results) =>
    Effect.logInfo(
      `\n✅ Example completed! Total pages crawled: ${results.length}`
    )
  ),
  Effect.tapError((error) =>
    Effect.logError(`\n❌ Example failed: ${String(error)}`)
  )
);

void Effect.runPromiseExit(mainEffect).then((exit) => {
  process.exit(exit._tag === 'Success' ? 0 : 1);
});
