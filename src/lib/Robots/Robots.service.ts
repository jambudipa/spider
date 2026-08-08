import { Chunk, Effect, MutableHashMap, Option } from 'effect';
import { RobotsTxtError } from '../errors/effect-errors.js';

/**
 * Largest `robots.txt` body this oracle will parse, in bytes.
 *
 * RFC 9309 §2.5 requires crawlers to parse at least 500 KiB. A body larger
 * than this is treated as *unavailable* rather than silently truncated —
 * truncation would drop rules and turn a restriction into an apparent
 * permission.
 *
 * @internal
 */
const MAX_ROBOTS_BYTES = 512 * 1024;

/**
 * A single `Allow` or `Disallow` rule from a `robots.txt` group.
 *
 * @group Data Types
 * @public
 */
export interface RobotsRule {
  /** Whether the rule permits or forbids the matching paths. */
  readonly kind: 'allow' | 'disallow';
  /** The rule's path pattern, exactly as published. */
  readonly path: string;
  /** Compiled matcher for {@link path}. @internal */
  readonly matches: (path: string) => boolean;
}

/**
 * Parsed `robots.txt` rules for a specific user agent.
 *
 * Rules are kept in publication order and matched by longest-pattern
 * precedence, so both `Allow` and `Disallow` are retained.
 *
 * @group Data Types
 * @public
 */
export interface RobotsRules {
  /** Every `Allow`/`Disallow` rule in the group that applies to this agent. */
  readonly rules: readonly RobotsRule[];
  /** Optional crawl delay in seconds specified in robots.txt. */
  readonly crawlDelay?: number;
  /** The user agent these rules apply to. */
  readonly userAgent: string;
}

/**
 * Why {@link RobotsService.checkUrl} reached its verdict.
 *
 * The distinction that matters is between `no-rules-published` — the origin
 * answered and declares no restrictions — and `robots-unavailable`, where
 * nothing is known. The first is an answer; the second is a failure, and they
 * get opposite outcomes.
 *
 * @group Data Types
 * @public
 */
export type RobotsCheckReason =
  /** The origin published no rules (HTTP 404/410, or an empty rule set). */
  | 'no-rules-published'
  /** A rule matched and permits the URL. */
  | 'allowed-by-rule'
  /** A rule matched and forbids the URL. */
  | 'disallowed-by-rule'
  /** The rules could not be established, so the URL is refused. */
  | 'robots-unavailable';

/**
 * The verdict for a single URL.
 *
 * @group Data Types
 * @public
 */
export interface RobotsCheck {
  /** Whether the URL may be fetched. */
  readonly allowed: boolean;
  /** Why {@link allowed} holds the value it does. */
  readonly reason: RobotsCheckReason;
  /** Crawl delay in seconds, when the origin published one. */
  readonly crawlDelay?: number;
  /** The `Disallow` pattern that forbade the URL, when one did. */
  readonly disallowRule?: string;
  /** What went wrong, when `reason` is `robots-unavailable`. */
  readonly unavailableCause?: string;
}

/**
 * The outcome of fetching `/robots.txt` — three distinct facts, not two.
 *
 * @internal
 */
type RobotsFetch =
  | { readonly status: 'published'; readonly body: string }
  | { readonly status: 'absent' }
  | { readonly status: 'unavailable'; readonly cause: string };

/**
 * Compiles a `robots.txt` path pattern into a matcher.
 *
 * Supports the two wildcards defined by RFC 9309: `*` matches any run of
 * characters, and a trailing `$` anchors the match to the end of the path.
 * If the pattern cannot be compiled, matching degrades to a prefix test
 * rather than failing the check.
 *
 * @internal
 */
const compilePattern = (pattern: string): ((path: string) => boolean) => {
  const endAnchored = pattern.endsWith('$');
  const body = endAnchored ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');

  return Option.liftThrowable(
    () => new RegExp(`^${escaped}${endAnchored ? '$' : ''}`)
  )().pipe(
    Option.match({
      onSome: (regex) => (path: string) => regex.test(path),
      onNone: () => {
        const prefix = body.replace(/\*.*$/, '');
        return (path: string) => path.startsWith(prefix);
      },
    })
  );
};

/**
 * Parses a `robots.txt` body into the rules that apply to `userAgent`.
 *
 * Consecutive `User-agent` lines form a single group. An empty `Disallow:`
 * contributes no rule, which is how the standard spells "permit everything".
 *
 * @internal
 */
