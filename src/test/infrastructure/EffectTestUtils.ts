/**
 * Effect Test Utilities - Enhanced Version
 * Comprehensive helper functions and test infrastructure for Effect-based testing
 */

import { Cause, Context, Data, Duration, Effect, Exit, Layer, Option, pipe, TestClock, Ref, Random } from 'effect';

// TaggedError for test utilities
class TestError extends Data.TaggedError('TestError')<{
  readonly message: string;
}> {}

class TimeoutError extends Data.TaggedError('TimeoutError')<{
  readonly message: string;
}> {}

class AssertionError extends Data.TaggedError('AssertionError')<{
  readonly message: string;
}> {}

class ConditionTimeoutError extends Data.TaggedError('ConditionTimeoutError')<{
  readonly message: string;
}> {}

/**
 * Run an Effect and return its result as a Promise
 */
export const runTest = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect);

/**
 * Run an Effect synchronously - intended for test setup only
 */
export const runTestSync = <A, E>(effect: Effect.Effect<A, E>): A =>
  // eslint-disable-next-line effect/no-effect-runsync-unguarded -- Test utility at program boundary
  Effect.runSync(effect);

/**
 * Run an Effect and get the Exit result
 */
export const runForExit = <A, E>(
  effect: Effect.Effect<A, E>
): Promise<Exit.Exit<A, E>> => Effect.runPromiseExit(effect);

/**
 * Assert that an Effect succeeds - returns Effect for composition
 */
export const expectSuccessEffect = <A, E>(
  effect: Effect.Effect<A, E>
): Effect.Effect<A, AssertionError | E> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect);
    if (Exit.isFailure(exit)) {
      return yield* Effect.fail(new AssertionError({
        message: `Expected success but got failure: ${Cause.pretty(exit.cause)}`
      }));
    }
    return exit.value;
  });

/**
 * Assert that an Effect succeeds - Promise-based for test frameworks
 */
export const expectSuccess = <A, E>(
  effect: Effect.Effect<A, E>
): Promise<A> => Effect.runPromise(expectSuccessEffect(effect));

/**
 * Helper to extract value from Option with timeout
 */
export const unwrapOption = <A>(
  option: Option.Option<A>
): Effect.Effect<A, TestError> =>
  Option.isSome(option)
    ? Effect.succeed(option.value)
    : Effect.fail(new TestError({ message: 'Option is None' }));

/**
 * Extract value from Effect<Option<A>> with timeout
 */
export const extractWithTimeout = <A, E>(
  effect: Effect.Effect<Option.Option<A>, E>,
  timeout: Duration.Duration = Duration.seconds(5)
): Effect.Effect<A, TestError | TimeoutError | E> =>
  Effect.gen(function* () {
    const optionResult = yield* Effect.timeoutOption(effect, timeout);
    if (Option.isSome(optionResult)) {
      return yield* unwrapOption(optionResult.value);
    }
    return yield* Effect.fail(new TimeoutError({ message: 'Timeout' }));
  });

/**
 * Assert that an Effect fails - returns Effect for composition
 */
export const expectFailureEffect = <A, E>(
  effect: Effect.Effect<A, E>
): Effect.Effect<E, AssertionError> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect);
    if (Exit.isSuccess(exit)) {
      return yield* Effect.fail(new AssertionError({
        message: `Expected failure but got success`
      }));
    }
    // Extract the error from the cause using Cause utilities
    const failureOption = Cause.failureOption(exit.cause);
    if (Option.isSome(failureOption)) {
      return failureOption.value;
    }
    return yield* Effect.fail(new AssertionError({
      message: `Unexpected failure cause: ${Cause.pretty(exit.cause)}`
    }));
  });

/**
 * Assert that an Effect fails - Promise-based for test frameworks
 */
export const expectFailure = <A, E>(
  effect: Effect.Effect<A, E>
): Promise<E> => Effect.runPromise(expectFailureEffect(effect));

/**
 * Run Effect with test context
 */
export const runWithContext = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  context: Layer.Layer<R>
): Promise<A> => Effect.runPromise(pipe(effect, Effect.provide(context)));

