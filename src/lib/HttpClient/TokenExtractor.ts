/**
 * Token Extractor Service
 * Extracts and manages various types of tokens from HTTP responses
 */

import { Context, Effect, Layer } from 'effect';
import * as cheerio from 'cheerio';
import {
  StateManager,
  TokenType,
} from '../StateManager/StateManager.service.js';
import { EnhancedHttpClient, type HttpResponse } from './EnhancedHttpClient.js';
import { SpiderLogger } from '../Logging/SpiderLogger.service.js';

export interface TokenInfo {
  type: TokenType;
  value: string;
  source: 'html' | 'header' | 'script' | 'json';
  selector?: string;
  pattern?: string;
}

export interface TokenExtractorService {
  /**
   * Extract all tokens from an HTTP response
   */
  extractTokensFromResponse: (
    response: HttpResponse
  ) => Effect.Effect<TokenInfo[], Error, never>;

  /**
   * Extract CSRF token from response
   */
  extractCSRFFromResponse: (
    response: HttpResponse
  ) => Effect.Effect<string | null, Error, never>;

  /**
   * Extract API token from response
   */
  extractAPIFromResponse: (
    response: HttpResponse
  ) => Effect.Effect<string | null, Error, never>;

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
  ) => Effect.Effect<HttpResponse, Error, never>;

  /**
   * Detect and handle token rotation
   */
  detectTokenRotation: (
    oldToken: string,
    response: HttpResponse,
    type: TokenType
  ) => Effect.Effect<boolean, Error, never>;

  /**
   * Refresh expired tokens
   */
  refreshToken: (
    type: TokenType,
    refreshUrl?: string
  ) => Effect.Effect<string, Error, never>;
}

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
    const tokens: TokenInfo[] = [];
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

    for (const { selector, attr } of csrfSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        const value = element.attr(attr);
        if (value) {
          tokens.push({
            type: TokenType.CSRF,
            value,
            source: 'html',
            selector,
          });
        }
      }
    }

    // API token patterns in HTML (less common)
    const apiSelectors = [
      { selector: 'meta[name="api-key"]', attr: 'content' },
      { selector: 'meta[name="api_key"]', attr: 'content' },
      { selector: 'meta[name="api-token"]', attr: 'content' },
      { selector: 'meta[name="access-token"]', attr: 'content' },
    ];

    for (const { selector, attr } of apiSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        const value = element.attr(attr);
        if (value) {
          tokens.push({
            type: TokenType.API,
            value,
            source: 'html',
            selector,
          });
        }
      }
    }

    return tokens;
  };

  const extractFromScripts = (html: string): TokenInfo[] => {
    const tokens: TokenInfo[] = [];
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

    for (const { pattern, name } of csrfPatterns) {
      const match = scriptContent.match(pattern);
      if (match && match[1]) {
        tokens.push({
          type: TokenType.CSRF,
          value: match[1],
          source: 'script',
          pattern: name,
        });
      }
    }

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

    for (const { pattern, name } of apiPatterns) {
      const match = scriptContent.match(pattern);
      if (match && match[1]) {
        tokens.push({
          type: TokenType.API,
          value: match[1],
          source: 'script',
          pattern: name,
        });
      }
    }

    // Check window object assignments
    const windowPattern =
      /window\[["']([^"']*[Tt]oken[^"']*)["']\]\s*=\s*["']([^"']+)["']/g;
    let windowMatch;
    while ((windowMatch = windowPattern.exec(scriptContent)) !== null) {
      if (windowMatch[2]) {
        const keyLower = windowMatch[1].toLowerCase();
        const type =
          keyLower.includes('csrf') || keyLower.includes('authenticity')
            ? TokenType.CSRF
            : TokenType.API;

        tokens.push({
          type,
          value: windowMatch[2],
          source: 'script',
          pattern: `window['${windowMatch[1]}']`,
        });
      }
    }

    return tokens;
  };

  const extractFromHeaders = (headers: Record<string, string>): TokenInfo[] => {
    const tokens: TokenInfo[] = [];

    // Check for tokens in response headers
    const headerPatterns = [
      { header: 'x-csrf-token', type: TokenType.CSRF },
      { header: 'x-auth-token', type: TokenType.AUTH },
      { header: 'x-api-key', type: TokenType.API },
      { header: 'authorization', type: TokenType.AUTH },
      { header: 'x-access-token', type: TokenType.AUTH },
    ];

    for (const { header, type } of headerPatterns) {
      const value = headers[header] || headers[header.toLowerCase()];
      if (value) {
        tokens.push({
          type,
          value,
          source: 'header',
          pattern: header,
        });
      }
    }

    return tokens;
  };

  const service: TokenExtractorService = {
    extractTokensFromResponse: (response: HttpResponse) =>
      Effect.gen(function* () {
        const tokens: TokenInfo[] = [];

        // Extract from HTML
        tokens.push(...extractFromHTML(response.body));

        // Extract from scripts
        tokens.push(...extractFromScripts(response.body));

        // Extract from headers
        tokens.push(...extractFromHeaders(response.headers));

        // Store unique tokens (by type and value)
        const uniqueTokens = new Map<string, TokenInfo>();
        for (const token of tokens) {
          const key = `${token.type}:${token.value}`;
          if (!uniqueTokens.has(key)) {
            uniqueTokens.set(key, token);

            // Store in StateManager
            yield* stateManager.storeToken(
              token.type,
              token.value,
              new Date(Date.now() + 3600000) // 1 hour expiry
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
        }

        return Array.from(uniqueTokens.values());
      }),

    extractCSRFFromResponse: (response: HttpResponse) =>
      Effect.gen(function* () {
        const tokens = yield* Effect.succeed([
          ...extractFromHTML(response.body),
          ...extractFromScripts(response.body),
        ]);

        const csrfToken = tokens.find((t) => t.type === TokenType.CSRF);
        if (csrfToken) {
          yield* stateManager.storeToken(
            TokenType.CSRF,
            csrfToken.value,
            new Date(Date.now() + 3600000)
          );
          return csrfToken.value;
        }

        return null;
      }),

    extractAPIFromResponse: (response: HttpResponse) =>
      Effect.gen(function* () {
        const tokens = yield* Effect.succeed([
          ...extractFromScripts(response.body),
          ...extractFromHeaders(response.headers),
        ]);

        const apiToken = tokens.find((t) => t.type === TokenType.API);
        if (apiToken) {
          yield* stateManager.storeToken(
            TokenType.API,
            apiToken.value,
            new Date(Date.now() + 3600000)
          );
          return apiToken.value;
        }

        return null;
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
                    new Date(Date.now() + 3600000)
                  );
                }
                return Effect.void;
              })
            );
          }

          const csrfToken = yield* stateManager
            .getToken(TokenType.CSRF)
            .pipe(Effect.catchAll(() => Effect.succeed(null)));

          if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
            headers['X-Requested-With'] = 'XMLHttpRequest';
          }
        }

        // Add API token if required
        if (options.requireAPI) {
          const isValid = yield* stateManager.isTokenValid(TokenType.API);

          if (!isValid) {
            return yield* Effect.fail(
              new Error('API token not available or expired')
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
          const currentCSRF = yield* stateManager
            .getToken(TokenType.CSRF)
            .pipe(Effect.catchAll(() => Effect.succeed('')));
          if (currentCSRF) {
            yield* service.detectTokenRotation(
              currentCSRF,
              response,
              TokenType.CSRF
            );
          }
        }

        if (options.requireAPI) {
          const currentAPI = yield* stateManager
            .getToken(TokenType.API)
            .pipe(Effect.catchAll(() => Effect.succeed('')));
          if (currentAPI) {
            yield* service.detectTokenRotation(
              currentAPI,
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
        const tokens = yield* Effect.succeed([
          ...extractFromHTML(response.body),
          ...extractFromScripts(response.body),
          ...extractFromHeaders(response.headers),
        ]);

        const newToken = tokens.find(
          (t) => t.type === type && t.value !== oldToken
        );

        if (newToken) {
          yield* stateManager.storeToken(
            type,
            newToken.value,
            new Date(Date.now() + 3600000)
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
          return yield* Effect.fail(new Error('No refresh URL provided'));
        }

        // Make request to refresh endpoint
        const response = yield* httpClient.get(refreshUrl);

        // Extract tokens from response
        const tokens = yield* Effect.succeed([
          ...extractFromHTML(response.body),
          ...extractFromScripts(response.body),
          ...extractFromHeaders(response.headers),
        ]);

        const newToken = tokens.find((t) => t.type === type);

        if (!newToken) {
          return yield* Effect.fail(
            new Error(`Failed to refresh ${type} token`)
          );
        }

        // Store new token
        yield* stateManager.storeToken(
          type,
          newToken.value,
          new Date(Date.now() + 3600000)
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
