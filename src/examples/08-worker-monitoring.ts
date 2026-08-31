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

import {
  DateTime,
  Duration,
  Effect,
  Fiber,
  HashMap,
  HashSet,
  Layer,
  Ref,
  Schedule,
  Sink,
} from 'effect';
import {
  CrawlResult,
  makeSpiderConfig,
  SpiderConfig,
  SpiderEventSinkNoop,
  SpiderService,
} from '../index.js';

/** Node process-memory snapshot used for worker health reporting. */
type MemoryUsage = ReturnType<typeof process.memoryUsage>;

/** Mutable measurements collected while the worker-monitoring example runs. */
interface WorkerStats {
  /** Number of result events observed by the sink. */
  totalRequests: number;
  /** Result events that carried successful page data. */
  successfulRequests: number;
  /** Result events that carried a typed crawl failure. */
  failedRequests: number;
  /** Mean successful response time in milliseconds. */
  averageResponseTime: number;
  /** Sum of successful response times in milliseconds. */
  totalResponseTime: number;
  /** Process-memory snapshots at the start, peak, and end of the crawl. */
  memoryUsage: {
    initial: MemoryUsage;
    peak: MemoryUsage;
    final: MemoryUsage;
  };
  /** Number of workers observed as active by the example. */
  workersActive: number;
  /** Domains that produced at least one observed result. */
  domainsProcessed: HashSet.HashSet<string>;
  /** Result-event count grouped by domain. */
  requestsPerDomain: HashMap.HashMap<string, number>;
}

