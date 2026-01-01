/**
 * Token Extractor Service
 * Extracts and manages various types of tokens from HTTP responses
 */

import { Context, Effect, Layer, HashMap, Option, DateTime, Data } from 'effect';
import * as cheerio from 'cheerio';
import {
  StateManager,
  TokenType,
} from '../StateManager/StateManager.service.js';
import { EnhancedHttpClient, type HttpResponse } from './EnhancedHttpClient.js';
import { SpiderLogger } from '../Logging/SpiderLogger.service.js';
import { NetworkError, ParseError, TimeoutError } from '../errors/effect-errors.js';

// Tagged error types for Effect-style error handling
export class TokenNotAvailableError extends Data.TaggedError('TokenNotAvailableError')<{
  readonly message: string;
}> {}

export class TokenRefreshError extends Data.TaggedError('TokenRefreshError')<{
  readonly message: string;
  readonly tokenType: TokenType;
}> {}

export class NoRefreshUrlError extends Data.TaggedError('NoRefreshUrlError')<{
  readonly message: string;
}> {}

export interface TokenInfo {
  type: TokenType;
  value: string;
  source: 'html' | 'header' | 'script' | 'json';
  selector?: string;
  pattern?: string;
}

// Common HTTP error type for methods that make HTTP requests
type HttpRequestError = NetworkError | ParseError | TimeoutError;

// Combined error type that includes HTTP and state management errors
type TokenExtractorError = HttpRequestError | Error | TokenNotAvailableError | TokenRefreshError | NoRefreshUrlError;

export interface TokenExtractorService {
  /**
   * Extract all tokens from an HTTP response
   */
  extractTokensFromResponse: (
    response: HttpResponse
  ) => Effect.Effect<TokenInfo[]>;

  /**
   * Extract CSRF token from response
   */
  extractCSRFFromResponse: (
    response: HttpResponse
  ) => Effect.Effect<Option.Option<string>>;

  /**
   * Extract API token from response
   */
  extractAPIFromResponse: (
    response: HttpResponse
  ) => Effect.Effect<Option.Option<string>>;

  /**
   * Make authenticated request with automatic token injection
   */
  authenticatedRequest: (
    url: string,
    options?: {
      requireCSRF?: boolean;
      requireAPI?: boolean;
      customHeaders?: Record<string, string>;
    }
  ) => Effect.Effect<HttpResponse, TokenExtractorError>;

  /**
   * Detect and handle token rotation
   */
  detectTokenRotation: (
    oldToken: string,
    response: HttpResponse,
    type: TokenType
  ) => Effect.Effect<boolean>;

  /**
   * Refresh expired tokens
   */
  refreshToken: (
    type: TokenType,
    refreshUrl?: string
  ) => Effect.Effect<string, TokenExtractorError>;
}

export type { TokenExtractorError };

export class TokenExtractor extends Context.Tag('TokenExtractor')<
  TokenExtractor,
  TokenExtractorService
>() {}

/**
 * Create a TokenExtractor service implementation
 */
