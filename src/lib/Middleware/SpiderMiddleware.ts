import { Effect, MutableHashMap, Option } from 'effect';
import { CrawlTask } from '../Spider/Spider.service.js';
import { PageData } from '../PageData/PageData.js';
import { MiddlewareError } from '../errors.js';

/**
 * Request object used in the middleware pipeline.
 *
 * Contains the crawl task along with optional headers and metadata
 * that can be modified by middleware during processing.
 *
 * @group Interfaces
 * @public
 */
export interface SpiderRequest {
  /** The crawl task containing URL and depth information */
  task: CrawlTask;
  /** HTTP headers to include with the request */
  headers?: Record<string, string>;
  /** Additional metadata that can be used by middleware */
  meta?: Record<string, unknown>;
}

/**
 * Response object used in the middleware pipeline.
 *
 * Contains the extracted page data along with optional HTTP response
 * information and metadata from middleware processing.
 *
 * @group Interfaces
 * @public
 */
export interface SpiderResponse {
  /** The extracted page data including content, links, and metadata */
  pageData: PageData;
  /** HTTP status code of the response */
  statusCode?: number;
  /** HTTP response headers */
  headers?: Record<string, string>;
  /** Additional metadata added by middleware */
  meta?: Record<string, unknown>;
}

/**
 * Interface for implementing custom middleware components.
 *
 * Middleware can intercept and modify requests before they're sent,
 * responses after they're received, and handle exceptions that occur
 * during processing. All methods are optional.
 *
 * @example
 * ```typescript
 * const loggingMiddleware: SpiderMiddleware = {
 *   processRequest: (request) => Effect.gen(function* () {
 *     console.log(`Requesting: ${request.task.url}`);
 *     return request;
 *   }),
 *
 *   processResponse: (response, request) => Effect.gen(function* () {
 *     console.log(`Response: ${response.statusCode} for ${request.task.url}`);
 *     return response;
 *   }),
 *
 *   processException: (error, request) => Effect.gen(function* () {
 *     console.error(`Error processing ${request.task.url}: ${error.message}`);
 *     return null; // Let the error propagate
 *   })
 * };
 * ```
 *
 * @group Interfaces
 * @public
 */
export interface SpiderMiddleware {
  /**
   * Process a request before it's sent to the target server.
   * Can modify headers, metadata, or reject the request entirely.
   */
  processRequest?: (
    request: SpiderRequest
  ) => Effect.Effect<SpiderRequest, MiddlewareError>;

  /**
   * Process a response after it's received from the target server.
   * Can modify the response data or metadata.
   */
  processResponse?: (
    response: SpiderResponse,
    request: SpiderRequest
  ) => Effect.Effect<SpiderResponse, MiddlewareError>;

  /**
   * Handle exceptions that occur during request processing.
   * Can attempt recovery by returning a SpiderResponse, or return null to propagate the error.
   */
  processException?: (
    error: Error,
    request: SpiderRequest
  ) => Effect.Effect<SpiderResponse | null, MiddlewareError>;
}

/**
 * Manages the middleware pipeline for request and response processing.
 *
 * The MiddlewareManager orchestrates the execution of middleware in the correct order:
 * - Requests are processed forward through the middleware array
 * - Responses are processed in reverse order (last middleware first)
 * - Exceptions are processed in reverse order for proper error handling
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
 *   const request: SpiderRequest = {
 *     task: { url: 'https://example.com', depth: 0 },
 *     headers: {}
 *   };
 *
 *   const processedRequest = yield* manager.processRequest(request, middleware);
 *   console.log('Request processed through middleware pipeline');
 * });
 * ```
 *
 * @group Services
 * @public
 */
export class MiddlewareManager extends Effect.Service<MiddlewareManager>()(
  '@jambudipa.io/MiddlewareManager',
  {
    effect: Effect.sync(() => ({
      /**
       * Processes a request through the middleware pipeline.
       *
       * Middleware are executed in order from first to last, with each middleware
       * receiving the output of the previous middleware as input.
       *
       * @param request - The initial request to process
       * @param middlewares - Array of middleware to apply
       * @returns Effect containing the processed request
       */
      processRequest: (
        request: SpiderRequest,
        middlewares: SpiderMiddleware[]
      ) =>
        Effect.reduce(middlewares, request, (req, middleware) =>
          middleware.processRequest
            ? middleware.processRequest(req)
            : Effect.succeed(req)
        ),

      /**
       * Processes a response through the middleware pipeline in reverse order.
       *
       * Middleware are executed in reverse order (last to first) to provide
       * proper nesting of response processing.
       *
       * @param response - The response to process
       * @param request - The original request (for context)
       * @param middlewares - Array of middleware to apply
       * @returns Effect containing the processed response
       */
      processResponse: (
        response: SpiderResponse,
        request: SpiderRequest,
        middlewares: SpiderMiddleware[]
      ) =>
        Effect.reduce(
          middlewares.slice().reverse(),
          response,
          (res, middleware) =>
            middleware.processResponse
              ? middleware.processResponse(res, request)
              : Effect.succeed(res)
        ),

      /**
       * Processes an exception through the middleware pipeline in reverse order.
       *
       * Middleware are given a chance to handle or recover from exceptions.
       * If a middleware returns a SpiderResponse, it indicates successful recovery.
       * If it returns null, the exception continues to propagate.
       *
       * @param error - The error that occurred
       * @param request - The request that caused the error
       * @param middlewares - Array of middleware to apply
       * @returns Effect containing a recovered response or null
       */
      processException: (
        error: Error,
        request: SpiderRequest,
        middlewares: SpiderMiddleware[]
      ) =>
        Effect.reduce(
          middlewares.slice().reverse(),
          null as SpiderResponse | null,
          (res, middleware) =>
            middleware.processException
              ? middleware.processException(error, request)
              : Effect.succeed(res)
        ),
    })),
  }
) {}

/**
 * Provides rate limiting functionality for respectful crawling.
 *
 * Controls request frequency at both global and per-domain levels to prevent
 * overwhelming target servers and avoid being blocked.
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
 *
 * @group Middleware
 * @public
 */
export class RateLimitMiddleware extends Effect.Service<RateLimitMiddleware>()(
  '@jambudipa.io/RateLimitMiddleware',
  {
    effect: Effect.sync(() => {
      const domainLastRequest = MutableHashMap.empty<string, number>();
      const domainRequestCount = MutableHashMap.empty<string, number>();
      const domainWindowStart = MutableHashMap.empty<string, number>();

      return {
        create: (config: {
          maxConcurrentRequests: number;
          maxRequestsPerSecondPerDomain: number;
          requestDelayMs?: number;
        }): SpiderMiddleware => ({
          processRequest: (request: SpiderRequest) =>
            Effect.gen(function* () {
              const url = new URL(request.task.url);
              const domain = url.hostname;
              const now = Date.now();

              // Apply general request delay if configured
              if (config.requestDelayMs) {
                yield* Effect.sleep(`${config.requestDelayMs} millis`);
              }

              // Per-domain rate limiting
              const windowDuration = 1000; // 1 second window
              const windowStart = Option.getOrElse(
                MutableHashMap.get(domainWindowStart, domain),
                () => now
              );
              const currentCount = Option.getOrElse(
                MutableHashMap.get(domainRequestCount, domain),
                () => 0
              );

              // Reset counter if window expired
              if (now - windowStart >= windowDuration) {
                MutableHashMap.set(domainWindowStart, domain, now);
                MutableHashMap.set(domainRequestCount, domain, 0);
              } else if (currentCount >= config.maxRequestsPerSecondPerDomain) {
                // Wait until window resets
                const waitTime = windowDuration - (now - windowStart);
                yield* Effect.sleep(`${waitTime} millis`);
                MutableHashMap.set(domainWindowStart, domain, Date.now());
                MutableHashMap.set(domainRequestCount, domain, 0);
              }

              // Increment counter
              const newCount =
                Option.getOrElse(
                  MutableHashMap.get(domainRequestCount, domain),
                  () => 0
                ) + 1;
              MutableHashMap.set(domainRequestCount, domain, newCount);
              MutableHashMap.set(domainLastRequest, domain, Date.now());

              yield* Effect.logDebug(
                `Rate limit: ${domain} - ${newCount}/${config.maxRequestsPerSecondPerDomain} requests in window`
              );

              return request;
            }),
        }),
      };
    }),
  }
) {}

/**
 * Provides logging functionality using Effect.Logger.
 *
 * Logs requests, responses, and errors at configurable levels for debugging
 * and monitoring purposes.
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
 *
 * @group Middleware
 * @public
 */
