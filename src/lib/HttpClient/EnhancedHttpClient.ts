/**
 * Enhanced HTTP Client
 * Provides advanced HTTP capabilities including POST requests, cookie management, and session handling
 */

import { Context, Effect, Layer } from 'effect';
import { NetworkError, ResponseError } from '../errors.js';
import { SpiderLogger } from '../Logging/SpiderLogger.service.js';
import { CookieManager } from './CookieManager.js';

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: string | FormData | URLSearchParams;
  timeout?: number;
  followRedirects?: boolean;
  credentials?: 'omit' | 'same-origin' | 'include';
}

export interface HttpResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  cookies?: string[];
}

export interface EnhancedHttpClientService {
  /**
   * Make a GET request
   */
  get: (
    url: string,
    options?: HttpRequestOptions
  ) => Effect.Effect<HttpResponse, NetworkError | ResponseError, never>;

  /**
   * Make a POST request
   */
  post: (
    url: string,
    data?: any,
    options?: HttpRequestOptions
  ) => Effect.Effect<HttpResponse, NetworkError | ResponseError, never>;

  /**
   * Make a request with any method
   */
  request: (
    url: string,
    options?: HttpRequestOptions
  ) => Effect.Effect<HttpResponse, NetworkError | ResponseError, never>;

  /**
   * Submit a form
   */
  submitForm: (
    url: string,
    formData: Record<string, string>,
    options?: HttpRequestOptions
  ) => Effect.Effect<HttpResponse, NetworkError | ResponseError, never>;
}

export class EnhancedHttpClient extends Context.Tag('EnhancedHttpClient')<
  EnhancedHttpClient,
  EnhancedHttpClientService
>() {}

/**
 * Create an EnhancedHttpClient service
 */
export const makeEnhancedHttpClient = Effect.gen(function* () {
  const logger = yield* SpiderLogger;
  const cookieManager = yield* CookieManager;

  const makeRequest = (url: string, options: HttpRequestOptions = {}) =>
    Effect.gen(function* () {
      const startMs = Date.now();
      const domain = new URL(url).hostname;

      // Get cookies for this URL
      const cookieHeader = yield* cookieManager.getCookieHeader(url);

      // Prepare headers
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (compatible; Spider/1.0)',
        ...options.headers,
      };

      if (cookieHeader && !headers['Cookie']) {
        headers['Cookie'] = cookieHeader;
      }

      // Set content-type for POST requests
      if (
        options.method === 'POST' &&
        options.body &&
        !headers['Content-Type']
      ) {
        if (typeof options.body === 'string') {
          // Try to detect if it's JSON
          try {
            JSON.parse(options.body);
            headers['Content-Type'] = 'application/json';
          } catch {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
          }
        } else if (options.body instanceof FormData) {
          // Let fetch set the boundary for multipart/form-data
          // Don't set Content-Type manually
        } else if (options.body instanceof URLSearchParams) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
      }

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutMs = options.timeout || 30000;

      const timeoutId = setTimeout(() => {
        const duration = Date.now() - startMs;
        Effect.runSync(
          logger.logEdgeCase(domain, 'http_request_abort', {
            url,
            method: options.method || 'GET',
            durationMs: duration,
            reason: 'timeout',
            timeoutMs,
          })
        );
        controller.abort();
      }, timeoutMs);

      // Make the request
      const response = yield* Effect.tryPromise({
        try: async () => {
          const resp = await fetch(url, {
            method: options.method || 'GET',
            headers,
            body: options.body,
            signal: controller.signal,
            redirect: options.followRedirects === false ? 'manual' : 'follow',
            credentials: options.credentials || 'same-origin',
          });

          clearTimeout(timeoutId);
          return resp;
        },
        catch: (error) => {
          clearTimeout(timeoutId);
          return NetworkError.fromCause(url, error);
        },
      });

      // Parse response body
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (error) => ResponseError.fromCause(url, error),
      });

      // Extract and store cookies from response
      const setCookieHeaders = response.headers.getSetCookie
        ? response.headers.getSetCookie()
        : response.headers.get('set-cookie')?.split(', ') || [];

      for (const cookieString of setCookieHeaders) {
        if (cookieString) {
          yield* cookieManager
            .setCookie(cookieString, url)
            .pipe(Effect.catchAll(() => Effect.void));
        }
      }

      // Convert headers to plain object
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        url: response.url,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body,
        cookies: setCookieHeaders,
      };
    });

  return {
    get: (url: string, options?: HttpRequestOptions) =>
      makeRequest(url, { ...options, method: 'GET' }),

    post: (url: string, data?: any, options?: HttpRequestOptions) =>
      Effect.gen(function* () {
        let body: string | FormData | URLSearchParams | undefined;

        if (data) {
          if (
            typeof data === 'string' ||
            data instanceof FormData ||
            data instanceof URLSearchParams
          ) {
            body = data;
          } else {
            // Convert object to JSON
            body = JSON.stringify(data);
          }
        }

        return yield* makeRequest(url, { ...options, method: 'POST', body });
      }),

    request: makeRequest,

    submitForm: (
      url: string,
      formData: Record<string, string>,
      options?: HttpRequestOptions
    ) =>
      Effect.gen(function* () {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(formData)) {
          params.append(key, value);
        }

        return yield* makeRequest(url, {
          ...options,
          method: 'POST',
          body: params,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...options?.headers,
          },
        });
      }),
  };
});

/**
 * EnhancedHttpClient Layer with dependencies
 */
export const EnhancedHttpClientLive = Layer.effect(
  EnhancedHttpClient,
  makeEnhancedHttpClient
);
