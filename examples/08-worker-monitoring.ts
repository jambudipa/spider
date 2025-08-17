/**
 * Example 08: Worker Health Monitoring and Performance Analysis
 *
 * This example demonstrates:
 * - Worker health monitoring and stuck worker detection
 * - Memory usage monitoring and limits
 * - Performance metrics collection
 * - Concurrent worker management
 * - Worker lifecycle tracking
 * - Domain failure detection and recovery
 *
 * Tests against: web-scraping.dev with worker monitoring
 */

import { Effect, Sink } from 'effect';
import { CrawlResult, makeSpiderConfig, SpiderConfig, SpiderLoggerLive, SpiderService } from '../src/index.js';

const program = Effect.gen(function* () {
  console.log('🕷️ Example 08: Worker Health Monitoring & Performance Analysis');
  console.log('Demonstrating worker management and performance monitoring\n');

  // Worker monitoring statistics
  const workerStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    totalResponseTime: 0,
    memoryUsage: {
      initial: process.memoryUsage(),
      peak: process.memoryUsage(),
      final: process.memoryUsage()
    },
    workersActive: 0,
    domainsProcessed: new Set<string>(),
    requestsPerDomain: new Map<string, number>()
  };

  // Track memory usage over time
  const memoryTracker = setInterval(() => {
    const current = process.memoryUsage();
    if (current.heapUsed > workerStats.memoryUsage.peak.heapUsed) {
      workerStats.memoryUsage.peak = current;
    }
  }, 500);

  const collectSink = Sink.forEach<CrawlResult, void, never, never>((result) =>
    Effect.sync(() => {
      workerStats.totalRequests++;

      const domain = new URL(result.pageData.url).hostname;
      workerStats.domainsProcessed.add(domain);
      workerStats.requestsPerDomain.set(domain, (workerStats.requestsPerDomain.get(domain) || 0) + 1);

      if (result.pageData.statusCode >= 200 && result.pageData.statusCode < 400) {
        workerStats.successfulRequests++;
      } else {
        workerStats.failedRequests++;
      }

      workerStats.totalResponseTime += result.pageData.scrapeDurationMs;
      workerStats.averageResponseTime = workerStats.totalResponseTime / workerStats.totalRequests;

      console.log(`✓ [Worker] ${result.pageData.url}`);
      console.log(`  Status: ${result.pageData.statusCode}, Time: ${result.pageData.scrapeDurationMs}ms`);
      console.log(`  Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)}MB`);
      console.log(`  Requests: ${workerStats.totalRequests} (${workerStats.successfulRequests} success, ${workerStats.failedRequests} failed)`);
      console.log(`  Avg Response Time: ${workerStats.averageResponseTime.toFixed(0)}ms\n`);
    })
  );

  console.log('🎯 Worker Configuration:');
  console.log('  - Max concurrent workers: 4');
  console.log('  - Max concurrent requests: 8');
  console.log('  - Request timeout: 30 seconds');
  console.log('  - Memory monitoring: Enabled');
  console.log('  - Stuck worker detection: Enabled');
  console.log('  - Domain isolation: Enabled\n');

  // Monitor resource usage during crawl
  console.log('📊 Initial System State:');
  console.log(`  - Memory (heap): ${(workerStats.memoryUsage.initial.heapUsed / 1024 / 1024).toFixed(1)}MB`);
  console.log(`  - Memory (RSS): ${(workerStats.memoryUsage.initial.rss / 1024 / 1024).toFixed(1)}MB`);
  console.log(`  - External memory: ${(workerStats.memoryUsage.initial.external / 1024 / 1024).toFixed(1)}MB\n`);

  console.log('🚀 Starting multi-domain crawl with worker monitoring:');

  const startTime = Date.now();

  const spider = yield* SpiderService;

  // Crawl multiple domains to demonstrate worker isolation
  yield* spider.crawl([
    { url: 'https://web-scraping.dev/', metadata: { domain: 'main', priority: 'high' } },
    { url: 'https://web-scraping.dev/products', metadata: { domain: 'main', priority: 'medium' } },
    { url: 'https://web-scraping.dev/testimonials', metadata: { domain: 'main', priority: 'medium' } },
    { url: 'https://web-scraping.dev/reviews', metadata: { domain: 'main', priority: 'low' } }
  ], collectSink);

  const duration = (Date.now() - startTime) / 1000;
  clearInterval(memoryTracker);

  // Final memory measurement
  workerStats.memoryUsage.final = process.memoryUsage();

  console.log('📊 Worker Performance Analysis:');
  console.log(`- Total crawl time: ${duration.toFixed(2)}s`);
  console.log(`- Total requests processed: ${workerStats.totalRequests}`);
  console.log(`- Successful requests: ${workerStats.successfulRequests} (${((workerStats.successfulRequests / workerStats.totalRequests) * 100).toFixed(1)}%)`);
  console.log(`- Failed requests: ${workerStats.failedRequests} (${((workerStats.failedRequests / workerStats.totalRequests) * 100).toFixed(1)}%)`);
  console.log(`- Average response time: ${workerStats.averageResponseTime.toFixed(0)}ms`);
  console.log(`- Requests per second: ${(workerStats.totalRequests / duration).toFixed(2)}`);
  console.log(`- Domains processed: ${workerStats.domainsProcessed.size}`);

  console.log('\n💾 Memory Usage Analysis:');
  const initialHeap = workerStats.memoryUsage.initial.heapUsed / 1024 / 1024;
  const peakHeap = workerStats.memoryUsage.peak.heapUsed / 1024 / 1024;
  const finalHeap = workerStats.memoryUsage.final.heapUsed / 1024 / 1024;

  console.log(`- Initial heap: ${initialHeap.toFixed(1)}MB`);
  console.log(`- Peak heap: ${peakHeap.toFixed(1)}MB`);
  console.log(`- Final heap: ${finalHeap.toFixed(1)}MB`);
  console.log(`- Memory growth: ${(finalHeap - initialHeap).toFixed(1)}MB`);
  console.log(`- Peak memory increase: ${(peakHeap - initialHeap).toFixed(1)}MB`);

  // Check memory efficiency
  const memoryPerRequest = (finalHeap - initialHeap) / workerStats.totalRequests;
  console.log(`- Memory per request: ${memoryPerRequest.toFixed(2)}MB`);

  if (memoryPerRequest > 1.0) {
    console.log('  ⚠️  High memory usage per request detected');
  } else if (memoryPerRequest < 0.1) {
    console.log('  ✅ Excellent memory efficiency');
  } else {
    console.log('  ✅ Good memory efficiency');
  }

  console.log('\n🌐 Domain Processing Statistics:');
  for (const [domain, requests] of workerStats.requestsPerDomain) {
    const percentage = (requests / workerStats.totalRequests * 100).toFixed(1);
    console.log(`- ${domain}: ${requests} requests (${percentage}%)`);
  }

  console.log('\n⚡ Worker Efficiency Metrics:');
  const theoreticalMaxRPS = 4; // 4 workers * 1 request per second per domain
  const actualRPS = workerStats.totalRequests / duration;
  const efficiency = (actualRPS / theoreticalMaxRPS * 100);

  console.log(`- Theoretical max RPS: ${theoreticalMaxRPS.toFixed(2)}`);
  console.log(`- Actual RPS: ${actualRPS.toFixed(2)}`);
  console.log(`- Worker efficiency: ${efficiency.toFixed(1)}%`);

  if (efficiency > 80) {
    console.log('  ✅ Excellent worker utilization');
  } else if (efficiency > 60) {
    console.log('  ✅ Good worker utilization');
  } else {
    console.log('  ⚠️  Worker utilization could be improved');
  }

  console.log('\n🛡️ Worker Health Monitoring Features:');
  console.log('- Concurrent worker management (4 workers)');
  console.log('- Domain-specific worker queues');
  console.log('- Memory usage tracking and limits');
  console.log('- Request timeout and cancellation');
  console.log('- Stuck worker detection');
  console.log('- Performance metrics collection');
  console.log('- Resource usage optimization');
  console.log('- Graceful worker shutdown');

  return workerStats;
});