export class LoggingMiddleware extends Effect.Service<LoggingMiddleware>()(
  '@jambudipa.io/LoggingMiddleware',
  {
    effect: Effect.sync(() => ({
      create: (
        config: {
          logRequests?: boolean;
          logResponses?: boolean;
          logErrors?: boolean;
          logLevel?: 'debug' | 'info' | 'warn' | 'error';
        } = {}
      ): SpiderMiddleware => {
        const {
          logRequests = true,
          logResponses = true,
          logErrors = true,
          logLevel = 'info',
        } = config;

        return {
          processRequest: (request: SpiderRequest) =>
            Effect.gen(function* () {
              if (logRequests) {
                const logMessage = `Processing request: ${request.task.url} (depth: ${request.task.depth})`;
                switch (logLevel) {
                  case 'debug':
                    yield* Effect.logDebug(logMessage);
                    break;
                  case 'info':
                    yield* Effect.logInfo(logMessage);
                    break;
                  case 'warn':
                    yield* Effect.logWarning(logMessage);
                    break;
                  case 'error':
                    yield* Effect.logError(logMessage);
                    break;
                }
              }
              return request;
            }),

          processResponse: (response: SpiderResponse, request: SpiderRequest) =>
            Effect.gen(function* () {
              if (logResponses) {
                const logMessage = `Received response: ${request.task.url} (status: ${response.statusCode || 'unknown'}, size: ${response.pageData.html.length} bytes)`;
                switch (logLevel) {
                  case 'debug':
                    yield* Effect.logDebug(logMessage);
                    break;
                  case 'info':
                    yield* Effect.logInfo(logMessage);
                    break;
                  case 'warn':
                    yield* Effect.logWarning(logMessage);
                    break;
                  case 'error':
                    yield* Effect.logError(logMessage);
                    break;
                }
              }
              return response;
            }),

          processException: (error: Error, request: SpiderRequest) =>
            Effect.gen(function* () {
              if (logErrors) {
                const logMessage = `Error processing request: ${request.task.url} - ${error.message}`;
                yield* Effect.logError(logMessage);
              }
              return null;
            }),
        };
      },
    })),
  }
) {}

/**
 * Adds User-Agent headers to requests.
 *
 * Sets a consistent User-Agent string for all requests to identify
 * your crawler to web servers.
 *
 * @example
 * ```typescript
 * const userAgent = yield* UserAgentMiddleware;
 * const middleware = userAgent.create('MyBot/1.0 (+https://example.com)');
 * ```
 *
 * @group Middleware
 * @public
 */
export class UserAgentMiddleware extends Effect.Service<UserAgentMiddleware>()(
  '@jambudipa.io/UserAgentMiddleware',
  {
    effect: Effect.sync(() => ({
      create: (userAgent: string): SpiderMiddleware => ({
        processRequest: (request: SpiderRequest) =>
          Effect.succeed({
            ...request,
            headers: {
              ...request.headers,
              'User-Agent': userAgent,
            },
          }),
      }),
    })),
  }
) {}

/**
 * Collects statistics about crawling activity.
 *
 * Tracks various metrics including requests processed, response codes,
 * bytes downloaded, and processing times for monitoring and optimization.
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
 *
 * @group Middleware
 * @public
 */
export class StatsMiddleware extends Effect.Service<StatsMiddleware>()(
  '@jambudipa.io/StatsMiddleware',
  {
    effect: Effect.sync(() => ({
      create: (): {
        middleware: SpiderMiddleware;
        getStats: () => Effect.Effect<Record<string, number>>;
      } => {
        const stats = MutableHashMap.empty<string, number>();
        const startTime = Date.now();

        const incr = (key: string, count = 1) => {
          const current = Option.getOrElse(
            MutableHashMap.get(stats, key),
            () => 0
          );
          MutableHashMap.set(stats, key, current + count);
        };

        return {
          middleware: {
            processRequest: (request: SpiderRequest) =>
              Effect.sync(() => {
                incr('requests_processed');
                incr(`requests_depth_${request.task.depth}`);
                return request;
              }),

            processResponse: (response: SpiderResponse) =>
              Effect.sync(() => {
                incr('responses_received');
                if (response.statusCode) {
                  incr(`status_${response.statusCode}`);
                  if (response.statusCode >= 200 && response.statusCode < 300) {
                    incr('responses_success');
                  } else if (response.statusCode >= 400) {
                    incr('responses_error');
                  }
                }
                incr('bytes_downloaded', response.pageData.html.length);
                return response;
              }),

            processException: (error: Error) =>
              Effect.sync(() => {
                incr('exceptions');
                incr(`exception_${error.constructor.name}`);
                return null;
              }),
          },

          getStats: () =>
            Effect.sync(() => ({
              ...Object.fromEntries(Array.from(stats)),
              runtime_seconds: (Date.now() - startTime) / 1000,
            })),
        };
      },
    })),
  }
) {}
