import {
  Effect,
  Fiber,
  MutableRef,
  Option,
  PubSub,
  Queue,
  Random,
  Schedule,
  Sink,
  Stream,
} from 'effect';
import * as cheerio from 'cheerio';
import { SpiderConfig } from '../Config/SpiderConfig.service.js';
import { UrlDeduplicatorService } from '../UrlDeduplicator/UrlDeduplicator.service.js';
import { ScraperService } from '../Scraper/Scraper.service.js';
import { PageData } from '../PageData/PageData.js';
import { RobotsService } from '../Robots/Robots.service.js';
import {
  type LinkExtractorConfig,
  LinkExtractorService,
} from '../LinkExtractor/index.js';
import { SpiderSchedulerService } from '../Scheduler/SpiderScheduler.service.js';
import { StateError, ParseError } from '../errors/effect-errors.js';
import {
  SpiderLogger,
  SpiderLoggerLive,
} from '../Logging/SpiderLogger.service.js';
import { deduplicateUrls } from '../utils/url-deduplication.js';

/**
 * Represents a single crawling task with URL and depth information.
 *
 * @group Data Types
 * @public
 */
interface CrawlTask {
  /** The URL to be crawled */
  url: string;
  /** The depth level of this URL relative to the starting URL */
  depth: number;
  /** The URL from which this URL was discovered (optional) */
  fromUrl?: string;
  /** Optional metadata to be passed through to the result */
  metadata?: Record<string, unknown>;
  /** Optional data extraction configuration */
  extractData?: Record<string, any>;
}

/**
 * The result of a successful crawl operation.
 *
 * Contains all extracted information from a crawled page along with
 * metadata about when and at what depth it was processed.
 *
 * @group Data Types
 * @public
 */
interface CrawlResult {
  /** The extracted page data including content, links, and metadata */
  pageData: PageData;
  /** The depth at which this page was crawled */
  depth: number;
  /** When this page was crawled */
  timestamp: Date;
  /** Optional metadata passed through from the original request */
  metadata?: Record<string, unknown>;
}

/**
 * The main Spider service that orchestrates web crawling operations.
 *
 * This service provides the core functionality for crawling websites, including:
 * - URL validation and filtering based on configuration
 * - Robots.txt compliance checking
 * - Concurrent crawling with configurable worker pools
 * - Request scheduling and rate limiting
 * - Result streaming through Effect sinks
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const spider = yield* Spider;
 *   const collectSink = Sink.forEach<CrawlResult>(result =>
 *     Effect.sync(() => console.log(result.pageData.url))
 *   );
 *
 *   const stats = yield* spider.crawl('https://example.com', collectSink);
 *   console.log(`Crawled ${stats.totalPages} pages`);
 * });
 * ```
 *
 * @group Services
 * @public
 */
/**
 * Options for enhanced link extraction during crawling.
 *
 * @group Configuration
 * @public
 */
export interface SpiderLinkExtractionOptions {
  /** Configuration for the LinkExtractorService */
  readonly linkExtractorConfig?: LinkExtractorConfig;
  /** Whether to use enhanced extraction in addition to basic extraction (default: false) */
  readonly useEnhancedExtraction?: boolean;
  /** Whether to replace basic extraction with enhanced extraction (default: true) */
  readonly replaceBasicExtraction?: boolean;
  /** Data extraction configuration for structured data extraction */
  readonly extractData?: Record<string, any>;
}

