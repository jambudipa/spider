import { DateTime, Duration, Effect, Option } from 'effect';
import type {
  HttpAdapter,
  HttpAdapterError,
  HttpAdapterResponse,
} from './HttpAdapter.types.js';

/**
 * Classify a thrown/wrapped error from `globalThis.fetch` into the
 * structured {@link HttpAdapterError} shape. Cause-string detection
 * mirrors `classifyFetchError` in `Spider/Spider.types.ts` so adapter
 * errors map cleanly into the existing `PageFetchErrorKind` union.
 *
 * @internal
 */
const classifyFetchPromiseRejection = (
  url: string,
  cause: unknown
): HttpAdapterError => {
  if (cause instanceof Error && cause.name === 'AbortError') {
    return { kind: 'timeout', message: `Request to ${url} aborted`, cause };
  }
  const hasCauseField = (value: unknown): value is { cause: unknown } =>
    value instanceof Object && 'cause' in value;
  const innerCause = hasCauseField(cause)
    ? Option.some(cause.cause)
    : Option.none<unknown>();
  const causeStr = String(Option.getOrElse(innerCause, () => cause));
  if (
    causeStr.includes('ENOTFOUND') ||
    causeStr.includes('ENONAME') ||
    causeStr.includes('WSAHOST_NOT_FOUND') ||
    causeStr.includes('getaddrinfo')
  ) {
    return { kind: 'dns', message: `DNS failure for ${url}: ${causeStr}`, cause };
  }
  if (causeStr.includes('ECONNREFUSED')) {
    return {
      kind: 'connection_refused',
      message: `Connection refused for ${url}: ${causeStr}`,
      cause,
    };
  }
  return {
    kind: 'other',
    message: `Fetch failed for ${url}: ${
      cause instanceof Error ? cause.message : String(cause)
    }`,
    cause,
  };
};

/**
 * Built-in HTTP adapter that wraps `globalThis.fetch` (Node undici).
 *
 * Behaviour preserves the spider's pre-`HttpAdapter` fetch path exactly:
 *   - Honours `request.timeoutMs` via `Effect.timeoutOption`.
 *   - Auto-injected `AbortSignal` from `Effect.tryPromise` propagates to
 *     the underlying fetch — fiber interruption (from `stopMode:'interrupt'`
 *     or the wrapping timeout) releases the socket immediately.
 *   - Reads the full response body into memory with a separate
 *     10-second decode timeout.
 *   - Returns ALL HTTP status codes (including 4xx and 5xx) as successful
 *     `HttpAdapterResponse` so the spider parses them into `PageData` as
 *     it did in v0.10. Network/DNS/timeout failures are the only adapter
 *     errors raised here. Custom adapters may choose to fail with
 *     `kind: 'http_5xx'` or similar to opt into retry semantics, but the
 *     default does not.
 *   - Caller-supplied `request.headers` are merged BEFORE `User-Agent`
 *     so the spider's resolved UA always wins; reserved-header injection
 *     is not a supported escape hatch.
 *
 * Used automatically when `SpiderConfigOptions.httpAdapter` is undefined.
 *
 * @group HttpAdapter
 * @public
 */
