import { Context, Effect } from 'effect';
import { SpiderLogger } from './SpiderLogger.service.js';

/**
 * Wrapper for fetch that adds comprehensive logging
 */
export const makeLoggingFetch = Effect.gen(function* () {
  const logger = yield* SpiderLogger;

  return (url: string, options?: RequestInit) => {
    const startMs = Date.now();
    const domain = new URL(url).hostname;

    // Log fetch start
    const logStart = logger.logEvent({
      type: 'edge_case',
      domain,
      url,
      message: '[FETCH_START] Starting fetch request',
      details: {
        case: 'fetch_start',
        url,
        timestamp: new Date().toISOString(),
        options: options
          ? {
              method: options.method,
              headers: Object.keys(options.headers || {}),
            }
          : undefined,
      },
    });

    // Create abort controller with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      const duration = Date.now() - startMs;
      Effect.runSync(
        logger.logEvent({
          type: 'edge_case',
          domain,
          url,
          message: `[FETCH_ABORT] Aborting fetch after ${duration}ms`,
          details: {
            case: 'fetch_abort',
            url,
            durationMs: duration,
            reason: 'timeout',
          },
        })
      );
      controller.abort();
    }, 30000); // 30 second timeout

    // Use Effect composition instead of Promise chains
    const fetchEffect = Effect.gen(function* () {
      yield* logStart;
      
      const response = yield* Effect.tryPromise({
        try: () => fetch(url, { ...options, signal: controller.signal }),
        catch: (error) => error as Error
      });
      
      clearTimeout(timeoutId);
      const duration = Date.now() - startMs;
      
      // Log successful response
      yield* logger.logEvent({
        type: 'edge_case',
        domain,
        url,
        message: `[FETCH_SUCCESS] Got response in ${duration}ms`,
        details: {
          case: 'fetch_success',
          url,
          durationMs: duration,
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get('content-type'),
        },
      });
      
      return response;
    }).pipe(
      Effect.catchAll((error) => 
        Effect.gen(function* () {
          clearTimeout(timeoutId);
          const duration = Date.now() - startMs;
          
          // Log fetch error
          yield* logger.logEvent({
            type: 'edge_case',
            domain,
            url,
            message: `[FETCH_ERROR] Failed after ${duration}ms`,
            details: {
              case: 'fetch_failed',
              url,
              durationMs: duration,
              error: error.name,
              message: error.message,
              isAborted: error.name === 'AbortError',
            },
          });
          
          return yield* Effect.fail(error);
        })
      )
    );
    
    return Effect.runPromise(fetchEffect);
  };
});

export const LoggingFetch =
  Context.GenericTag<(url: string, options?: RequestInit) => Promise<Response>>(
    'LoggingFetch'
  );
