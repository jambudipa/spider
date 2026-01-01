/**
 * Effect Migration Utilities
 * Helper functions for migrating to idiomatic Effect patterns
 */

import { Option, Effect, Schema } from 'effect';

/**
 * Safely parse JSON with typed error handling
 */
export const safeJsonParse = <E>(
  data: string,
  onError: (error: unknown) => E
) =>
  Schema.decodeUnknown(Schema.parseJson(Schema.Unknown))(data).pipe(
    Effect.mapError(onError)
  );

/**
 * Convert nullable value to Option with logging
 * Returns an Effect when logging is needed, otherwise returns the Option directly
 */
export const toOption = <T>(
  value: T | null | undefined,
  logContext?: string
): Effect.Effect<Option.Option<T>> => {
  const result = Option.fromNullable(value);

  if (logContext && Option.isNone(result)) {
    return Effect.logDebug(`[Migration] Null value encountered: ${logContext}`).pipe(
      Effect.map(() => result)
    );
  }

  return Effect.succeed(result);
};

/**
 * Helper for migrating Promise-based functions to Effect
 */
export const fromPromise = <A, E>(
  promise: () => Promise<A>,
  onError: (error: unknown) => E
) =>
  Effect.tryPromise({
    try: promise,
    catch: onError
  });

/**
 * Helper for parallel resource cleanup with error collection
 */
export const cleanupResources = <E>(
  resources: Array<{
    id: string;
    cleanup: () => Promise<void>;
    onError: (id: string, error: unknown) => E;
  }>
) =>
  Effect.all(
    resources.map(({ id, cleanup, onError }) =>
      Effect.tryPromise({
        try: cleanup,
        catch: (error) => onError(id, error)
      })
    ),
    { mode: 'either' }
  );

/**
 * Pattern matching helper for Option migration
 */
export const matchOption = <A, B>(
  option: Option.Option<A>,
  onNone: () => B,
  onSome: (value: A) => B
): B => Option.match(option, { onNone, onSome });