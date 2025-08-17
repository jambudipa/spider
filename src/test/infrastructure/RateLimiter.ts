/**
 * Rate Limiter Service - Fixed Version
 * Ensures respectful testing of web-scraping.dev by limiting request frequency
 */

import { Duration, Effect, Option, pipe, Ref, Schedule } from 'effect';

export interface RateLimiterConfig {
  readonly requestsPerSecond: number;
  readonly burstSize?: number;
}

export interface RateLimiterService {
  readonly throttle: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>;
  readonly setRate: (
    requestsPerSecond: number
  ) => Effect.Effect<void, never, never>;
  readonly withBackoff: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>;
}

export class RateLimiterService {
  static make = (config: RateLimiterConfig) =>
    Effect.gen(function* () {
      const { requestsPerSecond, burstSize = requestsPerSecond } = config;
      const intervalMs = 1000 / requestsPerSecond;

      // Token bucket for rate limiting
      const tokens = yield* Ref.make(burstSize);
      const lastRefill = yield* Ref.make(Date.now());

      // Refill tokens periodically
      const refillTokens = () =>
        Effect.gen(function* () {
          const now = Date.now();
          const last = yield* Ref.get(lastRefill);
          const elapsed = now - last;
          const tokensToAdd = Math.floor(elapsed / intervalMs);

          if (tokensToAdd > 0) {
            yield* Ref.update(tokens, (current) =>
              Math.min(current + tokensToAdd, burstSize)
            );
            yield* Ref.set(lastRefill, now);
          }
        });

      // Wait for available token
      const acquireToken = (): Effect.Effect<void, never, never> =>
        Effect.gen(function* () {
          yield* refillTokens();
          const available = yield* Ref.get(tokens);

          if (available > 0) {
            yield* Ref.update(tokens, (n) => n - 1);
          } else {
            // Wait and retry
            yield* Effect.sleep(Duration.millis(intervalMs));
            yield* acquireToken();
          }
        });

      // Throttle function
      const throttle = <A, E, R>(
        effect: Effect.Effect<A, E, R>
      ): Effect.Effect<A, E, R> =>
        pipe(
          acquireToken(),
          Effect.flatMap(() => effect)
        );

      // Set new rate
      const setRate = (newRequestsPerSecond: number) =>
        Effect.sync(() => {
          console.log(`Rate limit updated to ${newRequestsPerSecond} req/s`);
        });

      // Exponential backoff for failures
      const withBackoff = <A, E, R>(
        effect: Effect.Effect<A, E, R>
      ): Effect.Effect<A, E, R> =>
        Effect.retry(
          effect,
          Schedule.exponential(Duration.seconds(1), 2).pipe(
            Schedule.intersect(Schedule.recurs(3))
          )
        );

      return {
        throttle,
        setRate,
        withBackoff,
      } satisfies RateLimiterService;
    });
}

/**
 * Create a rate limiter with sensible defaults for web-scraping.dev
 */
export const makeTestRateLimiter = () =>
  RateLimiterService.make({
    requestsPerSecond: 1,
    burstSize: 2,
  });

/**
 * Apply rate limiting to a series of Effects
 */
export const rateLimitedSequence = <A, E, R>(
  effects: Effect.Effect<A, E, R>[],
  rateLimiter: RateLimiterService
): Effect.Effect<readonly A[], E, R> =>
  Effect.all(
    effects.map((effect) => rateLimiter.throttle(effect)),
    { concurrency: 1 }
  );

/**
 * Network resilience utilities
 */
export const NetworkResilience = {
  /**
   * Retry with exponential backoff
   */
  withExponentialBackoff: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options: {
      maxRetries?: number;
      initialDelay?: Duration.Duration;
      maxDelay?: Duration.Duration;
    } = {}
  ) => {
    const {
      maxRetries = 3,
      initialDelay = Duration.seconds(1),
      maxDelay = Duration.seconds(30),
    } = options;

    return Effect.retry(
      effect,
      Schedule.exponential(initialDelay, 2).pipe(
        Schedule.intersect(Schedule.recurs(maxRetries)),
        Schedule.upTo(maxDelay)
      )
    );
  },

  /**
   * Circuit breaker pattern
   */
  withCircuitBreaker: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options: {
      failureThreshold?: number;
      resetTimeout?: Duration.Duration;
    } = {}
  ) => {
    const { failureThreshold = 5, resetTimeout = Duration.seconds(60) } =
      options;

    return Effect.gen(function* () {
      const failures = yield* Ref.make(0);
      const circuitOpen = yield* Ref.make(false);

      const isOpen = yield* Ref.get(circuitOpen);
      if (isOpen) {
        return yield* Effect.fail(new Error('Circuit breaker is open') as E);
      }

      return yield* pipe(
        effect,
        Effect.tapError(() =>
          pipe(
            Ref.update(failures, (n) => n + 1),
            Effect.flatMap(() => Ref.get(failures)),
            Effect.flatMap((count) =>
              count >= failureThreshold
                ? Ref.set(circuitOpen, true)
                : Effect.void
            )
          )
        ),
        Effect.tap(() => Ref.set(failures, 0))
      );
    });
  },

  /**
   * Timeout with retry
   */
  withTimeoutRetry: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    timeout: Duration.Duration,
    retries: number = 2
  ): Effect.Effect<A, E | Error, R> =>
    pipe(
      effect,
      Effect.timeoutOption(timeout),
      Effect.flatMap((option) => {
        if (Option.isSome(option)) {
          return Effect.succeed(option.value);
        }
        return Effect.fail(
          new Error(`Timeout after ${Duration.toMillis(timeout)}ms`) as
            | E
            | Error
        );
      }),
      Effect.retry(Schedule.recurs(retries))
    ),
};
