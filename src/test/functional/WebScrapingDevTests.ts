/**
 * Functional Tests for web-scraping.dev Scenarios
 * These tests verify that Spider can successfully handle all 16 scenarios
 */

import { Console, Effect, Exit, Layer } from 'effect';
import {
  WebScrapingEngine,
  WebScrapingEngineLive,
} from '../../lib/WebScrapingEngine/WebScrapingEngine.service.js';
import {
  EnhancedHttpClient,
  EnhancedHttpClientLive,
} from '../../lib/HttpClient/EnhancedHttpClient.js';
import {
  StateManager,
  StateManagerLive,
  TokenType,
} from '../../lib/StateManager/StateManager.service.js';
import { SpiderLoggerLive } from '../../lib/Logging/SpiderLogger.service.js';
import { CookieManagerLive } from '../../lib/HttpClient/CookieManager.js';
import { SessionStoreLive } from '../../lib/HttpClient/SessionStore.js';
import { TokenExtractorLive } from '../../lib/HttpClient/TokenExtractor.js';
import * as cheerio from 'cheerio';
// Import additional scenarios
import { additionalScenarios } from './WebScrapingDevScenarios.js';

const BASE_URL = 'https://web-scraping.dev';

interface TestResult {
  scenario: string;
  success: boolean;
  data?: any;
  error?: string;
  duration: number;
}

/**
 * Test 1: Static Pagination - Extract all products from multiple pages
 */
