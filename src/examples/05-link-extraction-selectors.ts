/**
 * Example 05: Advanced Link Extraction with CSS Selectors
 *
 * This example demonstrates:
 * - Custom CSS selectors for targeted link extraction
 * - Link extraction from different HTML elements
 * - Form action URL extraction
 * - Custom attribute extraction
 * - Link extraction statistics and analysis
 *
 * Tests against: web-scraping.dev with targeted selectors
 */

import { DateTime, Effect, HashMap, HashSet, Layer, Sink } from 'effect';
import {
  CrawlResult,
  LinkExtractionResult,
  LinkExtractorService,
  makeSpiderConfig,
  PageData,
  ScraperService,
  SpiderConfig,
  SpiderEventSinkNoop,
  SpiderService,
} from '../index.js';

const program = Effect.gen(function* () {
  yield* Effect.logInfo(
    '🕷️ Example 05: Advanced Link Extraction with CSS Selectors'
  );
  yield* Effect.logInfo('Demonstrating targeted link extraction techniques\n');

  // Demonstrate link extraction service directly first
  yield* Effect.logInfo('🔍 Testing Link Extraction Service:');

  const scraper = yield* ScraperService;
  const linkExtractor = yield* LinkExtractorService;

  // Scrape a test page to demonstrate link extraction
  const fetchResult = yield* scraper.fetchAndParse(
    'https://web-scraping.dev/products'
  );
  const testPageData: PageData = fetchResult.pageData;

  yield* Effect.logInfo(
    `✓ Scraped page: ${testPageData.title ?? '(no title)'}`
  );
  yield* Effect.logInfo(
    `  Content length: ${testPageData.html.length} chars\n`
  );

  // Extract links using different strategies
  yield* Effect.logInfo('🎯 Link Extraction Analysis:');

  // 1. Extract all navigation links
  const navLinks: LinkExtractionResult = yield* linkExtractor.extractLinks(
    testPageData.html,
    {
      restrictCss: ['nav a', '.navbar a', 'header a'],
      tags: ['a'],
      attrs: ['href'],
    }
  );

  yield* Effect.logInfo('Navigation Links:');
  for (const url of navLinks.links.slice(0, 5)) {
    yield* Effect.logInfo(`  - ${url}`);
  }
  yield* Effect.logInfo(`  Total: ${navLinks.links.length} navigation links\n`);

  // 2. Extract product links specifically
  const productLinks: LinkExtractionResult = yield* linkExtractor.extractLinks(
    testPageData.html,
    {
      restrictCss: ['.product a', '[data-product] a', '.card a'],
      tags: ['a'],
      attrs: ['href'],
    }
  );

  yield* Effect.logInfo('Product Links:');
  for (const url of productLinks.links.slice(0, 5)) {
    yield* Effect.logInfo(`  - ${url}`);
  }
  yield* Effect.logInfo(
    `  Total: ${productLinks.links.length} product links\n`
  );

  // 3. Extract form action URLs
  const formLinks: LinkExtractionResult = yield* linkExtractor.extractLinks(
    testPageData.html,
    {
      restrictCss: ['form'],
      tags: ['form'],
      attrs: ['action'],
    }
  );

  yield* Effect.logInfo('Form Actions:');
  if (formLinks.links.length > 0) {
    for (const url of formLinks.links) {
      yield* Effect.logInfo(`  - ${url}`);
    }
  } else {
    yield* Effect.logInfo('  - No forms found');
  }
  yield* Effect.logInfo(`  Total: ${formLinks.links.length} form actions\n`);

  // Now demonstrate during actual crawling with advanced extraction
  let extractedLinks = HashMap.empty<string, readonly string[]>();

  const collectSink = Sink.forEach<CrawlResult, void, never, never>(
    (result: CrawlResult) =>
      Effect.gen(function* () {
        if (CrawlResult.isOk(result)) {
          const _domain = new URL(result.pageData.url).hostname;

          yield* Effect.logInfo(`✓ Crawled: ${result.pageData.url}`);
          yield* Effect.logInfo(
            `  Title: ${result.pageData.title ?? '(no title)'}`
          );
          yield* Effect.logInfo(`  Status: ${result.pageData.statusCode}`);
          yield* Effect.logInfo(
            `  Note: Link extraction would be done via LinkExtractorService on demand`
          );
          yield* Effect.logInfo('');
        } else {
          yield* Effect.logWarning(
            `✗ Failed: ${result.url} (${result.error.kind})`
          );
        }
      })
  );

  yield* Effect.logInfo(
    '🚀 Starting targeted crawl with custom link extraction:'
  );
  yield* Effect.logInfo('  - Targeting navigation and content links');
  yield* Effect.logInfo('  - Using CSS selectors for precision');
  yield* Effect.logInfo('  - Extracting from multiple HTML elements\n');

  const startTime = yield* DateTime.now;

  const spider = yield* SpiderService;
  yield* spider.crawl(['https://web-scraping.dev/'], collectSink);

  const endTime = yield* DateTime.now;
  const durationMillis =
    DateTime.toEpochMillis(endTime) - DateTime.toEpochMillis(startTime);
  const duration = durationMillis / 1000;

  yield* Effect.logInfo('📊 Link Extraction Analysis:');
  yield* Effect.logInfo(
    `- Total pages crawled: ${HashMap.size(extractedLinks)}`
  );
  yield* Effect.logInfo(`- Total crawl time: ${duration.toFixed(2)}s`);

  // Analyze extracted links
  const allLinks = Array.from(HashMap.values(extractedLinks)).flat();
  const uniqueLinks = HashSet.fromIterable(allLinks);

  const linksByDomain: Record<string, number> = {};
  for (const link of allLinks) {
    const domainResult = yield* Effect.try({
      try: () => new URL(link).hostname,
      catch: () => 'malformed',
    });
    linksByDomain[domainResult] = (linksByDomain[domainResult] ?? 0) + 1;
  }

  yield* Effect.logInfo(`- Total links extracted: ${allLinks.length}`);
  yield* Effect.logInfo(`- Unique links: ${HashSet.size(uniqueLinks)}`);
  yield* Effect.logInfo('- Links by domain:');
  const sortedDomains = Object.entries(linksByDomain)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  for (const [domain, count] of sortedDomains) {
    yield* Effect.logInfo(`    ${domain}: ${count} links`);
  }

  // Show link extraction efficiency
  const mapSize = HashMap.size(extractedLinks);
  const avgLinksPerPage = mapSize > 0 ? allLinks.length / mapSize : 0;
  yield* Effect.logInfo(
    `- Average links per page: ${avgLinksPerPage.toFixed(1)}`
  );

  return {
    extractedLinks,
    totalLinks: allLinks.length,
    uniqueLinks: HashSet.size(uniqueLinks),
  };
});

