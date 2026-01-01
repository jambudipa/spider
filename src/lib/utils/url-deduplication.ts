/**
 * URL Deduplication Utilities
 * Effect-based URL normalization and deduplication with configurable strategies
 */

import { Effect, HashMap, HashSet, Option, pipe, Ref } from 'effect';
import { ValidationError } from '../errors/effect-errors.js';

/**
 * Deduplication strategy options
 */
export interface DeduplicationStrategy {
  /**
   * How to handle www subdomain
   * - 'ignore': Treat www.example.com and example.com as the same
   * - 'preserve': Treat them as different domains
   * - 'prefer-www': Use www version when both exist
   * - 'prefer-non-www': Use non-www version when both exist
   */
  wwwHandling: 'ignore' | 'preserve' | 'prefer-www' | 'prefer-non-www';
  
  /**
   * How to handle URL protocols
   * - 'ignore': Treat http and https as the same
   * - 'preserve': Treat them as different
   * - 'prefer-https': Use https when both exist
   */
  protocolHandling: 'ignore' | 'preserve' | 'prefer-https';
  
  /**
   * How to handle trailing slashes
   */
  trailingSlashHandling: 'ignore' | 'preserve';
  
  /**
   * How to handle query parameters
   */
  queryParamHandling: 'ignore' | 'preserve' | 'sort';
  
  /**
   * How to handle URL fragments (hash)
   */
  fragmentHandling: 'ignore' | 'preserve';
}

/**
 * Default deduplication strategy
 */
export const DEFAULT_DEDUPLICATION_STRATEGY: DeduplicationStrategy = {
  wwwHandling: 'ignore',
  protocolHandling: 'prefer-https',
  trailingSlashHandling: 'ignore',
  queryParamHandling: 'preserve',
  fragmentHandling: 'ignore'
};

/**
 * URL with metadata for crawling
 */
export interface UrlWithMetadata {
  url: string;
  metadata?: Record<string, unknown>;
}

/**
 * Normalized URL result
 */
export interface NormalizedUrl {
  original: string;
  normalized: string;
  domain: string;
  metadata?: Record<string, unknown>;
}

/**
 * Parse and validate a URL
 */
export const parseUrl = (url: string): Effect.Effect<URL, ValidationError> =>
  Effect.try({
    try: () => new URL(url),
    catch: () => ValidationError.url(url)
  });

/**
 * Normalize a URL according to the strategy
 */
export const normalizeUrl = (
  url: string,
  strategy: DeduplicationStrategy = DEFAULT_DEDUPLICATION_STRATEGY
): Effect.Effect<NormalizedUrl, ValidationError> =>
  Effect.gen(function* () {
    const parsed = yield* parseUrl(url);
    
    // Handle protocol
    if (strategy.protocolHandling === 'prefer-https') {
      parsed.protocol = 'https:';
    }
    
    // Handle www subdomain
    let domain = parsed.hostname.toLowerCase();
    const hasWww = domain.startsWith('www.');
    const domainWithoutWww = hasWww ? domain.substring(4) : domain;
    
    switch (strategy.wwwHandling) {
      case 'ignore':
      case 'prefer-non-www':
        domain = domainWithoutWww;
        parsed.hostname = domain;
        break;
      case 'prefer-www':
        if (!hasWww) {
          domain = `www.${domain}`;
          parsed.hostname = domain;
        }
        break;
      case 'preserve':
        // Keep as is
        break;
    }
    
    // Handle trailing slash
    if (strategy.trailingSlashHandling === 'ignore') {
      parsed.pathname = parsed.pathname.replace(/\/$/, '') || '/';
    }
    
    // Handle query parameters
    if (strategy.queryParamHandling === 'ignore') {
      parsed.search = '';
    } else if (strategy.queryParamHandling === 'sort') {
      const params = new URLSearchParams(parsed.search);
      const sorted = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
      parsed.search = new URLSearchParams(sorted).toString();
    }
    
    // Handle fragment
    if (strategy.fragmentHandling === 'ignore') {
      parsed.hash = '';
    }
    
    return {
      original: url,
      normalized: parsed.toString(),
      domain: domainWithoutWww
    };
  });

/**
 * Deduplicate a list of URLs with metadata
 */
