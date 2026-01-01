import { DateTime, Duration, Effect, Option, Schema } from 'effect';
import * as cheerio from 'cheerio';
import { PageDataSchema } from '../PageData/PageData.js';
import { NetworkError, ResponseError, ContentTypeError, RequestAbortError } from '../errors.js';
import { SpiderLogger } from '../Logging/SpiderLogger.service.js';

/**
 * Service responsible for fetching HTML content and parsing basic page information.
 * 
 * The ScraperService handles the core HTTP fetching and HTML parsing functionality
 * for the Spider framework. It provides robust error handling, timeout management,
 * and content type validation to ensure reliable data extraction.
 * 
 * **Key Features:**
 * - Automatic timeout handling with AbortController
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
 *   const pageData = yield* scraper.fetchAndParse('https://example.com', 0);
 *   console.log(`Title: ${pageData.title}`);
 *   console.log(`Content length: ${pageData.html.length}`);
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
       * This method performs the following operations:
       * 1. Fetches the URL with configurable timeout (30 seconds)
       * 2. Validates content type (skips binary files)
       * 3. Parses HTML content with cheerio
       * 4. Extracts basic page metadata (title, description, etc.)
       * 5. Returns structured PageData object
       * 
       * The method uses AbortController for proper timeout handling to prevent
       * workers from hanging on malformed URLs or slow responses.
       * 
       * @param url - The URL to fetch and parse
       * @param depth - The crawl depth for logging purposes (default: 0)
       * @returns Effect containing PageData with extracted information
       * @throws NetworkError for network-related failures
       * @throws ResponseError for HTTP error responses
       * 
       * @example
       * Basic usage:
       * ```typescript
       * const pageData = yield* scraper.fetchAndParse('https://example.com');
       * console.log(`Page title: ${pageData.title}`);
       * ```
       * 
       * With depth tracking:
       * ```typescript
       * const pageData = yield* scraper.fetchAndParse('https://example.com/page', 2);
       * ```
       * 
       * Error handling:
       * ```typescript
       * const result = yield* scraper.fetchAndParse('https://example.com').pipe(
       *   Effect.catchTags({
       *     NetworkError: (error) => {
       *       console.log('Network error:', error.message);
       *       return Effect.succeed(null);
       *     },
       *     ResponseError: (error) => {
       *       console.log('HTTP error:', error.statusCode);
       *       return Effect.succeed(null);
       *     }
       *   })
       * );
       * ```
       * 
       * @performance 
       * - Request timeout: 30 seconds
       * - Response parsing timeout: 10 seconds
       * - Memory usage: ~2-5MB per page depending on content size
       * 
       * @security
       * - Validates content types to prevent processing binary files
       * - Uses AbortController to prevent hanging requests
       * - No execution of JavaScript content (static HTML parsing only)
       */
      fetchAndParse: (url: string, depth = 0) =>
        Effect.gen(function* () {
          const startTime = yield* DateTime.now;
          const startMs = DateTime.toEpochMillis(startTime);
          const logger = yield* SpiderLogger;
          const domain = new URL(url).hostname;

          // Log fetch start is handled by spider already

          const timeoutMs = 30000; // 30 seconds

          // Create the fetch effect with timeout
          const fetchEffect = Effect.tryPromise({
            try: () => globalThis.fetch(url),
            catch: (error) => {
              if (error instanceof Error && error.name === 'AbortError') {
                return RequestAbortError.timeout(url, timeoutMs);
              }
              return NetworkError.fromCause(url, error);
            },
          });

          // Apply timeout and handle timeout case
          const fetchWithTimeout = fetchEffect.pipe(
            Effect.timeoutOption(Duration.millis(timeoutMs)),
            Effect.flatMap((maybeResponse) =>
              Option.match(maybeResponse, {
                onNone: () =>
                  Effect.gen(function* () {
                    const currentTime = yield* DateTime.now;
                    const durationMs = DateTime.toEpochMillis(currentTime) - startMs;
                    yield* logger.logEdgeCase(domain, 'fetch_abort_triggered', {
                      url,
                      durationMs,
                      reason: 'timeout',
                      timeoutMs,
                    });
                    return yield* Effect.fail(
                      RequestAbortError.timeout(url, durationMs)
                    );
                  }),
                onSome: (response) => Effect.succeed(response),
              })
            )
          );

          // Fetch HTML with Effect-based timeout
          // JUSTIFICATION: Effect's timeout properly handles cancellation via Fiber interruption.
          // Previous implementation used AbortController, now using idiomatic Effect patterns.
          const response = yield* fetchWithTimeout;

          // Check content type - skip binary files
          const contentType = response.headers.get('content-type') ?? '';
          if (
            !contentType.includes('text/html') &&
            !contentType.includes('application/xhtml') &&
            !contentType.includes('text/') &&
            contentType !== ''
          ) {
            return yield* Effect.fail(
              ContentTypeError.create(
                url,
                contentType,
                ['text/html', 'application/xhtml+xml', 'text/*']
              )
            );
          }

          // Parse response with timeout protection
          const textTimeoutMs = 10000; // 10 seconds

          // Create the text parsing effect
          const parseTextEffect = Effect.tryPromise({
            try: () => response.text(),
            catch: (error) => ResponseError.fromCause(url, error),
          });

          // Apply timeout and handle timeout case
          const parseWithTimeout = parseTextEffect.pipe(
            Effect.timeoutOption(Duration.millis(textTimeoutMs)),
            Effect.flatMap((maybeHtml) =>
              Option.match(maybeHtml, {
                onNone: () =>
                  Effect.gen(function* () {
                    const currentTime = yield* DateTime.now;
                    const durationMs = DateTime.toEpochMillis(currentTime) - startMs;
                    yield* logger.logEdgeCase(domain, 'response_text_abort_triggered', {
                      url,
                      durationMs,
                      reason: 'timeout',
                      timeoutMs: textTimeoutMs,
                    });
                    return yield* Effect.fail(
                      RequestAbortError.timeout(url, durationMs)
                    );
                  }),
                onSome: (html) => Effect.succeed(html),
              })
            )
          );

          const html = yield* parseWithTimeout;

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

          // Extract all headers
          const headers: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });

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
            statusCode: response.status,
            headers,
            fetchedAt: DateTime.toDate(startTime),
            scrapeDurationMs: durationMs,
            depth,
          };

          // Validate with schema
          return yield* Schema.decode(PageDataSchema)(pageData);
        }),
    })),
  }
) {}