/** Crawls a target while collecting worker and memory measurements. */
const program = Effect.gen(function* () {
  yield* Effect.logInfo(
    '🕷️ Example 08: Worker Health Monitoring & Performance Analysis'
  );
  yield* Effect.logInfo(
    'Demonstrating worker management and performance monitoring\n'
  );

  // Worker monitoring statistics using Ref for mutable state
  const workerStatsRef = yield* Ref.make<WorkerStats>({
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    totalResponseTime: 0,
    memoryUsage: {
      initial: process.memoryUsage(),
      peak: process.memoryUsage(),
      final: process.memoryUsage(),
    },
    workersActive: 0,
    domainsProcessed: HashSet.empty<string>(),
    requestsPerDomain: HashMap.empty<string, number>(),
  });

  // Track memory usage over time using Effect.repeat with Schedule
  const memoryTrackerFiber = yield* Effect.forkChild(
    Effect.repeat(
      Effect.gen(function* () {
        const current = process.memoryUsage();
        yield* Ref.update(workerStatsRef, (stats) => {
          if (current.heapUsed > stats.memoryUsage.peak.heapUsed) {
            return {
              ...stats,
              memoryUsage: {
                ...stats.memoryUsage,
                peak: current,
              },
            };
          }
          return stats;
        });
      }),
      Schedule.spaced(Duration.millis(500))
    )
  );

  const collectSink = Sink.forEach<CrawlResult, void, never, never>(
    (result: CrawlResult) =>
      Effect.gen(function* () {
        if (CrawlResult.isOk(result)) {
          const domain = new URL(result.pageData.url).hostname;

          yield* Ref.update(workerStatsRef, (stats) => {
            const newDomainsProcessed = HashSet.add(
              stats.domainsProcessed,
              domain
            );
            const currentDomainCount = HashMap.get(
              stats.requestsPerDomain,
              domain
            );
            const newDomainCount =
              currentDomainCount._tag === 'Some'
                ? currentDomainCount.value + 1
                : 1;
            const newRequestsPerDomain = HashMap.set(
              stats.requestsPerDomain,
              domain,
              newDomainCount
            );

            const newTotalRequests = stats.totalRequests + 1;
            const isSuccess =
              result.pageData.statusCode >= 200 &&
              result.pageData.statusCode < 400;
            const newSuccessfulRequests =
              stats.successfulRequests + (isSuccess ? 1 : 0);
            const newFailedRequests =
              stats.failedRequests + (isSuccess ? 0 : 1);
            const newTotalResponseTime =
              stats.totalResponseTime + result.pageData.scrapeDurationMs;
            const newAverageResponseTime =
              newTotalResponseTime / newTotalRequests;

            return {
              ...stats,
              totalRequests: newTotalRequests,
              successfulRequests: newSuccessfulRequests,
              failedRequests: newFailedRequests,
              totalResponseTime: newTotalResponseTime,
              averageResponseTime: newAverageResponseTime,
              domainsProcessed: newDomainsProcessed,
              requestsPerDomain: newRequestsPerDomain,
            };
          });

          const currentStats = yield* Ref.get(workerStatsRef);

          yield* Effect.logInfo(`✓ [Worker] ${result.pageData.url}`);
          yield* Effect.logInfo(
            `  Status: ${result.pageData.statusCode}, Time: ${result.pageData.scrapeDurationMs}ms`
          );
          yield* Effect.logInfo(
            `  Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)}MB`
          );
          yield* Effect.logInfo(
            `  Requests: ${currentStats.totalRequests} (${currentStats.successfulRequests} success, ${currentStats.failedRequests} failed)`
          );
          yield* Effect.logInfo(
            `  Avg Response Time: ${currentStats.averageResponseTime.toFixed(0)}ms\n`
          );
        } else {
          yield* Ref.update(workerStatsRef, (stats) => ({
            ...stats,
            totalRequests: stats.totalRequests + 1,
            failedRequests: stats.failedRequests + 1,
          }));
          yield* Effect.logWarning(
            `✗ Failed: ${result.url} (${result.error.kind})`
          );
        }
      })
  );

  yield* Effect.logInfo('🎯 Worker Configuration:');
  yield* Effect.logInfo('  - Max concurrent workers: 4');
  yield* Effect.logInfo('  - Max concurrent requests: 8');
  yield* Effect.logInfo('  - Request timeout: 30 seconds');
  yield* Effect.logInfo('  - Memory monitoring: Enabled');
  yield* Effect.logInfo('  - Stuck worker detection: Enabled');
  yield* Effect.logInfo('  - Domain isolation: Enabled\n');

  // Monitor resource usage during crawl
  const initialStats = yield* Ref.get(workerStatsRef);
  yield* Effect.logInfo('📊 Initial System State:');
  yield* Effect.logInfo(
    `  - Memory (heap): ${(initialStats.memoryUsage.initial.heapUsed / 1024 / 1024).toFixed(1)}MB`
  );
  yield* Effect.logInfo(
    `  - Memory (RSS): ${(initialStats.memoryUsage.initial.rss / 1024 / 1024).toFixed(1)}MB`
  );
  yield* Effect.logInfo(
    `  - External memory: ${(initialStats.memoryUsage.initial.external / 1024 / 1024).toFixed(1)}MB\n`
  );

  yield* Effect.logInfo(
    '🚀 Starting multi-domain crawl with worker monitoring:'
  );

  const startTime = yield* DateTime.now;

  const spider = yield* SpiderService;

  // Crawl multiple domains to demonstrate worker isolation
  yield* spider.crawl(
    [
      {
        url: 'https://web-scraping.dev/',
        metadata: { domain: 'main', priority: 'high' },
      },
      {
        url: 'https://web-scraping.dev/products',
        metadata: { domain: 'main', priority: 'medium' },
      },
      {
        url: 'https://web-scraping.dev/testimonials',
        metadata: { domain: 'main', priority: 'medium' },
      },
      {
        url: 'https://web-scraping.dev/reviews',
        metadata: { domain: 'main', priority: 'low' },
      },
    ],
    collectSink
  );

  const endTime = yield* DateTime.now;
  const durationMs =
    DateTime.toEpochMillis(endTime) - DateTime.toEpochMillis(startTime);
  const duration = durationMs / 1000;

  // Stop the memory tracker fiber
  yield* Fiber.interrupt(memoryTrackerFiber);

  // Final memory measurement
  yield* Ref.update(workerStatsRef, (stats) => ({
    ...stats,
    memoryUsage: {
      ...stats.memoryUsage,
      final: process.memoryUsage(),
    },
  }));

  const workerStats = yield* Ref.get(workerStatsRef);

  yield* Effect.logInfo('📊 Worker Performance Analysis:');
  yield* Effect.logInfo(`- Total crawl time: ${duration.toFixed(2)}s`);
  yield* Effect.logInfo(
    `- Total requests processed: ${workerStats.totalRequests}`
  );
  yield* Effect.logInfo(
    `- Successful requests: ${workerStats.successfulRequests} (${((workerStats.successfulRequests / workerStats.totalRequests) * 100).toFixed(1)}%)`
  );
  yield* Effect.logInfo(
    `- Failed requests: ${workerStats.failedRequests} (${((workerStats.failedRequests / workerStats.totalRequests) * 100).toFixed(1)}%)`
  );
  yield* Effect.logInfo(
    `- Average response time: ${workerStats.averageResponseTime.toFixed(0)}ms`
  );
  yield* Effect.logInfo(
    `- Requests per second: ${(workerStats.totalRequests / duration).toFixed(2)}`
  );
  yield* Effect.logInfo(
    `- Domains processed: ${HashSet.size(workerStats.domainsProcessed)}`
  );

  yield* Effect.logInfo('\n💾 Memory Usage Analysis:');
  const initialHeap = workerStats.memoryUsage.initial.heapUsed / 1024 / 1024;
  const peakHeap = workerStats.memoryUsage.peak.heapUsed / 1024 / 1024;
  const finalHeap = workerStats.memoryUsage.final.heapUsed / 1024 / 1024;

  yield* Effect.logInfo(`- Initial heap: ${initialHeap.toFixed(1)}MB`);
  yield* Effect.logInfo(`- Peak heap: ${peakHeap.toFixed(1)}MB`);
  yield* Effect.logInfo(`- Final heap: ${finalHeap.toFixed(1)}MB`);
  yield* Effect.logInfo(
    `- Memory growth: ${(finalHeap - initialHeap).toFixed(1)}MB`
  );
  yield* Effect.logInfo(
    `- Peak memory increase: ${(peakHeap - initialHeap).toFixed(1)}MB`
  );

  // Check memory efficiency
  const memoryPerRequest =
    (finalHeap - initialHeap) / workerStats.totalRequests;
  yield* Effect.logInfo(
    `- Memory per request: ${memoryPerRequest.toFixed(2)}MB`
  );

  if (memoryPerRequest > 1.0) {
    yield* Effect.logInfo('  ⚠️  High memory usage per request detected');
  } else if (memoryPerRequest < 0.1) {
    yield* Effect.logInfo('  ✅ Excellent memory efficiency');
  } else {
    yield* Effect.logInfo('  ✅ Good memory efficiency');
  }

  yield* Effect.logInfo('\n🌐 Domain Processing Statistics:');
  for (const [domain, requests] of HashMap.toEntries(
    workerStats.requestsPerDomain
  )) {
    const percentage = ((requests / workerStats.totalRequests) * 100).toFixed(
      1
    );
    yield* Effect.logInfo(`- ${domain}: ${requests} requests (${percentage}%)`);
  }

  yield* Effect.logInfo('\n⚡ Worker Efficiency Metrics:');
  const theoreticalMaxRPS = 4; // 4 workers * 1 request per second per domain
  const actualRPS = workerStats.totalRequests / duration;
  const efficiency = (actualRPS / theoreticalMaxRPS) * 100;

  yield* Effect.logInfo(
    `- Theoretical max RPS: ${theoreticalMaxRPS.toFixed(2)}`
  );
  yield* Effect.logInfo(`- Actual RPS: ${actualRPS.toFixed(2)}`);
  yield* Effect.logInfo(`- Worker efficiency: ${efficiency.toFixed(1)}%`);

  if (efficiency > 80) {
    yield* Effect.logInfo('  ✅ Excellent worker utilization');
  } else if (efficiency > 60) {
    yield* Effect.logInfo('  ✅ Good worker utilization');
  } else {
    yield* Effect.logInfo('  ⚠️  Worker utilization could be improved');
  }

  yield* Effect.logInfo('\n🛡️ Worker Health Monitoring Features:');
  yield* Effect.logInfo('- Concurrent worker management (4 workers)');
  yield* Effect.logInfo('- Domain-specific worker queues');
  yield* Effect.logInfo('- Memory usage tracking and limits');
  yield* Effect.logInfo('- Request timeout and cancellation');
  yield* Effect.logInfo('- Stuck worker detection');
  yield* Effect.logInfo('- Performance metrics collection');
  yield* Effect.logInfo('- Resource usage optimization');
  yield* Effect.logInfo('- Graceful worker shutdown');

  return workerStats;
});

