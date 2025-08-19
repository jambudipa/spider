/**
 * Effect Test Utilities - Enhanced Version
 * Comprehensive helper functions and test infrastructure for Effect-based testing
 */

import { Duration, Effect, Exit, Layer, Option, pipe, TestClock, Clock, Ref, Random } from 'effect';

/**
 * Run an Effect and return its result as a Promise
 */
export const runTest = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
  Effect.runPromise(effect);

/**
 * Run an Effect synchronously
 */
export const runTestSync = <A, E>(effect: Effect.Effect<A, E, never>): A =>
  Effect.runSync(effect);

/**
 * Run an Effect and get the Exit result
 */
export const runForExit = <A, E>(
  effect: Effect.Effect<A, E, never>
): Promise<Exit.Exit<A, E>> => Effect.runPromiseExit(effect);

/**
 * Assert that an Effect succeeds
 */
export const expectSuccess = async <A, E>(
  effect: Effect.Effect<A, E, never>
): Promise<A> => {
  const exit = await runForExit(effect);
  if (Exit.isFailure(exit)) {
    throw new Error(
      `Expected success but got failure: ${JSON.stringify(exit.cause)}`
    );
  }
  return exit.value;
};

/**
 * Helper to extract value from Option with timeout
 */
export const unwrapOption = <A>(
  option: Option.Option<A>
): Effect.Effect<A, Error, never> =>
  Option.isSome(option)
    ? Effect.succeed(option.value)
    : Effect.fail(new Error('Option is None'));

/**
 * Extract value from Effect<Option<A>> with timeout
 */
export const extractWithTimeout = <A, E>(
  effect: Effect.Effect<Option.Option<A>, E, never>,
  timeout: Duration.Duration = Duration.seconds(5)
): Effect.Effect<A, Error | E, never> =>
  pipe(
    effect,
    Effect.timeoutOption(timeout),
    Effect.flatMap((optionResult) => {
      if (Option.isSome(optionResult)) {
        return unwrapOption(optionResult.value);
      }
      return Effect.fail(new Error('Timeout'));
    })
  );

/**
 * Assert that an Effect fails
 */
export const expectFailure = async <A, E>(
  effect: Effect.Effect<A, E, never>
): Promise<E> => {
  const exit = await runForExit(effect);
  if (Exit.isSuccess(exit)) {
    throw new Error(
      `Expected failure but got success: ${JSON.stringify(exit.value)}`
    );
  }
  // Extract the error from the cause
  const cause = exit.cause;
  if ('_tag' in cause && cause._tag === 'Fail') {
    return (cause as any).error;
  }
  throw new Error(`Unexpected failure cause: ${JSON.stringify(cause)}`);
};

/**
 * Run Effect with test context
 */
export const runWithContext = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  context: Layer.Layer<R, never, never>
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
  layer1: Layer.Layer<R1, never, never>,
  layer2: Layer.Layer<R2, never, never>
): Layer.Layer<R1 & R2, never, never> => Layer.merge(layer1, layer2);

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
): Effect.Effect<void, Error, never> => {
  const {
    timeout = Duration.seconds(5),
    interval = Duration.millis(100),
    message = 'Condition not met within timeout',
  } = options;

  const check = (): Effect.Effect<void, Error, never> =>
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
      return Effect.fail(new Error(message));
    })
  );
};

/**
 * Create Effect assertion helper
 */
export const expectEffect = <A>(
  effect: Effect.Effect<A, any, never>
): {
  toSucceedWith: (expected: A) => Promise<void>;
  toSucceed: () => Promise<A>;
  toFail: () => Promise<any>;
  toFailWith: (errorCheck: (error: any) => boolean) => Promise<void>;
} => ({
  toSucceedWith: async (expected: A) => {
    const result = await expectSuccess(effect);
    if (JSON.stringify(result) !== JSON.stringify(expected)) {
      throw new Error(
        `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(result)}`
      );
    }
  },
  toSucceed: () => expectSuccess(effect),
  toFail: () => expectFailure(effect),
  toFailWith: async (errorCheck: (error: any) => boolean) => {
    const error = await expectFailure(effect);
    if (!errorCheck(error)) {
      throw new Error(
        `Error did not match expected condition: ${JSON.stringify(error)}`
      );
    }
  },
});

