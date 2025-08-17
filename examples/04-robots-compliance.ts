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

import { Effect, Sink } from 'effect';
import { CrawlResult, makeSpiderConfig, SpiderConfig, SpiderLoggerLive, SpiderService } from '../src/index.js';
import { RobotsService } from '../src/lib/Robots/Robots.service.js';

const program = Effect.gen(function* () {
  console.log('🕷️ Example 04: Robots.txt Compliance & Rate Limiting');
  console.log('Demonstrating respectful crawling practices\n');

  // First, let's check what robots.txt says
  console.log('🤖 Checking robots.txt compliance:');
  const robots = yield* RobotsService;

  // Test some URLs against robots.txt
  const testUrls = [
    'https://web-scraping.dev/',
    'https://web-scraping.dev/products',
    'https://web-scraping.dev/api/graphql',
    'https://web-scraping.dev/blocked'
  ];

  console.log('Robots.txt permissions check:');
  for (const url of testUrls) {
    const result = yield* robots.checkUrl(url);
    console.log(`  ${result.allowed ? '✅' : '❌'} ${url} (delay: ${result.crawlDelay || 'default'}ms)`);
  }
  console.log();

  // Track timing to demonstrate rate limiting
  const crawlTimes: { url: string; timestamp: number; delay: number }[] = [];

  const collectSink = Sink.forEach<CrawlResult, void, never, never>((result) =>
    Effect.sync(() => {
      const now = Date.now();
      const previousTime = crawlTimes.length > 0 ? crawlTimes[crawlTimes.length - 1].timestamp : now;
      const actualDelay = now - previousTime;

      crawlTimes.push({
        url: result.pageData.url,
        timestamp: now,
        delay: actualDelay
      });

      console.log(`✓ ${result.pageData.url}`);
      console.log(`  Status: ${result.pageData.statusCode}`);
      console.log(`  Delay since last: ${actualDelay}ms`);
      console.log(`  Scrape time: ${result.pageData.scrapeDurationMs}ms\n`);
    })
  );

  console.log('🚀 Starting respectful crawl with robots.txt compliance:');

  const startTime = Date.now();

  const spider = yield* SpiderService;
  yield* spider.crawl(['https://web-scraping.dev/'], collectSink);

  const duration = (Date.now() - startTime) / 1000;

  console.log('📊 Rate Limiting Analysis:');
  console.log(`- Total pages: ${crawlTimes.length}`);
  console.log(`- Total time: ${duration.toFixed(2)}s`);

  if (crawlTimes.length > 1) {
    const delays = crawlTimes.slice(1).map(t => t.delay);
    const avgDelay = delays.reduce((sum, d) => sum + d, 0) / delays.length;
    const minDelay = Math.min(...delays);
    const maxDelay = Math.max(...delays);

    console.log(`- Average delay between requests: ${avgDelay.toFixed(0)}ms`);
    console.log(`- Min delay: ${minDelay}ms, Max delay: ${maxDelay}ms`);
  }

  console.log('\n⚡ Rate Limiting Settings Applied:');
  console.log('- Base request delay: 800ms');
  console.log('- Robots.txt crawl delays: respected');
  console.log('- Max requests per second per domain: 1');
  console.log('- Concurrent workers: 1 (for clear timing demo)');

  return crawlTimes;
});

// Configuration emphasizing respectful crawling
const config = makeSpiderConfig({
  maxPages: 8,
  maxDepth: 1,

  // Rate limiting settings
  requestDelayMs: 800,                    // Base delay between requests
  maxRequestsPerSecondPerDomain: 1,       // Very conservative rate
  maxConcurrentWorkers: 1,                // Single worker for clear timing

  // Robots.txt compliance
  ignoreRobotsTxt: false,                 // Always respect robots.txt
  maxRobotsCrawlDelayMs: 5000,           // Maximum delay we'll accept from robots.txt

  userAgent: 'SpiderExample/1.0',

  // Be selective about what we crawl
  customUrlFilters: [
    /\/api\//,          // Skip API endpoints
    /\/static\//,       // Skip static resources
    /\.(css|js|png|jpg|gif)$/i  // Skip assets
  ]
});

Effect.runPromise(
  program.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(RobotsService.Default),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
)
.then((crawlTimes) => {
  console.log(`\n✅ Respectful crawling example completed!`);
  console.log(`🤝 Demonstrated: Robots.txt compliance, rate limiting, crawl delays`);
  console.log(`📈 Crawled ${crawlTimes.length} pages with proper delays`);
  process.exit(0);
})
.catch((error) => {
  console.error('\n❌ Example failed:', error);
  process.exit(1);
});
