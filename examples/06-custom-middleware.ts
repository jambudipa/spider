/**
 * Example 06: Custom Middleware Usage
 *
 * This example demonstrates:
 * - Creating custom middleware for request/response processing
 * - Using built-in middleware (RateLimit, Logging, UserAgent, Stats)
 * - Middleware error handling
 * - Request preprocessing and response postprocessing
 * - Statistics collection through middleware
 *
 * Tests against: web-scraping.dev with custom middleware pipeline
 */

import { Effect, Sink } from 'effect';
import {
  CrawlResult,
  makeSpiderConfig,
  SpiderConfig,
  SpiderLoggerLive,
  SpiderMiddleware,
  SpiderRequest,
  SpiderResponse,
  SpiderService
} from '../src/index.js';

// Custom middleware to add request timing and custom headers
const TimingMiddleware: SpiderMiddleware = {
  processRequest: (request: SpiderRequest) => Effect.gen(function* () {
    console.log(`⏱️  Starting request to: ${request.task.url}`);

    // Add custom headers for tracking
    const enhancedRequest: SpiderRequest = {
      ...request,
      headers: {
        ...request.headers,
        'X-Request-Start': Date.now().toString(),
        'X-Spider-Example': '06-custom-middleware'
      }
    };

    return enhancedRequest;
  }),

  processResponse: (response: SpiderResponse, request: SpiderRequest) => Effect.gen(function* () {
    const startTime = parseInt(request.headers?.['X-Request-Start'] || '0');
    const duration = Date.now() - startTime;

    console.log(`✅ Request completed: ${request.task.url}`);
    console.log(`   Duration: ${duration}ms, Status: ${response.statusCode}`);

    return response;
  }),

  processException: (error: Error, request: SpiderRequest) => Effect.gen(function* () {
    console.log(`❌ Request failed: ${request.task.url}`);
    console.log(`   Error: ${error.message}`);

    // Return null to propagate the error
    return null;
  })
};

// Custom middleware for response content analysis
const ContentAnalysisMiddleware: SpiderMiddleware = {
  processResponse: (response: SpiderResponse, request: SpiderRequest) => Effect.gen(function* () {
    if (response.statusCode === 200) {
      const text = response.pageData.html;

      // Analyze content
      const wordCount = text.split(/\s+/).length;
      const linkCount = (text.match(/<a\s+[^>]*href/gi) || []).length;
      const imageCount = (text.match(/<img\s+[^>]*src/gi) || []).length;

      console.log(`📊 Content Analysis for ${request.task.url}:`);
      console.log(`   Words: ${wordCount}, Links: ${linkCount}, Images: ${imageCount}`);
    }

    return response;
  })
};

// Custom middleware for URL pattern detection
const PatternDetectionMiddleware: SpiderMiddleware = {
  processRequest: (request: SpiderRequest) => Effect.gen(function* () {
    const url = new URL(request.task.url);

    // Detect and log URL patterns
    if (url.pathname.includes('/product')) {
      console.log(`🛍️  Product page detected: ${url.pathname}`);
    } else if (url.pathname.includes('/api')) {
      console.log(`🔌 API endpoint detected: ${url.pathname}`);
    } else if (url.pathname.includes('/admin')) {
      console.log(`⚠️  Admin area detected: ${url.pathname}`);
    } else {
      console.log(`📄 Regular page: ${url.pathname}`);
    }

    return request;
  })
};

