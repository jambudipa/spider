/**
 * Cookie Manager Service
 * Manages HTTP cookies for session persistence across requests
 */

import { Context, Effect, Layer, Ref } from 'effect';
import { Cookie, CookieJar } from 'tough-cookie';
import { JsonUtils } from '../utils/JsonUtils.js';

export interface CookieManagerService {
  /**
   * Set a cookie for a URL
   */
  setCookie: (
    cookieString: string,
    url: string
  ) => Effect.Effect<void, Error, never>;

  /**
   * Get all cookies for a URL
   */
  getCookies: (url: string) => Effect.Effect<string[], never, never>;

  /**
   * Get cookie header string for a URL
   */
  getCookieHeader: (url: string) => Effect.Effect<string | null, never, never>;

  /**
   * Clear all cookies
   */
  clearCookies: () => Effect.Effect<void, never, never>;

  /**
   * Serialize cookies for storage
   */
  serialize: () => Effect.Effect<string, never, never>;

  /**
   * Load cookies from serialized string
   */
  deserialize: (data: string) => Effect.Effect<void, Error, never>;
}

export class CookieManager extends Context.Tag('CookieManager')<
  CookieManager,
  CookieManagerService
>() {}

/**
 * Create a CookieManager service implementation
 */
export const makeCookieManager = (): Effect.Effect<
  CookieManagerService,
  never,
  never
> =>
  Effect.gen(function* () {
    // Create a cookie jar with an in-memory store
    const jar = new CookieJar();
    const jarRef = yield* Ref.make(jar);

    return {
      setCookie: (cookieString: string, url: string) =>
        Effect.gen(function* () {
          const jar = yield* Ref.get(jarRef);

          yield* Effect.tryPromise({
            try: () =>
              new Promise<void>((resolve, reject) => {
                jar.setCookie(cookieString, url, (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              }),
            catch: (error) => new Error(`Failed to set cookie: ${error}`),
          });
        }),

      getCookies: (url: string) =>
        Effect.gen(function* () {
          const jar = yield* Ref.get(jarRef);

          const cookies = yield* Effect.tryPromise({
            try: () =>
              new Promise<Cookie[]>((resolve, reject) => {
                jar.getCookies(url, (err, cookies) => {
                  if (err) reject(err);
                  else resolve(cookies || []);
                });
              }),
            catch: () => new Error(`Failed to get cookies for ${url}`),
          });

          return cookies.map((cookie) => cookie.toString());
        }).pipe(Effect.orElseSucceed(() => [])),

      getCookieHeader: (url: string) =>
        Effect.gen(function* () {
          const jar = yield* Ref.get(jarRef);

          const cookieHeader = yield* Effect.tryPromise({
            try: () =>
              new Promise<string | null>((resolve, reject) => {
                jar.getCookieString(url, (err, cookies) => {
                  if (err) reject(err);
                  else resolve(cookies || null);
                });
              }),
            catch: () => null,
          });

          return cookieHeader;
        }).pipe(Effect.orElseSucceed(() => null)),

      clearCookies: () =>
        Effect.gen(function* () {
          const newJar = new CookieJar();
          yield* Ref.set(jarRef, newJar);
        }),

      serialize: () =>
        Effect.gen(function* () {
          const jar = yield* Ref.get(jarRef);

          const serialized = yield* Effect.tryPromise({
            try: () =>
              new Promise<any>((resolve, reject) => {
                jar.serialize((err, serializedObject) => {
                  if (err) reject(err);
                  else resolve(serializedObject);
                });
              }),
            catch: () => new Error('Failed to serialize cookies'),
          });

          return yield* JsonUtils.stringify(serialized);
        }).pipe(Effect.orElseSucceed(() => '{}')),

      deserialize: (data: string) =>
        Effect.gen(function* () {
          // Parse JSON data using JsonUtils
          const parsed = yield* JsonUtils.parse(data).pipe(
            Effect.mapError(error => new Error(`Invalid cookie JSON format: ${error.message}`))
          );

          // Deserialize cookie jar with error handling
          const newJar = yield* Effect.tryPromise({
            try: () => CookieJar.deserialize(parsed as any),
            catch: (error) => new Error(`Failed to deserialize cookie jar: ${error}`)
          });

          // Set the new jar reference
          yield* Ref.set(jarRef, newJar as CookieJar);
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
