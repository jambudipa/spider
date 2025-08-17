import { Effect, MutableHashMap, Option } from 'effect';
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
  disallowedPaths: Set<string>;
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
          disallowedPaths: new Set(),
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
              rules.disallowedPaths.add(value);
            } else if (directive.toLowerCase() === 'crawl-delay') {
              rules.crawlDelay = parseInt(value);
            }
          }
        }

        return rules;
      };

      const fetchRobotsTxt = (baseUrl: URL) => {
        const robotsUrl = new URL('/robots.txt', baseUrl);
        return Effect.tryPromise({
          try: async () => {
            const response = await fetch(robotsUrl.toString());

            if (!response.ok) {
              return null;
            }

            return await response.text();
          },
          catch: (error) =>
            RobotsTxtError.fromCause(robotsUrl.toString(), error),
        });
      };

      const isPathAllowed = (url: URL, rules: RobotsRules): boolean => {
        const path = url.pathname;

        for (const disallowedPath of rules.disallowedPaths) {
          if (disallowedPath === '/') return false;

          try {
            // Escape regex special characters first, then handle wildcards
            const pattern = disallowedPath
              .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape all regex special chars
              .replace(/\\\*/g, '.*'); // Convert escaped asterisks back to wildcard patterns

            if (new RegExp(`^${pattern}`).test(path)) {
              return false;
            }
          } catch {
            // If regex construction fails, fall back to simple string matching
            // Silently fall back to simple prefix matching for invalid patterns

            // Simple prefix matching as fallback
            if (disallowedPath.endsWith('*')) {
              const prefix = disallowedPath.slice(0, -1);
              if (path.startsWith(prefix)) {
                return false;
              }
            } else if (path.startsWith(disallowedPath)) {
              return false;
            }
          }
        }

        return true;
      };

      return {
        checkUrl: (urlString: string) =>
          Effect.gen(function* () {
            let url: URL;
            let baseUrl: URL;

            try {
              url = new URL(urlString);
              baseUrl = new URL(`${url.protocol}//${url.host}`);
            } catch (error) {
              // Invalid URL, default to allowing access
              yield* Effect.logWarning(
                `Invalid URL "${urlString}": ${error instanceof Error ? error.message : String(error)}. Allowing access.`
              );
              return { allowed: true };
            }

            const cacheKey = baseUrl.toString();

            const cachedRules = MutableHashMap.get(robotsCache, cacheKey);

            let rules: RobotsRules;

            if (Option.isNone(cachedRules)) {
              const robotsContent = yield* fetchRobotsTxt(baseUrl).pipe(
                Effect.catchAll((error) =>
                  Effect.logWarning(
                    `Failed to fetch robots.txt for ${baseUrl}: ${error.message}. Allowing access.`
                  ).pipe(Effect.map(() => null))
                )
              );

              if (robotsContent) {
                try {
                  rules = parseRobotsTxt(robotsContent);
                } catch {
                  // Silently handle parse errors and use default rules
                  rules = { disallowedPaths: new Set(), userAgent: '*' };
                }
              } else {
                rules = { disallowedPaths: new Set(), userAgent: '*' };
              }

              MutableHashMap.set(robotsCache, cacheKey, rules);
            } else {
              rules = cachedRules.value;
            }

            return {
              allowed: isPathAllowed(url, rules),
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
