import { Effect, MutableHashMap, MutableHashSet, Option } from 'effect';
import { RobotsTxtError } from '../errors.js';

/**
 * Parsed robots.txt rules for a specific user agent.
 * 
 * Contains the disallowed paths and crawl delay settings extracted
 * from a robots.txt file for a particular user agent string.
 * 
 * @group Data Types
 * @internal
 */
interface RobotsRules {
  /** Set of URL paths that are disallowed for this user agent */
  disallowedPaths: MutableHashSet.MutableHashSet<string>;
  /** Optional crawl delay in seconds specified in robots.txt */
  crawlDelay?: number;
  /** The user agent these rules apply to */
  userAgent: string;
}

/**
 * Service for parsing and enforcing robots.txt compliance.
 * 
 * The RobotsService handles fetching, parsing, and caching robots.txt files
 * to ensure compliant web crawling. It provides efficient URL checking with
 * automatic caching to minimise network requests.
 * 
 * **Key Features:**
 * - Automatic robots.txt fetching and parsing
 * - Intelligent caching to reduce redundant requests
 * - User agent-specific rule enforcement
 * - Crawl delay extraction and enforcement
 * - Graceful error handling for malformed robots.txt files
 * 
 * **Standards Compliance:**
 * - Follows the Robots Exclusion Standard (RFC 9309)
 * - Supports User-agent, Disallow, and Crawl-delay directives
 * - Handles wildcard (*) user agent specifications
 * - Case-insensitive user agent matching
 * 
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const robots = yield* RobotsService;
 *   
 *   // Check if URL is allowed
 *   const check = yield* robots.checkUrl('https://example.com/admin');
 *   if (!check.allowed) {
 *     console.log('URL blocked by robots.txt');
 *     return;
 *   }
 *   
 *   // Apply crawl delay if specified
 *   if (check.crawlDelay) {
 *     yield* Effect.sleep(`${check.crawlDelay} seconds`);
 *   }
 *   
 *   // Proceed with crawling...
 * });
 * ```
 * 
 * @group Services
 * @public
 */
export class RobotsService extends Effect.Service<RobotsService>()(
  '@jambudipa.io/RobotsService',
  {
    effect: Effect.sync(() => {
      const robotsCache = MutableHashMap.empty<string, RobotsRules>();

      const parseRobotsTxt = (
        content: string,
        userAgent = '*'
      ): RobotsRules => {
        const lines = content.split('\n');
        const rules: RobotsRules = {
          disallowedPaths: MutableHashSet.empty<string>(),
          userAgent,
        };

        let currentUserAgent = '';
        let isRelevantSection = false;

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('#') || !trimmed) continue;

          const [directive, ...valueParts] = trimmed.split(':');
          const value = valueParts.join(':').trim();

          if (directive.toLowerCase() === 'user-agent') {
            currentUserAgent = value;
            isRelevantSection =
              currentUserAgent === '*' ||
              currentUserAgent.toLowerCase() === userAgent.toLowerCase();
          } else if (isRelevantSection) {
            if (directive.toLowerCase() === 'disallow' && value) {
              MutableHashSet.add(rules.disallowedPaths, value);
            } else if (directive.toLowerCase() === 'crawl-delay') {
              rules.crawlDelay = parseInt(value);
            }
          }
        }

        return rules;
      };

      const fetchRobotsTxt = (baseUrl: URL): Effect.Effect<Option.Option<string>, RobotsTxtError> => {
        const robotsUrl = new URL('/robots.txt', baseUrl);
        return Effect.gen(function* () {
          const response = yield* Effect.tryPromise({
            try: () => globalThis.fetch(robotsUrl.toString()),
            catch: (error) => RobotsTxtError.fromCause(robotsUrl.toString(), error),
          });

          if (!response.ok) {
            return Option.none<string>();
          }

          const text = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: (error) => RobotsTxtError.fromCause(robotsUrl.toString(), error),
          });

          return Option.some(text);
        });
      };

      const isPathDisallowedByPattern = (path: string, disallowedPath: string): boolean => {
        if (disallowedPath === '/') return true;

        // Escape regex special characters first, then handle wildcards
        const pattern = disallowedPath
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape all regex special chars
          .replace(/\\\*/g, '.*'); // Convert escaped asterisks back to wildcard patterns

        return new RegExp(`^${pattern}`).test(path);
      };

      const isPathDisallowedFallback = (path: string, disallowedPath: string): boolean => {
        // Simple prefix matching as fallback
        if (disallowedPath.endsWith('*')) {
          const prefix = disallowedPath.slice(0, -1);
          return path.startsWith(prefix);
        }
        return path.startsWith(disallowedPath);
      };

      const checkPathAgainstPattern = (path: string, disallowedPath: string): Effect.Effect<boolean> =>
        Effect.try(() => isPathDisallowedByPattern(path, disallowedPath)).pipe(
          Effect.orElse(() => Effect.succeed(isPathDisallowedFallback(path, disallowedPath)))
        );

      const isPathAllowed = (url: URL, rules: RobotsRules): Effect.Effect<boolean> => {
        const path = url.pathname;

        return Effect.gen(function* () {
          for (const disallowedPath of rules.disallowedPaths) {
            const isDisallowed = yield* checkPathAgainstPattern(path, disallowedPath);
            if (isDisallowed) {
              return false;
            }
          }
          return true;
        });
      };

      const createDefaultRules = (): RobotsRules => ({
        disallowedPaths: MutableHashSet.empty<string>(),
        userAgent: '*',
      });

      const parseUrlSafely = (urlString: string): Option.Option<{ url: URL; baseUrl: URL }> =>
        Option.gen(function* () {
          const url = yield* Option.liftThrowable(() => new URL(urlString))();
          const baseUrl = yield* Option.liftThrowable(() => new URL(`${url.protocol}//${url.host}`))();
          return { url, baseUrl };
        });

      const parseRobotsTxtSafely = (content: string): Effect.Effect<RobotsRules> =>
        Effect.try(() => parseRobotsTxt(content)).pipe(
          Effect.orElse(() => Effect.succeed(createDefaultRules()))
        );

      return {
        checkUrl: (urlString: string) =>
          Effect.gen(function* () {
            const parsedUrls = parseUrlSafely(urlString);

            if (Option.isNone(parsedUrls)) {
              // Invalid URL, default to allowing access
              yield* Effect.logWarning(
                `Invalid URL "${urlString}". Allowing access.`
              );
              return { allowed: true };
            }

            const { url, baseUrl } = parsedUrls.value;
            const cacheKey = baseUrl.toString();

            const cachedRules = MutableHashMap.get(robotsCache, cacheKey);

            let rules: RobotsRules;

            if (Option.isNone(cachedRules)) {
              const robotsContentOption = yield* fetchRobotsTxt(baseUrl).pipe(
                Effect.catchAll((error) =>
                  Effect.logWarning(
                    `Failed to fetch robots.txt for ${baseUrl}: ${error.message}. Allowing access.`
                  ).pipe(Effect.map(() => Option.none<string>()))
                )
              );

              if (Option.isSome(robotsContentOption)) {
                rules = yield* parseRobotsTxtSafely(robotsContentOption.value);
              } else {
                rules = createDefaultRules();
              }

              MutableHashMap.set(robotsCache, cacheKey, rules);
            } else {
              rules = cachedRules.value;
            }

            const allowed = yield* isPathAllowed(url, rules);

            return {
              allowed,
              crawlDelay: rules.crawlDelay,
            };
          }),

        getRules: (domain: string) =>
          Effect.sync(() => {
            const baseUrl = new URL(domain);
            const cacheKey = baseUrl.toString();
            return MutableHashMap.get(robotsCache, cacheKey);
          }),
      };
    }),
  }
) {}