export class SpiderService extends Effect.Service<SpiderService>()(
  '@jambudipa/spider',
  {
    effect: Effect.gen(function* () {
      const robots = yield* RobotsService;
      const scraper = yield* ScraperService;
      const logger = yield* SpiderLogger;

      // Note: SpiderConfig is resolved within the crawl method to allow runtime overrides

      const linkExtractor = yield* LinkExtractorService;

      // Try to get SpiderSchedulerService for resumability support
      const maybeScheduler = yield* Effect.serviceOption(
        SpiderSchedulerService
      );
      const scheduler = Option.isSome(maybeScheduler)
        ? maybeScheduler.value
        : null;

      const self = {
        /**
         * Starts crawling from the specified URL and processes results through the provided sink.
         *
         * This method:
         * 1. Validates the starting URL against configuration rules
         * 2. Starts a configurable number of worker fibers
         * 3. Each worker processes URLs from a shared queue
         * 4. Results are streamed through the provided sink
         * 5. New URLs discovered are queued for processing
         *
         * @param startingUrls - The starting URL(s) for crawling (single string or array)
         * @param sink - Sink to process crawl results as they're produced
         * @param options - Optional enhanced link extraction configuration
         * @returns Effect containing crawl statistics (total pages, completion status)
         *
         * @example
         * Basic usage:
         * ```typescript
         * const collectSink = Sink.forEach<CrawlResult>(result =>
         *   Effect.sync(() => console.log(`Found: ${result.pageData.title}`))
         * );
         *
         * const stats = yield* spider.crawl('https://example.com', collectSink);
         * ```
         *
         * With multiple starting URLs:
         * ```typescript
         * const stats = yield* spider.crawl([
         *   'https://example.com',
         *   'https://other-domain.com'
         * ], collectSink);
         * ```
         *
         * With enhanced link extraction:
         * ```typescript
         * const stats = yield* spider.crawl('https://example.com', collectSink, {
         *   useEnhancedExtraction: true,
         *   linkExtractorConfig: {
         *     allowPatterns: [/\/articles\//],
         *     restrictCss: ['.content a']
         *   }
         * });
         * ```
         */
        crawl: <A, E, R>(
          startingUrls:
            | string
            | string[]
            | { url: string; metadata?: Record<string, unknown> }
            | { url: string; metadata?: Record<string, unknown> }[],
          sink: Sink.Sink<A, CrawlResult, E, R>,
          options?: SpiderLinkExtractionOptions
        ) =>
          Effect.gen(function* () {
            // Get config at runtime when crawl() is called - allows custom configs to override
            const config = yield* SpiderConfig;

            if (!config) {
              return yield* Effect.fail(
                new Error('SpiderConfig is required for crawling operations')
              );
            }

            // Normalize input to array of objects with url and metadata
            const normalizeUrlInput = (
              input: typeof startingUrls
            ): { url: string; metadata?: Record<string, unknown> }[] => {
              if (typeof input === 'string') {
                return [{ url: input }];
              }
              if (Array.isArray(input)) {
                return input.map((item) =>
                  typeof item === 'string' ? { url: item } : item
                );
              }
              return [input];
            };

            const urlsWithMetadata = normalizeUrlInput(startingUrls);

            // Use Effect-based URL deduplication with configurable strategy
            const deduplicationResult = yield* deduplicateUrls(
              urlsWithMetadata,
              {
                // Strategy: Treat www and non-www as the same domain by default
                // This can be configured via Spider options if needed
                wwwHandling: 'ignore',
                protocolHandling: 'prefer-https',
                trailingSlashHandling: 'ignore',
                queryParamHandling: 'preserve',
                fragmentHandling: 'ignore'
              }
            );
            
            const deduplicatedUrls = deduplicationResult.deduplicated;
            
            // Log deduplication statistics
            if (deduplicationResult.stats.duplicates > 0) {
              yield* Effect.logInfo(
                `URL deduplication: ${deduplicationResult.stats.total} total, ` +
                `${deduplicationResult.stats.unique} unique, ` +
                `${deduplicationResult.stats.duplicates} duplicates removed`
              );
            }
            
            // Log skipped URLs for debugging
            for (const skipped of deduplicationResult.skipped) {
              yield* Effect.logDebug(`Skipped URL: ${skipped.url} - Reason: ${skipped.reason}`);
            }

            // Deduplication happens silently to prevent excessive logging

            const concurrency = yield* config.getConcurrency();

            // Check if multiple URLs are being crawled and warn about domain restrictions
            if (deduplicatedUrls.length > 1) {
              const configOptions = yield* config.getOptions();
              if (
                configOptions.allowedDomains ||
                configOptions.blockedDomains
              ) {
                console.warn(
                  'Warning: Multiple starting URLs detected with allowedDomains/blockedDomains configured. ' +
                    'Domain restrictions will be ignored - each URL will be restricted to its own domain instead.'
                );
              }
            }

            // Log spider lifecycle start
            yield* logger.logSpiderLifecycle('start', {
              totalUrls: deduplicatedUrls.length,
              urls: deduplicatedUrls.map((u) => u.url),
              originalCount: urlsWithMetadata.length,
              deduplicatedCount: deduplicatedUrls.length,
            });

            // Run each URL as a separate crawling operation with its own infrastructure
            // All domains feed results to the same sink
            // ALWAYS restrict to starting domain to prevent crawling external sites
            const restrictToStartingDomain = true;

            const results = yield* Effect.all(
              deduplicatedUrls.map(({ url, metadata }) =>
                self.crawlSingle(
                  url,
                  sink,
                  options,
                  metadata,
                  restrictToStartingDomain
                )
              ),
              { concurrency }
            );

            // Log spider lifecycle complete
            yield* logger.logSpiderLifecycle('complete', {
              totalDomains: results.length,
              totalPages: results.reduce(
                (sum, r) => sum + (r.pagesScraped || 0),
                0
              ),
            });

            // All results have been processed through the sink
            return {
              completed: true,
            };
          }),

        // Single URL crawling - each gets its own queue, workers, and deduplicator
        crawlSingle: <A, E, R>(
          urlString: string,
          sink: Sink.Sink<A, CrawlResult, E, R>,
          options?: SpiderLinkExtractionOptions,
          initialMetadata?: Record<string, unknown>,
          restrictToStartingDomain?: boolean
        ) =>
          Effect.gen(function* () {
            const config = yield* SpiderConfig;

            // Extract domain from URL
            let domain: string;
            try {
              const url = new URL(urlString);
              domain = url.hostname;
            } catch {
              domain = 'invalid-url';
            }

            // Log domain start
            yield* logger.logDomainStart(domain, urlString);

            // Create a fresh deduplicator instance for this domain
            const localDeduplicator = yield* Effect.provide(
              UrlDeduplicatorService,
              UrlDeduplicatorService.Default
            );

            const urlQueue = yield* Queue.unbounded<CrawlTask>();
            const resultPubSub = yield* PubSub.unbounded<CrawlResult>();
            const activeWorkers = MutableRef.make(0);
            const maxPagesReached = MutableRef.make(false);
            const domainCompleted = MutableRef.make(false);

            // Create semaphore for atomic queue operations (mutex with 1 permit)
            const queueMutex = yield* Effect.makeSemaphore(1);

            // Worker health monitoring system
            const workerHealthChecks = MutableRef.make<Map<string, Date>>(
              new Map()
            );

            const reportWorkerHealth = (workerId: string) =>
              Effect.sync(() => {
                const healthMap = MutableRef.get(workerHealthChecks);
                healthMap.set(workerId, new Date());
                return healthMap;
              });

            const workerHealthMonitor = Effect.gen(function* () {
              const healthMap = MutableRef.get(workerHealthChecks);
              const now = Date.now();
              const staleThreshold = 60000; // 60 seconds

              for (const [workerId, lastCheck] of healthMap) {
                const elapsed = now - lastCheck.getTime();
                if (elapsed > staleThreshold) {
                  yield* logger.logEdgeCase(domain, 'worker_death_detected', {
                    workerId,
                    lastSeen: elapsed + 'ms ago',
                    message: `DEAD WORKER: ${workerId} - No heartbeat for ${Math.round(elapsed / 1000)}s`,
                  });

                  // Remove dead worker from health tracking
                  healthMap.delete(workerId);
                }
              }
            }).pipe(
              Effect.repeat(Schedule.fixed('15 seconds')) // Check every 15 seconds
            );

            // Atomic queue manager - synchronizes queue operations with worker state using semaphore
            const queueManager = {
              // Atomic take: either returns task and increments active count, or detects completion
              takeTaskOrComplete: queueMutex.withPermits(1)(
                Effect.gen(function* () {
                  // This entire block is atomic - only one worker can execute at a time

                  // Check completion conditions first
                  const isCompleted = MutableRef.get(domainCompleted);
                  if (isCompleted) {
                    return {
                      type: 'completed' as const,
                      reason: 'already_completed',
                      wasFirstToComplete: false,
                    };
                  }

                  const hasMaxPages = MutableRef.get(maxPagesReached);
                  if (hasMaxPages) {
                    // Mark domain as completed atomically
                    const wasCompleted = MutableRef.compareAndSet(
                      domainCompleted,
                      false,
                      true
                    );
                    return {
                      type: 'completed' as const,
                      reason: 'max_pages',
                      wasFirstToComplete: wasCompleted,
                    };
                  }

                  // Use non-blocking poll instead of blocking take to prevent deadlock
                  const pollResult = yield* Queue.poll(urlQueue);

                  if (pollResult._tag === 'Some') {
                    // We got a task - increment active count and return it
                    const activeCount = MutableRef.updateAndGet(
                      activeWorkers,
                      (n: number) => n + 1
                    );
                    return {
                      type: 'task' as const,
                      task: pollResult.value,
                      activeCount,
                    };
                  } else {
                    // Queue is empty - check completion conditions
                    const currentActive = MutableRef.get(activeWorkers);

                    // If there are already no active workers, we can safely check completion
                    if (currentActive === 0) {
                      // Double-check queue is still empty before marking complete
                      const wasCompleted = MutableRef.compareAndSet(
                        domainCompleted,
                        false,
                        true
                      );
                      return {
                        type: 'completed' as const,
                        reason: 'no_more_urls',
                        wasFirstToComplete: wasCompleted,
                      };
                    } else {
                      // Other workers are active - signal to wait
                      return {
                        type: 'empty_but_active' as const,
                        activeWorkers: currentActive,
                      };
                    }
                  }
                })
              ),

              // Add task to queue
              addTask: (task: CrawlTask) => Queue.offer(urlQueue, task),

              // Mark worker as idle (decrement active count with bounds checking)
              markIdle: () =>
                Effect.sync(() =>
                  MutableRef.updateAndGet(activeWorkers, (n: number) =>
                    Math.max(0, n - 1)
                  )
                ),

              // Get queue size for logging (with defensive bounds checking)
              size: () =>
                Effect.map(Queue.size(urlQueue), (size) => Math.max(0, size)),
            };

            // Generate unique worker IDs for this domain
            const generateWorkerId = () =>
              Effect.gen(function* () {
                const random = yield* Random.nextIntBetween(1000, 9999);
                return `${domain}-worker-${random}`;
              });

            // Worker implementation with enhanced logging
            const worker = (workerId: string) =>
              Effect.gen(function* () {
                // Log worker lifecycle: entering main loop
                yield* logger.logWorkerLifecycle(
                  workerId,
                  domain,
                  'entering_loop'
                );

                while (true) {
                  // Report worker health heartbeat
                  yield* reportWorkerHealth(workerId);

                  // Monitor memory usage and queue size for potential issues
                  const queueSize = yield* queueManager.size();
                  const memUsage = process.memoryUsage();

                  // Log warnings for concerning resource usage
                  if (memUsage.heapUsed > 1024 * 1024 * 1024) {
                    // > 1GB
                    yield* logger.logEdgeCase(domain, 'high_memory_usage', {
                      workerId,
                      heapUsed:
                        Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
                      heapTotal:
                        Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
                      queueSize,
                    });
                  }

                  if (queueSize > 10000) {
                    yield* logger.logEdgeCase(domain, 'excessive_queue_size', {
                      workerId,
                      queueSize,
                      message:
                        'Queue size exceeds 10,000 items - potential memory issue',
                    });
                  }

                  // Log worker state: attempting to take task
                  yield* logger.logWorkerState(
                    workerId,
                    domain,
                    'taking_task',
                    {
                      queueSize,
                    }
                  );

                  // Use atomic take-or-complete operation with timeout detection
                  const result = yield* queueManager.takeTaskOrComplete.pipe(
                    Effect.timeout('10 seconds'),
                    Effect.tap(() =>
                      logger.logEdgeCase(domain, 'task_acquisition_success', {
                        workerId,
                        message: 'Task acquired successfully',
                      })
                    ),
                    Effect.tapError((error) =>
                      logger.logEdgeCase(domain, 'deadlock_detected', {
                        workerId,
                        error: String(error),
                        message:
                          'DEADLOCK: Task acquisition timed out - worker stuck in atomic operation',
                        timestamp: new Date().toISOString(),
                      })
                    ),
                    Effect.catchAll((error) =>
                      Effect.gen(function* () {
                        yield* logger.logEdgeCase(
                          domain,
                          'task_acquisition_failed',
                          {
                            workerId,
                            error: String(error),
                            isTimeout: error?.name === 'TimeoutException',
                            message:
                              'Task acquisition failed, marking worker as idle and retrying',
                          }
                        );

                        // Mark worker as idle before continuing - prevent stuck active count
                        yield* queueManager.markIdle();

                        // Return empty_but_active to trigger retry logic
                        return {
                          type: 'empty_but_active' as const,
                          activeWorkers: 0,
                        };
                      })
                    )
                  );

                  if (result.type === 'completed') {
                    if (
                      'wasFirstToComplete' in result &&
                      result.wasFirstToComplete
                    ) {
                      // This worker detected completion - log it
                      const reason = result.reason || 'unknown';
                      yield* logger.logEvent({
                        type: 'domain_complete',
                        domain,
                        message: `Worker ${workerId} detected domain completion - ${reason}`,
                        details: { reason },
                      });
                    }
                    yield* logger.logWorkerLifecycle(
                      workerId,
                      domain,
                      'exiting_loop',
                      'detected_completion'
                    );
                    break;
                  } else if (result.type === 'empty_but_active') {
                    // Queue empty but other workers active, sleep and retry
                    // Use exponential backoff to avoid busy-waiting
                    const backoffMs = Math.min(
                      1000 * Math.pow(2, Math.floor(Math.random() * 3)),
                      5000
                    );
                    yield* Effect.sleep(`${backoffMs} millis`);
                    continue;
                  } else if (result.type === 'task') {
                    // Got a task and active count was incremented atomically
                    const task = result.task;

                    yield* logger.logWorkerState(
                      workerId,
                      domain,
                      'marked_active',
                      {
                        taskUrl: task.url,
                        activeWorkers: result.activeCount,
                      }
                    );

                    // Try to add URL to local deduplicator - skip if already seen
                    const wasAdded = yield* localDeduplicator.tryAdd(task.url);
                    if (!wasAdded) {
                      // Mark worker as idle before continuing to next iteration
                      const postIdleCount = yield* queueManager.markIdle();
                      yield* logger.logWorkerState(
                        workerId,
                        domain,
                        'marked_idle',
                        {
                          taskUrl: task.url,
                          activeWorkers: postIdleCount,
                          reason: 'duplicate_url',
                        }
                      );
                      continue; // Already processed this URL
                    }
                  } else {
                    // Should not happen, but handle gracefully
                    yield* Effect.sleep('1 second');
                    continue;
                  }

                  // We have a valid task to process
                  const task = result.task;

                  // Use SpiderConfig to decide whether to follow URL
                  yield* logger.logEdgeCase(domain, 'before_shouldFollowUrl', {
                    workerId,
                    url: task.url,
                    message: 'About to check shouldFollowUrl',
                  });

                  const shouldFollow = yield* config.shouldFollowUrl(
                    task.url,
                    task.fromUrl,
                    restrictToStartingDomain ? urlString : undefined
                  );

                  yield* logger.logEdgeCase(domain, 'after_shouldFollowUrl', {
                    workerId,
                    url: task.url,
                    follow: shouldFollow.follow,
                    reason: shouldFollow.reason,
                    message: 'Completed shouldFollowUrl check',
                  });

                  if (!shouldFollow.follow) {
                    // Mark worker as idle before continuing
                    const newIdleCount = yield* queueManager.markIdle();
                    yield* logger.logWorkerState(
                      workerId,
                      domain,
                      'marked_idle',
                      {
                        reason: 'shouldNotFollow',
                        activeWorkers: newIdleCount,
                      }
                    );
                    continue;
                  }

                  // Check robots.txt unless configured to ignore
                  const ignoreRobots = yield* config.shouldIgnoreRobotsTxt();
                  if (!ignoreRobots) {
                    yield* logger.logEdgeCase(domain, 'before_robots_check', {
                      workerId,
                      url: task.url,
                      message: 'About to check robots.txt',
                    });

                    const robotsCheck = yield* robots.checkUrl(task.url);

                    yield* logger.logEdgeCase(domain, 'after_robots_check', {
                      workerId,
                      url: task.url,
                      allowed: robotsCheck.allowed,
                      crawlDelay: robotsCheck.crawlDelay,
                      message: 'Completed robots.txt check',
                    });
                    if (!robotsCheck.allowed) {
                      // Mark worker as idle before continuing
                      const newIdleCount = yield* queueManager.markIdle();
                      yield* logger.logWorkerState(
                        workerId,
                        domain,
                        'marked_idle',
                        {
                          reason: 'robotsBlocked',
                          activeWorkers: newIdleCount,
                        }
                      );
                      continue;
                    }

                    // Apply crawl delay if specified, but cap at maximum
                    if (robotsCheck.crawlDelay) {
                      const maxCrawlDelayMs =
                        yield* config.getMaxRobotsCrawlDelay();
                      const maxCrawlDelaySeconds = maxCrawlDelayMs / 1000;
                      const effectiveCrawlDelay = Math.min(
                        robotsCheck.crawlDelay,
                        maxCrawlDelaySeconds
                      );

                      if (effectiveCrawlDelay < robotsCheck.crawlDelay) {
                        yield* logger.logEvent({
                          type: 'crawl_delay_capped',
                          domain,
                          workerId,
                          message: `[CRAWL_DELAY] Capping robots.txt delay from ${robotsCheck.crawlDelay}s to ${effectiveCrawlDelay}s`,
                          details: {
                            robotsCrawlDelay: robotsCheck.crawlDelay,
                            maxCrawlDelay: maxCrawlDelaySeconds,
                            effectiveDelay: effectiveCrawlDelay,
                          },
                        });
                      }

                      yield* Effect.sleep(`${effectiveCrawlDelay} seconds`);
                    }
                  }

                  // Apply configured request delay
                  const requestDelay = yield* config.getRequestDelay();
                  yield* Effect.sleep(`${requestDelay} millis`);

                  const fetchStartTime = Date.now();
                  yield* logger.logEdgeCase(domain, 'before_fetch', {
                    workerId,
                    url: task.url,
                    depth: task.depth,
                    message: 'About to fetch and parse page',
                    timestamp: new Date().toISOString(),
                    fetchStartMs: fetchStartTime,
                  });

                  // Fetch and parse the page with aggressive timeout
                  const pageData = yield* scraper
                    .fetchAndParse(task.url, task.depth)
                    .pipe(
                      // Add overall timeout to prevent workers from hanging
                      Effect.timeout('45 seconds'),
                      Effect.retry({
                        times: 2, // Reduced retries to prevent long hangs
                        schedule: Schedule.exponential('1 second'),
                      }),
                      Effect.catchAll((error) =>
                        Effect.gen(function* () {
                          const fetchDuration = Date.now() - fetchStartTime;
                          // Log timeouts and errors to help debug worker hangs
                          if (error?.name === 'TimeoutException') {
                            yield* logger.logEdgeCase(domain, 'fetch_timeout', {
                              workerId,
                              url: task.url,
                              message: `Fetch operation timed out after ${fetchDuration}ms`,
                              durationMs: fetchDuration,
                              timeoutExpectedMs: 45000,
                            });
                          } else {
                            yield* logger.logEdgeCase(domain, 'fetch_error', {
                              workerId,
                              url: task.url,
                              error: String(error),
                              errorName: error?.name || 'Unknown',
                              message: `Fetch operation failed after ${fetchDuration}ms`,
                              durationMs: fetchDuration,
                            });
                          }
                          return null;
                        })
                      )
                    );

                  if (pageData) {
                    const fetchDuration = Date.now() - fetchStartTime;

                    // Apply data extraction if configured
                    if (task.extractData) {
                      const extractedData = yield* Effect.sync(() => {
                        const $ = cheerio.load(pageData.html);
                        const result: Record<string, any> = {};

                        for (const [fieldName, fieldConfig] of Object.entries(
                          task.extractData!
                        )) {
                          if (typeof fieldConfig === 'string') {
                            result[fieldName] =
                              $(fieldConfig).text().trim() || undefined;
                          } else if (typeof fieldConfig === 'object') {
                            const fc = fieldConfig as any;
                            const {
                              selector,
                              text,
                              attribute,
                              multiple,
                              exists,
                            } = fc;

                            if (exists) {
                              result[fieldName] = $(selector).length > 0;
                            } else if (multiple) {
                              const elements = $(selector);
                              const values: any[] = [];
                              elements.each((_: number, el: any) => {
                                const $el = $(el);
                                if (fc.fields) {
                                  // Handle nested fields extraction
                                  const nestedResult: Record<string, any> = {};
                                  for (const [
                                    nestedName,
                                    nestedConfig,
                                  ] of Object.entries(fc.fields)) {
                                    if (typeof nestedConfig === 'object') {
                                      const nc = nestedConfig as any;
                                      const $nested = $el.find(nc.selector);
                                      if (nc.attribute) {
                                        nestedResult[nestedName] = $nested.attr(
                                          nc.attribute
                                        );
                                      } else {
                                        nestedResult[nestedName] = $nested
                                          .text()
                                          .trim();
                                      }
                                    }
                                  }
                                  values.push(nestedResult);
                                } else if (attribute) {
                                  values.push($el.attr(attribute));
                                } else {
                                  values.push($el.text().trim());
                                }
                              });
                              result[fieldName] =
                                values.length > 0 ? values : undefined;
                            } else {
                              const $el = $(selector);
                              if (attribute) {
                                result[fieldName] = $el.attr(attribute);
                              } else {
                                result[fieldName] =
                                  $el.text().trim() || undefined;
                              }
                            }
                          }
                        }

                        return result;
                      });

                      (pageData as any).extractedData = extractedData;
                    }

                    // Get current page count for logging
                    const currentPageCount = yield* localDeduplicator.size();

                    // Log successful fetch completion
                    yield* logger.logEdgeCase(domain, 'fetch_success', {
                      workerId,
                      url: task.url,
                      message: `Fetch completed successfully`,
                      durationMs: fetchDuration,
                    });

                    // Log the page being scraped
                    yield* logger.logPageScraped(
                      task.url,
                      domain,
                      currentPageCount
                    );

                    // Publish result
                    yield* PubSub.publish(resultPubSub, {
                      pageData,
                      depth: task.depth,
                      timestamp: new Date(),
                      metadata: task.metadata,
                    });

                    // Queue new URLs if not at max depth
                    const maxDepth = yield* config.getMaxDepth();

                    if (!maxDepth || task.depth < maxDepth) {
                      let linksToProcess: string[] = [];

                      // Extract links using LinkExtractorService if available
                      const extractionResult = linkExtractor
                        ? yield* (() => {
                            const extractorConfig =
                              options?.linkExtractorConfig || {};
                            return (
                              linkExtractor
                                // NOTE: We use the service interface (.extractLinks) rather than the pure function
                                // (extractRawLinks) to allow for dependency injection and alternative implementations.
                                // The service wraps the pure function with Effect error handling and enables
                                // testing with mock implementations or enhanced extractors with different capabilities.
                                .extractLinks(pageData.html, extractorConfig)
                                .pipe(
                                  Effect.catchAll(() =>
                                    Effect.succeed({
                                      links: [],
                                      totalElementsProcessed: 0,
                                      extractionBreakdown: {},
                                    })
                                  )
                                )
                            );
                          })()
                        : {
                            links: [],
                            totalElementsProcessed: 0,
                            extractionBreakdown: {},
                          };

                      // Resolve raw URLs to absolute URLs
                      linksToProcess = extractionResult.links
                        .map((url) => {
                          try {
                            return new URL(url, pageData.url).toString();
                          } catch {
                            // Skip invalid URLs
                            return null;
                          }
                        })
                        .filter((url): url is string => url !== null);

                      // Note: These counters could be used for debugging/metrics in the future
                      // Statistics tracking would go here

                      for (const link of linksToProcess) {
                        // Use config to validate each link first
                        const linkShouldFollow = yield* config.shouldFollowUrl(
                          link,
                          task.url,
                          restrictToStartingDomain ? urlString : undefined
                        );
                        if (!linkShouldFollow.follow) {
                          // URL filtered by robots.txt
                          continue;
                        }

                        // Check if we've already seen this URL (but don't mark as seen yet)
                        const alreadySeen =
                          yield* localDeduplicator.contains(link);
                        if (!alreadySeen) {
                          yield* queueManager.addTask({
                            url: link,
                            depth: task.depth + 1,
                            fromUrl: task.url,
                            metadata: task.metadata,
                          });
                          // Log queue state after adding URL
                          const newQueueSize = yield* queueManager.size();
                          if (newQueueSize % 10 === 0 || newQueueSize <= 5) {
                            yield* logger.logEvent({
                              type: 'queue_status',
                              domain,
                              workerId,
                              message: `[QUEUE_STATE] URL added to queue: ${link}`,
                              details: {
                                queueSize: newQueueSize,
                                addedUrl: link,
                                fromUrl: task.url,
                              },
                            });
                          }
                        }
                      }
                    }
                  }

                  // Mark worker as idle (finished processing this task)
                  const newIdleCount = yield* queueManager.markIdle();
                  yield* logger.logWorkerState(
                    workerId,
                    domain,
                    'task_completed',
                    {
                      taskUrl: task.url,
                      activeWorkers: newIdleCount,
                      pageProcessed: !!pageData,
                    }
                  );

                  // Check if we've reached max pages for this domain (atomic check)
                  const maxPages = yield* config.getMaxPages();
                  if (maxPages) {
                    const currentPageCount = yield* localDeduplicator.size();
                    if (currentPageCount >= maxPages) {
                      // Atomically check and set maxPagesReached to prevent multiple workers from logging completion
                      const wasFirstToReachMax = MutableRef.compareAndSet(
                        maxPagesReached,
                        false,
                        true
                      );
                      if (wasFirstToReachMax) {
                        // Only the first worker to reach max pages logs completion
                        yield* logger.logPageScraped(
                          task.url,
                          domain,
                          currentPageCount
                        );
                        yield* logger.logEvent({
                          type: 'domain_complete',
                          domain,
                          message: `Domain ${domain} reached max pages limit: ${currentPageCount}`,
                          details: {
                            currentPageCount,
                            maxPages,
                            reason: 'max_pages_reached',
                          },
                        });
                      }
                      yield* logger.logWorkerLifecycle(
                        workerId,
                        domain,
                        'exiting_loop',
                        'max_pages_reached',
                        {
                          currentPageCount,
                          maxPages,
                        }
                      );
                      break;
                    }
                  }

                  // Log queue status periodically
                  const pageCount = yield* localDeduplicator.size();
                  if (pageCount % 10 === 0) {
                    const queueSize = yield* queueManager.size();
                    const activeCount = MutableRef.get(activeWorkers);
                    const maxWorkers = yield* config.getMaxConcurrentWorkers();

                    // Log detailed domain status
                    yield* logger.logDomainStatus(domain, {
                      pagesScraped: pageCount,
                      queueSize,
                      activeWorkers: activeCount,
                      maxWorkers,
                    });
                  }
                }

                // Log worker lifecycle: exiting main loop (normal exit)
                yield* logger.logWorkerLifecycle(
                  workerId,
                  domain,
                  'exiting_loop',
                  'normal_completion'
                );
              }).pipe(
                // Ensure this runs even if the worker is interrupted/crashes
                Effect.ensuring(
                  logger.logWorkerLifecycle(
                    workerId,
                    domain,
                    'exiting_loop',
                    'effect_ensuring_cleanup'
                  )
                ),
                // Add catchAll to handle any unhandled errors
                Effect.catchAll((error) =>
                  Effect.gen(function* () {
                    yield* logger.logEdgeCase(domain, 'worker_crash', {
                      workerId,
                      error: String(error),
                      message: `Worker ${workerId} crashed with error: ${error}`,
                      timestamp: new Date().toISOString(),
                    });

                    // Mark worker as exited due to error
                    yield* logger.logWorkerLifecycle(
                      workerId,
                      domain,
                      'exiting_loop',
                      'error_exit'
                    );

                    // Re-throw to maintain error semantics
                  })
                )
              );

            // Queue the initial URL
            yield* queueManager.addTask({
              url: urlString,
              depth: 0,
              metadata: initialMetadata,
              extractData: options?.extractData,
            });
            yield* logger.logEvent({
              type: 'queue_status',
              domain,
              message: `[QUEUE_STATE] Initial URL queued: ${urlString}`,
              details: { queueSize: 1, initialUrl: urlString },
            });

            // Start workers with unique IDs
            const maxWorkers = yield* config.getMaxConcurrentWorkers();
            const workerFibers: Fiber.RuntimeFiber<void, unknown>[] = [];
            for (let i = 0; i < maxWorkers; i++) {
              const workerId = yield* generateWorkerId();

              // Log worker lifecycle: creation
              yield* logger.logWorkerLifecycle(
                workerId,
                domain,
                'created',
                undefined,
                {
                  workerIndex: i,
                  totalWorkers: maxWorkers,
                }
              );

              // Workers start idle, they'll mark themselves active when processing tasks
              const fiber = yield* Effect.fork(worker(workerId));
              workerFibers.push(fiber);
            }

            // Start worker health monitoring
            const healthMonitorFiber = yield* Effect.fork(workerHealthMonitor);

            // Create result stream from PubSub
            const resultStream = Stream.fromPubSub(resultPubSub);

            // Run the stream into the sink
            const sinkFiber = yield* Effect.fork(
              Stream.run(resultStream, sink)
            );

            // Domain failure detection - mark domains as failed if they get stuck
            const failureDetector = Effect.gen(function* () {
              let lastPageCount = 0;
              let stuckIterations = 0;

              while (!MutableRef.get(domainCompleted)) {
                yield* Effect.sleep('30 seconds'); // Check every 30 seconds

                const pageCount = yield* localDeduplicator.size();
                const queueSize = yield* queueManager.size();
                const activeCount = MutableRef.get(activeWorkers);

                // Check for various stuck states
                const hasQueueItems = queueSize > 0;
                const hasNoActiveWorkers = activeCount === 0;
                const hasNegativeQueue = queueSize < 0;
                const noProgressMade = pageCount === lastPageCount;

                if (hasNegativeQueue) {
                  yield* logger.logEdgeCase(domain, 'negative_queue_detected', {
                    queueSize,
                    activeWorkers: activeCount,
                    pageCount,
                  });
                }

                // Critical failure states that require intervention
                const criticalFailures = [
                  hasNoActiveWorkers && hasQueueItems && pageCount > 0, // 0 workers with queue items
                  hasNegativeQueue, // Invalid queue state
                  activeCount === 0 && pageCount <= 1 && stuckIterations >= 2, // Completely stuck
                ];

                if (criticalFailures.some(Boolean)) {
                  const reason =
                    hasNoActiveWorkers && hasQueueItems
                      ? 'no_workers_with_queue_items'
                      : hasNegativeQueue
                        ? 'negative_queue_size'
                        : 'no_progress_for_60s';

                  yield* logger.logEdgeCase(
                    domain,
                    'critical_failure_detected',
                    {
                      timeElapsed: `${(stuckIterations + 1) * 30}s`,
                      pageCount,
                      queueSize,
                      activeWorkers: activeCount,
                      reason,
                    }
                  );

                  // Mark domain as completed with error to free up the slot
                  const wasCompleted = MutableRef.compareAndSet(
                    domainCompleted,
                    false,
                    true
                  );
                  if (wasCompleted) {
                    yield* logger.logDomainComplete(domain, pageCount, 'error');
                  }
                  break;
                }

                // Track progress to detect stalled domains
                if (noProgressMade) {
                  stuckIterations++;
                } else {
                  stuckIterations = 0;
                  lastPageCount = pageCount;
                }
              }
            });

            const failureDetectorFiber = yield* Effect.fork(failureDetector);

            // Wait for all workers to complete (they will exit when domain is completed)
            yield* Effect.all(
              workerFibers.map((f) => Fiber.join(f)),
              { concurrency: 'unbounded' }
            );

            // Clean up failure detector and health monitor
            yield* Fiber.interrupt(failureDetectorFiber).pipe(Effect.ignore);
            yield* Fiber.interrupt(healthMonitorFiber).pipe(Effect.ignore);

            // Shut down the queue to signal workers to exit
            yield* logger.logEvent({
              type: 'queue_status',
              domain,
              message: `[QUEUE_STATE] Shutting down queue for domain completion`,
              details: { finalQueueSize: yield* queueManager.size() },
            });
            // yield* Queue.shutdown(urlQueue);

            // Log final page count
            const finalPageCount = yield* localDeduplicator.size();
            const maxPages = yield* config.getMaxPages();
            const completionReason =
              maxPages && finalPageCount >= maxPages
                ? 'max_pages'
                : 'queue_empty';
            yield* logger.logDomainComplete(
              domain,
              finalPageCount,
              completionReason
            );

            // Close the PubSub to signal stream completion
            yield* PubSub.shutdown(resultPubSub);

            // Wait for sink to finish processing ALL results
            // This is critical: we must ensure all crawled pages are saved to the database
            // before completing. No timeouts - the sink must process everything.
            yield* logger.logEvent({
              type: 'spider_lifecycle',
              domain,
              message: `Waiting for sink to process remaining results...`,
            });

            yield* Fiber.join(sinkFiber);

            // Log successful completion after all results are processed
            yield* logger.logEvent({
              type: 'spider_lifecycle',
              domain,
              message: `Sink processing complete. All ${finalPageCount} pages saved.`,
            });

            return {
              completed: true,
              pagesScraped: finalPageCount,
              domain,
            };
          }),

        /**
         * Resume a previous crawling session from persistent storage.
         *
         * This method requires resumability to be enabled in the SpiderConfig and
         * a StatePersistence implementation to be configured. It will restore the
         * crawling state and continue processing from where it left off.
         *
         * @param stateKey - The unique identifier for the session to resume
         * @param sink - Sink to process crawl results as they're produced
         * @param persistence - Optional persistence implementation (uses configured one if not provided)
         * @returns Effect containing crawl statistics
         *
         * @example
         * ```typescript
         * const stateKey = new SpiderStateKey({
         *   id: 'my-crawl-session',
         *   timestamp: new Date('2024-01-01'),
         *   name: 'Example Crawl'
         * });
         *
         * const collectSink = Sink.forEach<CrawlResult>(result =>
         *   Effect.sync(() => console.log(`Resumed: ${result.pageData.title}`))
         * );
         *
         * const stats = yield* spider.resume(stateKey, collectSink);
         * ```
         */
        resume: <A, E, R>(
          stateKey: import('../Scheduler/SpiderScheduler.service.js').SpiderStateKey,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          _sink: Sink.Sink<A, CrawlResult, E, R>,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          _persistence?: import('../Scheduler/SpiderScheduler.service.js').StatePersistence
        ) =>
          Effect.gen(function* () {
            const config = yield* SpiderConfig;

            if (!config) {
              return yield* Effect.fail(
                new Error(
                  'SpiderConfig is required for resumability operations'
                )
              );
            }

            const resumabilityEnabled = yield* config.isResumabilityEnabled();
            if (!resumabilityEnabled) {
              return yield* Effect.fail(
                new Error(
                  'Resume functionality requires resumability to be enabled in SpiderConfig. ' +
                    'Set enableResumability: true in your spider configuration.'
                )
              );
            }

            // Implement resume logic using Effect patterns
            const scheduler = yield* SpiderSchedulerService;
            const logger = yield* SpiderLogger;
            
            yield* logger.logSpiderLifecycle('start' as any, {
              sessionId: stateKey.id,
              timestamp: new Date().toISOString()
            });
            
            // Load the saved state
            const savedState = yield* Effect.tryPromise({
              try: async () => {
                // Note: In a full implementation, this would use ResumabilityService
                // For now, we'll use the scheduler's state management
                return scheduler.getState ? await Effect.runPromise(scheduler.getState()) : null;
              },
              catch: (error) => new StateError({
                operation: 'load',
                stateKey: stateKey.id,
                cause: error
              })
            });
            
            if (!savedState) {
              return yield* Effect.fail(
                new StateError({
                  operation: 'load',
                  stateKey: stateKey.id,
                  cause: 'No saved state found for session'
                })
              );
            }
            
            // Restore the crawl state
            const restoredUrls = yield* Effect.try({
              try: () => {
                // Extract URLs from saved state
                const urls: string[] = [];
                if (savedState && typeof savedState === 'object') {
                  // Extract pending URLs from state
                  if ('pendingUrls' in savedState && Array.isArray(savedState.pendingUrls)) {
                    urls.push(...savedState.pendingUrls);
                  }
                  // Extract visited URLs to avoid re-crawling
                  if ('visitedUrls' in savedState && Array.isArray(savedState.visitedUrls)) {
                    // These would be marked as already processed
                  }
                }
                return urls;
              },
              catch: (error) => new ParseError({
                input: 'saved state',
                expected: 'crawl state',
                cause: error
              })
            });
            
            yield* logger.logSpiderLifecycle('start' as any, {
              sessionId: stateKey.id,
              pendingUrls: restoredUrls.length,
              timestamp: new Date().toISOString()
            });
            
            // Resume crawling with restored URLs
            if (restoredUrls.length > 0) {
              // Use the crawl method with restored URLs
              const crawlResult = yield* self.crawl(
                restoredUrls,
                _sink as any,
                {} as any
              );
              
              yield* logger.logSpiderLifecycle('complete' as any, {
                sessionId: stateKey.id,
                urlsProcessed: restoredUrls.length,
                timestamp: new Date().toISOString()
              });
              
              return {
                ...crawlResult,
                resumed: true,
                sessionId: stateKey.id
              };
            }
            
            return {
              completed: true,
              resumed: true,
              sessionId: stateKey.id,
              urlsProcessed: 0
            };
          }),

        /**
         * Returns the list of URLs that have been visited during crawling.
         *
         * @returns Effect containing array of visited URLs
         *
         * @remarks
         * This is currently a placeholder implementation. In a future version,
         * this will return the actual list of visited URLs from the current session.
         */
        getVisitedUrls: () => Effect.sync(() => [] as string[]),
      };

      return self;
    }),
    dependencies: [
      RobotsService.Default,
      ScraperService.Default,
      UrlDeduplicatorService.Default,
      SpiderConfig.Default,
      LinkExtractorService.Default,
      SpiderLoggerLive,
    ],
  }
) {}

export type { CrawlResult, CrawlTask };
