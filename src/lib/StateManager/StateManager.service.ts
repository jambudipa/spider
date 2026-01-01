/**
 * State Manager Service
 * Manages tokens, sessions, and client-side storage simulation
 */

import { Context, Data, DateTime, Effect, HashMap, Layer, Option, Ref } from 'effect';
import * as cheerio from 'cheerio';

// Tagged error types for Effect-style error handling
export class CSRFTokenNotFoundError extends Data.TaggedError('CSRFTokenNotFoundError')<{
  readonly message: string;
}> {}

export class APITokenNotFoundError extends Data.TaggedError('APITokenNotFoundError')<{
  readonly message: string;
}> {}

export class TokenNotFoundError extends Data.TaggedError('TokenNotFoundError')<{
  readonly message: string;
  readonly tokenType: TokenType;
}> {}

export class TokenExpiredError extends Data.TaggedError('TokenExpiredError')<{
  readonly message: string;
  readonly tokenType: TokenType;
}> {}

export class StorageKeyNotFoundError extends Data.TaggedError('StorageKeyNotFoundError')<{
  readonly message: string;
  readonly key: string;
  readonly storageType: 'local' | 'session';
}> {}

export enum TokenType {
  CSRF = 'csrf',
  API = 'api',
  AUTH = 'auth',
  REFRESH = 'refresh',
}

export interface Token {
  type: TokenType;
  value: string;
  expiry?: Date;
  scope?: string[];
}

export interface StateManagerService {
  /**
   * Extract CSRF token from HTML
   */
  extractCSRFToken: (html: string) => Effect.Effect<string, CSRFTokenNotFoundError>;

  /**
   * Extract API token from JavaScript
   */
  extractAPIToken: (scripts: string[]) => Effect.Effect<string, APITokenNotFoundError>;

  /**
   * Store a token
   */
  storeToken: (
    type: TokenType,
    token: string,
    expiry?: Date
  ) => Effect.Effect<void>;

  /**
   * Get a stored token
   */
  getToken: (type: TokenType) => Effect.Effect<string, TokenNotFoundError | TokenExpiredError>;

  /**
   * Check if token is valid (not expired)
   */
  isTokenValid: (type: TokenType) => Effect.Effect<boolean>;

  /**
   * Simulate local storage
   */
  setLocalStorage: (
    key: string,
    value: string
  ) => Effect.Effect<void>;
  getLocalStorage: (key: string) => Effect.Effect<string, StorageKeyNotFoundError>;
  clearLocalStorage: () => Effect.Effect<void>;

  /**
   * Simulate session storage
   */
  setSessionStorage: (
    key: string,
    value: string
  ) => Effect.Effect<void>;
  getSessionStorage: (key: string) => Effect.Effect<string, StorageKeyNotFoundError>;
  clearSessionStorage: () => Effect.Effect<void>;

  /**
   * Clear all state
   */
  clearState: () => Effect.Effect<void>;
}

export class StateManager extends Context.Tag('StateManager')<
  StateManager,
  StateManagerService
>() {}

/**
 * Create a StateManager service implementation
 */
