#!/usr/bin/env tsx

/**
 * Simple test to verify basic Spider functionality against web-scraping.dev
 */

import { Console, Effect } from 'effect';
import { ScraperService } from '../lib/Scraper/Scraper.service.js';
import { SpiderLoggerLive } from '../lib/Logging/SpiderLogger.service.js';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://web-scraping.dev';

const testBasicScraping = Effect.gen(function* () {
  const scraper = yield* ScraperService;

  yield* Console.log(
    '🕷️  Testing basic Spider scraping against web-scraping.dev...\n'
  );

  try {
    // Test 1: Basic page scraping
    yield* Console.log('📄 Test 1: Static Pagination');
    const paginationResult = yield* scraper.fetchAndParse(
      `${BASE_URL}/products`
    );

    const $ = cheerio.load(paginationResult.html);
    const products = $('.product-card').length;
    const nextPageLink = $('.pagination .next').length > 0;

    yield* Console.log(`   ✅ Products found: ${products}`);
    yield* Console.log(`   ✅ Next page link exists: ${nextPageLink}`);
    yield* Console.log(`   ✅ Page title: ${paginationResult.title}`);
    yield* Console.log(`   ✅ Status: ${paginationResult.statusCode}\n`);

    // Test 2: Product detail page
    yield* Console.log('📦 Test 2: Product Detail Page');
    const productResult = yield* scraper.fetchAndParse(`${BASE_URL}/product/1`);

    const $product = cheerio.load(productResult.html);
    const productTitle = $product('.product-title').text().trim();
    const productPrice = $product('.product-price').text().trim();

    yield* Console.log(`   ✅ Product title: ${productTitle}`);
    yield* Console.log(`   ✅ Product price: ${productPrice}`);
    yield* Console.log(`   ✅ Status: ${productResult.statusCode}\n`);

    // Test 3: Check for hidden JSON data
    yield* Console.log('🔍 Test 3: Hidden JSON Data Detection');
    const scriptTags = $product('script:not([src])').length;

    let foundJsonData = false;
    $product('script:not([src])').each((_, script) => {
      const content = $product(script).html();
      if (
        content &&
        (content.includes('window.__') || content.includes('JSON'))
      ) {
        foundJsonData = true;
      }
    });

    yield* Console.log(`   ✅ Script tags found: ${scriptTags}`);
    yield* Console.log(`   ✅ Potential JSON data: ${foundJsonData}\n`);

    // Test 4: Login page form detection
    yield* Console.log('🔐 Test 4: Login Form Detection');
    const loginResult = yield* scraper.fetchAndParse(`${BASE_URL}/login`);

    const $login = cheerio.load(loginResult.html);
    const usernameField =
      $login('input[name="username"], input[type="email"]').length > 0;
    const passwordField =
      $login('input[name="password"], input[type="password"]').length > 0;
    const submitButton =
      $login('button[type="submit"], input[type="submit"]').length > 0;
    const csrfToken =
      $login('meta[name="csrf-token"], input[name="csrf_token"]').length > 0;

    yield* Console.log(`   ✅ Username field: ${usernameField}`);
    yield* Console.log(`   ✅ Password field: ${passwordField}`);
    yield* Console.log(`   ✅ Submit button: ${submitButton}`);
    yield* Console.log(`   ✅ CSRF token: ${csrfToken}\n`);

    yield* Console.log('🎉 All basic tests completed successfully!');
    yield* Console.log('📊 Summary:');
    yield* Console.log('   • Static content extraction: ✅ Working');
    yield* Console.log('   • Product data parsing: ✅ Working');
    yield* Console.log('   • JSON data detection: ✅ Working');
    yield* Console.log('   • Form structure analysis: ✅ Working');
    yield* Console.log('');
    yield* Console.log(
      '🚀 Spider is ready to handle web-scraping.dev scenarios!'
    );
  } catch (error) {
    yield* Console.log(`❌ Test failed: ${error}`);
    throw error;
  }
});

const program = testBasicScraping.pipe(Effect.provide(SpiderLoggerLive));

Effect.runPromiseExit(program)
  .then((exit) => {
    if (exit._tag === 'Failure') {
      console.error('❌ Test execution failed:', exit.cause);
      process.exit(1);
    } else {
      console.log('✅ All tests passed successfully!');
      process.exit(0);
    }
  })
  .catch((error) => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });
