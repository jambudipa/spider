import { Effect, Schema } from 'effect';
import * as cheerio from 'cheerio';
import { PageDataSchema } from '../PageData/PageData.js';
import { NetworkError, ResponseError } from '../errors.js';
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
 * - Effect.js integration for composability
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
          const startTime = yield* Effect.sync(() => new Date());
          const startMs = startTime.getTime();
          const logger = yield* SpiderLogger;
          const domain = new URL(url).hostname;

          // Log fetch start is handled by spider already

          // Create AbortController for proper timeout handling
          const controller = new AbortController();
          const timeoutMs = 30000; // 30 seconds

          const timeoutId = setTimeout(() => {
            const duration = Date.now() - startMs;
            Effect.runSync(
              logger.logEdgeCase(domain, 'fetch_abort_triggered', {
                url,
                durationMs: duration,
                reason: 'timeout',
                timeoutMs,
              })
            );
            controller.abort();
          }, timeoutMs);

          // Fetch HTML with AbortController-based timeout
          // JUSTIFICATION: Effect's timeout doesn't actually abort the underlying fetch operation,
          // causing workers to hang on malformed URLs. AbortController properly cancels the request.
          // EVIDENCE: Logs show 298 stuck fetches on URLs with escaped quotes, 292 on multiple slashes,
          // all showing as "pending" with 0 timeouts fired despite 45-second configuration.
          const response = yield* Effect.tryPromise({
            try: async () => {
              try {
                const resp = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);

                // Check content type - skip binary files
                const contentType = resp.headers.get('content-type') || '';
                if (
                  !contentType.includes('text/html') &&
                  !contentType.includes('application/xhtml') &&
                  !contentType.includes('text/') &&
                  contentType !== ''
                ) {
                  throw new Error(`Skipping non-HTML content: ${contentType}`);
                }

                return resp;
              } catch (error) {
                clearTimeout(timeoutId);
                if (error instanceof Error && error.name === 'AbortError') {
                  throw new Error(
                    `Request aborted after ${Date.now() - startMs}ms`
                  );
                }
                throw error;
              }
            },
            catch: (error) => NetworkError.fromCause(url, error),
          });

          // Parse response with timeout protection
          // Create a new AbortController for response parsing
          const textController = new AbortController();
          const textTimeoutMs = 10000; // 10 seconds

          const textTimeoutId = setTimeout(() => {
            const duration = Date.now() - startMs;
            Effect.runSync(
              logger.logEdgeCase(domain, 'response_text_abort_triggered', {
                url,
                durationMs: duration,
                reason: 'timeout',
                timeoutMs: textTimeoutMs,
              })
            );
            textController.abort();
          }, textTimeoutMs);

          const html = yield* Effect.tryPromise({
            try: async () => {
              try {
                // Use a readable stream with abort capability
                const reader = response.body?.getReader();
                if (!reader) throw new Error('No response body');

                const decoder = new TextDecoder();
                let html = '';

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  html += decoder.decode(value, { stream: true });

                  // Check if we should abort
                  if (textController.signal.aborted) {
                    reader.cancel();
                    throw new Error('Response parsing aborted');
                  }
                }

                clearTimeout(textTimeoutId);
                return html;
              } catch (error) {
                clearTimeout(textTimeoutId);
                throw error;
              }
            },
            catch: (error) => ResponseError.fromCause(url, error),
          });

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
          const endTime = yield* Effect.sync(() => new Date());
          const durationMs = endTime.getTime() - startTime.getTime();

          // Build PageData object
          const pageData = {
            url,
            html,
            title: $('title').text() || undefined,
            metadata,
            commonMetadata: Object.values(commonMetadata).some((v) => v)
              ? commonMetadata
              : undefined,
            statusCode: response.status,
            headers,
            fetchedAt: startTime,
            scrapeDurationMs: durationMs,
            depth,
          };

          // Validate with schema
          return yield* Schema.decode(PageDataSchema)(pageData);
        }),
    })),
  }
) {}
