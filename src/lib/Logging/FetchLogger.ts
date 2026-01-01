import { Context, Data, DateTime, Duration, Effect, Option } from 'effect';
import { SpiderLogger } from './SpiderLogger.service.js';

/**
 * Tagged error for fetch operations
 */
export class FetchError extends Data.TaggedError('FetchError')<{
  readonly url: string;
  readonly reason: 'timeout' | 'network' | 'unknown';
  readonly durationMs: number;
  readonly cause?: unknown;
}> {
  get message(): string {
    return `Fetch failed for ${this.url}: ${this.reason} after ${this.durationMs}ms`;
  }
}

/**
 * Wrapper for fetch that adds comprehensive logging
 */
export const makeLoggingFetch = Effect.gen(function* () {
  const logger = yield* SpiderLogger;

  return (url: string, options?: RequestInit): Effect.Effect<Response, FetchError> =>
    Effect.gen(function* () {
      const startTime = yield* DateTime.now;
      const startMs = DateTime.toEpochMillis(startTime);
      const domain = new URL(url).hostname;

      // Log fetch start with Option for optional details
      const optionDetails = Option.fromNullable(options).pipe(
        Option.map((opts) => ({
          method: opts.method,
          headers: Object.keys(opts.headers ?? {}),
        }))
      );

      yield* logger.logEvent({
        type: 'edge_case',
        domain,
        url,
        message: '[FETCH_START] Starting fetch request',
        details: {
          case: 'fetch_start',
          url,
          timestamp: DateTime.formatIso(startTime),
          options: Option.getOrUndefined(optionDetails),
        },
      });

      // Create the fetch effect with timeout handling
      // Note: We use startMs captured from DateTime.now for duration calculation
      const fetchEffect = Effect.tryPromise({
        try: () => globalThis.fetch(url, options),
        catch: (error): FetchError =>
          new FetchError({
            url,
            reason: 'network',
            durationMs: 0, // Duration will be calculated in error handler
            cause: error,
          }),
      });

      // Apply 30 second timeout
      const timeoutDuration = Duration.seconds(30);

      const fetchWithTimeout = fetchEffect.pipe(
        Effect.timeoutOption(timeoutDuration),
        Effect.flatMap((maybeResponse) =>
          Option.match(maybeResponse, {
            onNone: () =>
              Effect.gen(function* () {
                const currentTime = yield* DateTime.now;
                const durationMs = DateTime.toEpochMillis(currentTime) - startMs;

                yield* logger.logEvent({
                  type: 'edge_case',
                  domain,
                  url,
                  message: `[FETCH_ABORT] Aborting fetch after ${durationMs}ms`,
                  details: {
                    case: 'fetch_abort',
                    url,
                    durationMs,
                    reason: 'timeout',
                  },
                });

                return yield* Effect.fail(
                  new FetchError({
                    url,
                    reason: 'timeout',
                    durationMs: Number(durationMs),
                  })
                );
              }),
            onSome: (response) => Effect.succeed(response),
          })
        )
      );

      // Execute fetch with timeout
      const response = yield* fetchWithTimeout.pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            const currentTime = yield* DateTime.now;
            const durationMs = DateTime.toEpochMillis(currentTime) - startMs;

            // Log fetch error
            yield* logger.logEvent({
              type: 'edge_case',
              domain,
              url,
              message: `[FETCH_ERROR] Failed after ${durationMs}ms`,
              details: {
                case: 'fetch_failed',
                url,
                durationMs,
                error: error._tag,
                message: error.message,
                isAborted: error.reason === 'timeout',
              },
            });

            return yield* Effect.fail(error);
          })
        )
      );

      // Log successful response
      const endTime = yield* DateTime.now;
      const durationMs = DateTime.toEpochMillis(endTime) - startMs;

      yield* logger.logEvent({
        type: 'edge_case',
        domain,
        url,
        message: `[FETCH_SUCCESS] Got response in ${durationMs}ms`,
        details: {
          case: 'fetch_success',
          url,
          durationMs,
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get('content-type'),
        },
      });

      return response;
    });
});

export type LoggingFetchFn = (
  url: string,
  options?: RequestInit
) => Effect.Effect<Response, FetchError>;

export const LoggingFetch = Context.GenericTag<LoggingFetchFn>('LoggingFetch');