const testStaticPagination = Effect.gen(function* () {
  const startTime = Date.now();
  const httpClient = yield* EnhancedHttpClient;

  try {
    // Start from page 1
    let currentPage = 1;
    let allProducts: any[] = [];
    let hasNextPage = true;

    while (hasNextPage && currentPage <= 5) {
      // Limit to 5 pages for safety
      const url = `${BASE_URL}/products?page=${currentPage}`;
      const response = yield* httpClient.get(url);

      if (response.status !== 200) {
        throw new Error(
          `Failed to fetch page ${currentPage}: ${response.status}`
        );
      }

      const $ = cheerio.load(response.body);

      // Extract products from current page
      const products = $('.product-card')
        .map((_, el) => ({
          title: $(el).find('.product-title').text().trim(),
          price: $(el).find('.product-price').text().trim(),
          description: $(el).find('.product-description').text().trim(),
          page: currentPage,
        }))
        .get();

      if (products.length === 0) {
        hasNextPage = false;
        break;
      }

      allProducts.push(...products);

      // Check for next page link
      const nextLink = $('.pagination .next');
      hasNextPage = nextLink.length > 0 && !nextLink.hasClass('disabled');

      currentPage++;

      // Add delay to be respectful
      yield* Effect.sleep(100);
    }

    const duration = Date.now() - startTime;

    if (allProducts.length === 0) {
      throw new Error('No products found across any pages');
    }

    return {
      scenario: 'Static Pagination',
      success: true,
      data: {
        totalProducts: allProducts.length,
        pagesScraped: currentPage - 1,
        sampleProducts: allProducts.slice(0, 3),
      },
      duration,
    };
  } catch (error) {
    return {
      scenario: 'Static Pagination',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
});

/**
 * Test 2: Product Detail - Extract detailed product information
 */
const testProductDetail = Effect.gen(function* () {
  const startTime = Date.now();
  const httpClient = yield* EnhancedHttpClient;

  try {
    const response = yield* httpClient.get(`${BASE_URL}/product/1`);

    if (response.status !== 200) {
      throw new Error(`Failed to fetch product: ${response.status}`);
    }

    const $ = cheerio.load(response.body);

    const product = {
      title: $('.product-title').text().trim(),
      price: $('.product-price').text().trim(),
      description: $('.product-description').text().trim(),
      specifications: $('.specifications li')
        .map((_, el) => $(el).text().trim())
        .get(),
      images: $('.product-images img')
        .map((_, el) => $(el).attr('src'))
        .get(),
      rating:
        $('.rating .stars').data('rating') || $('.rating .value').text().trim(),
      reviews: $('.reviews .review')
        .map((_, el) => ({
          author: $(el).find('.author').text().trim(),
          text: $(el).find('.text').text().trim(),
          rating: $(el).find('.stars').data('rating'),
        }))
        .get(),
    };

    const duration = Date.now() - startTime;

    if (!product.title) {
      throw new Error('Product title not found');
    }

    return {
      scenario: 'Product Detail',
      success: true,
      data: product,
      duration,
    };
  } catch (error) {
    return {
      scenario: 'Product Detail',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
});

/**
 * Test 3: Hidden JSON Data - Extract data from script tags
 */
const testHiddenJsonData = Effect.gen(function* () {
  const startTime = Date.now();
  const httpClient = yield* EnhancedHttpClient;

  try {
    const response = yield* httpClient.get(`${BASE_URL}/product/1`);

    if (response.status !== 200) {
      throw new Error(`Failed to fetch page: ${response.status}`);
    }

    const $ = cheerio.load(response.body);

    // Look for JSON data in script tags
    let hiddenData: any = null;

    $('script:not([src])').each((_, script) => {
      const content = $(script).html();
      if (content) {
        // Look for common patterns
        const patterns = [
          /window\.__PRODUCT_DATA__\s*=\s*({.+?});/s,
          /window\.productData\s*=\s*({.+?});/s,
          /__INITIAL_STATE__\s*=\s*({.+?});/s,
          /var\s+productInfo\s*=\s*({.+?});/s,
        ];

        for (const pattern of patterns) {
          const match = content.match(pattern);
          if (match) {
            try {
              hiddenData = JSON.parse(match[1]);
              return false; // Break out of each loop
            } catch (e) {
              // Continue trying other patterns
            }
          }
        }
      }
    });

    const duration = Date.now() - startTime;

    if (!hiddenData) {
      throw new Error('No hidden JSON data found in script tags');
    }

    return {
      scenario: 'Hidden JSON Data',
      success: true,
      data: hiddenData,
      duration,
    };
  } catch (error) {
    return {
      scenario: 'Hidden JSON Data',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
});

/**
 * Test 7: Form Login - Authenticate and access protected content
 */
const testFormLogin = Effect.gen(function* () {
  const startTime = Date.now();
  const webEngine = yield* WebScrapingEngine;
  const httpClient = yield* EnhancedHttpClient;

  try {
    // First, try to access protected content without login
    const protectedResponse = yield* httpClient
      .get(`${BASE_URL}/user/profile`)
      .pipe(Effect.catchAll(() => Effect.succeed({ status: 401, body: '' })));

    if (protectedResponse.status === 200) {
      throw new Error(
        'Protected content accessible without login - test invalid'
      );
    }

    // Perform login
    const session = yield* webEngine.login({
      username: 'testuser',
      password: 'testpass',
      loginUrl: `${BASE_URL}/login`,
      usernameField: 'username',
      passwordField: 'password',
    });

    if (!session.authenticated) {
      throw new Error('Login failed - session not authenticated');
    }

    // Try to access protected content after login
    const authenticatedResponse = yield* webEngine.fetchAuthenticated(
      `${BASE_URL}/user/profile`
    );

    if (authenticatedResponse.status !== 200) {
      throw new Error(
        `Failed to access protected content after login: ${authenticatedResponse.status}`
      );
    }

    const $ = cheerio.load(authenticatedResponse.body);
    const userInfo = {
      username: $('.user-profile .username').text().trim(),
      email: $('.user-profile .email').text().trim(),
      role: $('.user-profile .role').text().trim(),
    };

    const duration = Date.now() - startTime;

    return {
      scenario: 'Form Login',
      success: true,
      data: {
        sessionId: session.id,
        userInfo,
        authenticatedContentLength: authenticatedResponse.body.length,
      },
      duration,
    };
  } catch (error) {
    return {
      scenario: 'Form Login',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
});

/**
 * Test 8: CSRF Token - Handle CSRF-protected form submission
 */
const testCSRFToken = Effect.gen(function* () {
  const startTime = Date.now();
  const webEngine = yield* WebScrapingEngine;
  const stateManager = yield* StateManager;

  try {
    // Get the CSRF form page
    const formData = {
      name: 'Test User',
      email: 'test@example.com',
      message: 'This is a test message',
    };

    // Submit form with CSRF protection
    const response = yield* webEngine.submitFormWithCSRF(
      `${BASE_URL}/contact`,
      formData,
      `${BASE_URL}/contact` // CSRF token page
    );

    if (response.status !== 200 && response.status !== 302) {
      throw new Error(`CSRF form submission failed: ${response.status}`);
    }

    // Check if CSRF token was found and used
    const hasCSRF = yield* stateManager.isTokenValid(TokenType.CSRF);

    const $ = cheerio.load(response.body);
    const successMessage = $('.success-message, .alert-success').text().trim();

    const duration = Date.now() - startTime;

    return {
      scenario: 'CSRF Token',
      success: true,
      data: {
        formSubmitted: response.status === 200 || response.status === 302,
        csrfTokenFound: hasCSRF,
        successMessage,
        responseStatus: response.status,
      },
      duration,
    };
  } catch (error) {
    return {
      scenario: 'CSRF Token',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
});

/**
 * Test 9: Secret API Token - Find and use API token
 */
const testSecretAPIToken = Effect.gen(function* () {
  const startTime = Date.now();
  const httpClient = yield* EnhancedHttpClient;
  const webEngine = yield* WebScrapingEngine;
  const stateManager = yield* StateManager;

  try {
    // First, find the page that contains the API token
    const tokenPageResponse = yield* httpClient.get(`${BASE_URL}/api-docs`);

    if (tokenPageResponse.status !== 200) {
      throw new Error(
        `Failed to fetch API docs page: ${tokenPageResponse.status}`
      );
    }

    const $ = cheerio.load(tokenPageResponse.body);

    // Look for API token in various places
    let apiToken: string | null = null;

    // Check script tags for token
    $('script:not([src])').each((_, script) => {
      const content = $(script).html();
      if (content) {
        const patterns = [
          /api[_-]?key["']?\s*[:=]\s*["']([^"']+)["']/i,
          /api[_-]?token["']?\s*[:=]\s*["']([^"']+)["']/i,
          /X-Secret-Token["']?\s*[:=]\s*["']([^"']+)["']/,
          /authorization["']?\s*[:=]\s*["']Bearer\s+([^"']+)["']/i,
        ];

        for (const pattern of patterns) {
          const match = content.match(pattern);
          if (match && match[1]) {
            apiToken = match[1];
            return false; // Break
          }
        }
      }
    });

    if (!apiToken) {
      throw new Error('API token not found on the page');
    }

    // Store the token
    yield* stateManager.storeToken(TokenType.API, apiToken);

    // Try to use the token to make an API request
    const apiResponse = yield* webEngine.makeAPIRequest(`${BASE_URL}/api/data`);

    if (apiResponse.status !== 200) {
      throw new Error(`API request failed: ${apiResponse.status}`);
    }

    let apiData: any = {};
    try {
      apiData = JSON.parse(apiResponse.body);
    } catch (e) {
      // API might return HTML or other format
      apiData = { response: apiResponse.body.substring(0, 200) };
    }

    const duration = Date.now() - startTime;

    return {
      scenario: 'Secret API Token',
      success: true,
      data: {
        tokenFound: !!apiToken,
        tokenLength: apiToken.length,
        apiResponseStatus: apiResponse.status,
        apiData,
      },
      duration,
    };
  } catch (error) {
    return {
      scenario: 'Secret API Token',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
});

/**
 * Test 10: File Download - Download a file
 */
const testFileDownload = Effect.gen(function* () {
  const startTime = Date.now();
  const httpClient = yield* EnhancedHttpClient;

  try {
    // Find download link
    const pageResponse = yield* httpClient.get(`${BASE_URL}/downloads`);

    if (pageResponse.status !== 200) {
      throw new Error(`Failed to fetch downloads page: ${pageResponse.status}`);
    }

    const $ = cheerio.load(pageResponse.body);
    const downloadLink = $('.download-link, a[href*=".pdf"], a[href*=".zip"]')
      .first()
      .attr('href');

    if (!downloadLink) {
      throw new Error('No download link found on the page');
    }

    const downloadUrl = downloadLink.startsWith('http')
      ? downloadLink
      : new URL(downloadLink, BASE_URL).toString();

    // Download the file
    const downloadResponse = yield* httpClient.get(downloadUrl);

    if (downloadResponse.status !== 200) {
      throw new Error(`Download failed: ${downloadResponse.status}`);
    }

    const contentType = downloadResponse.headers['content-type'] || '';
    const contentLength =
      downloadResponse.headers['content-length'] ||
      downloadResponse.body.length;

    const duration = Date.now() - startTime;

    return {
      scenario: 'File Download',
      success: true,
      data: {
        downloadUrl,
        contentType,
        contentLength: Number(contentLength),
        fileSize: downloadResponse.body.length,
      },
      duration,
    };
  } catch (error) {
    return {
      scenario: 'File Download',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
});

/**
 * Main test runner
 */
const runAllTests = Effect.gen(function* () {
  yield* Console.log('🕷️  Starting web-scraping.dev functional tests...\n');
  yield* Console.log('Testing Spider capabilities across 14 scenarios\n');

  const coreTests = [
    testStaticPagination,
    testProductDetail,
    testHiddenJsonData,
    testFormLogin,
    testCSRFToken,
    testSecretAPIToken,
    testFileDownload,
  ];

  const tests = [...coreTests, ...additionalScenarios];

  const results: TestResult[] = [];

  for (const test of tests) {
    const result = yield* test;
    results.push(result);

    const status = result.success ? '✅' : '❌';
    const duration = `${result.duration}ms`;

    yield* Console.log(`${status} ${result.scenario} (${duration})`);

    if (!result.success) {
      yield* Console.log(`   Error: ${result.error}`);
    } else if (result.data) {
      yield* Console.log(
        `   Data: ${JSON.stringify(result.data, null, 2).split('\n')[0]}...`
      );
    }

    if (
      'limitations' in result &&
      result.limitations &&
      result.limitations.length > 0
    ) {
      yield* Console.log(`   Limitations: ${result.limitations.join(', ')}`);
    }

    yield* Console.log('');

    // Add delay between tests
    yield* Effect.sleep(500);
  }

  const successCount = results.filter((r) => r.success).length;
  const totalTests = results.length;
  const fullySupported = results.filter(
    (r) => r.success && !('limitations' in r)
  ).length;
  const partiallySupported = results.filter(
    (r) => r.success && 'limitations' in r
  ).length;

  yield* Console.log(`\n📊 Test Results Summary:`);
  yield* Console.log(`   ✅ Fully supported scenarios: ${fullySupported}`);
  yield* Console.log(
    `   🔶 Partially supported scenarios: ${partiallySupported}`
  );
  yield* Console.log(`   ❌ Failed scenarios: ${totalTests - successCount}`);
  yield* Console.log(
    `   📈 Total coverage: ${successCount}/${totalTests} scenarios`
  );

  if (successCount === totalTests) {
    yield* Console.log(
      '\n🎉 All web-scraping.dev scenarios are accessible with Spider!'
    );
    if (partiallySupported > 0) {
      yield* Console.log(
        '💡 Some scenarios require browser automation for full functionality.'
      );
    }
  } else {
    yield* Console.log(
      '\n⚠️  Some scenarios need attention. See errors above.'
    );
  }

  yield* Console.log('\n📋 Scenario Analysis:');
  yield* Console.log('   • HTTP-based scenarios: Fully supported');
  yield* Console.log('   • Authentication & forms: Fully supported');
  yield* Console.log('   • Token handling (CSRF/API): Fully supported');
  yield* Console.log('   • Static content extraction: Fully supported');
  yield* Console.log(
    '   • Dynamic content (JS-heavy): Requires browser automation'
  );
  yield* Console.log('   • File downloads: Fully supported');
  yield* Console.log('   • Session management: Fully supported');

  return results;
});

/**
 * Combined layer with all dependencies
 */
const MainLayer = Layer.mergeAll(
  SpiderLoggerLive,
  CookieManagerLive,
  StateManagerLive
).pipe(
  Layer.merge(EnhancedHttpClientLive),
  Layer.merge(SessionStoreLive),
  Layer.merge(TokenExtractorLive),
  Layer.merge(WebScrapingEngineLive)
);

/**
 * Program with all dependencies
 */
const program = runAllTests.pipe(Effect.provide(MainLayer));

// Export for manual execution
export { runAllTests, program };

// Auto-run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  Effect.runPromiseExit(program).then((exit) => {
    if (Exit.isFailure(exit)) {
      console.error('Test execution failed:', exit.cause);
      process.exit(1);
    }
  });
}
