import { DateTime, Effect, Option, Schema } from 'effect';
import * as cheerio from 'cheerio';
import { PageDataSchema } from '../PageData/PageData.js';
import {
  NetworkError,
  ContentTypeError,
  RequestAbortError,
  ResponseError,
} from '../errors/effect-errors.js';
import type {
  HttpAdapter,
  HttpAdapterError,
  HttpAdapterRequest,
  HttpAdapterResponse,
  HttpAdapterSelector,
} from '../HttpAdapter/HttpAdapter.types.js';
import { resolveAdapter } from '../HttpAdapter/HttpAdapter.types.js';
import { defaultUndiciAdapter } from '../HttpAdapter/defaultUndiciAdapter.js';

/**
 * Map an {@link HttpAdapterError} to the existing typed errors expected
 * by the upstream Spider retry/classification pipeline. Keeping this
 * translation here means callers that already pattern-match on
 * `NetworkError`/`RequestAbortError`/etc. see no behavioural change when
 * a custom adapter is in use.
 *
 * For http_* kinds, a missing `statusCode` is inferred from the kind
 * itself (4xx→400, 429→429, 5xx→500) so the downstream
 * `classifyFetchError` round-trip preserves the kind even when the
 * adapter omits the field.
 *
 * For dns/connection_refused, we tag the `cause` with a sentinel string
 * that `classifyFetchError` recognises. The sentinel is bracketed
 * (`[adapter-kind:dns]`) rather than using raw `ENOTFOUND`/`ECONNREFUSED`
 * markers so a caller-supplied message containing those substrings can't
 * collide with the round-trip.
 *
 * @internal
 */
export const ADAPTER_DNS_SENTINEL = '[adapter-kind:dns:ENOTFOUND]';
export const ADAPTER_CONN_REFUSED_SENTINEL =
  '[adapter-kind:connection_refused:ECONNREFUSED]';

/* eslint-disable effect/no-undefined-use-option -- interop helper: `statusCode?` field on both HttpAdapterError and NetworkError is bare optional by existing convention; lifting through Option here would change the public field shape */
const inferStatusCode = (
  kind: HttpAdapterError['kind'],
  provided: number | undefined
): number | undefined => {
  if (provided !== undefined) return provided;
  if (kind === 'http_4xx') return 400;
  if (kind === 'http_429') return 429;
  if (kind === 'http_5xx') return 500;
  return undefined;
};
/* eslint-enable effect/no-undefined-use-option */

const adapterErrorToTypedError = (
  url: string,
  durationMs: number,
  err: HttpAdapterError
): NetworkError | RequestAbortError => {
  if (err.kind === 'timeout') {
    return RequestAbortError.timeout(url, durationMs);
  }
  if (
    err.kind === 'http_4xx' ||
    err.kind === 'http_429' ||
    err.kind === 'http_5xx'
  ) {
    return new NetworkError({
      url,
      statusCode: inferStatusCode(err.kind, err.statusCode),
      method: 'GET',
      cause: err.cause ?? err.message,
    });
  }
  if (err.kind === 'dns') {
    return new NetworkError({
      url,
      method: 'GET',
      cause: `${ADAPTER_DNS_SENTINEL} ${err.message}`,
    });
  }
  if (err.kind === 'connection_refused') {
    return new NetworkError({
      url,
      method: 'GET',
      cause: `${ADAPTER_CONN_REFUSED_SENTINEL} ${err.message}`,
    });
  }
  // other or any unknown kind a custom JS adapter may emit.
  return new NetworkError({
    url,
    method: 'GET',
    cause: err.cause ?? err.message,
  });
};

/**
 * Service responsible for fetching HTML content and parsing basic page information.
 *
 * The ScraperService handles the core HTTP fetching and HTML parsing functionality
 * for the Spider framework. It provides robust error handling, timeout management,
 * and content type validation to ensure reliable data extraction.
 *
 * **Key Features:**
 * - Pluggable HTTP fetch via the {@link HttpAdapter} extension point
 *   (defaults to undici-backed `globalThis.fetch` when no adapter supplied)
 * - Content type validation (skips binary files)
 * - Comprehensive error handling with typed errors
 * - Performance monitoring and logging
 * - Effect integration for composability
 *
 * **Note:** This service focuses solely on fetching and parsing HTML content.
 * Link extraction is handled separately by LinkExtractorService for better
 * separation of concerns and modularity.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const scraper = yield* ScraperService;
 *   const { pageData } = yield* scraper.fetchAndParse('https://example.com', 0);
 *   console.log(`Title: ${pageData.title}`);
 * });
 * ```
 *
 * @group Services
 * @public
 */
export class ScraperService extends Effect.Service<ScraperService>()(
  '@jambudipa.io/ScraperService',
  {
    effect: Effect.sync(() => ({
      /**
       * Fetches a URL and parses the HTML to extract basic page information.
       *
       * Dispatches the actual HTTP fetch through the supplied
       * {@link HttpAdapter} (or {@link defaultUndiciAdapter} when none is
       * provided). The adapter owns the fetch timeout; ScraperService only
       * handles content-type validation and HTML parsing of the response.
       *
       * @param url - The URL to fetch and parse
       * @param depth - The crawl depth for logging purposes (default: 0)
       * @param userAgent - Resolved User-Agent string for this request
       * @param httpAdapter - HTTP adapter, selector, or undefined. When
       *                      undefined, {@link defaultUndiciAdapter} is
       *                      used and behaviour matches the pre-adapter
       *                      undici fetch path exactly.
       * @returns Effect containing PageData with extracted information
       *
       * @example
       * ```typescript
       * const { pageData } = yield* scraper.fetchAndParse('https://example.com');
       * ```
       */
      fetchAndParse: (
        url: string,
        depth = 0,
        userAgent: string = 'JambudipaSpider/1.0',
        httpAdapter?: HttpAdapter | HttpAdapterSelector
      ) =>
        Effect.gen(function* () {
          const startTime = yield* DateTime.now;
          const startMs = DateTime.toEpochMillis(startTime);
          const domain = new URL(url).hostname;

          const timeoutMs = 30000; // 30 seconds — kept inside ScraperService
                                   // (and passed to the adapter) for parity
                                   // with the previous behaviour.

          // Build a per-request id from crypto.randomUUID() — node 20+
          // exposes this globally and we declare node>=20 in engines.
          const requestId = globalThis.crypto.randomUUID();
          const request: HttpAdapterRequest = {
            url,
            userAgent,
            timeoutMs,
            requestId,
          };
          const adapter = resolveAdapter(
            httpAdapter,
            request,
            defaultUndiciAdapter
          );

          // Dispatch via the adapter. The adapter owns timeout enforcement;
          // we map its structured error union back to the existing typed
          // errors so the Spider retry/classification pipeline is unchanged.
          const adapterResponse: HttpAdapterResponse = yield* adapter
            .fetch(request)
            .pipe(
              Effect.catchAll((err) =>
                Effect.gen(function* () {
                  const failTime = yield* DateTime.now;
                  const durationMs =
                    DateTime.toEpochMillis(failTime) - startMs;
                  if (err.kind === 'timeout') {
                    yield* Effect.logWarning(
                      'fetch abort (timeout)'
                    ).pipe(
                      Effect.annotateLogs({
                        event: 'fetch_abort_triggered',
                        domain,
                        url,
                        durationMs,
                        reason: 'timeout',
                        timeoutMs,
                      })
                    );
                  }
                  return yield* Effect.fail(
                    adapterErrorToTypedError(url, durationMs, err)
                  );
                })
              )
            );

          // Check content type - skip binary files
          const contentType =
            adapterResponse.headers['content-type'] ?? '';
          if (
            !contentType.includes('text/html') &&
            !contentType.includes('application/xhtml') &&
            !contentType.includes('text/') &&
            contentType !== ''
          ) {
            return yield* Effect.fail(
              ContentTypeError.create(url, contentType, [
                'text/html',
                'application/xhtml+xml',
                'text/*',
              ])
            );
          }

          // Defensive runtime check: the contract requires `body: string`,
          // but a JS adapter may pass `null`/`undefined`/`Buffer`. Surface
          // contract violations as a ResponseError rather than letting
          // cheerio crash deep in parsing.
          if (typeof adapterResponse.body !== 'string') {
            const bodyTypeName =
              adapterResponse.body === null // eslint-disable-line effect/no-null-use-option -- discriminates null vs undefined in a runtime contract-violation diagnostic message; not a model of absence
                ? 'null'
                : typeof adapterResponse.body;
            return yield* Effect.fail(
              ResponseError.fromCause(
                url,
                `HttpAdapter contract violation: response.body must be a string, got ${bodyTypeName}`
              )
            );
          }

          const html = adapterResponse.body;

          // Parse with Cheerio
          const $ = cheerio.load(html);

          // Extract all metadata from meta tags
          const metadata: Record<string, string> = {};
          $('meta').each((_, element) => {
            const $meta = $(element);
            const name =
              $meta.attr('name') ||
              $meta.attr('property') ||
              $meta.attr('http-equiv');
            const content = $meta.attr('content');
            if (name && content) {
              metadata[name] = content;
            }
          });

          // Extract commonly used metadata for convenience
          const commonMetadata = {
            description: metadata['description'],
            keywords: metadata['keywords'],
            author: metadata['author'],
            robots: metadata['robots'],
          };

          // Copy headers into the existing PageData shape. Adapter
          // contract guarantees `Record<string, string>`.
          const headers: Record<string, string> = { ...adapterResponse.headers };

          // Calculate duration
          const endTime = yield* DateTime.now;
          const durationMs = DateTime.toEpochMillis(endTime) - startMs;

          // Build PageData object using Option for optional fields
          const titleText = $('title').text();
          const title = Option.liftPredicate(titleText, (t) => t.length > 0);
          const hasAnyMetadata = Object.values(commonMetadata).some(
            (v) => Option.isSome(Option.fromNullable(v))
          );
          const maybeCommonMetadata = Option.liftPredicate(
            commonMetadata,
            () => hasAnyMetadata
          );

          const pageData = {
            url,
            html,
            title: Option.getOrUndefined(title),
            metadata,
            commonMetadata: Option.getOrUndefined(maybeCommonMetadata),
            statusCode: adapterResponse.statusCode,
            headers,
            fetchedAt: DateTime.toDate(startTime),
            scrapeDurationMs: durationMs,
            depth,
          };

          // Validate with schema
          const validated = yield* Schema.decode(PageDataSchema)(pageData);
          // `adapterResponse.url` is the final URL after redirects
          // (Node.js native fetch exposes this via `Response.url`).
          return { pageData: validated, finalUrl: adapterResponse.url };
        }),
    })),
  }
) {}
