/**
 * State Manager Service
 * Manages tokens, sessions, and client-side storage simulation
 */

import { Context, Effect, Layer, Ref } from 'effect';
import * as cheerio from 'cheerio';

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
  extractCSRFToken: (html: string) => Effect.Effect<string, Error, never>;

  /**
   * Extract API token from JavaScript
   */
  extractAPIToken: (scripts: string[]) => Effect.Effect<string, Error, never>;

  /**
   * Store a token
   */
  storeToken: (
    type: TokenType,
    token: string,
    expiry?: Date
  ) => Effect.Effect<void, never, never>;

  /**
   * Get a stored token
   */
  getToken: (type: TokenType) => Effect.Effect<string, Error, never>;

  /**
   * Check if token is valid (not expired)
   */
  isTokenValid: (type: TokenType) => Effect.Effect<boolean, never, never>;

  /**
   * Simulate local storage
   */
  setLocalStorage: (
    key: string,
    value: string
  ) => Effect.Effect<void, never, never>;
  getLocalStorage: (key: string) => Effect.Effect<string, Error, never>;
  clearLocalStorage: () => Effect.Effect<void, never, never>;

  /**
   * Simulate session storage
   */
  setSessionStorage: (
    key: string,
    value: string
  ) => Effect.Effect<void, never, never>;
  getSessionStorage: (key: string) => Effect.Effect<string, Error, never>;
  clearSessionStorage: () => Effect.Effect<void, never, never>;

  /**
   * Clear all state
   */
  clearState: () => Effect.Effect<void, never, never>;
}

export class StateManager extends Context.Tag('StateManager')<
  StateManager,
  StateManagerService
>() {}

/**
 * Create a StateManager service implementation
 */
export const makeStateManager = (): Effect.Effect<
  StateManagerService,
  never,
  never
> =>
  Effect.gen(function* () {
    // Token storage
    const tokens = yield* Ref.make(new Map<TokenType, Token>());

    // Browser storage simulation
    const localStorage = yield* Ref.make(new Map<string, string>());
    const sessionStorage = yield* Ref.make(new Map<string, string>());

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
            if (match && match[1]) {
              return match[1];
            }
          }

          return yield* Effect.fail(new Error('CSRF token not found in HTML'));
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
            if (match && match[1]) {
              return match[1];
            }
          }

          // Try to find in window object assignments
          const windowPattern =
            /window\[["']([^"']*[Tt]oken[^"']*)["']\]\s*=\s*["']([^"']+)["']/g;
          let windowMatch;
          while ((windowMatch = windowPattern.exec(scriptContent)) !== null) {
            if (windowMatch[2]) {
              return windowMatch[2];
            }
          }

          return yield* Effect.fail(
            new Error('API token not found in scripts')
          );
        }),

      storeToken: (type: TokenType, value: string, expiry?: Date) =>
        Effect.gen(function* () {
          const token: Token = {
            type,
            value,
            expiry,
          };

          const tokensMap = yield* Ref.get(tokens);
          tokensMap.set(type, token);
          yield* Ref.set(tokens, tokensMap);
        }),

      getToken: (type: TokenType) =>
        Effect.gen(function* () {
          const tokensMap = yield* Ref.get(tokens);
          const token = tokensMap.get(type);

          if (!token) {
            return yield* Effect.fail(
              new Error(`Token of type ${type} not found`)
            );
          }

          // Check if expired
          if (token.expiry && token.expiry < new Date()) {
            return yield* Effect.fail(
              new Error(`Token of type ${type} has expired`)
            );
          }

          return token.value;
        }),

      isTokenValid: (type: TokenType) =>
        Effect.gen(function* () {
          const tokensMap = yield* Ref.get(tokens);
          const token = tokensMap.get(type);

          if (!token) {
            return false;
          }

          if (token.expiry && token.expiry < new Date()) {
            return false;
          }

          return true;
        }),

      setLocalStorage: (key: string, value: string) =>
        Effect.gen(function* () {
          const storage = yield* Ref.get(localStorage);
          storage.set(key, value);
          yield* Ref.set(localStorage, storage);
        }),

      getLocalStorage: (key: string) =>
        Effect.gen(function* () {
          const storage = yield* Ref.get(localStorage);
          const value = storage.get(key);

          if (!value) {
            return yield* Effect.fail(
              new Error(`Local storage key '${key}' not found`)
            );
          }

          return value;
        }),

      clearLocalStorage: () =>
        Effect.gen(function* () {
          yield* Ref.set(localStorage, new Map());
        }),

      setSessionStorage: (key: string, value: string) =>
        Effect.gen(function* () {
          const storage = yield* Ref.get(sessionStorage);
          storage.set(key, value);
          yield* Ref.set(sessionStorage, storage);
        }),

      getSessionStorage: (key: string) =>
        Effect.gen(function* () {
          const storage = yield* Ref.get(sessionStorage);
          const value = storage.get(key);

          if (!value) {
            return yield* Effect.fail(
              new Error(`Session storage key '${key}' not found`)
            );
          }

          return value;
        }),

      clearSessionStorage: () =>
        Effect.gen(function* () {
          yield* Ref.set(sessionStorage, new Map());
        }),

      clearState: () =>
        Effect.gen(function* () {
          yield* Ref.set(tokens, new Map());
          yield* Ref.set(localStorage, new Map());
          yield* Ref.set(sessionStorage, new Map());
        }),
    };
  });

/**
 * StateManager Layer
 */
export const StateManagerLive = Layer.effect(StateManager, makeStateManager());