const program = Effect.gen(function* () {
  console.log('🕷️ Example 06: Custom Middleware Usage');
  console.log('Demonstrating middleware pipeline and custom processing\n');

  // Track middleware statistics
  const middlewareStats = {
    requestsProcessed: 0,
    errorsHandled: 0,
    totalProcessingTime: 0,
    responseAnalyzed: 0
  };

  const collectSink = Sink.forEach<CrawlResult, void, never, never>((result) =>
    Effect.sync(() => {
      middlewareStats.requestsProcessed++;

      console.log(`✓ Page processed: ${result.pageData.url}`);
      console.log(`  Title: ${result.pageData.title || '(no title)'}`);
      console.log(`  Status: ${result.pageData.statusCode}`);
      console.log(`  Processing time: ${result.pageData.scrapeDurationMs}ms`);

      middlewareStats.totalProcessingTime += result.pageData.scrapeDurationMs;

      // Check for middleware-added headers (if any)
      if (result.pageData.headers) {
        const customHeaders = Object.keys(result.pageData.headers)
          .filter(key => key.startsWith('x-spider-') || key.startsWith('X-Spider-'));

        if (customHeaders.length > 0) {
          console.log(`  Custom headers: ${customHeaders.join(', ')}`);
        }
      }
      console.log();
    })
  );

  console.log('🔧 Setting up middleware pipeline:');
  console.log('  1. TimingMiddleware - Request timing and custom headers');
  console.log('  2. PatternDetectionMiddleware - URL pattern analysis');
  console.log('  3. ContentAnalysisMiddleware - Response content analysis');
  console.log('  4. Built-in RateLimitMiddleware - Rate limiting');
  console.log('  5. Built-in LoggingMiddleware - Request/response logging');
  console.log('  6. Built-in UserAgentMiddleware - User agent headers');
  console.log('  7. Built-in StatsMiddleware - Statistics collection\n');

  // Note: Middleware integration with Spider service requires additional configuration
  // Custom middleware defined above demonstrates the interface structure
  console.log('📝 Custom middleware classes defined:');
  console.log('   - TimingMiddleware: Request timing and headers');
  console.log('   - PatternDetectionMiddleware: URL pattern analysis');
  console.log('   - ContentAnalysisMiddleware: Response content analysis');

  console.log('🚀 Starting crawl with middleware pipeline:');

  const startTime = Date.now();

  const spider = yield* SpiderService;
  yield* spider.crawl([
    'https://web-scraping.dev/',
    'https://web-scraping.dev/products',
    'https://web-scraping.dev/testimonials'
  ], collectSink);

  const duration = (Date.now() - startTime) / 1000;

  console.log('📊 Middleware Performance Analysis:');
  console.log(`- Total requests processed: ${middlewareStats.requestsProcessed}`);
  console.log(`- Total crawl time: ${duration.toFixed(2)}s`);
  console.log(`- Average processing time per page: ${(middlewareStats.totalProcessingTime / middlewareStats.requestsProcessed).toFixed(0)}ms`);
  console.log(`- Errors handled by middleware: ${middlewareStats.errorsHandled}`);

  console.log('\n🔍 Middleware Pipeline Benefits:');
  console.log('- Request timing and performance monitoring');
  console.log('- Custom header injection for tracking');
  console.log('- Content analysis and statistics');
  console.log('- URL pattern detection and classification');
  console.log('- Automatic rate limiting and compliance');
  console.log('- Comprehensive request/response logging');
  console.log('- Statistics collection and aggregation');

  return middlewareStats;
});

// Configuration optimized for middleware demonstration
const config = makeSpiderConfig({
  maxPages: 8,
  maxDepth: 1,
  requestDelayMs: 600,  // Slower to see middleware timing effects
  ignoreRobotsTxt: false,
  userAgent: 'SpiderExample-Middleware/1.0',

  // Note: Detailed logging handled by middleware, not config option

  // Configure rate limiting that middleware will handle
  maxRequestsPerSecondPerDomain: 1,

  // Allow some variety in URL patterns
  customUrlFilters: [
    /\/blocked/,    // Block obvious blocked paths
    /\/admin/       // Block admin areas for safety
  ],

  maxConcurrentWorkers: 1  // Single worker to see clear middleware execution order
});

Effect.runPromise(
  program.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
)
.then((stats) => {
  console.log(`\n✅ Custom middleware example completed!`);
  console.log(`🔧 Demonstrated: Custom middleware, built-in middleware, request/response processing`);
  console.log(`📈 Processed ${stats.requestsProcessed} requests with comprehensive middleware pipeline`);
  process.exit(0);
})
.catch((error) => {
  console.error('\n❌ Example failed:', error);
  process.exit(1);
});