// Configuration optimized for link extraction
const config = makeSpiderConfig({
  maxPages: 6,
  maxDepth: 1,
  requestDelayMs: 400,
  ignoreRobotsTxt: false,
  userAgent: 'SpiderExample/1.0',

  // Note: Link extraction is handled automatically by LinkExtractorService during crawling
  // Custom selectors would need to be implemented via middleware or custom extraction calls

  // Allow crawling of different file types for comprehensive testing
  fileExtensionFilters: {
    filterArchives: true,
    filterImages: false, // Allow images to test extraction
    filterAudio: true,
    filterVideo: true,
    filterOfficeDocuments: false, // Allow PDFs to test extraction
    filterOther: false, // Allow other file types
  },

  maxConcurrentWorkers: 2,
});

const runnable = program.pipe(
  Effect.provide(
    SpiderService.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          ScraperService.layer,
          LinkExtractorService.layer,
          SpiderConfig.layerWith(config),
          SpiderEventSinkNoop
        )
      )
    )
  ),
  Effect.tap((result) =>
    Effect.all([
      Effect.logInfo(`\n✅ Link extraction example completed!`),
      Effect.logInfo(
        `🎯 Demonstrated: CSS selectors, multi-element extraction, link analysis`
      ),
      Effect.logInfo(
        `📈 Extracted ${result.totalLinks} links (${result.uniqueLinks} unique) from ${HashMap.size(result.extractedLinks)} pages`
      ),
    ])
  ),
  Effect.tapError((error) =>
    Effect.logError(`\n❌ Example failed: ${String(error)}`)
  )
);

void Effect.runPromiseExit(runnable).then((exit) => {
  process.exit(exit._tag === 'Success' ? 0 : 1);
});