/**
 * Create a test layer
 */
export const createTestLayer = <ROut, E = never, RIn = never>(
  layer: Layer.Layer<ROut, E, RIn>
): Layer.Layer<ROut, E, RIn> => layer;

/**
 * Combine multiple test layers
 */
export const combineTestLayers = <R1, R2>(
  layer1: Layer.Layer<R1>,
  layer2: Layer.Layer<R2>
): Layer.Layer<R1 & R2> => Layer.merge(layer1, layer2);

/**
 * Wait for condition with timeout
 */
export const waitForCondition = (
  predicate: () => boolean,
  options: {
    timeout?: Duration.Duration;
    interval?: Duration.Duration;
    message?: string;
  } = {}
): Effect.Effect<void, ConditionTimeoutError> => {
  const {
    timeout = Duration.seconds(5),
    interval = Duration.millis(100),
    message = 'Condition not met within timeout',
  } = options;

  const check = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (predicate()) {
        return;
      }
      yield* Effect.sleep(interval);
      yield* check();
    });

  return pipe(
    check(),
    Effect.timeoutOption(timeout),
    Effect.flatMap((option) => {
      if (Option.isSome(option)) {
        return Effect.void;
      }
      return Effect.fail(new ConditionTimeoutError({ message }));
    })
  );
};

/**
 * Create Effect assertion helper - Effect-based version
 */
export const expectEffectGen = <A, E>(
  effect: Effect.Effect<A, E>
): {
  toSucceedWith: (expected: A) => Effect.Effect<void, AssertionError | E>;
  toSucceed: () => Effect.Effect<A, AssertionError | E>;
  toFail: () => Effect.Effect<E, AssertionError>;
  toFailWith: (errorCheck: (error: E) => boolean) => Effect.Effect<void, AssertionError>;
} => ({
  toSucceedWith: (expected: A): Effect.Effect<void, AssertionError | E> =>
    Effect.gen(function* () {
      const result = yield* expectSuccessEffect(effect);
      // Simple equality check - for complex objects, users should use proper assertion libraries
      if (result !== expected) {
        return yield* Effect.fail(new AssertionError({
          message: `Expected values to be equal`
        }));
      }
    }),
  toSucceed: () => expectSuccessEffect(effect),
  toFail: () => expectFailureEffect(effect),
  toFailWith: (errorCheck: (error: E) => boolean): Effect.Effect<void, AssertionError> =>
    Effect.gen(function* () {
      const error = yield* expectFailureEffect(effect);
      if (!errorCheck(error)) {
        return yield* Effect.fail(new AssertionError({
          message: `Error did not match expected condition`
        }));
      }
    }),
});

/**
 * Run Effect synchronously with test services - test boundary utility
 */
export const runSyncWithTestServices = <A, E>(
  effect: Effect.Effect<A, E>,
  _options: {
    seed?: number;
    currentTime?: number;
  } = {}
): A => {
  // Note: TestClock.setTime requires TestServices context
  // For simple sync test execution, we just run the effect
  // eslint-disable-next-line effect/no-effect-runsync-unguarded -- Test utility at program boundary
  return Effect.runSync(effect);
};

/**
 * Create a mock service layer with proper typing
 */
export const createMockServiceLayer = <S, I>(
  tag: Context.Tag<I, S>,
  implementation: S
): Layer.Layer<I> =>
  Layer.succeed(tag, implementation);

/**
 * Test layer for common services
 */
export const commonTestLayers = {
  clock: TestClock.defaultTestClock,
  random: Layer.empty,
  deterministic: TestClock.defaultTestClock,
};

/**
 * Helper to test Effect retries
 */
export const testWithRetries = <A, E>(
  effect: Effect.Effect<A, E>,
  maxAttempts: number = 3
): Effect.Effect<{
  result: Exit.Exit<A, E>;
  attempts: number;
}> =>
  Effect.gen(function* () {
    const attemptsRef = yield* Ref.make(0);

    const trackedEffect = pipe(
      effect,
      Effect.tap(() => Ref.update(attemptsRef, n => n + 1)),
      Effect.retry({
        times: maxAttempts - 1
      })
    );

    const result = yield* Effect.exit(trackedEffect);
    const attempts = yield* Ref.get(attemptsRef);

    return { result, attempts };
  });

