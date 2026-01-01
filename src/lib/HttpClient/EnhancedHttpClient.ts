/**
 * Enhanced HTTP Client
 * Provides advanced HTTP capabilities including POST requests, cookie management, and session handling
 */

import { Context, DateTime, Effect, Layer, Option, Schedule, Duration } from 'effect';
import { JsonUtils, JsonStringifyError } from '../utils/JsonUtils.js';
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
  readonly get: (
    url: string,
    options?: HttpRequestOptions
  ) => Effect.Effect<HttpResponse, NetworkError | ParseError | TimeoutError>;

  /**
   * Make a POST request
   */
  readonly post: (
    url: string,
    data?: string | FormData | URLSearchParams | Record<string, unknown>,
    options?: HttpRequestOptions
  ) => Effect.Effect<HttpResponse, NetworkError | ParseError | TimeoutError | JsonStringifyError>;

  /**
   * Make a request with any method
   */
  readonly request: (
    url: string,
    options?: HttpRequestOptions
  ) => Effect.Effect<HttpResponse, NetworkError | ParseError | TimeoutError>;

  /**
   * Submit a form
   */
  readonly submitForm: (
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
    Effect.gen(function* () {
      const startTime = yield* DateTime.now;
      const startMs = DateTime.toEpochMillis(startTime);
      const domain = new URL(url).hostname;

      // Get cookies for this URL
      const cookieHeaderOption = yield* cookieManager.getCookieHeader(url);

      // Prepare headers
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (compatible; Spider/1.0)',
        ...options.headers,
      };

      // Add cookie header if present and not already set
      if (Option.isSome(cookieHeaderOption) && !headers['Cookie']) {
        headers['Cookie'] = cookieHeaderOption.value;
      }

      // Set content-type for POST requests
      if (
        options.method === 'POST' &&
        options.body &&
        !headers['Content-Type']
      ) {
        if (typeof options.body === 'string') {
          // Try to detect if it's JSON using Effect-based JSON validation
          const isJson = yield* JsonUtils.isValid(options.body);

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

      // Use Effect timeout for request
      const timeoutMs = options.timeout ?? 30000;

      // Create the fetch effect
      const fetchEffect = Effect.tryPromise({
        try: () =>
          globalThis.fetch(url, {
            method: options.method ?? 'GET',
            headers,
            body: options.body,
            redirect: options.followRedirects === false ? 'manual' : 'follow',
            credentials: options.credentials ?? 'same-origin',
          }),
        catch: (error) =>
          new NetworkError({
            url,
            method: options.method ?? 'GET',
            cause: error,
          }),
      });

      // Apply timeout using Effect.timeoutOption and handle the timeout case
      const fetchWithTimeout = fetchEffect.pipe(
        Effect.timeoutOption(Duration.millis(timeoutMs)),
        Effect.flatMap((maybeResponse) =>
          Option.match(maybeResponse, {
            onNone: () =>
              Effect.gen(function* () {
                const currentTime = yield* DateTime.now;
                const durationMs = DateTime.toEpochMillis(currentTime) - startMs;
                yield* logger.logEdgeCase(domain, 'http_request_abort', {
                  url,
                  method: options.method ?? 'GET',
                  durationMs,
                  reason: 'timeout',
                  timeoutMs,
                });
                return yield* Effect.fail(
                  new TimeoutError({
                    operation: `HTTP ${options.method ?? 'GET'}`,
                    timeoutMs,
                    url,
                  })
                );
              }),
            onSome: (response) => Effect.succeed(response),
          })
        )
      );

      // Make the request with timeout
      const response = yield* fetchWithTimeout;

      // Check for HTTP errors
      if (!response.ok) {
        return yield* Effect.fail(new NetworkError({
          url: response.url,
          statusCode: response.status,
          method: options.method ?? 'GET',
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
        : response.headers.get('set-cookie')?.split(', ') ?? [];

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

      // Build result with optional cookies
      const maybeCookies = Option.liftPredicate(
        setCookieHeaders,
        (cookies: string[]) => cookies.length > 0
      );

      const result: HttpResponse = {
        url: response.url,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body,
        cookies: Option.getOrUndefined(maybeCookies),
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
              method: options.method ?? 'GET',
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

    post: (
      url: string,
      data?: string | FormData | URLSearchParams | Record<string, unknown>,
      options?: HttpRequestOptions
    ) =>
      Effect.gen(function* () {
        // Convert data to body using Option for type-safe handling
        const maybeData = Option.fromNullable(data);
        const body: string | FormData | URLSearchParams | undefined = yield* Option.match(
          maybeData,
          {
            onNone: () => Effect.succeed(Option.getOrUndefined(Option.none<string | FormData | URLSearchParams>())),
            onSome: (d) => {
              if (
                typeof d === 'string' ||
                d instanceof FormData ||
                d instanceof URLSearchParams
              ) {
                return Effect.succeed(d);
              }
              // Convert object to JSON using Effect-based stringify
              return JsonUtils.stringify(d);
            },
          }
        );

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