export const makeTokenExtractor = Effect.gen(function* () {
  const stateManager = yield* StateManager;
  const httpClient = yield* EnhancedHttpClient;
  const logger = yield* SpiderLogger;

  const extractFromHTML = (html: string): TokenInfo[] => {
    const $ = cheerio.load(html);

    // CSRF token patterns in HTML
    const csrfSelectors = [
      { selector: 'meta[name="csrf-token"]', attr: 'content' },
      { selector: 'meta[name="_csrf"]', attr: 'content' },
      { selector: 'meta[name="csrf_token"]', attr: 'content' },
      { selector: 'meta[name="authenticity_token"]', attr: 'content' },
      { selector: 'input[name="csrf_token"]', attr: 'value' },
      { selector: 'input[name="_csrf"]', attr: 'value' },
      { selector: 'input[name="authenticity_token"]', attr: 'value' },
      { selector: 'input[name="__RequestVerificationToken"]', attr: 'value' },
    ];

    const csrfTokens = csrfSelectors.flatMap(({ selector, attr }) => {
      const element = $(selector);
      if (element.length > 0) {
        const value = element.attr(attr);
        if (value) {
          return [{
            type: TokenType.CSRF,
            value,
            source: 'html' as const,
            selector,
          }];
        }
      }
      return [];
    });

    // API token patterns in HTML (less common)
    const apiSelectors = [
      { selector: 'meta[name="api-key"]', attr: 'content' },
      { selector: 'meta[name="api_key"]', attr: 'content' },
      { selector: 'meta[name="api-token"]', attr: 'content' },
      { selector: 'meta[name="access-token"]', attr: 'content' },
    ];

    const apiTokens = apiSelectors.flatMap(({ selector, attr }) => {
      const element = $(selector);
      if (element.length > 0) {
        const value = element.attr(attr);
        if (value) {
          return [{
            type: TokenType.API,
            value,
            source: 'html' as const,
            selector,
          }];
        }
      }
      return [];
    });

    return [...csrfTokens, ...apiTokens];
  };

  const extractFromScripts = (html: string): TokenInfo[] => {
    const $ = cheerio.load(html);

    // Get all inline scripts
    const scriptTags = $('script:not([src])');
    const scriptContent = scriptTags
      .map((_, el) => $(el).html())
      .get()
      .join('\n');

    // CSRF token patterns in JavaScript
    const csrfPatterns = [
      {
        pattern: /window\.csrfToken\s*=\s*["']([^"']+)["']/,
        name: 'window.csrfToken',
      },
      {
        pattern: /csrf[_-]?token["']?\s*[:=]\s*["']([^"']+)["']/i,
        name: 'csrf_token',
      },
      { pattern: /_token["']?\s*[:=]\s*["']([^"']+)["']/, name: '_token' },
      {
        pattern: /authenticity_token["']?\s*[:=]\s*["']([^"']+)["']/,
        name: 'authenticity_token',
      },
      {
        pattern: /X-CSRF-Token["']?\s*[:=]\s*["']([^"']+)["']/,
        name: 'X-CSRF-Token',
      },
    ];

    const csrfTokens = csrfPatterns.flatMap(({ pattern, name }) => {
      const match = scriptContent.match(pattern);
      if (match?.[1]) {
        return [{
          type: TokenType.CSRF,
          value: match[1],
          source: 'script' as const,
          pattern: name,
        }];
      }
      return [];
    });

    // API token patterns in JavaScript
    const apiPatterns = [
      {
        pattern: /api[_-]?key["']?\s*[:=]\s*["']([^"']+)["']/i,
        name: 'api_key',
      },
      {
        pattern: /api[_-]?token["']?\s*[:=]\s*["']([^"']+)["']/i,
        name: 'api_token',
      },
      {
        pattern: /X-Secret-Token["']?\s*[:=]\s*["']([^"']+)["']/,
        name: 'X-Secret-Token',
      },
      {
        pattern: /authorization["']?\s*[:=]\s*["']Bearer\s+([^"']+)["']/i,
        name: 'authorization',
      },
      {
        pattern: /access[_-]?token["']?\s*[:=]\s*["']([^"']+)["']/i,
        name: 'access_token',
      },
      {
        pattern: /secret[_-]?key["']?\s*[:=]\s*["']([^"']+)["']/i,
        name: 'secret_key',
      },
    ];

    const apiTokens = apiPatterns.flatMap(({ pattern, name }) => {
      const match = scriptContent.match(pattern);
      if (match?.[1]) {
        return [{
          type: TokenType.API,
          value: match[1],
          source: 'script' as const,
          pattern: name,
        }];
      }
      return [];
    });

    // Check window object assignments
    const windowPattern =
      /window\[["']([^"']*[Tt]oken[^"']*)["']\]\s*=\s*["']([^"']+)["']/g;
    const windowMatches = Array.from(scriptContent.matchAll(windowPattern));
    const windowTokens = windowMatches.flatMap((windowMatch) => {
      if (windowMatch[2]) {
        const keyLower = windowMatch[1].toLowerCase();
        const type =
          keyLower.includes('csrf') || keyLower.includes('authenticity')
            ? TokenType.CSRF
            : TokenType.API;

        return [{
          type,
          value: windowMatch[2],
          source: 'script' as const,
          pattern: `window['${windowMatch[1]}']`,
        }];
      }
      return [];
    });

    return [...csrfTokens, ...apiTokens, ...windowTokens];
  };

  const extractFromHeaders = (headers: Record<string, string>): TokenInfo[] => {
    // Check for tokens in response headers
    const headerPatterns = [
      { header: 'x-csrf-token', type: TokenType.CSRF },
      { header: 'x-auth-token', type: TokenType.AUTH },
      { header: 'x-api-key', type: TokenType.API },
      { header: 'authorization', type: TokenType.AUTH },
      { header: 'x-access-token', type: TokenType.AUTH },
    ];

    return headerPatterns.flatMap(({ header, type }) => {
      const value = headers[header] || headers[header.toLowerCase()];
      if (value) {
        return [{
          type,
          value,
          source: 'header' as const,
          pattern: header,
        }];
      }
      return [];
    });
  };

  // Helper to compute expiry DateTime (1 hour from now)
  const computeExpiryDate = (): Date => {
    const now = DateTime.unsafeNow();
    const oneHourMs = 3600000;
    return DateTime.toDate(DateTime.add(now, { millis: oneHourMs }));
  };

  const service: TokenExtractorService = {
    extractTokensFromResponse: (response: HttpResponse) =>
      Effect.gen(function* () {
        // Extract from all sources
        const allTokens = [
          ...extractFromHTML(response.body),
          ...extractFromScripts(response.body),
          ...extractFromHeaders(response.headers),
        ];

        // Store unique tokens (by type and value) using HashMap
        const uniqueTokensMap = allTokens.reduce(
          (acc, token) => {
            const key = `${token.type}:${token.value}`;
            if (!HashMap.has(acc, key)) {
              return HashMap.set(acc, key, token);
            }
            return acc;
          },
          HashMap.empty<string, TokenInfo>()
        );

        const uniqueTokensList = Array.from(HashMap.values(uniqueTokensMap));

        // Store in StateManager and log
        for (const token of uniqueTokensList) {
          yield* stateManager.storeToken(
            token.type,
            token.value,
            computeExpiryDate()
          );

          yield* logger.logEdgeCase(
            new URL(response.url).hostname,
            'token_found',
            {
              type: token.type,
              source: token.source,
              pattern: token.pattern || token.selector,
            }
          );
        }

        return uniqueTokensList;
      }),

    extractCSRFFromResponse: (response: HttpResponse) =>
      Effect.gen(function* () {
        const tokens = [
          ...extractFromHTML(response.body),
          ...extractFromScripts(response.body),
        ];

        const csrfToken = tokens.find((t) => t.type === TokenType.CSRF);
        if (csrfToken) {
          yield* stateManager.storeToken(
            TokenType.CSRF,
            csrfToken.value,
            computeExpiryDate()
          );
          return Option.some(csrfToken.value);
        }

        return Option.none();
      }),

    extractAPIFromResponse: (response: HttpResponse) =>
      Effect.gen(function* () {
        const tokens = [
          ...extractFromScripts(response.body),
          ...extractFromHeaders(response.headers),
        ];

        const apiToken = tokens.find((t) => t.type === TokenType.API);
        if (apiToken) {
          yield* stateManager.storeToken(
            TokenType.API,
            apiToken.value,
            computeExpiryDate()
          );
          return Option.some(apiToken.value);
        }

        return Option.none();
      }),

    authenticatedRequest: (
      url: string,
      options: {
        requireCSRF?: boolean;
        requireAPI?: boolean;
        customHeaders?: Record<string, string>;
      } = {}
    ) =>
      Effect.gen(function* () {
        const headers: Record<string, string> = { ...options.customHeaders };

        // Add CSRF token if required
        if (options.requireCSRF) {
          const isValid = yield* stateManager.isTokenValid(TokenType.CSRF);

          if (!isValid) {
            // Try to fetch a new CSRF token from the base page
            const baseUrl = new URL(url).origin;
            const baseResponse = yield* httpClient.get(baseUrl);
            yield* Effect.succeed(extractFromHTML(baseResponse.body)).pipe(
              Effect.flatMap((tokens) => {
                const csrfToken = tokens.find((t) => t.type === TokenType.CSRF);
                if (csrfToken) {
                  return stateManager.storeToken(
                    TokenType.CSRF,
                    csrfToken.value,
                    computeExpiryDate()
                  );
                }
                return Effect.void;
              })
            );
          }

          const csrfTokenOption = yield* stateManager
            .getToken(TokenType.CSRF)
            .pipe(
              Effect.map(Option.some),
              Effect.catchAll(() => Effect.succeed(Option.none()))
            );

          if (Option.isSome(csrfTokenOption)) {
            headers['X-CSRF-Token'] = csrfTokenOption.value;
            headers['X-Requested-With'] = 'XMLHttpRequest';
          }
        }

        // Add API token if required
        if (options.requireAPI) {
          const isValid = yield* stateManager.isTokenValid(TokenType.API);

          if (!isValid) {
            return yield* Effect.fail(
              new TokenNotAvailableError({ message: 'API token not available or expired' })
            );
          }

          const apiToken = yield* stateManager.getToken(TokenType.API);
          headers['Authorization'] = `Bearer ${apiToken}`;
          headers['X-API-Key'] = apiToken;
        }

        // Make the request
        const response = yield* httpClient.request(url, { headers });

        // Check for token rotation
        if (options.requireCSRF) {
          const currentCSRFOption = yield* stateManager
            .getToken(TokenType.CSRF)
            .pipe(
              Effect.map(Option.some),
              Effect.catchAll(() => Effect.succeed(Option.none()))
            );
          if (Option.isSome(currentCSRFOption)) {
            yield* service.detectTokenRotation(
              currentCSRFOption.value,
              response,
              TokenType.CSRF
            );
          }
        }

        if (options.requireAPI) {
          const currentAPIOption = yield* stateManager
            .getToken(TokenType.API)
            .pipe(
              Effect.map(Option.some),
              Effect.catchAll(() => Effect.succeed(Option.none()))
            );
          if (Option.isSome(currentAPIOption)) {
            yield* service.detectTokenRotation(
              currentAPIOption.value,
              response,
              TokenType.API
            );
          }
        }

        return response;
      }),

    detectTokenRotation: (
      oldToken: string,
      response: HttpResponse,
      type: TokenType
    ) =>
      Effect.gen(function* () {
        const tokens = [
          ...extractFromHTML(response.body),
          ...extractFromScripts(response.body),
          ...extractFromHeaders(response.headers),
        ];

        const newToken = tokens.find(
          (t) => t.type === type && t.value !== oldToken
        );

        if (newToken) {
          yield* stateManager.storeToken(
            type,
            newToken.value,
            computeExpiryDate()
          );

          yield* logger.logEdgeCase(
            new URL(response.url).hostname,
            'token_rotated',
            {
              type,
              oldToken: oldToken.substring(0, 8) + '...',
              newToken: newToken.value.substring(0, 8) + '...',
            }
          );

          return true;
        }

        return false;
      }),

    refreshToken: (type: TokenType, refreshUrl?: string) =>
      Effect.gen(function* () {
        if (!refreshUrl) {
          return yield* Effect.fail(new NoRefreshUrlError({ message: 'No refresh URL provided' }));
        }

        // Make request to refresh endpoint
        const response = yield* httpClient.get(refreshUrl);

        // Extract tokens from response
        const tokens = [
          ...extractFromHTML(response.body),
          ...extractFromScripts(response.body),
          ...extractFromHeaders(response.headers),
        ];

        const newToken = tokens.find((t) => t.type === type);

        if (!newToken) {
          return yield* Effect.fail(
            new TokenRefreshError({ message: `Failed to refresh ${type} token`, tokenType: type })
          );
        }

        // Store new token
        yield* stateManager.storeToken(
          type,
          newToken.value,
          computeExpiryDate()
        );

        return newToken.value;
      }),
  };

  return service;
});

/**
 * TokenExtractor Layer with dependencies
 */
export const TokenExtractorLive = Layer.effect(
  TokenExtractor,
  makeTokenExtractor
);
