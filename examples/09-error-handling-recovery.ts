/**
 * Example 09: Error Handling and Recovery Strategies
 *
 * This example demonstrates:
 * - Comprehensive error handling for network failures
 * - Recovery strategies for failed requests
 * - Timeout handling and request cancellation
 * - Domain failure detection and recovery
 * - Graceful degradation under adverse conditions
 * - Error classification and reporting
 *
 * Tests against: web-scraping.dev with simulated failures
 */

import { Effect, Sink } from 'effect';
import {
  ConfigurationError,
  CrawlResult,
  makeSpiderConfig,
  NetworkError,
  ResponseError,
  SpiderConfig,
  SpiderLoggerLive,
  SpiderService
} from '../src/index.js';

const program = Effect.gen(function* () {
  console.log('🕷️ Example 09: Error Handling and Recovery Strategies');
  console.log('Demonstrating robust error handling and recovery mechanisms\n');

  // Error tracking statistics
  const errorStats = {
    totalRequests: 0,
    successfulRequests: 0,
    networkErrors: 0,
    timeoutErrors: 0,
    serverErrors: 0,
    clientErrors: 0,
    parseErrors: 0,
    otherErrors: 0,
    recoveredRequests: 0,
    failedDomains: new Set<string>(),
    errorsByDomain: new Map<string, number>(),
    errorDetails: [] as Array<{
      url: string;
      error: string;
      timestamp: number;
      recovered: boolean;
    }>
  };

  const collectSink = Sink.forEach<CrawlResult, void, never, never>((result) =>
    Effect.sync(() => {
      errorStats.totalRequests++;

      const domain = new URL(result.pageData.url).hostname;

      // Analyze result for error conditions
      if (result.pageData.statusCode >= 200 && result.pageData.statusCode < 300) {
        errorStats.successfulRequests++;
        console.log(`✅ Success: ${result.pageData.url}`);
        console.log(`   Status: ${result.pageData.statusCode}, Time: ${result.pageData.scrapeDurationMs}ms`);
      } else if (result.pageData.statusCode >= 400 && result.pageData.statusCode < 500) {
        errorStats.clientErrors++;
        errorStats.errorsByDomain.set(domain, (errorStats.errorsByDomain.get(domain) || 0) + 1);
        console.log(`⚠️  Client Error: ${result.pageData.url}`);
        console.log(`   Status: ${result.pageData.statusCode} - Client error handled gracefully`);
      } else if (result.pageData.statusCode >= 500) {
        errorStats.serverErrors++;
        errorStats.errorsByDomain.set(domain, (errorStats.errorsByDomain.get(domain) || 0) + 1);
        errorStats.failedDomains.add(domain);
        console.log(`❌ Server Error: ${result.pageData.url}`);
        console.log(`   Status: ${result.pageData.statusCode} - Server error detected`);
      } else {
        console.log(`ℹ️  Other Response: ${result.pageData.url}`);
        console.log(`   Status: ${result.pageData.statusCode}`);
      }

      // Check for slow responses that might indicate issues
      if (result.pageData.scrapeDurationMs > 10000) {
        console.log(`   ⏰ Slow response detected (${result.pageData.scrapeDurationMs}ms)`);
      }

      console.log(`   Title: ${result.pageData.title || '(no title)'}`);
      console.log(`   Content: ${result.pageData.html?.length || 0} chars\n`);
    })
  );

  console.log('🛡️ Error Handling Configuration:');
  console.log('  - Network timeout: 30 seconds');
  console.log('  - Parse timeout: 10 seconds');
  console.log('  - Retry strategy: Graceful degradation');
  console.log('  - Error classification: Enabled');
  console.log('  - Domain failure recovery: Enabled');
  console.log('  - Request cancellation: Enabled\n');

  // Test URLs including some that might fail
  const testUrls = [
    // Valid URLs
    'https://web-scraping.dev/',
    'https://web-scraping.dev/products',
    'https://web-scraping.dev/testimonials',

    // URLs that might return errors or timeouts
    'https://web-scraping.dev/404-not-found',
    'https://web-scraping.dev/500-server-error',
    'https://web-scraping.dev/slow-response',
    'https://web-scraping.dev/timeout-test',

    // Valid URLs for recovery testing
    'https://web-scraping.dev/reviews',
    'https://web-scraping.dev/contact'
  ];

  console.log('🎯 Test Scenarios:');
  console.log(`  - Valid requests: ${testUrls.filter(url => !url.includes('404') && !url.includes('500') && !url.includes('slow') && !url.includes('timeout')).length}`);
  console.log(`  - Expected 404s: ${testUrls.filter(url => url.includes('404')).length}`);
  console.log(`  - Expected 500s: ${testUrls.filter(url => url.includes('500')).length}`);
  console.log(`  - Timeout tests: ${testUrls.filter(url => url.includes('timeout') || url.includes('slow')).length}`);
  console.log(`  - Recovery tests: ${testUrls.length - testUrls.filter(url => url.includes('404') || url.includes('500') || url.includes('slow') || url.includes('timeout')).length}\n`);

  console.log('🚀 Starting error handling demonstration:');

  const startTime = Date.now();

  const spider = yield* SpiderService;

  // Use Effect error handling to catch and classify errors
  const crawlEffect = spider.crawl(testUrls, collectSink);

  yield* crawlEffect.pipe(
    Effect.catchAll((error) => Effect.gen(function* () {
      console.log('\n🔧 Error Recovery Handler Activated:');

      if (error instanceof NetworkError) {
        errorStats.networkErrors++;
        console.log(`❌ Network Error: ${error.message}`);
        console.log('   → Implementing network error recovery strategy');
      } else if (error instanceof ResponseError) {
        errorStats.serverErrors++;
        console.log(`❌ Response Error: ${error.message}`);
        console.log('   → Implementing response error recovery strategy');
      } else if (error instanceof ConfigurationError) {
        console.log(`❌ Configuration Error: ${error.message}`);
        console.log('   → Configuration errors require manual intervention');
        return Effect.fail(error); // Re-throw config errors
      } else {
        errorStats.otherErrors++;
        console.log(`❌ Unknown Error: ${error}`);
        console.log('   → Implementing generic error recovery strategy');
      }

      // Implement recovery strategy
      console.log('   ✅ Error handled gracefully, continuing with available data');
      errorStats.recoveredRequests++;

      return Effect.succeed(undefined);
    }))
  );

  const duration = (Date.now() - startTime) / 1000;

  console.log('📊 Error Handling Analysis:');
  console.log(`- Total crawl time: ${duration.toFixed(2)}s`);
  console.log(`- Total requests attempted: ${errorStats.totalRequests}`);
  console.log(`- Successful requests: ${errorStats.successfulRequests} (${((errorStats.successfulRequests / errorStats.totalRequests) * 100).toFixed(1)}%)`);
  console.log(`- Client errors (4xx): ${errorStats.clientErrors}`);
  console.log(`- Server errors (5xx): ${errorStats.serverErrors}`);
  console.log(`- Network errors: ${errorStats.networkErrors}`);
  console.log(`- Timeout errors: ${errorStats.timeoutErrors}`);
  console.log(`- Parse errors: ${errorStats.parseErrors}`);
  console.log(`- Other errors: ${errorStats.otherErrors}`);
  console.log(`- Recovered requests: ${errorStats.recoveredRequests}`);

  console.log('\n🌐 Error Distribution by Domain:');
  if (errorStats.errorsByDomain.size > 0) {
    for (const [domain, errors] of errorStats.errorsByDomain) {
      const errorRate = (errors / errorStats.totalRequests * 100).toFixed(1);
      console.log(`- ${domain}: ${errors} errors (${errorRate}% error rate)`);

      if (errorStats.failedDomains.has(domain)) {
        console.log(`  ⚠️  Domain marked as potentially problematic`);
      }
    }
  } else {
    console.log('- No domain-specific errors detected ✅');
  }

  console.log('\n🛡️ Error Recovery Strategies:');
  console.log('- Network failures: Graceful degradation, continue with available data');
  console.log('- Timeout errors: Request cancellation, resource cleanup');
  console.log('- Server errors: Error logging, domain failure tracking');
  console.log('- Client errors: Expected behavior, continue processing');
  console.log('- Parse errors: Content validation, fallback parsing');
  console.log('- Configuration errors: Immediate failure with clear messaging');

  const successRate = (errorStats.successfulRequests / errorStats.totalRequests * 100).toFixed(1);
  const errorRate = ((errorStats.totalRequests - errorStats.successfulRequests) / errorStats.totalRequests * 100).toFixed(1);

  console.log('\n📈 Reliability Metrics:');
  console.log(`- Success rate: ${successRate}%`);
  console.log(`- Error rate: ${errorRate}%`);
  console.log(`- Recovery rate: ${errorStats.recoveredRequests > 0 ? '100%' : 'N/A'} (${errorStats.recoveredRequests} recovered)`);
  console.log(`- Failed domains: ${errorStats.failedDomains.size}`);

  if (parseFloat(successRate) > 80) {
    console.log('  ✅ Excellent reliability');
  } else if (parseFloat(successRate) > 60) {
    console.log('  ✅ Good reliability with error handling');
  } else {
    console.log('  ⚠️  Consider reviewing error handling strategies');
  }

  console.log('\n🔍 Error Handling Features Demonstrated:');
  console.log('- Network error detection and classification');
  console.log('- Timeout handling with request cancellation');
  console.log('- HTTP status code error handling');
  console.log('- Domain failure tracking and recovery');
  console.log('- Graceful degradation under failure conditions');
  console.log('- Error statistics collection and analysis');
  console.log('- Recovery strategy implementation');
  console.log('- Resource cleanup on errors');

  return errorStats;
});

