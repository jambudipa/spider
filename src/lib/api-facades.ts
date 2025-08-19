/**
 * Clean API facades that hide Effect.Service implementation details.
 *
 * These interfaces provide clean documentation without exposing
 * internal Effect service machinery.
 *
 * @group Services
 */

import { Effect, Sink } from 'effect';
import { CrawlResult, CrawlTask } from './Spider/Spider.service.js';
import {
  PriorityRequest,
  SpiderState,
  SpiderStateKey,
  StatePersistence,
} from './Scheduler/SpiderScheduler.service.js';
import {
  SpiderMiddleware,
  SpiderRequest,
  SpiderResponse,
} from './Middleware/SpiderMiddleware.js';
import { MiddlewareError } from './errors.js';

/**
 * The main Spider service interface for web crawling.
 *
 * Orchestrates the entire crawling process including URL validation,
 * robots.txt checking, concurrent processing, and result streaming.
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
export interface ISpider {
  /**
   * Starts crawling from the specified URL and processes results through the provided sink.
   *
   * @param urlString - The starting URL for crawling
   * @param sink - Sink to process crawl results as they're produced
   * @returns Effect containing crawl statistics (total pages, completion status)
   */
  crawl<A, E, R>(
    urlString: string,
    sink: Sink.Sink<A, CrawlResult, E, R>
  ): Effect.Effect<{ totalPages: number; completed: boolean }, Error>;

  /**
   * Returns the list of URLs that have been visited during crawling.
   *
   * @returns Effect containing array of visited URLs
   */
  getVisitedUrls(): Effect.Effect<string[]>;
}

/**
 * The SpiderSchedulerService service interface for request scheduling and persistence.
 *
 * Manages request queuing, prioritization, and state persistence for
 * resumable crawling operations.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const scheduler = yield* SpiderSchedulerService;
 *
 *   // Configure persistence
 *   const stateKey = new SpiderStateKey({
 *     id: 'my-crawl',
 *     timestamp: new Date(),
 *     name: 'Example Crawl'
 *   });
 *
 *   yield* scheduler.configurePersistence(persistence, stateKey);
 *
 *   // Queue requests with priority
 *   yield* scheduler.enqueue({ url: 'https://example.com', depth: 0 }, 10);
 *
 *   // Process requests
 *   const request = yield* scheduler.dequeue();
 *   console.log(`Processing: ${request.request.url}`);
 * });
 * ```
 *
 * @group Services
 * @public
 */
export interface ISpiderScheduler {
  /**
   * Configures the scheduler to use a specific persistence layer with a state key.
   *
   * @param persistence - Implementation of StatePersistence interface
   * @param stateKey - Unique identifier for the crawl session
   */
  configurePersistence(
    persistence: StatePersistence,
    stateKey: SpiderStateKey
  ): Effect.Effect<void>;

  /**
   * Removes persistence configuration, disabling state saving.
   */
  clearPersistence(): Effect.Effect<void>;

  /**
   * Adds a crawl task to the processing queue with optional priority.
   *
   * @param request - Crawl task containing URL and depth
   * @param priority - Optional priority (higher numbers = higher priority, default: 0)
   * @returns Effect containing boolean indicating if task was added (false if duplicate)
   */
  enqueue(request: CrawlTask, priority?: number): Effect.Effect<boolean>;

  /**
   * Retrieves the next highest-priority task from the queue.
   *
   * @returns Effect containing the next priority request
   */
  dequeue(): Effect.Effect<PriorityRequest>;

  /**
   * Returns the current number of tasks in the queue.
   */
  size(): Effect.Effect<number>;

  /**
   * Checks if the queue is empty.
   */
  isEmpty(): Effect.Effect<boolean>;

  /**
   * Returns the current scheduler state for persistence.
   */
  getState(): Effect.Effect<SpiderState>;

  /**
   * Restores the scheduler from a previously saved state.
   *
   * @param state - Complete state to restore from
   */
  restoreFromState(state: SpiderState): Effect.Effect<void>;

  /**
   * Attempts to restore state from a persistence layer.
   *
   * @param persistence - Persistence layer to load from
   * @param stateKey - State key to restore
   * @returns Effect containing boolean indicating if state was successfully restored
   */
  restore(
    persistence: StatePersistence,
    stateKey: SpiderStateKey
  ): Effect.Effect<boolean>;
}

/**
 * The MiddlewareManager service interface for pipeline processing.
 *
 * Orchestrates the execution of middleware in the correct order for
 * request processing, response handling, and error recovery.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const manager = yield* MiddlewareManager;
 *
 *   const middleware = [
 *     rateLimitMiddleware,
 *     loggingMiddleware,
 *     userAgentMiddleware
 *   ];
 *
 *   const processedRequest = yield* manager.processRequest(request, middleware);
 *   console.log('Request processed through middleware pipeline');
 * });
 * ```
 *
 * @group Services
 * @public
 */