/**
 * Test helper for timeout scenarios
 */
export const testTimeout = <A, E>(
  effect: Effect.Effect<A, E>,
  duration: Duration.Duration
): Effect.Effect<Option.Option<A>, E> =>
  Effect.timeoutOption(effect, duration);

/**
 * Helper for testing concurrent operations
 */
export const testConcurrent = <A, E>(
  effects: Effect.Effect<A, E>[],
  options: {
    concurrency?: number;
  } = {}
): Effect.Effect<A[], E> =>
  Effect.all(effects, { concurrency: options.concurrency });

/**
 * Create a test environment with all common test services
 */
export const createTestEnvironment = () => {
  const cleanup: Array<() => void> = [];

  return {
    provide: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
      layer: Layer.Layer<R>
    ) => pipe(effect, Effect.provide(layer)),

    cleanup: () => {
      cleanup.forEach(fn => fn());
    },

    addCleanup: (fn: () => void) => {
      cleanup.push(fn);
    }
  };
};

/**
 * Test data generators
 */
export const testData = {
  randomString: (length: number = 10): Effect.Effect<string> =>
    Effect.gen(function* () {
      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let result = '';
      for (let i = 0; i < length; i++) {
        const index = yield* Random.nextIntBetween(0, chars.length);
        result += chars[index];
      }
      return result;
    }),

  randomNumber: (min: number, max: number): Effect.Effect<number> =>
    Random.nextIntBetween(min, max),

  randomBoolean: (): Effect.Effect<boolean> =>
    Random.nextBoolean
};

// Type guards for error matching
const isNonNullObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && Option.isSome(Option.fromNullable(value)) && !Option.isOption(value);

const hasTagProperty = (obj: Record<string, unknown>): obj is Record<string, unknown> & { _tag: unknown } =>
  '_tag' in obj;

const hasMessageProperty = (obj: Record<string, unknown>): obj is Record<string, unknown> & { message: unknown } =>
  'message' in obj;

/**
 * Matcher for Effect errors
 */
export const errorMatchers = {
  isTaggedError: (error: unknown, tag: string): boolean => {
    if (!isNonNullObject(error)) return false;
    if (!hasTagProperty(error)) return false;
    return error._tag === tag;
  },

  hasMessage: (error: unknown, message: string | RegExp): boolean => {
    if (!isNonNullObject(error)) return false;
    if (!hasMessageProperty(error)) return false;
    const errorMessage = String(error.message);
    return typeof message === 'string'
      ? errorMessage.includes(message)
      : message.test(errorMessage);
  },

  hasProperty: <T>(error: unknown, property: string, value?: T): boolean => {
    if (!isNonNullObject(error)) return false;
    if (!(property in error)) return false;
    if (Option.isNone(Option.fromNullable(value))) return true;
    return error[property] === value;
  }
};

/**
 * Test fixtures factory - Effect-based version
 */
export const createFixture = <T>(
  setup: () => Effect.Effect<T>,
  teardown?: (fixture: T) => Effect.Effect<void>
) => {
  return {
    use: <A, E>(
      test: (fixture: T) => Effect.Effect<A, E>
    ): Effect.Effect<A, E> =>
      Effect.gen(function* () {
        const fixture = yield* setup();
        const result = yield* Effect.ensuring(
          test(fixture),
          teardown ? teardown(fixture) : Effect.void
        );
        return result;
      }),

    usePromise: <A, E>(
      test: (fixture: T) => Effect.Effect<A, E>
    ): Promise<A> =>
      Effect.runPromise(
        Effect.gen(function* () {
          const fixture = yield* setup();
          const result = yield* Effect.ensuring(
            test(fixture),
            teardown ? teardown(fixture) : Effect.void
          );
          return result;
        })
      )
  };
};
