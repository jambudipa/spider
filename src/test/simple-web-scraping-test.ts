/**
 * Simple test to verify web-scraping.dev scenarios work
 */

import { Effect, Sink } from 'effect';
import { SpiderService } from '../lib/Spider/Spider.service.js';
import {
  makeSpiderConfig,
  SpiderConfig,
} from '../lib/Config/SpiderConfig.service.js';
import { SpiderLoggerLive } from '../lib/Logging/SpiderLogger.service.js';
import * as cheerio from 'cheerio';

// Test different scenarios
const scenarios = [
  {
    name: 'Product Page',
    url: 'https://web-scraping.dev/product/1',
    validate: (html: string) => {
      const $ = cheerio.load(html);
      const title = $('h3.card-title').text();
      const price = $('.price').first().text();
      console.log(`  - Title: ${title}`);
      console.log(`  - Price: ${price}`);
      return title.length > 0 && price.length > 0;
    },
  },
  {
    name: 'Products List',
    url: 'https://web-scraping.dev/products',
    validate: (html: string) => {
      const $ = cheerio.load(html);
      const products = $('.product').length;
      console.log(`  - Found ${products} products`);
      return products > 0;
    },
  },
  {
    name: 'Login Page',
    url: 'https://web-scraping.dev/login',
    validate: (html: string) => {
      const $ = cheerio.load(html);
      const hasForm = $('form').length > 0;
      const hasUsername =
        $('input[name="username"], input[type="text"]').length > 0;
      const hasPassword =
        $('input[name="password"], input[type="password"]').length > 0;
      console.log(`  - Has form: ${hasForm}`);
      console.log(`  - Has username field: ${hasUsername}`);
      console.log(`  - Has password field: ${hasPassword}`);
      return hasForm;
    },
  },
];

const runScenarios = async () => {
  const config = makeSpiderConfig({
    maxPages: 1,
    maxDepth: 0,
    requestDelayMs: 2000,
    ignoreRobotsTxt: false,
    userAgent: 'Spider Test Suite',
  });

  let passed = 0;
  let failed = 0;

  for (const scenario of scenarios) {
    console.log(`\n📝 Testing: ${scenario.name}`);
    console.log(`   URL: ${scenario.url}`);

    try {
      const results: any[] = [];
      const collectSink = Sink.forEach((result: any) =>
        Effect.sync(() => {
          results.push(result);
        })
      );

      const testProgram = Effect.gen(function* () {
        const spider = yield* SpiderService;
        yield* spider.crawl([scenario.url], collectSink as any);
        return results;
      });

      const crawlResults = await Effect.runPromise(
        testProgram.pipe(
          Effect.provide(SpiderService.Default),
          Effect.provide(SpiderConfig.Live(config)),
          Effect.provide(SpiderLoggerLive)
        )
      );

      if (crawlResults.length > 0) {
        const pageData = crawlResults[0].pageData;
        const isValid = scenario.validate(pageData.html);

        if (isValid) {
          console.log('  ✅ PASSED');
          passed++;
        } else {
          console.log('  ❌ FAILED - Validation failed');
          failed++;
        }
      } else {
        console.log('  ❌ FAILED - No results');
        failed++;
      }
    } catch (error) {
      console.log(`  ❌ FAILED - ${error}`);
      failed++;
    }

    // Rate limit between tests
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log('\n' + '='.repeat(50));
  console.log(`📊 Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) {
    process.exit(1);
  }
};

runScenarios().catch(console.error);