const parseRobotsTxt = (content: string, userAgent = '*'): RobotsRules => {
  const wanted = userAgent.toLowerCase();
  let rules = Chunk.empty<RobotsRule>();
  let crawlDelay = Option.none<number>();
  let inGroup = false;
  let groupHasRules = false;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const directive = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (directive === 'user-agent') {
      // A `User-agent` line after any rule line starts a fresh group.
      if (groupHasRules) {
        inGroup = false;
        groupHasRules = false;
      }
      const agent = value.toLowerCase();
      if (agent === '*' || agent === wanted) inGroup = true;
      continue;
    }

    if (!inGroup) continue;
    groupHasRules = true;

    if (directive === 'disallow' || directive === 'allow') {
      // An empty `Disallow:` permits everything — it contributes no rule.
      if (value) {
        rules = Chunk.append(rules, {
          kind: directive === 'allow' ? 'allow' : 'disallow',
          path: value,
          matches: compilePattern(value),
        });
      }
    } else if (directive === 'crawl-delay') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        crawlDelay = Option.some(parsed);
      }
    }
  }

  return {
    rules: Chunk.toReadonlyArray(rules),
    userAgent,
    ...(Option.isSome(crawlDelay) ? { crawlDelay: crawlDelay.value } : {}),
  };
};

/**
 * Applies longest-match precedence to a path.
 *
 * The most specific matching rule wins; on an equal-length tie `Allow` beats
 * `Disallow`.
 *
 * @internal
 */
const decidePath = (
  path: string,
  rules: readonly RobotsRule[]
): { allowed: boolean; disallowRule?: string; matched: boolean } => {
  const best = rules.reduce<Option.Option<RobotsRule>>((winner, rule) => {
    if (!rule.matches(path)) return winner;
    if (Option.isNone(winner)) return Option.some(rule);

    const current = winner.value;
    const moreSpecific = rule.path.length > current.path.length;
    const tieGoesToAllow =
      rule.path.length === current.path.length && rule.kind === 'allow';
    return moreSpecific || tieGoesToAllow ? Option.some(rule) : winner;
  }, Option.none());

  return Option.match(best, {
    onNone: () => ({ allowed: true, matched: false }),
    onSome: (rule) =>
      rule.kind === 'allow'
        ? { allowed: true, matched: true }
        : { allowed: false, disallowRule: rule.path, matched: true },
  });
};

