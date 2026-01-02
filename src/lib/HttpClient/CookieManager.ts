/**
 * Cookie Manager Service
 * Manages HTTP cookies for session persistence across requests
 */

import { Context, Data, Effect, Layer, Option, Ref, Schema } from 'effect';
import { Cookie, CookieJar } from 'tough-cookie';
import { JsonUtils, JsonParseError } from '../utils/JsonUtils.js';

// ============================================================================
// Schema for SerializedCookieJar (tough-cookie format)
// ============================================================================

/**
 * Schema for tough-cookie's SerializedCookieJar format.
 * We use a permissive schema since tough-cookie handles its own validation.
 */
const SerializedCookieJarSchema = Schema.Struct({
  version: Schema.String,
  storeType: Schema.String,
  rejectPublicSuffixes: Schema.Boolean,
  cookies: Schema.Array(Schema.Unknown),
});

// ============================================================================
// Error Types
// ============================================================================

export class CookieError extends Data.TaggedError('CookieError')<{
  readonly operation: 'set' | 'get' | 'serialize' | 'deserialize';
  readonly cause?: unknown;
  readonly message: string;
}> {
  static set(cause: unknown): CookieError {
    return new CookieError({
      operation: 'set',
      cause,
      message: `Failed to set cookie: ${cause}`,
    });
  }

  static get(url: string, cause: unknown): CookieError {
    return new CookieError({
      operation: 'get',
      cause,
      message: `Failed to get cookies for ${url}: ${cause}`,
    });
  }

  static serialize(cause: unknown): CookieError {
    return new CookieError({
      operation: 'serialize',
      cause,
      message: `Failed to serialize cookies: ${cause}`,
    });
  }

  static deserialize(cause: unknown): CookieError {
    return new CookieError({
      operation: 'deserialize',
      cause,
      message: `Failed to deserialize cookies: ${cause}`,
    });
  }
}

// ============================================================================
// Service Interface
// ============================================================================

export interface CookieManagerService {
  /**
   * Set a cookie for a URL
   */
  setCookie: (
    cookieString: string,
    url: string
  ) => Effect.Effect<void, CookieError>;

  /**
   * Get all cookies for a URL
   */
  getCookies: (url: string) => Effect.Effect<string[]>;

  /**
   * Get cookie header string for a URL
   */
  getCookieHeader: (url: string) => Effect.Effect<Option.Option<string>>;

  /**
   * Clear all cookies
   */
  clearCookies: () => Effect.Effect<void>;

  /**
   * Serialize cookies for storage
   */
  serialize: () => Effect.Effect<string>;

  /**
   * Load cookies from serialized string
   */
  deserialize: (data: string) => Effect.Effect<void, CookieError | JsonParseError>;
}

export class CookieManager extends Context.Tag('CookieManager')<
  CookieManager,
  CookieManagerService
>() {}

/**
 * Create a CookieManager service implementation
 */
export const makeCookieManager = (): Effect.Effect<CookieManagerService> =>
  Effect.gen(function* () {
    // Create a cookie jar with an in-memory store
    const jar = new CookieJar();
    const jarRef = yield* Ref.make(jar);

    return {
      setCookie: (cookieString: string, url: string) =>
        Effect.gen(function* () {
          const currentJar = yield* Ref.get(jarRef);

          yield* Effect.tryPromise({
            try: () => currentJar.setCookie(cookieString, url),
            catch: (error) => CookieError.set(error),
          });
        }),

      getCookies: (url: string) =>
        Effect.gen(function* () {
          const currentJar = yield* Ref.get(jarRef);

          const cookies = yield* Effect.tryPromise({
            try: () => currentJar.getCookies(url),
            catch: (error) => CookieError.get(url, error),
          });

          return cookies.map((cookie: Cookie) => cookie.toString());
        }).pipe(Effect.orElseSucceed(() => [])),

      getCookieHeader: (url: string) =>
        Effect.gen(function* () {
          const currentJar = yield* Ref.get(jarRef);

          const cookieHeader = yield* Effect.tryPromise({
            try: () => currentJar.getCookieString(url),
            catch: () => CookieError.get(url, 'Failed to get cookie string'),
          });

          return cookieHeader ? Option.some(cookieHeader) : Option.none();
        }).pipe(Effect.orElseSucceed(() => Option.none())),

      clearCookies: () =>
        Effect.gen(function* () {
          const newJar = new CookieJar();
          yield* Ref.set(jarRef, newJar);
        }),

      serialize: () =>
        Effect.gen(function* () {
          const currentJar = yield* Ref.get(jarRef);

          const serialized = yield* Effect.tryPromise({
            try: () => currentJar.serialize(),
            catch: (error) => CookieError.serialize(error),
          });

          return yield* JsonUtils.stringify(serialized);
        }).pipe(Effect.orElseSucceed(() => '{}')),

      deserialize: (data: string) =>
        Effect.gen(function* () {
          // Parse JSON data using JsonUtils with schema validation
          const parsed = yield* JsonUtils.parse(data, SerializedCookieJarSchema);

          // Deserialize cookie jar with error handling
          const newJar = yield* Effect.tryPromise({
            try: () => CookieJar.deserialize(parsed),
            catch: (error) => CookieError.deserialize(error),
          });

          // Set the new jar reference
          yield* Ref.set(jarRef, newJar);
        }),
    };
  });

/**
 * CookieManager Layer
 */
export const CookieManagerLive = Layer.effect(
  CookieManager,
  makeCookieManager()
);
