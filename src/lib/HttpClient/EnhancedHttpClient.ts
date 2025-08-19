/**
 * Enhanced HTTP Client
 * Provides advanced HTTP capabilities including POST requests, cookie management, and session handling
 */

import { Context, Effect, Layer, Option, Schedule, Duration } from 'effect';
import { NetworkError, ParseError, TimeoutError } from '../errors/effect-errors.js';
import { SpiderLogger } from '../Logging/SpiderLogger.service.js';
import { CookieManager } from './CookieManager.js';

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: string | FormData | URLSearchParams;
  timeout?: number;
  followRedirects?: boolean;
  credentials?: 'omit' | 'same-origin' | 'include';
  retries?: number;
  retryDelay?: number;
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
  ) => Effect.Effect<HttpResponse, NetworkError | ParseError | TimeoutError>;

  /**
   * Make a POST request
   */
  post: (
    url: string,
    data?: any,
    options?: HttpRequestOptions
  ) => Effect.Effect<HttpResponse, NetworkError | ParseError | TimeoutError>;

  /**
   * Make a request with any method
   */
  request: (
    url: string,
    options?: HttpRequestOptions
  ) => Effect.Effect<HttpResponse, NetworkError | ParseError | TimeoutError>;

  /**
   * Submit a form
   */
  submitForm: (
    url: string,
    formData: Record<string, string>,
    options?: HttpRequestOptions
  ) => Effect.Effect<HttpResponse, NetworkError | ParseError | TimeoutError>;
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

  const makeRequest = (url: string, options: HttpRequestOptions = {}): Effect.Effect<HttpResponse, NetworkError | TimeoutError | ParseError> =>
    Effect.gen(function* (_) {
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
          // Try to detect if it's JSON using Effect.try
          const isJson = yield* Effect.succeed((() => {
            try {
              JSON.parse(options.body as string);
              return true;
            } catch {
              return false;
            }
          })());
          
          headers['Content-Type'] = isJson 
            ? 'application/json' 
            : 'application/x-www-form-urlencoded';
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
          // Check if it's a timeout
          if (error instanceof Error && error.name === 'AbortError') {
            return new TimeoutError({
              operation: `HTTP ${options.method || 'GET'}`,
              timeoutMs: timeoutMs,
              url: url
            });
          }
          return new NetworkError({
            url,
            method: options.method || 'GET',
            cause: error
          });
        },
      });

      // Check for HTTP errors
      if (!response.ok) {
        return yield* Effect.fail(new NetworkError({
          url: response.url,
          statusCode: response.status,
          method: options.method || 'GET',
          cause: `HTTP ${response.status}: ${response.statusText}`
        }));
      }

      // Parse response body
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (error) => new ParseError({
          input: url,
          expected: 'text',
          cause: error
        }),
      });

      // Extract and store cookies from response
      const setCookieHeaders = response.headers.getSetCookie
        ? response.headers.getSetCookie()
        : response.headers.get('set-cookie')?.split(', ') || [];

      for (const cookieString of setCookieHeaders) {
        if (cookieString) {
          yield* cookieManager
            .setCookie(cookieString, url)
            .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
        }
      }

      // Convert headers to plain object
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const result: HttpResponse = {
        url: response.url,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body,
        cookies: setCookieHeaders.length > 0 ? setCookieHeaders : undefined,
      };
      return result;
    });

  // Wrap request with retry logic
  const makeRequestWithRetry = (url: string, options: HttpRequestOptions = {}) => {
    const retries = options.retries ?? 3;
    const retryDelay = options.retryDelay ?? 1000;

    // Create retry schedule with exponential backoff
    const retrySchedule = Schedule.exponential(Duration.millis(retryDelay), 2).pipe(
      Schedule.compose(Schedule.recurs(retries)),
      Schedule.tapInput((error) =>
        Effect.gen(function* () {
          yield* logger.logEdgeCase(
            new URL(url).hostname,
            'http_request_retry',
            {
              url,
              method: options.method || 'GET',
              error: error instanceof Error ? error.message : String(error),
              attempt: retries
            }
          );
        })
      )
    );

    // Only retry on network errors, not on 4xx client errors
    return makeRequest(url, options).pipe(
      Effect.retry({
        schedule: retrySchedule,
        while: (error) => {
          if (error instanceof NetworkError) {
            // Don't retry 4xx errors (client errors)
            if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
              return false;
            }
            return true;
          }
          return error instanceof TimeoutError;
        }
      })
    );
  };

  return {
    get: (url: string, options?: HttpRequestOptions) =>
      makeRequestWithRetry(url, { ...options, method: 'GET' }),

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

        return yield* makeRequestWithRetry(url, { ...options, method: 'POST', body });
      }),

    request: makeRequestWithRetry,

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

        return yield* makeRequestWithRetry(url, {
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