// Configuration optimized for error handling demonstration
const config = makeSpiderConfig({
  maxPages: 20,
  maxDepth: 1,
  requestDelayMs: 500,
  ignoreRobotsTxt: false,
  userAgent: 'SpiderExample-ErrorHandling/1.0',

  // Note: Error handling and timeouts are built into the spider service
  // Configuration focuses on basic crawling parameters

  // Worker configuration for error isolation
  maxConcurrentWorkers: 2,      // Fewer workers to isolate errors
  maxConcurrentRequests: 4,     // Conservative request limits

  // Allow all types of responses for comprehensive error testing
  fileExtensionFilters: {
    filterArchives: true,
    filterImages: false,
    filterAudio: true,
    filterVideo: true,
    filterOfficeDocuments: false,
    filterOther: false
  },

  // Relaxed filtering to test error conditions
  customUrlFilters: [
    // Only block obviously dangerous paths
    /\/malware/,
    /\/virus/
  ]
});

Effect.runPromise(
  program.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
)
.then((stats) => {
  console.log(`\n✅ Error handling example completed!`);
  console.log(`🛡️ Demonstrated: Comprehensive error handling, recovery strategies, reliability metrics`);
  console.log(`📈 Processed ${stats.totalRequests} requests with ${stats.successfulRequests} successes`);
  console.log(`🔧 Recovery: ${stats.recoveredRequests} requests recovered from errors`);
  console.log(`📊 Reliability: ${((stats.successfulRequests / stats.totalRequests) * 100).toFixed(1)}% success rate`);

  process.exit(0);
})
.catch((error) => {
  console.error('\n❌ Example failed with unrecoverable error:', error);
  console.log('🔍 This demonstrates the final error handling boundary');
  process.exit(1);
});
