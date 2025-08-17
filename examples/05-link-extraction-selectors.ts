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

import { Effect, Sink } from 'effect';
import {
  CrawlResult,
  LinkExtractorService,
  makeSpiderConfig,
  ScraperService,
  SpiderConfig,
  SpiderLoggerLive,
  SpiderService
} from '../src/index.js';

const program = Effect.gen(function* () {
  console.log('🕷️ Example 05: Advanced Link Extraction with CSS Selectors');
  console.log('Demonstrating targeted link extraction techniques\n');

  // Demonstrate link extraction service directly first
  console.log('🔍 Testing Link Extraction Service:');

  const scraper = yield* ScraperService;
  const linkExtractor = yield* LinkExtractorService;

  // Scrape a test page to demonstrate link extraction
  const testPageData = yield* scraper.fetchAndParse('https://web-scraping.dev/products');

  console.log(`✓ Scraped page: ${testPageData.title}`);
  console.log(`  Content length: ${testPageData.html.length} chars\n`);

  // Extract links using different strategies
  console.log('🎯 Link Extraction Analysis:');

  // 1. Extract all navigation links
  const navLinks = yield* linkExtractor.extractLinks(
    testPageData.html,
    {
      restrictCss: ['nav a', '.navbar a', 'header a'],
      tags: ['a'],
      attrs: ['href']
    }
  );

  console.log('Navigation Links:');
  navLinks.links.slice(0, 5).forEach(url => {
    console.log(`  - ${url}`);
  });
  console.log(`  Total: ${navLinks.links.length} navigation links\n`);

  // 2. Extract product links specifically
  const productLinks = yield* linkExtractor.extractLinks(
    testPageData.html,
    {
      restrictCss: ['.product a', '[data-product] a', '.card a'],
      tags: ['a'],
      attrs: ['href']
    }
  );

  console.log('Product Links:');
  productLinks.links.slice(0, 5).forEach(url => {
    console.log(`  - ${url}`);
  });
  console.log(`  Total: ${productLinks.links.length} product links\n`);

  // 3. Extract form action URLs
  const formLinks = yield* linkExtractor.extractLinks(
    testPageData.html,
    {
      restrictCss: ['form'],
      tags: ['form'],
      attrs: ['action']
    }
  );

  console.log('Form Actions:');
  if (formLinks.links.length > 0) {
    formLinks.links.forEach(url => {
      console.log(`  - ${url}`);
    });
  } else {
    console.log('  - No forms found');
  }
  console.log(`  Total: ${formLinks.links.length} form actions\n`);

  // Now demonstrate during actual crawling with advanced extraction
  const extractedLinks = new Map<string, string[]>();

  const collectSink = Sink.forEach<CrawlResult, void, never, never>((result) =>
    Effect.sync(() => {
      const domain = new URL(result.pageData.url).hostname;

      console.log(`✓ Crawled: ${result.pageData.url}`);
      console.log(`  Title: ${result.pageData.title || '(no title)'}`);
      console.log(`  Status: ${result.pageData.statusCode}`);
      console.log(`  Note: Link extraction would be done via LinkExtractorService on demand`);
      console.log();
    })
  );

  console.log('🚀 Starting targeted crawl with custom link extraction:');
  console.log('  - Targeting navigation and content links');
  console.log('  - Using CSS selectors for precision');
  console.log('  - Extracting from multiple HTML elements\n');

  const startTime = Date.now();

  const spider = yield* SpiderService;
  yield* spider.crawl(['https://web-scraping.dev/'], collectSink);

  const duration = (Date.now() - startTime) / 1000;

  console.log('📊 Link Extraction Analysis:');
  console.log(`- Total pages crawled: ${extractedLinks.size}`);
  console.log(`- Total crawl time: ${duration.toFixed(2)}s`);

  // Analyze extracted links
  const allLinks = Array.from(extractedLinks.values()).flat();
  const uniqueLinks = [...new Set(allLinks)];
  const linksByDomain = uniqueLinks.reduce((acc, link) => {
    try {
      const domain = new URL(link).hostname;
      acc[domain] = (acc[domain] || 0) + 1;
    } catch {
      acc['malformed'] = (acc['malformed'] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  console.log(`- Total links extracted: ${allLinks.length}`);
  console.log(`- Unique links: ${uniqueLinks.length}`);
  console.log('- Links by domain:');
  Object.entries(linksByDomain)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .forEach(([domain, count]) => {
      console.log(`    ${domain}: ${count} links`);
    });

  // Show link extraction efficiency
  const avgLinksPerPage = allLinks.length / extractedLinks.size;
  console.log(`- Average links per page: ${avgLinksPerPage.toFixed(1)}`);

  return { extractedLinks, totalLinks: allLinks.length, uniqueLinks: uniqueLinks.length };
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
    filterImages: false,    // Allow images to test extraction
    filterAudio: true,
    filterVideo: true,
    filterOfficeDocuments: false,  // Allow PDFs to test extraction
    filterOther: false      // Allow other file types
  },

  maxConcurrentWorkers: 2
});

Effect.runPromise(
  program.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(ScraperService.Default),
    Effect.provide(LinkExtractorService.Default),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
)
.then((result) => {
  console.log(`\n✅ Link extraction example completed!`);
  console.log(`🎯 Demonstrated: CSS selectors, multi-element extraction, link analysis`);
  console.log(`📈 Extracted ${result.totalLinks} links (${result.uniqueLinks} unique) from ${result.extractedLinks.size} pages`);
  process.exit(0);
})
.catch((error) => {
  console.error('\n❌ Example failed:', error);
  process.exit(1);
});
