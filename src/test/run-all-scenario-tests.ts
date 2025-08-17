/**
 * Comprehensive Test Runner for all Spider scenarios
 * Tests against real web-scraping.dev without mocking
 */

import { Effect, Sink } from 'effect';
import { SpiderService } from '../lib/Spider/Spider.service.js';
import {
  makeSpiderConfig,
  SpiderConfig,
} from '../lib/Config/SpiderConfig.service.js';
import { SpiderLoggerLive } from '../lib/Logging/SpiderLogger.service.js';

interface TestScenario {
  category: string;
  name: string;
  url: string;
  extractData?: Record<string, any>;
  validate: (result: any) => boolean;
}

const scenarios: TestScenario[] = [
  // Static Content Tests
  {
    category: 'Static Content',
    name: 'Product List Extraction',
    url: 'https://web-scraping.dev/products',
    extractData: {
      products: {
        selector: '.product',
        multiple: true,
        fields: {
          name: { selector: 'h3', text: true },
          price: { selector: '.price', text: true },
        },
      },
    },
    validate: (result) => {
      const products = result.pageData.extractedData?.products;
      return Array.isArray(products) && products.length > 0;
    },
  },
  {
    category: 'Static Content',
    name: 'Product Detail Extraction',
    url: 'https://web-scraping.dev/product/1',
    extractData: {
      title: { selector: 'h3.card-title', text: true },
      price: { selector: '.price', text: true },
      description: { selector: 'p.product-description', text: true },
      inStock: { selector: '.text-success', exists: true },
    },
    validate: (result) => {
      const data = result.pageData.extractedData;
      return !!(data?.title && data?.price);
    },
  },

  // Authentication Tests
  {
    category: 'Authentication',
    name: 'Login Form Detection',
    url: 'https://web-scraping.dev/login',
    extractData: {
      hasForm: { selector: 'form', exists: true },
      username: {
        selector: 'input[type="text"], input[name="username"]',
        attribute: 'name',
      },
      password: {
        selector: 'input[type="password"], input[name="password"]',
        attribute: 'name',
      },
      submitButton: { selector: 'button[type="submit"]', text: true },
    },
    validate: (result) => {
      const data = result.pageData.extractedData;
      return data?.hasForm === true && !!data?.username;
    },
  },

  // Dynamic Content Tests
  {
    category: 'Dynamic Content',
    name: 'JavaScript Detection',
    url: 'https://web-scraping.dev/products',
    extractData: {
      scripts: { selector: 'script', multiple: true },
      dataAttributes: { selector: '[data-product], [data-id]', multiple: true },
    },
    validate: (result) => {
      const data = result.pageData.extractedData;
      return Array.isArray(data?.scripts) && data.scripts.length > 0;
    },
  },

  // Special Content Tests
  {
    category: 'Special Content',
    name: 'Meta Tags Extraction',
    url: 'https://web-scraping.dev',
    validate: (result) => {
      const metadata = result.pageData.metadata;
      return metadata && Object.keys(metadata).length > 0;
    },
  },
  {
    category: 'Special Content',
    name: 'Links Extraction',
    url: 'https://web-scraping.dev',
    extractData: {
      navigationLinks: {
        selector: 'nav a, header a',
        multiple: true,
        fields: {
          text: { selector: '', text: true },
          href: { selector: '', attribute: 'href' },
        },
      },
    },
    validate: (result) => {
      const links = result.pageData.extractedData?.navigationLinks;
      return Array.isArray(links) && links.length > 0;
    },
  },

  // Error Handling Tests
  {
    category: 'Error Handling',
    name: 'Valid Page Error Handling',
    url: 'https://web-scraping.dev/products?page=999',
    validate: (result) => {
      // Should handle pages that exist but might have no content
      return (
        result.pageData.statusCode === 200 || result.pageData.statusCode === 404
      );
    },
  },

  // Complex Selectors
  {
    category: 'Complex Selectors',
    name: 'Nested Data Extraction',
    url: 'https://web-scraping.dev/products',
    extractData: {
      firstProduct: {
        selector: '.product:first-child',
        text: true,
      },
      allProducts: {
        selector: '.product',
        multiple: true,
      },
    },
    validate: (result) => {
      const data = result.pageData.extractedData;
      return !!data?.firstProduct && Array.isArray(data?.allProducts);
    },
  },
];

async function runScenarioTest(scenario: TestScenario): Promise<boolean> {
  try {
    const config = makeSpiderConfig({
      maxPages: 1,
      maxDepth: 0,
      requestDelayMs: 1000,
      userAgent: 'Spider Test Suite',
    });

    const results: any[] = [];
    const collectSink = Sink.forEach((result: any) =>
      Effect.sync(() => results.push(result))
    );

    const program = Effect.gen(function* () {
      const spider = yield* SpiderService;
      yield* spider.crawlSingle(scenario.url, collectSink as any, {
        extractData: scenario.extractData,
      });
      return results;
    });

    const crawlResults = await Effect.runPromise(
      program.pipe(
        Effect.provide(SpiderService.Default),
        Effect.provide(SpiderConfig.Live(config)),
        Effect.provide(SpiderLoggerLive)
      )
    );

    if (crawlResults.length === 0) {
      console.log(`  ❌ No results returned`);
      return false;
    }

    const isValid = scenario.validate(crawlResults[0]);

    if (isValid) {
      console.log(`  ✅ PASSED`);
    } else {
      console.log(`  ❌ FAILED - Validation failed`);
      console.log(
        `     Result:`,
        JSON.stringify(
          crawlResults[0].pageData.extractedData,
          null,
          2
        ).substring(0, 200)
      );
    }

    return isValid;
  } catch (error) {
    console.log(`  ❌ ERROR: ${error}`);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Spider Comprehensive Test Suite');
  console.log('   Testing against real web-scraping.dev');
  console.log('='.repeat(60));

  const categoryResults: Record<string, { passed: number; failed: number }> =
    {};
  let totalPassed = 0;
  let totalFailed = 0;

  for (const scenario of scenarios) {
    if (!categoryResults[scenario.category]) {
      categoryResults[scenario.category] = { passed: 0, failed: 0 };
      console.log(`\n📁 ${scenario.category}`);
    }

    console.log(`\n  📝 ${scenario.name}`);
    console.log(`     URL: ${scenario.url}`);

    const passed = await runScenarioTest(scenario);

    if (passed) {
      categoryResults[scenario.category].passed++;
      totalPassed++;
    } else {
      categoryResults[scenario.category].failed++;
      totalFailed++;
    }

    // Rate limit between tests
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));

  for (const [category, results] of Object.entries(categoryResults)) {
    const total = results.passed + results.failed;
    const percentage = ((results.passed / total) * 100).toFixed(0);
    console.log(
      `${category}: ${results.passed}/${total} passed (${percentage}%)`
    );
  }

  console.log('\n' + '='.repeat(60));
  console.log(
    `TOTAL: ${totalPassed}/${totalPassed + totalFailed} tests passed`
  );

  if (totalFailed === 0) {
    console.log('✅ ALL TESTS PASSED! Spider is working correctly.');
  } else {
    console.log(`⚠️  ${totalFailed} tests failed. See details above.`);
  }

  process.exit(totalFailed > 0 ? 1 : 0);
}

runAllTests().catch(console.error);
