/**
 * Simple test runner to check scenario tests against real web-scraping.dev
 */

import { Effect, Sink } from 'effect';
import { SpiderService } from '../lib/Spider/Spider.service.js';
import {
  makeSpiderConfig,
  SpiderConfig,
} from '../lib/Config/SpiderConfig.service.js';
import { SpiderLoggerLive } from '../lib/Logging/SpiderLogger.service.js';

const testCrawl = Effect.gen(function* () {
  const spider = yield* SpiderService;

  const results: any[] = [];
  const collectSink = Sink.forEach((result: any) =>
    Effect.sync(() => {
      results.push(result);
      console.log('Crawled:', result.pageData.url);
    })
  );

  // Test crawling the main page with data extraction
  const testUrl = 'https://web-scraping.dev/product/1';
  console.log(`Testing crawl of: ${testUrl}`);

  const options = {
    extractData: {
      title: { selector: 'h3.card-title', text: true },
      price: { selector: '.price:first', text: true },
      description: {
        selector: '.card-description, .product-description',
        text: true,
      },
      image: { selector: '.card-img-top, img.product-image', attribute: 'src' },
      stockStatus: { selector: '.text-success, .text-danger', text: true },
      rating: { selector: '.rating .rate', text: true },
      reviews: { selector: '.reviews-count', text: true },
    },
  };

  yield* spider.crawlSingle(testUrl, collectSink as any, options);

  return results;
});

const runTest = async () => {
  try {
    const config = makeSpiderConfig({
      maxPages: 1,
      maxDepth: 0,
      requestDelayMs: 2000, // 2 second delay between requests
      ignoreRobotsTxt: false,
      userAgent: 'Spider Test Suite (github.com/jambudipa-io/spider)',
    });

    const results = await Effect.runPromise(
      testCrawl.pipe(
        Effect.provide(SpiderService.Default),
        Effect.provide(SpiderConfig.Live(config)),
        Effect.provide(SpiderLoggerLive)
      )
    );

    console.log('\n✅ Test completed successfully!');
    console.log(`Crawled ${results.length} page(s)`);

    if (results.length > 0) {
      const page = results[0].pageData;
      console.log('\nPage details:');
      console.log('- URL:', page.url);
      console.log('- Title:', page.title);
      console.log('- Links found:', page.links?.length || 0);
      console.log('- HTML length:', page.html?.length || 0);

      // Test data extraction
      if (page.extractedData) {
        console.log('\nExtracted data:');
        console.log(JSON.stringify(page.extractedData, null, 2));
      }
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
};

runTest();