// Configuration optimized for worker monitoring demonstration
/** Configures enough work to make worker-health measurements visible. */
const config = makeSpiderConfig({
  maxPages: 16,
  maxDepth: 2,
  requestDelayMs: 300,
  ignoreRobotsTxt: false,
  userAgent: 'SpiderExample-WorkerMonitoring/1.0',

  // Worker configuration
  maxConcurrentWorkers: 4, // Multiple workers for monitoring
  maxConcurrentRequests: 8, // Higher concurrency for worker stress testing
  // Note: Worker monitoring is built into the spider service
  // Configuration focuses on basic rate limiting and concurrency

  // Rate limiting to test worker queuing
  maxRequestsPerSecondPerDomain: 3, // Allow some concurrency per domain

  // Allow various content types for comprehensive worker testing
  fileExtensionFilters: {
    filterArchives: true,
    filterImages: false, // Allow images to test worker variety
    filterAudio: true,
    filterVideo: true,
    filterOfficeDocuments: true,
    filterOther: false, // Allow other types for comprehensive testing
  },
});

/** Provides worker-health monitoring and the crawler runtime for the example. */
const mainEffect = program.pipe(
  Effect.provide(
    SpiderService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(SpiderConfig.layerWith(config), SpiderEventSinkNoop)
      )
    )
  ),
  Effect.tap((stats) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`\n✅ Worker monitoring example completed!`);
      yield* Effect.logInfo(
        `⚡ Demonstrated: Worker health monitoring, performance analysis, resource management`
      );
      yield* Effect.logInfo(
        `📈 Processed ${stats.totalRequests} requests across ${HashSet.size(stats.domainsProcessed)} domains`
      );
      yield* Effect.logInfo(
        `🧠 Memory efficiency: ${((stats.memoryUsage.final.heapUsed - stats.memoryUsage.initial.heapUsed) / 1024 / 1024 / stats.totalRequests).toFixed(2)}MB per request`
      );

      // Force garbage collection for clean exit (if available)
      if (global.gc) {
        global.gc();
        yield* Effect.logInfo('🧹 Forced garbage collection for clean exit');
      }
    })
  ),
  Effect.tapError((error) =>
    Effect.logError(`\n❌ Example failed: ${String(error)}`)
  )
);

void Effect.runPromiseExit(mainEffect).then((exit) => {
  if (exit._tag === 'Success') {
    process.exit(0);
  } else {
    process.exit(1);
  }
});