export const defaultUndiciAdapter: HttpAdapter = {
  fetch: ({ url, userAgent, timeoutMs, headers }) =>
    Effect.gen(function* () {
      // Reject obviously invalid timeouts up front so the caller gets a
      // clear error instead of an immediate `kind: 'timeout'` from
      // Effect.timeoutOption(0ms).
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return yield* Effect.fail<HttpAdapterError>({
          kind: 'other',
          message: `Invalid timeoutMs (${timeoutMs}); must be a positive finite number`,
        });
      }

      const startTime = yield* DateTime.now;
      const startMs = DateTime.toEpochMillis(startTime);
      const domain = new URL(url).hostname;

      const fetchEffect = Effect.tryPromise({
        try: (signal) =>
          globalThis.fetch(url, {
            // Spread caller headers FIRST so a User-Agent in `headers`
            // cannot override the spider's resolved UA. The spider owns UA
            // strategy via `userAgentStrategy`; the adapter is not an
            // escape hatch for it.
            headers: { ...(headers ?? {}), 'User-Agent': userAgent },
            signal,
          }),
        catch: (cause) => classifyFetchPromiseRejection(url, cause),
      });

      const fetchWithTimeout = fetchEffect.pipe(
        Effect.timeoutOption(Duration.millis(timeoutMs)),
        Effect.flatMap((maybeResponse) =>
          Option.match(maybeResponse, {
            onNone: (): Effect.Effect<Response, HttpAdapterError> =>
              Effect.fail<HttpAdapterError>({
                kind: 'timeout',
                message: `Request to ${url} timed out after ${timeoutMs}ms`,
              }),
            onSome: (response) => Effect.succeed(response),
          })
        )
      );

      const response = yield* fetchWithTimeout;

      const textTimeoutMs = 10000;
      const cancelResponseBody = () => {
        const body = response.body;
        if (!body) return Effect.void;
        return Effect.tryPromise({
          try: () => body.cancel(),
          catch: (cause) =>
            ({
              kind: 'other',
              message: `Failed to cancel the response body for ${url}: ${String(cause)}`,
              cause,
            }) satisfies HttpAdapterError,
        }).pipe(Effect.ignore);
      };

      const bodyEffect = Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) =>
          ({
            kind: 'other',
            message: `Failed to read response body from ${url}: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
            cause,
          }) satisfies HttpAdapterError,
      }).pipe(
        // Defensive belt-and-braces against socket leak: if the body-read
        // effect is interrupted (timeout, fiber interrupt), explicitly
        // cancel the stream. Effect.tryPromise's auto-signal SHOULD
        // already cascade to the stream on undici, but cancelling the
        // body directly is robust across runtimes/polyfills.
        Effect.onInterrupt(cancelResponseBody)
      );

      const body = yield* bodyEffect.pipe(
        Effect.timeoutOption(Duration.millis(textTimeoutMs)),
        Effect.flatMap((maybeBody) =>
          Option.match(maybeBody, {
            onNone: (): Effect.Effect<string, HttpAdapterError> =>
              Effect.gen(function* () {
                const endTime = yield* DateTime.now;
                const durationMs =
                  DateTime.toEpochMillis(endTime) - startMs;
                // Restore the v0.10 `response_text_abort_triggered` log
                // event so existing log consumers continue to see it.
                yield* Effect.logWarning(
                  'response text abort (timeout)'
                ).pipe(
                  Effect.annotateLogs({
                    event: 'response_text_abort_triggered',
                    domain,
                    url,
                    durationMs,
                    reason: 'timeout',
                    timeoutMs: textTimeoutMs,
                  })
                );
                // Cancel the body stream so the socket releases promptly
                // rather than draining in the background until GC.
                yield* cancelResponseBody();
                return yield* Effect.fail<HttpAdapterError>({
                  kind: 'timeout',
                  message: `Response body read for ${url} timed out after ${textTimeoutMs}ms (total ${durationMs}ms)`,
                });
              }),
            onSome: (text) => Effect.succeed(text),
          })
        )
      );

      // Flatten headers. `Headers.forEach` joins most repeated values
      // with `', '` per the Fetch spec, but Set-Cookie is the documented
      // exception — forEach iterates each Set-Cookie entry separately and
      // a naive object-assignment would silently lose all but the last.
      // Use `getSetCookie()` (Node 20+) to recover the full set and join
      // with `\n`, the only safe delimiter for cookie strings (RFC 6265
      // forbids `,` in Set-Cookie values because it appears in Expires=).
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        // Skip set-cookie here; handled separately below.
        if (key.toLowerCase() === 'set-cookie') return;
        responseHeaders[key] = value;
      });
      // `getSetCookie` is standardised on the WHATWG Fetch spec and
      // available in Node ≥ 19.7 / 20+.
      const setCookies = response.headers.getSetCookie();
      if (setCookies.length > 0) {
        responseHeaders['set-cookie'] = setCookies.join('\n');
      }

      const adapterResponse: HttpAdapterResponse = {
        // Match v0.10 exactly: forward `response.url` raw, including the
        // empty string the Fetch spec allows when no URL list is present.
        // Substituting the input url would mask post-redirect tracking.
        url: response.url,
        statusCode: response.status,
        headers: responseHeaders,
        body,
      };
      return adapterResponse;
    }),
};
