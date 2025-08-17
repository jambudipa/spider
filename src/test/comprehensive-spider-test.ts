/**
 * Comprehensive test demonstrating Spider capabilities on web-scraping.dev
 */

import { Effect, Sink } from 'effect';
import { SpiderService } from '../lib/Spider/Spider.service.js';
import {
  makeSpiderConfig,
  SpiderConfig,
} from '../lib/Config/SpiderConfig.service.js';
import { SpiderLoggerLive } from '../lib/Logging/SpiderLogger.service.js';

const scenarios = [
  {
    name: 'Data Extraction - Product Page',
    url: 'https://web-scraping.dev/product/1',
    options: {
      extractData: {
        title: { selector: 'h3', text: true },
        price: { selector: '.price:first', text: true },
        description: { selector: '.card-description', text: true },
        inStock: { selector: '.text-success', exists: true },
        rating: { selector: '.rate', text: true },
      },
    },
    validate: (result: any) => {
      const data = result.pageData.extractedData;
      console.log('  Extracted:', JSON.stringify(data, null, 2));
      return data?.title && data?.price;
    },
  },
  {
    name: 'Multiple Products Extraction',
    url: 'https://web-scraping.dev/products',
    options: {
      extractData: {
        pageTitle: { selector: 'h1', text: true },
        products: {
          selector: '.product',
          multiple: true,
          fields: {
            name: { selector: 'h3', text: true },
            price: { selector: '.price', text: true },
            link: { selector: 'a', attribute: 'href' },
          },
        },
        productCount: { selector: '.product', multiple: true },
      },
    },
    validate: (result: any) => {
      const data = result.pageData.extractedData;
      const count = data?.productCount?.length || 0;
      console.log(`  Found ${count} products`);
      if (data?.products?.length > 0) {
        console.log(
          `  First product: ${data.products[0].name} - ${data.products[0].price}`
        );
      }
      return count > 0;
    },
  },
  {
    name: 'Form Elements Detection',
    url: 'https://web-scraping.dev/login',
    options: {
      extractData: {
        hasLoginForm: { selector: 'form', exists: true },
        formAction: { selector: 'form', attribute: 'action' },
        formMethod: { selector: 'form', attribute: 'method' },
        usernameField: {
          selector: 'input[name="username"], input[type="text"]',
          attribute: 'name',
        },
        passwordField: {
          selector: 'input[name="password"], input[type="password"]',
          attribute: 'name',
        },
        submitButton: {
          selector: 'button[type="submit"], input[type="submit"]',
          text: true,
        },
      },
    },
    validate: (result: any) => {
      const data = result.pageData.extractedData;
      console.log('  Form detection:', {
        hasForm: data?.hasLoginForm,
        method: data?.formMethod,
        username: data?.usernameField,
        password: data?.passwordField,
      });
      return data?.hasLoginForm === true;
    },
  },
];

const runComprehensiveTest = async () => {
  console.log('🚀 Spider Comprehensive Test Suite');
  console.log('='.repeat(50));

  const config = makeSpiderConfig({
    maxPages: 1,
    maxDepth: 0,
    requestDelayMs: 2000,
    userAgent: 'Spider Test Suite',
  });

  let passed = 0;
  let failed = 0;

  for (const scenario of scenarios) {
    console.log(`\n📝 ${scenario.name}`);
    console.log(`   URL: ${scenario.url}`);

    try {
      const results: any[] = [];
      const collectSink = Sink.forEach((result: any) =>
        Effect.sync(() => results.push(result))
      );

      const program = Effect.gen(function* () {
        const spider = yield* SpiderService;
        yield* spider.crawlSingle(
          scenario.url,
          collectSink as any,
          scenario.options
        );
        return results;
      });

      const crawlResults = await Effect.runPromise(
        program.pipe(
          Effect.provide(SpiderService.Default),
          Effect.provide(SpiderConfig.Live(config)),
          Effect.provide(SpiderLoggerLive)
        )
      );

      if (crawlResults.length > 0 && scenario.validate(crawlResults[0])) {
        console.log('  ✅ PASSED');
        passed++;
      } else {
        console.log('  ❌ FAILED');
        failed++;
      }
    } catch (error) {
      console.log(`  ❌ ERROR: ${error}`);
      failed++;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log('\n' + '='.repeat(50));
  console.log(`📊 Final Results: ${passed}/${scenarios.length} passed`);
  console.log('='.repeat(50));

  if (failed > 0) {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
  }
};

runComprehensiveTest().catch(console.error);
