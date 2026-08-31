import { Effect, Option } from 'effect';
import type { PageFetchErrorKind } from '../Spider/Spider.types.js';

/**
 * Request payload passed to an {@link HttpAdapter} on every page fetch.
 *
 * The spider populates all required fields. Adapters MUST honour
 * `timeoutMs` themselves — the spider does not layer an additional
 * `Effect.timeout` on top of an adapter call.
 *
 * @group HttpAdapter
 * @public
 */
export interface HttpAdapterRequest {
  /** Fully-qualified URL to fetch. */
  readonly url: string;
  /** Resolved User-Agent string (from the spider's `userAgentStrategy`). */
  readonly userAgent: string;
  /** Hard deadline in milliseconds. Adapter MUST abort if exceeded. */
  readonly timeoutMs: number;
  /**
   * Optional extra headers to send with the request. Reserved for
   * forward compatibility — the spider does not populate this in v0.11.
   * If a future per-domain header config feeds this field, callers can
   * see them on every adapter invocation without an API change.
   *
   * If a caller populates `User-Agent` here, the built-in
   * `defaultUndiciAdapter` IGNORES it: the resolved `userAgent` always
   * wins so the spider's `userAgentStrategy` remains the single source
   * of truth.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /** Per-request id useful for adapter-side logs and correlation. */
  readonly requestId: string;
}

/**
 * Response payload returned by an {@link HttpAdapter}.
 *
 * `body` is the fully-decoded response body. Streaming is out of scope —
 * the spider reads the full body into memory regardless.
 *
 * @group HttpAdapter
 * @public
 */
export interface HttpAdapterResponse {
  /** Final URL after any redirects (matches `Response.url` from fetch). */
  readonly url: string;
  /** HTTP status code. */
  readonly statusCode: number;
  /**
   * Response headers as a plain map. Adapters wrapping `Headers` should
   * use `Headers.forEach` to flatten — undici joins repeated values with
   * `', '`. Use lower-case keys for consistency with the Fetch spec.
   */
  readonly headers: Readonly<Record<string, string>>;
  /** Decoded response body. */
  readonly body: string;
}

/**
 * Structured error returned by an {@link HttpAdapter} when a fetch fails.
 *
 * `kind` MUST be drawn from {@link PageFetchErrorKind} so the spider's
 * existing `fetchRetry.retryOn` configuration keys keep working unchanged.
 * Adapters needing semantics not yet covered (e.g. TLS handshake failure)
 * should report `kind: 'other'` with a descriptive `message` until a
 * broader union lands.
 *
 * @group HttpAdapter
 * @public
 */
export interface HttpAdapterError {
  /** Retry classifier used by the spider's page-fetch policy. */
  readonly kind: PageFetchErrorKind;
  /** Safe diagnostic text for logs and crawl results. */
  readonly message: string;
  /**
   * HTTP status code, present when `kind` is `http_4xx | http_429 | http_5xx`.
   * Modelled as a bare optional field (rather than `Option`) because adapter
   * authors implementing this contract are not expected to depend on Effect
   * just to construct an error value.
   */
  readonly statusCode?: number;
  /** Original underlying error, if any. */
  readonly cause?: unknown;
}

/**
 * Pluggable HTTP fetcher contract. Implementations dispatch a single
 * request and return either a structured response or a structured error.
 *
 * The returned Effect MUST be cancellable so `stopMode: 'interrupt'` can
 * abort in-flight fetches. Adapters wrapping promise-based libraries
 * SHOULD use `Effect.tryPromise` so the auto-injected `AbortSignal`
 * propagates to the underlying request.
 *
 * @group HttpAdapter
 * @public
 */
export interface HttpAdapter {
  /**
   * Performs one cancellable request and converts transport failures into the
   * structured error contract that the spider can classify and retry.
   */
  readonly fetch: (
    request: HttpAdapterRequest
  ) => Effect.Effect<HttpAdapterResponse, HttpAdapterError>;
}

/**
 * Per-request adapter selector. Lets a single configuration field serve
 * both "swap globally" (return a constant adapter) and "swap per-domain"
 * (return one of several adapters based on `request.url`).
 *
 * @group HttpAdapter
 * @public
 */
export type HttpAdapterSelector = (request: HttpAdapterRequest) => HttpAdapter;

/**
 * Adapter stub used when a selector throws or returns an invalid value.
 * Surfaces the failure as a normal `HttpAdapterError` of kind `'other'`
 * so the worker keeps running and the failure flows through the standard
 * retry/classify pipeline like any other fetch error.
 *
 * The supplied `reason` is used verbatim in `message` rather than being
 * passed through `cause` so that downstream `String(error.cause)` checks
 * in `classifyFetchError` cannot accidentally match `ENOTFOUND` /
 * `ECONNREFUSED` markers embedded in a thrown payload.
 *
 * @internal
 */
const failingAdapter = (reason: string): HttpAdapter => ({
  fetch: () =>
    Effect.fail({
      kind: 'other',
      message: reason,
    }),
});

/**
 * Is `value` something usable as an `HttpAdapter`? Requires a callable
 * `fetch` field on an object — anything else (null, primitive, function
 * without a fetch, object whose `fetch` is not callable) fails the test.
 *
 * @internal
 */
const isAdapter = (value: unknown): value is HttpAdapter => {
  if (!(value instanceof Object)) return false;
  if (!('fetch' in value)) return false;
  const { fetch: fetchField } = value;
  return typeof fetchField === 'function';
};

/**
 * Resolve the effective adapter for a single request given the value
 * configured on `SpiderConfigOptions.httpAdapter`.
 *
 * Resolution rules:
 *   - `undefined` / `null` → fall back to `defaultAdapter`
 *   - object with a callable `fetch` (`HttpAdapter`) → use it directly
 *   - function (`HttpAdapterSelector`) → invoke with the request; the
 *     return value must itself be a valid adapter
 *   - anything else → stub adapter whose `fetch` fails with `kind:'other'`
 *
 * If a selector throws synchronously OR returns a non-adapter value, the
 * resolver returns a stub adapter whose `fetch` fails with `kind:'other'`,
 * so a misbehaving selector cannot crash the worker fiber.
 *
 * @group HttpAdapter
 * @public
 */
export const resolveAdapter = (
  config: HttpAdapter | HttpAdapterSelector | undefined,
  request: HttpAdapterRequest,
  defaultAdapter: HttpAdapter
): HttpAdapter => {
  const configuredAdapter = Option.fromNullishOr(config);
  if (Option.isNone(configuredAdapter)) return defaultAdapter;
  const candidate = configuredAdapter.value;
  if (isAdapter(candidate)) return candidate;
  if (typeof candidate !== 'function') {
    return failingAdapter(
      'HttpAdapter config is neither undefined, a function selector, nor an object with a callable fetch method'
    );
  }
  // Selector form is invoked sync; guard against throws so a bad selector
  // cannot crash the worker. The stub adapter surfaces the failure as a
  // normal HttpAdapterError that flows through the retry pipeline.
  try {
    const resolved = candidate(request);
    if (!isAdapter(resolved)) {
      return failingAdapter(
        'HttpAdapter selector returned a value that is not a valid adapter (must be an object with a callable fetch method)'
      );
    }
    return resolved;
  } catch (cause) {
    return failingAdapter(
      `HttpAdapter selector threw: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
  }
};