/**
 * Service for parsing and enforcing robots.txt compliance.
 *
 * The RobotsService fetches, parses, and caches robots.txt files so that a
 * crawl obeys what an origin actually published. Verdicts are cached per
 * origin for the lifetime of the service.
 *
 * **A 404 is an answer, not a failure.** An origin that returns 404 or 410 for
 * `/robots.txt` has declared no restrictions, and every URL is allowed.
 * An origin that times out, refuses the connection, answers 5xx, or serves a
 * body too large to parse has told us nothing — those URLs are refused. Use
 * `ignoreRobotsTxt` on {@link SpiderConfig} if a target you control cannot
 * serve `/robots.txt` reliably.
 *
 * **Key Features:**
 * - Automatic robots.txt fetching and parsing
 * - Per-origin caching to reduce redundant requests
 * - `Allow` and `Disallow` with longest-match precedence
 * - Crawl delay extraction and enforcement
 * - Distinct outcomes for "no rules" and "rules unknown"
 *
 * **Standards Compliance:**
 * - Follows the Robots Exclusion Standard (RFC 9309)
 * - Supports `User-agent`, `Allow`, `Disallow`, and `Crawl-delay`
 * - Supports the `*` and `$` path wildcards
 * - Handles wildcard (`*`) user agent specifications
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
 *     console.log(`URL refused: ${check.reason}`);
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
      const robotsCache = MutableHashMap.empty<string, RobotsFetch>();

      const fetchRobotsTxt = (
        baseUrl: URL
      ): Effect.Effect<RobotsFetch, RobotsTxtError> => {
        const robotsUrl = new URL('/robots.txt', baseUrl);
        return Effect.gen(function* () {
          const response = yield* Effect.tryPromise({
            try: () =>
              globalThis.fetch(robotsUrl.toString(), {
                // robots.txt is a public declaration. Asking as a signed-in
                // user asks a different question from the one the answer is
                // about, so no credentials are sent.
                credentials: 'omit',
                redirect: 'follow',
                headers: { accept: 'text/plain' },
              }),
            catch: (error) =>
              RobotsTxtError.fromCause(robotsUrl.toString(), error),
          });

          // The origin answered and publishes no rules. That is an answer.
          if (response.status === 404 || response.status === 410) {
            return { status: 'absent' } as const;
          }

          if (!response.ok) {
            return {
              status: 'unavailable',
              cause: `robots.txt responded HTTP ${response.status}`,
            } as const;
          }

          const declaredLength = Number(
            response.headers.get('content-length') ?? Number.NaN
          );
          if (
            Number.isFinite(declaredLength) &&
            declaredLength > MAX_ROBOTS_BYTES
          ) {
            return {
              status: 'unavailable',
              cause: `robots.txt declares ${declaredLength} bytes, over the ${MAX_ROBOTS_BYTES}-byte parse limit`,
            } as const;
          }

          const body = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: (error) =>
              RobotsTxtError.fromCause(robotsUrl.toString(), error),
          });

          if (Buffer.byteLength(body, 'utf8') > MAX_ROBOTS_BYTES) {
            return {
              status: 'unavailable',
              cause: `robots.txt exceeds the ${MAX_ROBOTS_BYTES}-byte parse limit`,
            } as const;
          }

          return { status: 'published', body } as const;
        });
      };

      const parseUrlSafely = (
        urlString: string
      ): Option.Option<{ url: URL; baseUrl: URL }> =>
        Option.gen(function* () {
          const url = yield* Option.liftThrowable(() => new URL(urlString))();
          const baseUrl = yield* Option.liftThrowable(
            () => new URL(`${url.protocol}//${url.host}`)
          )();
          return { url, baseUrl };
        });

      const resolveFetch = (
        baseUrl: URL
      ): Effect.Effect<RobotsFetch> => {
        const cacheKey = baseUrl.toString();
        const cached = MutableHashMap.get(robotsCache, cacheKey);
        if (Option.isSome(cached)) return Effect.succeed(cached.value);

        return fetchRobotsTxt(baseUrl).pipe(
          // A transport failure is not permission. Nothing is known, so the
          // outcome is `unavailable` and the caller fails closed.
          Effect.catchAll((error) =>
            Effect.succeed({
              status: 'unavailable',
              cause: error.message,
            } as const)
          ),
          Effect.tap((outcome) =>
            Effect.sync(() =>
              MutableHashMap.set(robotsCache, cacheKey, outcome)
            )
          )
        );
      };

      return {
        checkUrl: (urlString: string): Effect.Effect<RobotsCheck> =>
          Effect.gen(function* () {
            const parsedUrls = parseUrlSafely(urlString);

            if (Option.isNone(parsedUrls)) {
              yield* Effect.logWarning(
                `Invalid URL "${urlString}". Allowing access.`
              );
              return { allowed: true, reason: 'no-rules-published' as const };
            }

            const { url, baseUrl } = parsedUrls.value;
            const outcome = yield* resolveFetch(baseUrl);

            if (outcome.status === 'unavailable') {
              yield* Effect.logWarning(
                `robots.txt for ${baseUrl.toString()} could not be established (${outcome.cause}). Refusing.`
              );
              return {
                allowed: false,
                reason: 'robots-unavailable' as const,
                unavailableCause: outcome.cause,
              };
            }

            if (outcome.status === 'absent') {
              return { allowed: true, reason: 'no-rules-published' as const };
            }

            const rules = yield* Effect.try(() =>
              parseRobotsTxt(outcome.body)
            ).pipe(
              Effect.orElseSucceed(
                (): RobotsRules => ({ rules: [], userAgent: '*' })
              )
            );

            // Rules match against path plus query, not path alone.
            const decision = decidePath(`${url.pathname}${url.search}`, rules.rules);

            return {
              allowed: decision.allowed,
              reason: decision.matched
                ? decision.allowed
                  ? ('allowed-by-rule' as const)
                  : ('disallowed-by-rule' as const)
                : rules.rules.length === 0
                  ? ('no-rules-published' as const)
                  : ('allowed-by-rule' as const),
              crawlDelay: rules.crawlDelay,
              disallowRule: decision.disallowRule,
            };
          }),

        getRules: (domain: string): Effect.Effect<Option.Option<RobotsRules>> =>
          Effect.sync(() => {
            const cacheKey = Option.liftThrowable(
              () => new URL(domain).toString()
            )();
            if (Option.isNone(cacheKey)) return Option.none<RobotsRules>();
            return MutableHashMap.get(robotsCache, cacheKey.value).pipe(
              Option.flatMap((outcome) =>
                outcome.status === 'published'
                  ? Option.some(parseRobotsTxt(outcome.body))
                  : Option.none()
              )
            );
          }),
      };
    }),
  }
) {}