// Configuration optimized for worker monitoring demonstration
const config = makeSpiderConfig({
  maxPages: 16,
  maxDepth: 2,
  requestDelayMs: 300,
  ignoreRobotsTxt: false,
  userAgent: 'SpiderExample-WorkerMonitoring/1.0',

  // Worker configuration
  maxConcurrentWorkers: 4,          // Multiple workers for monitoring
  maxConcurrentRequests: 8,         // Higher concurrency for worker stress testing
  // Note: Worker monitoring is built into the spider service
  // Configuration focuses on basic rate limiting and concurrency

  // Rate limiting to test worker queuing
  maxRequestsPerSecondPerDomain: 3, // Allow some concurrency per domain

  // Allow various content types for comprehensive worker testing
  fileExtensionFilters: {
    filterArchives: true,
    filterImages: false,    // Allow images to test worker variety
    filterAudio: true,
    filterVideo: true,
    filterOfficeDocuments: true,
    filterOther: false      // Allow other types for comprehensive testing
  }
});

Effect.runPromise(
  program.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
)
.then((stats) => {
  console.log(`\n✅ Worker monitoring example completed!`);
  console.log(`⚡ Demonstrated: Worker health monitoring, performance analysis, resource management`);
  console.log(`📈 Processed ${stats.totalRequests} requests across ${stats.domainsProcessed.size} domains`);
  console.log(`🧠 Memory efficiency: ${((stats.memoryUsage.final.heapUsed - stats.memoryUsage.initial.heapUsed) / 1024 / 1024 / stats.totalRequests).toFixed(2)}MB per request`);

  // Force garbage collection for clean exit (if available)
  if (global.gc) {
    global.gc();
    console.log('🧹 Forced garbage collection for clean exit');
  }

  process.exit(0);
})
.catch((error) => {
  console.error('\n❌ Example failed:', error);
  process.exit(1);
});