export const makeStateManager = (): Effect.Effect<StateManagerService> =>
  Effect.gen(function* () {
    // Token storage using Effect's HashMap
    const tokens = yield* Ref.make(HashMap.empty<TokenType, Token>());

    // Browser storage simulation using Effect's HashMap
    const localStorage = yield* Ref.make(HashMap.empty<string, string>());
    const sessionStorage = yield* Ref.make(HashMap.empty<string, string>());

    return {
      extractCSRFToken: (html: string) =>
        Effect.gen(function* () {
          const $ = cheerio.load(html);

          // Common CSRF token patterns
          const csrfSelectors = [
            'meta[name="csrf-token"]',
            'meta[name="_csrf"]',
            'meta[name="csrf_token"]',
            'meta[name="authenticity_token"]',
            'input[name="csrf_token"]',
            'input[name="_csrf"]',
            'input[name="authenticity_token"]',
            'input[name="__RequestVerificationToken"]',
          ];

          for (const selector of csrfSelectors) {
            const element = $(selector);
            if (element.length > 0) {
              const token = element.attr('content') || element.attr('value');
              if (token) {
                return token;
              }
            }
          }

          // Try to find in JavaScript
          const scriptTags = $('script:not([src])');
          const scriptContent = scriptTags
            .map((_, el) => $(el).html())
            .get()
            .join('\n');

          // Common JavaScript patterns
          const patterns = [
            /window\.csrfToken\s*=\s*["']([^"']+)["']/,
            /csrf[_-]?token["']?\s*[:=]\s*["']([^"']+)["']/i,
            /_token["']?\s*[:=]\s*["']([^"']+)["']/,
            /authenticity_token["']?\s*[:=]\s*["']([^"']+)["']/,
            /X-CSRF-Token["']?\s*[:=]\s*["']([^"']+)["']/,
          ];

          for (const pattern of patterns) {
            const match = scriptContent.match(pattern);
            if (match?.[1]) {
              return match[1];
            }
          }

          return yield* Effect.fail(new CSRFTokenNotFoundError({ message: 'CSRF token not found in HTML' }));
        }),

      extractAPIToken: (scripts: string[]) =>
        Effect.gen(function* () {
          const scriptContent = scripts.join('\n');

          // Common API token patterns
          const patterns = [
            /api[_-]?key["']?\s*[:=]\s*["']([^"']+)["']/i,
            /api[_-]?token["']?\s*[:=]\s*["']([^"']+)["']/i,
            /X-Secret-Token["']?\s*[:=]\s*["']([^"']+)["']/,
            /authorization["']?\s*[:=]\s*["']Bearer\s+([^"']+)["']/i,
            /access[_-]?token["']?\s*[:=]\s*["']([^"']+)["']/i,
            /secret[_-]?key["']?\s*[:=]\s*["']([^"']+)["']/i,
          ];

          for (const pattern of patterns) {
            const match = scriptContent.match(pattern);
            if (match?.[1]) {
              return match[1];
            }
          }

          // Try to find in window object assignments
          const windowPattern =
            /window\[["']([^"']*[Tt]oken[^"']*)["']\]\s*=\s*["']([^"']+)["']/g;
          const windowMatches = Array.from(scriptContent.matchAll(windowPattern));
          for (const windowMatch of windowMatches) {
            if (windowMatch[2]) {
              return windowMatch[2];
            }
          }

          return yield* Effect.fail(
            new APITokenNotFoundError({ message: 'API token not found in scripts' })
          );
        }),

      storeToken: (type: TokenType, value: string, expiry?: Date) =>
        Effect.gen(function* () {
          const token: Token = {
            type,
            value,
            expiry,
          };

          yield* Ref.update(tokens, (tokensMap) => HashMap.set(tokensMap, type, token));
        }),

      getToken: (type: TokenType) =>
        Effect.gen(function* () {
          const tokensMap = yield* Ref.get(tokens);
          const tokenOption = HashMap.get(tokensMap, type);

          if (Option.isNone(tokenOption)) {
            return yield* Effect.fail(
              new TokenNotFoundError({ message: `Token of type ${type} not found`, tokenType: type })
            );
          }

          const token = tokenOption.value;

          // Check if expired using DateTime
          if (token.expiry) {
            const now = DateTime.unsafeNow();
            const expiryDateTime = DateTime.unsafeMake(token.expiry);
            if (DateTime.lessThan(expiryDateTime, now)) {
              return yield* Effect.fail(
                new TokenExpiredError({ message: `Token of type ${type} has expired`, tokenType: type })
              );
            }
          }

          return token.value;
        }),

      isTokenValid: (type: TokenType) =>
        Effect.gen(function* () {
          const tokensMap = yield* Ref.get(tokens);
          const tokenOption = HashMap.get(tokensMap, type);

          if (Option.isNone(tokenOption)) {
            return false;
          }

          const token = tokenOption.value;

          if (token.expiry) {
            const now = DateTime.unsafeNow();
            const expiryDateTime = DateTime.unsafeMake(token.expiry);
            if (DateTime.lessThan(expiryDateTime, now)) {
              return false;
            }
          }

          return true;
        }),

      setLocalStorage: (key: string, value: string) =>
        Effect.gen(function* () {
          yield* Ref.update(localStorage, (storage) => HashMap.set(storage, key, value));
        }),

      getLocalStorage: (key: string) =>
        Effect.gen(function* () {
          const storage = yield* Ref.get(localStorage);
          const valueOption = HashMap.get(storage, key);

          if (Option.isNone(valueOption)) {
            return yield* Effect.fail(
              new StorageKeyNotFoundError({ message: `Local storage key '${key}' not found`, key, storageType: 'local' })
            );
          }

          return valueOption.value;
        }),

      clearLocalStorage: () =>
        Effect.gen(function* () {
          yield* Ref.set(localStorage, HashMap.empty());
        }),

      setSessionStorage: (key: string, value: string) =>
        Effect.gen(function* () {
          yield* Ref.update(sessionStorage, (storage) => HashMap.set(storage, key, value));
        }),

      getSessionStorage: (key: string) =>
        Effect.gen(function* () {
          const storage = yield* Ref.get(sessionStorage);
          const valueOption = HashMap.get(storage, key);

          if (Option.isNone(valueOption)) {
            return yield* Effect.fail(
              new StorageKeyNotFoundError({ message: `Session storage key '${key}' not found`, key, storageType: 'session' })
            );
          }

          return valueOption.value;
        }),

      clearSessionStorage: () =>
        Effect.gen(function* () {
          yield* Ref.set(sessionStorage, HashMap.empty());
        }),

      clearState: () =>
        Effect.gen(function* () {
          yield* Ref.set(tokens, HashMap.empty());
          yield* Ref.set(localStorage, HashMap.empty());
          yield* Ref.set(sessionStorage, HashMap.empty());
        }),
    };
  });

/**
 * StateManager Layer
 */
export const StateManagerLive = Layer.effect(StateManager, makeStateManager());
