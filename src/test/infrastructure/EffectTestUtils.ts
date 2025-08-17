/**
 * Effect Test Utilities - Fixed Version
 * Helper functions for testing with Effect-TS
 */

import { Duration, Effect, Exit, Layer, Option, pipe } from 'effect';

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