/**
 * Run Effect synchronously with test services
 */
export const runSyncWithTestServices = <A, E>(
  effect: Effect.Effect<A, E, never>,
  options: {
    seed?: number;
    currentTime?: number;
  } = {}
): A => {
  const testEffect = effect;
  
  if (options.currentTime) {
    Effect.runSync(TestClock.setTime(options.currentTime));
  }
  
  return Effect.runSync(testEffect);
};

/**
 * Create a mock service layer
 */
export const createMockServiceLayer = <T extends Record<string, any>>(
  tag: any,
  implementation: T
): Layer.Layer<any, never, never> => 
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
  effect: Effect.Effect<A, E, never>,
  maxAttempts: number = 3
): Effect.Effect<{
  result: Exit.Exit<A, E>;
  attempts: number;
}, never, never> => 
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
  effect: Effect.Effect<A, E, never>,
  duration: Duration.Duration
): Effect.Effect<Option.Option<A>, E, never> =>
  Effect.timeoutOption(effect, duration);

/**
 * Helper for testing concurrent operations
 */
export const testConcurrent = <A, E>(
  effects: Effect.Effect<A, E, never>[],
  options: {
    concurrency?: number;
  } = {}
): Effect.Effect<A[], E, never> =>
  Effect.all(effects, { concurrency: options.concurrency });

/**
 * Create a test environment with all common test services
 */
export const createTestEnvironment = () => {
  const cleanup: Array<() => void> = [];
  
  return {
    provide: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
      layer: Layer.Layer<R, never, never>
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
  randomString: (length: number = 10): Effect.Effect<string, never, never> =>
    Effect.gen(function* () {
      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let result = '';
      for (let i = 0; i < length; i++) {
        const index = yield* Random.nextIntBetween(0, chars.length);
        result += chars[index];
      }
      return result;
    }),
  
  randomNumber: (min: number, max: number): Effect.Effect<number, never, never> =>
    Random.nextIntBetween(min, max),
  
  randomBoolean: (): Effect.Effect<boolean, never, never> =>
    Random.nextBoolean
};

/**
 * Matcher for Effect errors
 */
export const errorMatchers = {
  isTaggedError: (error: unknown, tag: string): boolean => {
    return typeof error === 'object' && 
           error !== null && 
           '_tag' in error && 
           error._tag === tag;
  },
  
  hasMessage: (error: unknown, message: string | RegExp): boolean => {
    if (typeof error === 'object' && error !== null && 'message' in error) {
      const errorMessage = String(error.message);
      return typeof message === 'string' 
        ? errorMessage.includes(message)
        : message.test(errorMessage);
    }
    return false;
  },
  
  hasProperty: (error: unknown, property: string, value?: any): boolean => {
    if (typeof error === 'object' && error !== null && property in error) {
      if (value === undefined) return true;
      return (error as any)[property] === value;
    }
    return false;
  }
};

/**
 * Test fixtures factory
 */
export const createFixture = <T>(
  setup: () => Effect.Effect<T, never, never>,
  teardown?: (fixture: T) => Effect.Effect<void, never, never>
) => {
  let fixture: T | null = null;
  
  return {
    use: async <A>(
      test: (fixture: T) => Effect.Effect<A, any, never>
    ): Promise<A> => {
      try {
        fixture = await Effect.runPromise(setup());
        return await Effect.runPromise(test(fixture));
      } finally {
        if (fixture && teardown) {
          await Effect.runPromise(teardown(fixture));
        }
      }
    }
  };
};