export interface IMiddlewareManager {
  /**
   * Processes a request through the middleware pipeline.
   *
   * @param request - The initial request to process
   * @param middlewares - Array of middleware to apply
   * @returns Effect containing the processed request
   */
  processRequest(
    request: SpiderRequest,
    middlewares: SpiderMiddleware[]
  ): Effect.Effect<SpiderRequest, MiddlewareError>;

  /**
   * Processes a response through the middleware pipeline in reverse order.
   *
   * @param response - The response to process
   * @param request - The original request (for context)
   * @param middlewares - Array of middleware to apply
   * @returns Effect containing the processed response
   */
  processResponse(
    response: SpiderResponse,
    request: SpiderRequest,
    middlewares: SpiderMiddleware[]
  ): Effect.Effect<SpiderResponse, MiddlewareError>;

  /**
   * Processes an exception through the middleware pipeline in reverse order.
   *
   * @param error - The error that occurred
   * @param request - The request that caused the error
   * @param middlewares - Array of middleware to apply
   * @returns Effect containing a recovered response or null
   */
  processException(
    error: Error,
    request: SpiderRequest,
    middlewares: SpiderMiddleware[]
  ): Effect.Effect<SpiderResponse | null, MiddlewareError>;
}

/**
 * Rate limiting middleware service interface.
 *
 * Provides rate limiting functionality for respectful crawling,
 * controlling request frequency at both global and per-domain levels.
 *
 * @group Middleware
 * @public
 */
export interface IRateLimitMiddleware {
  /**
   * Creates a rate limiting middleware with the specified configuration.
   *
   * @param config - Rate limiting configuration options
   * @returns Configured middleware instance
   *
   * @example
   * ```typescript
   * const rateLimiter = yield* RateLimitMiddleware;
   * const middleware = rateLimiter.create({
   *   maxConcurrentRequests: 5,
   *   maxRequestsPerSecondPerDomain: 2,
   *   requestDelayMs: 250
   * });
   * ```
   */
  create(config: {
    maxConcurrentRequests: number;
    maxRequestsPerSecondPerDomain: number;
    requestDelayMs?: number;
  }): SpiderMiddleware;
}

/**
 * Logging middleware service interface.
 *
 * Provides logging functionality using Effect.Logger for debugging
 * and monitoring crawling operations.
 *
 * @group Middleware
 * @public
 */
export interface ILoggingMiddleware {
  /**
   * Creates a logging middleware with optional configuration.
   *
   * @param config - Optional logging configuration
   * @returns Configured middleware instance
   *
   * @example
   * ```typescript
   * const logger = yield* LoggingMiddleware;
   * const middleware = logger.create({
   *   logRequests: true,
   *   logResponses: true,
   *   logLevel: 'info'
   * });
   * ```
   */
  create(config?: {
    logRequests?: boolean;
    logResponses?: boolean;
    logErrors?: boolean;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
  }): SpiderMiddleware;
}

/**
 * User agent middleware service interface.
 *
 * Adds consistent User-Agent headers to all requests for
 * proper identification of your crawler.
 *
 * @group Middleware
 * @public
 */
export interface IUserAgentMiddleware {
  /**
   * Creates a User-Agent middleware with the specified user agent string.
   *
   * @param userAgent - User agent string to add to requests
   * @returns Configured middleware instance
   *
   * @example
   * ```typescript
   * const userAgent = yield* UserAgentMiddleware;
   * const middleware = userAgent.create('MyBot/1.0 (+https://example.com)');
   * ```
   */
  create(userAgent: string): SpiderMiddleware;
}

/**
 * Statistics middleware service interface.
 *
 * Collects comprehensive metrics about crawling activity including
 * request counts, response codes, and performance statistics.
 *
 * @group Middleware
 * @public
 */
export interface IStatsMiddleware {
  /**
   * Creates a statistics middleware and returns both the middleware and a stats getter.
   *
   * @returns Object containing the middleware instance and statistics retrieval function
   *
   * @example
   * ```typescript
   * const statsService = yield* StatsMiddleware;
   * const { middleware, getStats } = statsService.create();
   *
   * // Use middleware in your pipeline
   * // Later get statistics
   * const stats = yield* getStats();
   * console.log(`Processed ${stats.requests_processed} requests`);
   * ```
   */
  create(): {
    middleware: SpiderMiddleware;
    getStats: () => Effect.Effect<Record<string, number>>;
  };
}