export const deduplicateUrls = (
  urls: UrlWithMetadata[],
  strategy: DeduplicationStrategy = DEFAULT_DEDUPLICATION_STRATEGY
): Effect.Effect<{
  deduplicated: UrlWithMetadata[];
  skipped: Array<{ url: string; reason: string }>;
  stats: {
    total: number;
    unique: number;
    duplicates: number;
    invalid: number;
  };
}> =>
  Effect.gen(function* () {
    const domainMap = yield* Ref.make(HashMap.empty<string, UrlWithMetadata>());
    const skipped = yield* Ref.make<Array<{ url: string; reason: string }>>([]);
    let invalidCount = 0;
    
    // Process each URL
    yield* Effect.all(
      urls.map((urlObj) =>
        pipe(
          normalizeUrl(urlObj.url, strategy),
          Effect.tap((normalized) =>
            Effect.gen(function* () {
              const currentMap = yield* Ref.get(domainMap);
              const key = strategy.wwwHandling === 'preserve'
                ? normalized.normalized
                : normalized.domain;

              const existingOption = HashMap.get(currentMap, key);

              if (Option.isNone(existingOption)) {
                // First URL for this domain/normalized URL
                yield* Ref.set(domainMap, HashMap.set(currentMap, key, urlObj));
              } else {
                // Duplicate found
                const existing = existingOption.value;

                // Apply preference rules
                let shouldReplace = false;
                if (strategy.wwwHandling === 'prefer-www') {
                  const existingHasWww = existing.url.includes('://www.');
                  const newHasWww = urlObj.url.includes('://www.');
                  shouldReplace = !existingHasWww && newHasWww;
                } else if (strategy.wwwHandling === 'prefer-non-www') {
                  const existingHasWww = existing.url.includes('://www.');
                  const newHasWww = urlObj.url.includes('://www.');
                  shouldReplace = existingHasWww && !newHasWww;
                }

                if (shouldReplace) {
                  yield* Ref.set(domainMap, HashMap.set(currentMap, key, urlObj));
                  yield* Ref.update(skipped, (arr) => [
                    ...arr,
                    { url: existing.url, reason: `Replaced by preferred variant: ${urlObj.url}` }
                  ]);
                } else {
                  yield* Ref.update(skipped, (arr) => [
                    ...arr,
                    { url: urlObj.url, reason: `Duplicate of: ${existing.url}` }
                  ]);
                }
              }
            })
          ),
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              invalidCount++;
              yield* Ref.update(skipped, (arr) => [
                ...arr,
                { url: urlObj.url, reason: `Invalid URL: ${error.message}` }
              ]);
              yield* Effect.logWarning(`Invalid URL skipped: ${urlObj.url}`);
            })
          )
        )
      ),
      { concurrency: 'unbounded' }
    );
    
    const finalMap = yield* Ref.get(domainMap);
    const finalSkipped = yield* Ref.get(skipped);
    const deduplicated = Array.from(HashMap.values(finalMap));
    
    return {
      deduplicated,
      skipped: finalSkipped,
      stats: {
        total: urls.length,
        unique: deduplicated.length,
        duplicates: finalSkipped.filter(s => s.reason.startsWith('Duplicate')).length,
        invalid: invalidCount
      }
    };
  });

/**
 * Create a URL deduplicator with stateful tracking
 */
export const createUrlDeduplicator = (
  strategy: DeduplicationStrategy = DEFAULT_DEDUPLICATION_STRATEGY
) => Effect.gen(function* () {
  const seenUrls = yield* Ref.make(HashSet.empty<string>());
  const urlStats = yield* Ref.make({
    processed: 0,
    unique: 0,
    duplicates: 0
  });

  return {
    /**
     * Check if a URL has been seen (after normalization)
     */
    hasSeenUrl: (url: string) =>
      Effect.gen(function* () {
        const normalized = yield* normalizeUrl(url, strategy);
        const seen = yield* Ref.get(seenUrls);
        return HashSet.has(seen, normalized.normalized);
      }),

    /**
     * Add a URL to the seen set
     */
    markUrlSeen: (url: string) =>
      Effect.gen(function* () {
        const normalized = yield* normalizeUrl(url, strategy);
        const seen = yield* Ref.get(seenUrls);

        if (HashSet.has(seen, normalized.normalized)) {
          yield* Ref.update(urlStats, stats => ({
            ...stats,
            processed: stats.processed + 1,
            duplicates: stats.duplicates + 1
          }));
          return false; // Was duplicate
        } else {
          yield* Ref.set(seenUrls, HashSet.add(seen, normalized.normalized));
          yield* Ref.update(urlStats, stats => ({
            ...stats,
            processed: stats.processed + 1,
            unique: stats.unique + 1
          }));
          return true; // Was unique
        }
      }),

    /**
     * Get deduplication statistics
     */
    getStats: () => Ref.get(urlStats),

    /**
     * Reset the deduplicator
     */
    reset: () =>
      Effect.gen(function* () {
        yield* Ref.set(seenUrls, HashSet.empty<string>());
        yield* Ref.set(urlStats, {
          processed: 0,
          unique: 0,
          duplicates: 0
        });
      })
  };
});