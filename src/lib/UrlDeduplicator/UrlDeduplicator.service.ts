import { Effect, MutableHashSet } from 'effect';
import { SpiderConfig } from '../Config/SpiderConfig.service.js';

/**
 * Thread-safe URL deduplication service with built-in normalization.
 *
 * Provides atomic operations for checking and adding URLs to prevent
 * race conditions in concurrent environments. URLs are normalized
 * before storage to ensure consistent deduplication.
 *
 * @group Services
 * @public
 */
export interface IUrlDeduplicator {
  /**
   * Attempts to add a URL to the deduplication set.
   *
   * @param url - The URL to add
   * @returns Effect containing boolean - true if URL was added (first time seen), false if already exists
   */
  tryAdd(_url: string): Effect.Effect<boolean>;

  /**
   * Checks if a URL has already been seen.
   *
   * @param url - The URL to check
   * @returns Effect containing boolean - true if URL exists, false otherwise
   */
  contains(_url: string): Effect.Effect<boolean>;

  /**
   * Returns the current number of unique URLs in the set.
   *
   * @returns Effect containing the count
   */
  size(): Effect.Effect<number>;

  /**
   * Clears all URLs from the deduplication set.
   *
   * @returns Effect containing void
   */
  clear(): Effect.Effect<void>;
}

/**
 * URL deduplication service as an Effect Service.
 *
 * @group Services
 * @public
 */
export class UrlDeduplicatorService extends Effect.Service<UrlDeduplicatorService>()(
  '@jambudipa.io/UrlDeduplicatorService',
  {
    effect: Effect.gen(function* () {
      const config = yield* SpiderConfig;
      const shouldNormalize =
        yield* config.shouldNormalizeUrlsForDeduplication();

      const seenUrls = MutableHashSet.empty<string>();
      const mutex = yield* Effect.makeSemaphore(1); // Mutual exclusion semaphore

      /**
       * Normalizes a URL for consistent deduplication.
       */
      const normalizeUrl = (url: string): Effect.Effect<string> => {
        if (!shouldNormalize) {
          return Effect.succeed(url);
        }

        return Effect.orElse(
          Effect.sync(() => {
            const parsed = new URL(url);

            // Normalize pathname: remove multiple consecutive slashes and trailing slashes
            let normalizedPath = parsed.pathname
              .replace(/\/+/g, '/') // Replace multiple slashes with single slash
              .replace(/\/$/, ''); // Remove trailing slash

            // Keep root path as '/'
            if (normalizedPath === '') {
              normalizedPath = '/';
            }

            parsed.pathname = normalizedPath;

            // Remove fragment
            parsed.hash = '';

            // Remove default ports
            if (
              (parsed.protocol === 'http:' && parsed.port === '80') ||
              (parsed.protocol === 'https:' && parsed.port === '443')
            ) {
              parsed.port = '';
            }

            // Sort query parameters alphabetically
            if (parsed.search) {
              const params = new URLSearchParams(parsed.search);
              const sortedParams = new URLSearchParams();
              Array.from(params.keys())
                .sort()
                .forEach((key) => {
                  params.getAll(key).forEach((value) => {
                    sortedParams.append(key, value);
                  });
                });
              parsed.search = sortedParams.toString();
            }

            return parsed.toString();
          }),
          // If URL parsing fails, return original
          () => Effect.succeed(url)
        );
      };

      return {
        tryAdd: (url: string) =>
          mutex.withPermits(1)(
            Effect.gen(function* () {
              const normalizedUrl = yield* normalizeUrl(url);

              if (MutableHashSet.has(seenUrls, normalizedUrl)) {
                return false; // Already exists
              }

              MutableHashSet.add(seenUrls, normalizedUrl);
              return true; // Successfully added
            })
          ),

        contains: (url: string) =>
          mutex.withPermits(1)(
            Effect.gen(function* () {
              const normalizedUrl = yield* normalizeUrl(url);
              return MutableHashSet.has(seenUrls, normalizedUrl);
            })
          ),

        size: () =>
          mutex.withPermits(1)(
            Effect.sync(() => MutableHashSet.size(seenUrls))
          ),

        clear: () =>
          mutex.withPermits(1)(
            Effect.sync(() => MutableHashSet.clear(seenUrls))
          ),
      };
    }),
    dependencies: [SpiderConfig.Default],
  }
) {}
