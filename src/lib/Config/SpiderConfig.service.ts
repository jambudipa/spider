import {
  Chunk,
  Duration,
  Effect,
  HashMap,
  Layer,
  MutableRef,
  Option,
  Schedule,
} from 'effect';
import type { PageFetchErrorKind } from '../Spider/Spider.types.js';
import { classifyFetchError } from '../Spider/Spider.types.js';
import { SPIDER_DEFAULTS } from '../Spider/Spider.defaults.js';
import { ConfigError } from '../errors/effect-errors.js';
import type {
  HttpAdapter,
  HttpAdapterSelector,
} from '../HttpAdapter/HttpAdapter.types.js';

/**
 * Strategies for treating two hostnames/protocols as equivalent
 * during domain-restricted crawling.
 *
 * @group Configuration
 * @public
 */
export interface DomainEquivalenceConfig {
  /** `'ignore'` treats `www.X` and `X` as the same domain. `'strict'` treats them as different. */
  readonly wwwHandling: 'ignore' | 'strict';
  /** `'permissive'` allows http<->https when domain matches. `'strict'` requires identical protocol. */
  readonly protocolHandling: 'permissive' | 'strict';
  /** `'strict'` blocks `sub.X` from matching `X`. `'ignore'` allows arbitrary subdomains under the starting domain. */
  readonly subdomainHandling: 'strict' | 'ignore';
}

/**
 * Default domain-equivalence settings used when no explicit config is provided.
 *
 * @group Configuration
 * @public
 */
export const defaultDomainEquivalence: DomainEquivalenceConfig = {
  wwwHandling: 'ignore',
  protocolHandling: 'permissive',
  subdomainHandling: 'strict',
};

/**
 * Error kinds that may be retried by the fetch pipeline.
 * Mirrors the discriminator on {@link PageFetchError}.
 *
 * @group Configuration
 * @public
 */
export type RetryableErrorKind = PageFetchErrorKind;

/**
 * Retry policy for the page-fetch pipeline.
 *
 * @group Configuration
 * @public
 */
export interface FetchRetryConfig {
  /** Total attempts including the initial one (must be >= 1). */
  readonly maxAttempts: number;
  /** Base backoff in milliseconds for the exponential schedule. */
  readonly baseBackoffMs: number;
  /** Error kinds that trigger a retry. Errors outside this list propagate immediately. */
  readonly retryOn: ReadonlyArray<RetryableErrorKind>;
}

/**
 * Default fetch-retry policy.
 *
 * @group Configuration
 * @public
 */
export const defaultFetchRetry: FetchRetryConfig = {
  maxAttempts: 3,
  baseBackoffMs: 1000,
  retryOn: ['timeout', 'http_5xx', 'http_429'],
};

/**
 * Reason a domain finished a pass. Mirrors the `reason` field on
 * {@link DomainCompleteEvent}. Re-declared here to avoid a circular
 * import between Config and Logging.
 *
 * @group Configuration
 * @public
 */
export type DomainCompleteReason =
  | 'queue_empty'
  | 'max_pages'
  | 'error'
  | 'robots_blocked'
  | 'all_fetches_failed'
  | 'interrupted'
  | 'interrupt_grace_exceeded';

/**
 * Predicate used to decide whether a domain that just completed a pass should
 * be retried in a subsequent pass. The match is conjunctive — both conditions
 * must hold.
 *
 * @group Configuration
 * @public
 */
export interface DomainRetryPredicate {
  /** Domain `reason` values eligible for retry. */
  readonly reasons: ReadonlyArray<DomainCompleteReason>;
  /**
   * Upper bound on `pagesAttempted` for the just-completed pass. A domain that
   * scraped more pages than this is treated as a partial-coverage failure
   * (likely structural) rather than a transient burst — and so is NOT retried.
   */
  readonly maxPagesAttempted: number;
}

/**
 * Per-pass overrides applied to retry passes (cycle &ge; 1). Each field is
 * optional; when omitted, the base {@link SpiderConfigOptions} value flows
 * through unchanged.
 *
 * @group Configuration
 * @public
 */
export interface DomainRetryPassOverrides {
  /** Override {@link SpiderConfigOptions.concurrency} for retry passes. */
  readonly concurrency?: number | 'unbounded' | 'inherit';
  /** Override {@link SpiderConfigOptions.fetchRetry} for retry passes. */
  readonly fetchRetry?: FetchRetryConfig;
}

/**
 * Configuration for in-cycle domain-level retry. When `enabled` is true and
 * a domain's pass-0 completion matches `retryOn`, the spider sleeps
 * `backoffMs` and runs that domain's start URL again (up to `maxPasses` total
 * passes). All passes share the same undici connection pool, URL
 * deduplicator, robots cache, result channel, and event sink.
 *
 * Default behaviour preserves the pre-feature behaviour: `enabled: false`
 * means a single pass is run.
 *
 * @group Configuration
 * @public
 */
export interface DomainRetryConfig {
  /** Master switch. When `false`, the rest of this config is ignored. */
  readonly enabled: boolean;
  /**
   * Total passes including the initial one. Must be `>= 1`. `1` is the
   * pre-feature default (pass 0 only); `2` means pass 0 + one retry pass.
   */
  readonly maxPasses: number;
  /** Delay between passes, in milliseconds. Must be `>= 0`. */
  readonly backoffMs: number;
  /** Predicate selecting which pass-completion outcomes trigger a retry. */
  readonly retryOn: DomainRetryPredicate;
  /** Optional overrides applied to retry passes. */
  readonly passOverrides?: DomainRetryPassOverrides;
}

/**
 * Default domain-retry policy: disabled. Preserves pre-feature behaviour
 * (one pass, no retry) when `domainRetry` is omitted from `SpiderConfigOptions`.
 *
 * @group Configuration
 * @public
 */
export const defaultDomainRetry: DomainRetryConfig = {
  enabled: false,
  maxPasses: 1,
  backoffMs: 60_000,
  retryOn: {
    reasons: ['all_fetches_failed'],
    maxPagesAttempted: 1,
  },
};

/**
 * Build the Effect retry schedule used by the page-fetch pipeline.
 *
 * Exported so callers (production code and tests) share a single source
 * of truth — production drift will surface in tests immediately rather
 * than silently passing against a stale local copy.
 *
 * Shape: exponential backoff intersected with `recurs(maxAttempts - 1)`,
 * gated by `whileInput(isRetryable)` so non-retryable error kinds stop
 * the schedule immediately.
 *
 * @param cfg - Retry policy.
 * @param onAttempt - Optional infallible side-effect fired by the schedule
 * each time it receives a failure input — i.e. once per retry decision,
 * before the backoff delay is awaited. Used by the spider to refresh the
 * worker heartbeat between attempts so long retry chains aren't flagged
 * as a dead worker. The hook is typed `Effect.Effect<unknown, never>` so
 * it cannot corrupt the retry chain by failing.
 *
 * @group Configuration
 * @public
 */
export const buildFetchRetrySchedule = (
  cfg: FetchRetryConfig,
  onAttempt?: Effect.Effect<unknown>
): Schedule.Schedule<readonly [Duration.Duration, number]> => {
  // `classifyFetchError` could in principle throw on exotic wrapped
  // errors (FiberFailure, Cause); a throw inside the predicate would
  // crash the worker. Treat any classification failure as non-retryable
  // so the error surfaces normally. try/catch is the right shape here
  // because the predicate is sync.
  const isRetryable = (error: unknown): boolean => {
    // eslint-disable-next-line effect/no-try-catch-use-effect -- sync predicate, defensive guard against exotic error shapes
    try {
      const kind = classifyFetchError(error, 0, 0).kind;
      return cfg.retryOn.includes(kind);
    } catch {
      return false;
    }
  };
  const base = Schedule.exponential(Duration.millis(cfg.baseBackoffMs)).pipe(
    Schedule.intersect(Schedule.recurs(Math.max(0, cfg.maxAttempts - 1))),
    Schedule.whileInput(isRetryable)
  );
  // eslint-disable-next-line effect/no-undefined-use-option -- `onAttempt` is an optional function parameter (Effect-or-omitted); the absence check is the natural JS shape, and Option would force callers to wrap every invocation
  return onAttempt === undefined
    ? base
    : base.pipe(Schedule.tapInput(() => onAttempt));
};

/**
 * Cross-domain redirect handling for start URLs.
 *
 * When `enabled` is `true` and the start URL's HTTP response resolves to a
 * different hostname (e.g. `example.org` → `example.org.au`), the spider
 * updates the per-domain restriction to the final host so subsequent links
 * are followed on the redirected domain. When `false` (the default),
 * cross-domain redirects produce zero pages because every discovered link
 * is treated as off-domain.
 *
 * `maxHops` is informational only — `globalThis.fetch` follows redirects
 * transparently and does not expose intermediate hops, so the emitted
 * {@link StartUrlRedirectedEvent.chain} contains only `[from, to]`.
 *
 * @group Configuration
 * @public
 */
export interface CrossDomainRedirectConfig {
  readonly enabled: boolean;
  readonly maxHops: number;
}

/**
 * Default cross-domain redirect policy: disabled.
 *
 * @group Configuration
 * @public
 */
export const defaultCrossDomainRedirects: CrossDomainRedirectConfig = {
  enabled: false,
  maxHops: 3,
};

/**
 * User-agent selection strategy for outgoing requests.
 *
 * - `static`: use a fixed UA string for every request (the existing
 *   `userAgent` shorthand in {@link SpiderConfigOptions} is sugar for this).
 * - `rotating`: pick from a pool. With `perDomain: true`, each domain gets a
 *   sticky UA chosen on first contact; with `perDomain: false`, a fresh
 *   selection is made per request.
 * - `custom`: synchronous resolver invoked per request. Useful when the UA
 *   depends on request metadata (e.g. URL patterns).
 *
 * Anti-bot evasion beyond UA — `Accept-Language`, `Referer`, TLS fingerprint
 * randomisation, JavaScript execution — is out of scope. Consumers needing
 * deeper evasion must implement it externally.
 *
 * @group Configuration
 * @public
 */
export type UserAgentStrategy =
  | { readonly kind: 'static'; readonly userAgent: string }
  | {
      readonly kind: 'rotating';
      readonly pool: ReadonlyArray<string>;
      readonly perDomain: boolean;
    }
  | { readonly kind: 'custom'; readonly resolver: (url: string) => string };

/**
 * Behaviour when a stop condition fires (`maxPages`, external abort signal).
 *
 * - `'drain'` — current behaviour: let every in-flight task finish naturally.
 * - `'interrupt'` — new: cancel in-flight fetches and exit within `gracePeriodMs`.
 * - Object form allows tuning `gracePeriodMs` (default 5 000 ms).
 *
 * @group Configuration
 * @public
 */
export type StopMode =
  | 'drain'
  | 'interrupt'
  | { readonly kind: 'interrupt'; readonly gracePeriodMs?: number };

/**
 * Normalised stop-mode after defaults are applied.
 *
 * @group Configuration
 * @public
 */
export interface ResolvedStopMode {
  readonly kind: 'drain' | 'interrupt';
  readonly gracePeriodMs: number;
}

const resolveStopMode = (mode?: StopMode): ResolvedStopMode => {
  if (!mode || mode === 'drain') return { kind: 'drain', gracePeriodMs: 5000 };
  if (mode === 'interrupt') return { kind: 'interrupt', gracePeriodMs: 5000 };
  return { kind: 'interrupt', gracePeriodMs: mode.gracePeriodMs ?? 5000 };
};

/**
 * Resolve the User-Agent string for a given request.
 *
 * Pure function — `cache` is mutated in place when `rotating` + `perDomain`
 * is selected to keep the per-domain UA stable across requests within one
 * crawl session. The cache is owned by the caller (typically the `crawl`
 * method) so its lifetime is one crawl invocation.
 *
 * @group Configuration
 * @public
 */
export const resolveUserAgent = (
  strategy: UserAgentStrategy,
  domain: string,
  cache: MutableRef.MutableRef<HashMap.HashMap<string, string>>
): string => {
  if (strategy.kind === 'static') return strategy.userAgent;
  if (strategy.kind === 'custom') return strategy.resolver(domain);
  // rotating
  const pick = () =>
    // This helper is a synchronous pure function called from non-Effect
    // contexts (per spec). UA selection is presentational, not security-
    // sensitive; deterministic testing uses the cache (perDomain stickiness)
    // rather than seeded randomness.
    // eslint-disable-next-line effect/no-math-random-use-random
    strategy.pool[Math.floor(Math.random() * strategy.pool.length)] ?? '';
  if (strategy.perDomain) {
    const current = MutableRef.get(cache);
    const cached = HashMap.get(current, domain);
    if (Option.isSome(cached)) return cached.value;
    const ua = pick();
    MutableRef.update(cache, (m) => HashMap.set(m, domain, ua));
    return ua;
  }
  return pick();
};

/**
 * File extension filter categories based on Scrapy's IGNORED_EXTENSIONS.
 * Each category can be individually enabled/disabled for flexible filtering.
 *
 * @group Configuration
 * @public
 */
export interface FileExtensionFilters {
  /** Archive files: 7z, 7zip, bz2, rar, tar, tar.gz, xz, zip (default: true) */
  readonly filterArchives: boolean;
  /** Image files: jpg, png, gif, svg, webp, etc. (default: true) */
  readonly filterImages: boolean;
  /** Audio files: mp3, wav, ogg, aac, etc. (default: true) */
  readonly filterAudio: boolean;
  /** Video files: mp4, avi, mov, webm, etc. (default: true) */
  readonly filterVideo: boolean;
  /** Office documents: pdf, doc, xls, ppt, odt, etc. (default: true) */
  readonly filterOfficeDocuments: boolean;
  /** Other files: css, js, exe, bin, rss, etc. (default: true) */
  readonly filterOther: boolean;
}

/**
 * Technical URL filtering options based on Scrapy's validation rules.
 * These filters help ensure only valid, crawlable URLs are processed.
 *
 * @group Configuration
 * @public
 */
export interface TechnicalFilters {
  /** Filter URLs with unsupported schemes (default: true - only http/https/file/ftp allowed) */
  readonly filterUnsupportedSchemes: boolean;
  /** Filter URLs exceeding maximum length (default: true - 2083 chars like Scrapy) */
  readonly filterLongUrls: boolean;
  /** Maximum URL length in characters (default: 2083) */
  readonly maxUrlLength: number;
  /** Filter malformed/invalid URLs (default: true) */
  readonly filterMalformedUrls: boolean;
}

/**
 * Configuration options for spider behavior and limits.
 *
 * Controls all aspects of crawling including rate limits, filtering rules,
 * and behavioral settings. All options have sensible defaults based on Scrapy.
 *
 * @group Configuration
 * @public
 */
export interface SpiderConfigOptions {
  /** Whether to ignore robots.txt files (default: false) */
  readonly ignoreRobotsTxt: boolean;
  /** Maximum number of concurrent worker fibers (default: 5) */
  readonly maxConcurrentWorkers: number;
  /** Concurrency level for crawling multiple starting URLs (default: 4) */
  readonly concurrency: number | 'unbounded' | 'inherit';
  /**
   * Maximum number of buffered `CrawlResult` values between worker fibers and
   * the user-supplied sink (default: `'unbounded'`).
   *
   * When the sink lags behind worker fetch rate, results queue up here. With
   * `'unbounded'`, the queue grows without limit — convenient for trivial
   * sinks but causes heap growth for any sink doing real I/O (DB writes,
   * downloads, etc.) because each buffered `CrawlResultOk` retains the full
   * HTML body. With a numeric capacity, workers naturally suspend on
   * `Queue.offer` when the queue is full, applying backpressure that matches
   * fetch rate to sink drain rate. Heap stays flat at roughly
   * `capacity × avg(CrawlResult)`.
   *
   * Recommended: a small multiple of `concurrency × maxConcurrentWorkers`.
   * For the default `4 × 5 = 20` workers, capacity 50–100 gives sinks
   * breathing room without unbounded growth.
   *
   * Must be a positive integer between 1 and 1,000,000 when numeric.
   * Out-of-range values, non-integers, and explicit `null`/`undefined`
   * are rejected by `makeSpiderConfig` with a `ConfigError`.
   */
  readonly resultChannelCapacity: number | 'unbounded';
  /** Base delay between requests in milliseconds (default: 1000) */
  readonly requestDelayMs: number;
  /** Maximum crawl delay from robots.txt in milliseconds (default: 10000 - 10 seconds) */
  readonly maxRobotsCrawlDelayMs: number;
  /** User agent string to send with requests (default: 'JambudipaSpider/1.0') */
  readonly userAgent: string;
  /** Maximum crawl depth, undefined for unlimited (default: undefined) */
  readonly maxDepth?: number;
  /** Maximum pages to crawl, undefined for unlimited (default: undefined) */
  readonly maxPages?: number;
  /** Domains to restrict crawling to (default: undefined - all domains) */
  readonly allowedDomains?: string[];
  /** Domains to exclude from crawling (default: undefined - no blocks) */
  readonly blockedDomains?: string[];
  /** Allowed URL protocols (default: ['http:', 'https:']) */
  readonly allowedProtocols: string[];
  /** Whether to follow HTTP redirects (default: true) */
  readonly followRedirects: boolean;
  /** Whether to respect rel="nofollow" attributes (default: true) */
  readonly respectNoFollow: boolean;
  /**
   * File extension filtering configuration.
   * When undefined, uses default Scrapy-equivalent filtering (all categories enabled).
   * Set to override default behavior for each category.
   *
   * @example
   * ```typescript
   * // Allow images but filter everything else
   * fileExtensionFilters: {
   *   filterArchives: true,
   *   filterImages: false,  // Allow images
   *   filterAudio: true,
   *   filterVideo: true,
   *   filterOfficeDocuments: true,
   *   filterOther: true
   * }
   * ```
   */
  readonly fileExtensionFilters?: FileExtensionFilters;
  /**
   * Technical URL filtering configuration.
   * When undefined, uses default Scrapy-equivalent filtering (all enabled).
   *
   * @example
   * ```typescript
   * // Disable URL length filtering for special cases
   * technicalFilters: {
   *   filterUnsupportedSchemes: true,
   *   filterLongUrls: false,  // Allow long URLs
   *   maxUrlLength: 2083,
   *   filterMalformedUrls: true
   * }
   * ```
   */
  readonly technicalFilters?: TechnicalFilters;
  /**
   * Custom file extensions to skip (legacy support).
   * When specified, overrides fileExtensionFilters completely.
   * Use fileExtensionFilters for more granular control.
   */
  readonly skipFileExtensions?: string[];
  /** Maximum concurrent requests across all domains (default: 10) */
  readonly maxConcurrentRequests: number;
  /** Maximum requests per second per domain (default: 2) */
  readonly maxRequestsPerSecondPerDomain: number;
  /**
   * Whether to normalize URLs for deduplication (default: true).
   * When enabled, URLs are normalized before checking for duplicates:
   * - Trailing slashes are removed (example.com/path/ becomes example.com/path)
   * - Fragment identifiers are removed (example.com#section becomes example.com)
   * - Default ports are removed (http://example.com:80 becomes http://example.com)
   * - Query parameters are sorted alphabetically
   *
   * This prevents crawling the same content multiple times when URLs differ only
   * in formatting. Set to false if you need to treat these variations as distinct URLs.
   *
   * @default true
   */
  readonly normalizeUrlsForDeduplication: boolean;
  /**
   * Custom URL filter patterns to exclude from crawling.
   * Provides regex patterns that will be tested against URLs to determine if they should be skipped.
   * This is useful for filtering out admin areas, utility pages, or other unwanted URL patterns.
   *
   * @example
   * ```typescript
   * customUrlFilters: [
   *   /\/wp-admin\//i,
   *   /\/wp-content\/uploads\//i,
   *   /\/api\//i
   * ]
   * ```
   *
   * @default undefined
   */
  readonly customUrlFilters?: RegExp[];
  /**
   * Whether to enable resumable crawling support (default: false).
   * When enabled, the spider can save its state and resume interrupted crawls.
   * Requires configuring a StatePersistence implementation.
   *
   * @default false
   */
  readonly enableResumability: boolean;
  /**
   * Domain-equivalence rules used when restricting crawls to the starting domain.
   * Both the up-front URL deduplication and the per-link `shouldFollowUrl` check
   * derive their behaviour from this config so the two paths stay in sync.
   *
   * @default defaultDomainEquivalence
   */
  readonly domainEquivalence?: DomainEquivalenceConfig;
  /**
   * Retry policy for the page-fetch pipeline.
   *
   * @default defaultFetchRetry
   */
  readonly fetchRetry?: FetchRetryConfig;
  /**
   * In-cycle domain-level retry policy. When enabled, `Spider.crawl()` runs
   * the start-URL list as a multi-pass loop: pass 0 is the existing
   * behaviour, then residual domains matching `retryOn` are re-run after
   * `backoffMs`. All passes share the same undici connection pool, URL
   * deduplicator, robots cache, result channel, and event sink.
   *
   * Disabled by default — omitting this option (or setting `enabled: false`)
   * preserves the pre-feature behaviour (one pass, no retry).
   *
   * @default defaultDomainRetry
   */
  readonly domainRetry?: DomainRetryConfig;
  /**
   * Cross-domain redirect handling for start URLs. When enabled, a start URL
   * that 3xx-redirects to a different hostname updates the per-domain
   * restriction so the rest of the crawl follows links on the final domain.
   *
   * @default defaultCrossDomainRedirects
   */
  readonly crossDomainRedirects?: CrossDomainRedirectConfig;
  /**
   * User-agent selection strategy. When provided, overrides the `userAgent`
   * shorthand. When absent, behaviour is equivalent to
   * `{ kind: 'static', userAgent }`.
   *
   * @default undefined
   */
  readonly userAgentStrategy?: UserAgentStrategy;
  /**
   * Behaviour when a stop condition fires (`maxPages`, external abort signal).
   *
   * - `'drain'` (default) — let in-flight tasks finish naturally.
   * - `'interrupt'` — cancel in-flight fetches and exit within `gracePeriodMs` (default 5 000 ms).
   * - Object form: `{ kind: 'interrupt', gracePeriodMs: 3000 }` to tune the grace period.
   *
   * @default 'drain'
   */
  readonly stopMode?: StopMode;
  /**
   * Override for the worker-health staleness threshold in milliseconds.
   *
   * When unset, the spider uses {@link SPIDER_DEFAULTS.STALE_WORKER_THRESHOLD_MS}
   * (300 000 ms). Raise this when your `HttpAdapter` or `fetchRetry`
   * configuration produces a worst-case task time that exceeds the
   * default — guideline:
   * `fetchRetry.maxAttempts × per-attempt timeout + sum(backoff) + 30 s`.
   *
   * Must be a positive integer (`Number.isInteger(n) && n >= 1`).
   * Invalid values throw `ConfigError` at `makeSpiderConfig` time.
   *
   * @default 300_000
   */
  readonly staleWorkerThresholdMs?: number;
  /**
   * Override for the worker-health monitor's check interval in milliseconds.
   *
   * When unset, the spider checks for stale workers every 15 000 ms.
   * Lower values let tests exercise the dead-worker detection path in
   * real time; production callers rarely need to override this.
   *
   * Must be a positive integer between 1 and {@link STALE_THRESHOLD_MAX_MS}.
   * Invalid values throw `ConfigError` at `makeSpiderConfig` time.
   *
   * @default 15_000
   */
  readonly staleWorkerCheckIntervalMs?: number;
  /**
   * Worker heartbeat refresh behaviour.
   *
   * - `'per-iteration'` (default) — heartbeat fires once per worker-loop
   *   iteration, at the top. Matches behaviour up to and including v0.11.
   * - `'per-attempt'` — additionally refreshes the heartbeat each time the
   *   retry schedule receives a failure input (i.e. between attempts).
   *   Recommended for any non-undici adapter whose per-attempt timeout can
   *   approach or exceed `staleWorkerThresholdMs / maxAttempts`.
   *
   * @default 'per-iteration'
   */
  readonly workerHeartbeatMode?: 'per-iteration' | 'per-attempt';
  /**
   * Pluggable HTTP fetcher. When provided, the spider dispatches every
   * page fetch through this adapter instead of the built-in undici path.
   * Leave undefined to keep today's behaviour (default).
   *
   * Use the function form ({@link HttpAdapterSelector}) to choose between
   * adapters per-request — e.g. undici for the bulk of the crawl and a
   * TLS-impersonating adapter for known anti-bot portals:
   *
   * ```ts
   * const promoted = new Set(['example.com']);
   * const httpAdapter: HttpAdapterSelector = (req) =>
   *   promoted.has(new URL(req.url).hostname.replace(/^www\./, ''))
   *     ? gotScrapingAdapter
   *     : defaultUndiciAdapter;
   * ```
   *
   * @default undefined
   */
  readonly httpAdapter?: HttpAdapter | HttpAdapterSelector;
}

/**
 * Service interface for accessing spider configuration.
 *
 * Provides Effect-wrapped access to all configuration options with
 * validation and computed properties. Used throughout the framework
 * to access settings in a composable way.
 *
 * @group Configuration
 * @public
 */
export interface SpiderConfigService {
  /** Get the complete configuration options */
  getOptions: () => Effect.Effect<SpiderConfigOptions>;
  /** Check if a URL should be followed based on configured rules */
  shouldFollowUrl: (
    _urlString: string,
    _fromUrl?: string,
    _restrictToStartingDomain?: string
  ) => Effect.Effect<{ follow: boolean; reason?: string }>;
  /** Get the configured user agent string */
  getUserAgent: () => Effect.Effect<string>;
  /** Get the request delay in milliseconds */
  getRequestDelay: () => Effect.Effect<number>;
  /** Get the maximum crawl delay from robots.txt in milliseconds */
  getMaxRobotsCrawlDelay: () => Effect.Effect<number>;
  /** Check if robots.txt should be ignored */
  shouldIgnoreRobotsTxt: () => Effect.Effect<boolean>;
  /** Get maximum concurrent workers */
  getMaxConcurrentWorkers: () => Effect.Effect<number>;
  /**
   * Get maximum crawl depth (undefined if unlimited).
   *
   * Crawl depth refers to the number of link hops from the starting URL(s).
   * For example:
   * - Depth 0: Only the initial URL(s) are crawled
   * - Depth 1: Initial URLs + all links found on those pages
   * - Depth 2: Initial URLs + links from depth 1 + links found on depth 1 pages
   *
   * Cross-domain behavior: Depth counting applies only within allowed domains.
   * If `allowedDomains` is configured, links to external domains are not followed
   * regardless of depth. If no domain restrictions are set, depth applies across
   * all domains encountered.
   */
  getMaxDepth: () => Effect.Effect<number | undefined>;
  /** Get maximum pages to crawl (undefined if unlimited) */
  getMaxPages: () => Effect.Effect<number | undefined>;
  /** Check if redirects should be followed */
  shouldFollowRedirects: () => Effect.Effect<boolean>;
  /** Check if nofollow attributes should be respected */
  shouldRespectNoFollow: () => Effect.Effect<boolean>;
  /** Get file extensions to skip */
  getSkipFileExtensions: () => Effect.Effect<string[]>;
  /** Get maximum concurrent requests across all domains */
  getMaxConcurrentRequests: () => Effect.Effect<number>;
  /** Get maximum requests per second per domain */
  getMaxRequestsPerSecondPerDomain: () => Effect.Effect<number>;
  /** Check if URLs should be normalized for deduplication */
  shouldNormalizeUrlsForDeduplication: () => Effect.Effect<boolean>;
  /** Get the concurrency level for crawling multiple starting URLs */
  getConcurrency: () => Effect.Effect<number | 'unbounded' | 'inherit'>;
  /**
   * Get the capacity for the worker → sink result channel.
   *
   * Returns `'unbounded'` (default) or a positive integer. Numeric values
   * cause the channel to be constructed via `Queue.bounded(n)`, applying
   * backpressure on workers when the sink lags. See
   * {@link SpiderConfigOptions.resultChannelCapacity}.
   */
  getResultChannelCapacity: () => Effect.Effect<number | 'unbounded'>;
  /** Check if resumable crawling is enabled */
  isResumabilityEnabled: () => Effect.Effect<boolean>;
  /** Get the fetch-retry policy (returns defaults when not configured). */
  getFetchRetry: () => Effect.Effect<FetchRetryConfig>;
  /** Get the domain-retry policy (returns defaults when not configured). */
  getDomainRetry: () => Effect.Effect<DomainRetryConfig>;
  /** Get the domain-equivalence rules (returns defaults when not configured). */
  getDomainEquivalence: () => Effect.Effect<DomainEquivalenceConfig>;
  /** Get cross-domain redirect policy (returns defaults when not configured). */
  getCrossDomainRedirects: () => Effect.Effect<CrossDomainRedirectConfig>;
  /** Get the resolved stop-mode settings. */
  getStopMode: () => Effect.Effect<ResolvedStopMode>;
  /**
   * Get the worker-health staleness threshold in milliseconds.
   *
   * Returns the configured override when set, otherwise
   * {@link SPIDER_DEFAULTS.STALE_WORKER_THRESHOLD_MS}.
   */
  getStaleWorkerThreshold: () => Effect.Effect<number>;
  /**
   * Get the worker heartbeat refresh mode.
   *
   * Returns `'per-iteration'` when unset.
   */
  getWorkerHeartbeatMode: () => Effect.Effect<'per-iteration' | 'per-attempt'>;
  /**
   * Get the worker-health monitor check interval in milliseconds.
   *
   * Returns the configured override when set, otherwise `15_000`.
   */
  getStaleWorkerCheckInterval: () => Effect.Effect<number>;
  /**
   * Get the configured HTTP adapter (or selector). Returns `undefined`
   * when no override was provided — callers should fall back to
   * `defaultUndiciAdapter` in that case.
   */
  getHttpAdapter: () => Effect.Effect<
    HttpAdapter | HttpAdapterSelector | undefined
  >;
}

/**
 * The main SpiderConfig service for dependency injection.
 *
 * Provides default configuration that can be overridden using layers.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const config = yield* SpiderConfig;
 *   const userAgent = yield* config.getUserAgent();
 *   console.log(`Using: ${userAgent}`);
 * });
 *
 * await Effect.runPromise(
 *   program.pipe(Effect.provide(SpiderConfig.Default))
 * );
 * ```
 *
 * @group Configuration
 * @public
 */
export class SpiderConfig extends Effect.Service<SpiderConfigService>()(
  '@jambudipa/spiderConfig',
  {
    effect: Effect.sync(() => makeSpiderConfig({})),
  }
) {
  /**
   * Creates a Layer that provides SpiderConfig with custom options
   * @param config - The configuration options or a pre-made SpiderConfigService
   */
  static Live = (config: Partial<SpiderConfigOptions> | SpiderConfigService) =>
    Layer.effect(
      SpiderConfig,
      Effect.succeed('getOptions' in config ? config : makeSpiderConfig(config))
    );
}

/**
 * Creates a SpiderConfigService implementation with custom options.
 *
 * This is the factory function that creates the actual service implementation.
 * Options are merged with defaults, providing a complete configuration.
 *
 * @param options - Partial configuration options to merge with defaults
 * @returns Complete SpiderConfigService implementation
 *
 * @group Configuration
 * @public
 */
/**
 * Common file extension categories for filtering.
 * Based on commonly ignored file types in web scraping (86 total extensions).
 *
 * @internal
 */
const FILE_EXTENSION_CATEGORIES = {
  /** Archive files (8 extensions) */
  archives: ['.7z', '.7zip', '.bz2', '.rar', '.tar', '.tar.gz', '.xz', '.zip'],

  /** Image files (19 extensions) */
  images: [
    '.mng',
    '.pct',
    '.bmp',
    '.gif',
    '.jpg',
    '.jpeg',
    '.png',
    '.pst',
    '.psp',
    '.tif',
    '.tiff',
    '.ai',
    '.drw',
    '.dxf',
    '.eps',
    '.ps',
    '.svg',
    '.cdr',
    '.ico',
    '.webp',
  ],

  /** Audio files (9 extensions) */
  audio: [
    '.mp3',
    '.wma',
    '.ogg',
    '.wav',
    '.ra',
    '.aac',
    '.mid',
    '.au',
    '.aiff',
  ],

  /** Video files (14 extensions) */
  video: [
    '.3gp',
    '.asf',
    '.asx',
    '.avi',
    '.mov',
    '.mp4',
    '.mpg',
    '.qt',
    '.rm',
    '.swf',
    '.wmv',
    '.m4a',
    '.m4v',
    '.flv',
    '.webm',
  ],

  /** Office documents (21 extensions) */
  officeDocuments: [
    '.xls',
    '.xlsm',
    '.xlsx',
    '.xltm',
    '.xltx',
    '.potm',
    '.potx',
    '.ppt',
    '.pptm',
    '.pptx',
    '.pps',
    '.doc',
    '.docb',
    '.docm',
    '.docx',
    '.dotm',
    '.dotx',
    '.odt',
    '.ods',
    '.odg',
    '.odp',
  ],

  /** Other files (16 extensions) */
  other: [
    '.css',
    '.pdf',
    '.exe',
    '.bin',
    '.rss',
    '.dmg',
    '.iso',
    '.apk',
    '.jar',
    '.sh',
    '.rb',
    '.js',
    '.hta',
    '.bat',
    '.cpl',
    '.msi',
    '.msp',
    '.py',
  ],
} as const;

/**
 * Generates file extensions to skip based on filter configuration.
 *
 * @param filters - File extension filter configuration
 * @returns Array of file extensions to skip
 * @internal
 */
const generateSkipExtensions = (filters: FileExtensionFilters): string[] => {
  const categoryChunks = [
    filters.filterArchives
      ? Chunk.fromIterable(FILE_EXTENSION_CATEGORIES.archives)
      : Chunk.empty<string>(),
    filters.filterImages
      ? Chunk.fromIterable(FILE_EXTENSION_CATEGORIES.images)
      : Chunk.empty<string>(),
    filters.filterAudio
      ? Chunk.fromIterable(FILE_EXTENSION_CATEGORIES.audio)
      : Chunk.empty<string>(),
    filters.filterVideo
      ? Chunk.fromIterable(FILE_EXTENSION_CATEGORIES.video)
      : Chunk.empty<string>(),
    filters.filterOfficeDocuments
      ? Chunk.fromIterable(FILE_EXTENSION_CATEGORIES.officeDocuments)
      : Chunk.empty<string>(),
    filters.filterOther
      ? Chunk.fromIterable(FILE_EXTENSION_CATEGORIES.other)
      : Chunk.empty<string>(),
  ] as const;

  return Chunk.toArray(Chunk.flatten(Chunk.fromIterable(categoryChunks)));
};

/**
 * Safely parse a URL string, returning Option.none if invalid.
 *
 * @param urlString - The URL string to parse
 * @returns Option containing the parsed URL or Option.none if invalid
 * @internal
 */
const safeParseUrl: (urlString: string) => Option.Option<URL> =
  Option.liftThrowable((urlString: string) => new URL(urlString));

/**
 * Normalise a hostname for domain-equivalence comparison.
 * Lower-cases the hostname and optionally strips a leading `www.`.
 *
 * @internal
 */
const normaliseDomainForComparison = (
  hostname: string,
  equiv: DomainEquivalenceConfig
): string => {
  let h = hostname.toLowerCase();
  if (equiv.wwwHandling === 'ignore') {
    // Greedy strip — `www.www.example.com` → `example.com` — covers the
    // (rare but observed) case where a misconfigured server adds `www.`
    // twice in CNAMEs or links.
    h = h.replace(/^(www\.)+/, '');
  }
  // Strip a trailing dot (`example.com.` and `example.com` are equivalent
  // per DNS but URL.hostname preserves the dot). Without this the IDN
  // round-trip below also preserves it, masking equivalence.
  h = h.replace(/\.$/, '');
  // Short-circuit on empty string (e.g. input was `www.www.www.` → empty
  // after the strip). `new URL('http://').hostname` throws; catching it
  // would leave `h === ''` which is harmless but pointless to round-trip.
  if (h === '') return h;
  // Round-trip through URL.hostname so IDN inputs (`例え.jp`) and their
  // punycode form (`xn--r8jz45g.jp`) collapse to the same canonical
  // representation. Node's URL parser already returns punycode — no
  // dependency required. try/catch is appropriate here because the
  // function is synchronous (used inside `shouldFollowUrl`'s sync block);
  // wrapping in Effect would force the entire follow-decision pipeline
  // to become async for what is a defensive guard against an impossible
  // input (the caller already passed `URL.hostname`).
  // eslint-disable-next-line effect/no-try-catch-use-effect -- sync helper, defensive guard
  try {
    h = new URL(`http://${h}`).hostname;
  } catch {
    // Fall through with the lower-cased / www-stripped form.
  }
  return h;
};

export const makeSpiderConfig = (
  options: Partial<SpiderConfigOptions> = {}
): SpiderConfigService => {
  // Validate fetchRetry.maxAttempts up front. The retry schedule uses
  // `Math.max(0, n - 1)` which silently coerces zero/negative values into
  // "one attempt total" — surprising and hard to debug. Synchronous throw
  // matches the existing input-validation pattern: makeSpiderConfig is
  // called from sync setup code, not from inside Effect.gen, so wrapping
  // in Effect.fail would force every call site to become async for what
  // is a programmer error caught at startup.
  const maxAttemptsOpt = Option.fromNullable(options.fetchRetry?.maxAttempts);
  if (Option.isSome(maxAttemptsOpt)) {
    const n = maxAttemptsOpt.value;
    if (!Number.isInteger(n) || n < 1) {
      // eslint-disable-next-line effect/no-throw-use-effect -- sync factory, programmer error at startup
      throw new ConfigError({
        field: 'fetchRetry.maxAttempts',
        value: n,
        reason: 'must be a positive integer >= 1 (the initial attempt counts as 1)',
      });
    }
  }

  // Validate `domainRetry` shape up front. Like `fetchRetry.maxAttempts`,
  // the multi-pass loop uses `cycle < maxPasses` as its termination
  // predicate — a non-positive `maxPasses` would silently skip the
  // initial pass, producing an empty crawl with no obvious cause.
  // `backoffMs` is fed to `Effect.sleep`; negatives would either be
  // coerced or surprise callers.
  const domainRetryOpt = Option.fromNullable(options.domainRetry);
  if (Option.isSome(domainRetryOpt)) {
    const dr = domainRetryOpt.value;
    if (!Number.isInteger(dr.maxPasses) || dr.maxPasses < 1) {
      // eslint-disable-next-line effect/no-throw-use-effect -- sync factory, programmer error at startup
      throw new ConfigError({
        field: 'domainRetry.maxPasses',
        value: dr.maxPasses,
        reason:
          'must be a positive integer >= 1 (the initial pass counts as 1; set to 2 to allow one retry)',
      });
    }
    // `enabled: true` with `maxPasses: 1` is a silent no-op: the user opted
    // in but only the initial pass runs, no retry happens, and no event
    // surfaces the misconfiguration. Reject at construction so the footgun
    // is caught at the boundary rather than silently degrading coverage.
    if (dr.enabled && dr.maxPasses < 2) {
      // eslint-disable-next-line effect/no-throw-use-effect -- sync factory, programmer error at startup
      throw new ConfigError({
        field: 'domainRetry.maxPasses',
        value: dr.maxPasses,
        reason:
          'must be >= 2 when `domainRetry.enabled` is true (otherwise no retry pass runs and opting in has no effect)',
      });
    }
    if (typeof dr.backoffMs !== 'number' || !Number.isFinite(dr.backoffMs) || dr.backoffMs < 0) {
      // eslint-disable-next-line effect/no-throw-use-effect -- sync factory, programmer error at startup
      throw new ConfigError({
        field: 'domainRetry.backoffMs',
        value: dr.backoffMs,
        reason: 'must be a finite number >= 0 (milliseconds)',
      });
    }
    // `retryOn.reasons` empty silently disables retries even with
    // `enabled: true` and a sensible `maxPasses`. Reject so the
    // misconfiguration surfaces at the boundary.
    if (!Array.isArray(dr.retryOn.reasons) || dr.retryOn.reasons.length === 0) {
      // eslint-disable-next-line effect/no-throw-use-effect -- sync factory, programmer error at startup
      throw new ConfigError({
        field: 'domainRetry.retryOn.reasons',
        value: dr.retryOn.reasons,
        reason: 'must be a non-empty array of DomainCompleteReason values',
      });
    }
    // `retryOn.maxPagesAttempted`: allow `Infinity` (means "no upper bound")
    // and any finite non-negative number. Reject NaN, negatives, and
    // non-finite values that aren't `Infinity` so silent no-op predicates
    // (NaN comparisons always false) can't slip through.
    const mpa = dr.retryOn.maxPagesAttempted;
    if (
      typeof mpa !== 'number' ||
      Number.isNaN(mpa) ||
      mpa < 0 ||
      (!Number.isFinite(mpa) && mpa !== Infinity)
    ) {
      // eslint-disable-next-line effect/no-throw-use-effect -- sync factory, programmer error at startup
      throw new ConfigError({
        field: 'domainRetry.retryOn.maxPagesAttempted',
        value: mpa,
        reason:
          'must be a non-negative number (Infinity is allowed; NaN and negatives are rejected)',
      });
    }
    // Mirror the fetchRetry validation for any override carried in passOverrides.
    const overrideMaxAttempts = dr.passOverrides?.fetchRetry?.maxAttempts;
    // eslint-disable-next-line effect/no-undefined-use-option -- `overrideMaxAttempts` is an optional field on an optional nested config; the absence-check is the natural JS shape and mirrors the pattern used by the sibling fetchRetry validation above
    if (overrideMaxAttempts !== undefined) {
      if (!Number.isInteger(overrideMaxAttempts) || overrideMaxAttempts < 1) {
        // eslint-disable-next-line effect/no-throw-use-effect -- sync factory, programmer error at startup
        throw new ConfigError({
          field: 'domainRetry.passOverrides.fetchRetry.maxAttempts',
          value: overrideMaxAttempts,
          reason:
            'must be a positive integer >= 1 (the initial attempt counts as 1)',
        });
      }
    }
    const overrideBaseBackoff = dr.passOverrides?.fetchRetry?.baseBackoffMs;
    // eslint-disable-next-line effect/no-undefined-use-option -- optional nested config; sentinel-absence check
    if (overrideBaseBackoff !== undefined) {
      if (
        typeof overrideBaseBackoff !== 'number' ||
        !Number.isFinite(overrideBaseBackoff) ||
        overrideBaseBackoff < 0
      ) {
        // eslint-disable-next-line effect/no-throw-use-effect -- sync factory, programmer error at startup
        throw new ConfigError({
          field: 'domainRetry.passOverrides.fetchRetry.baseBackoffMs',
          value: overrideBaseBackoff,
          reason: 'must be a finite number >= 0 (milliseconds)',
        });
      }
    }
  }

  // Same validation shape as fetchRetry.maxAttempts: reject NaN, Infinity,
  // negatives, non-integers, and zero at startup rather than letting the
  // value flow into the worker health monitor where misbehaviour would be
  // much harder to diagnose. Upper bound matches the maximum signed 32-bit
  // millisecond value (~24.8 days) — beyond that, JS timer-related code
  // paths and `setTimeout` clamping become surprising, and any sensible
  // configuration is far below this ceiling.
  const STALE_THRESHOLD_MAX_MS = 2_147_483_647;
  const staleThresholdOpt = Option.fromNullable(options.staleWorkerThresholdMs);
  if (Option.isSome(staleThresholdOpt)) {
    const n = staleThresholdOpt.value;
    if (
      typeof n !== 'number' ||
      !Number.isInteger(n) ||
      n < 1 ||
      n > STALE_THRESHOLD_MAX_MS
    ) {
      // eslint-disable-next-line effect/no-throw-use-effect -- sync factory, programmer error at startup
      throw new ConfigError({
        field: 'staleWorkerThresholdMs',
        value: n,
        reason: `must be a positive integer between 1 and ${STALE_THRESHOLD_MAX_MS} (milliseconds)`,
      });
    }
  }

  // Same bounds as the threshold; same rationale (32-bit ms ceiling).
  const checkIntervalOpt = Option.fromNullable(
    options.staleWorkerCheckIntervalMs
  );
  if (Option.isSome(checkIntervalOpt)) {
    const n = checkIntervalOpt.value;
    if (
      typeof n !== 'number' ||
      !Number.isInteger(n) ||
      n < 1 ||
      n > STALE_THRESHOLD_MAX_MS
    ) {
      // eslint-disable-next-line effect/no-throw-use-effect -- sync factory, programmer error at startup
      throw new ConfigError({
        field: 'staleWorkerCheckIntervalMs',
        value: n,
        reason: `must be a positive integer between 1 and ${STALE_THRESHOLD_MAX_MS} (milliseconds)`,
      });
    }
  }

  // Runtime validation for `workerHeartbeatMode` — TypeScript narrows to
  // the union literally at compile time, but untyped callers (JSON config,
  // dynamic options) can sneak invalid strings through; without this check
  // the strict-equality branch at `Spider.service.ts:per-task` would
  // silently downgrade to `'per-iteration'`.
  const heartbeatModeOpt = Option.fromNullable(options.workerHeartbeatMode);
  if (Option.isSome(heartbeatModeOpt)) {
    const m = heartbeatModeOpt.value;
    if (m !== 'per-iteration' && m !== 'per-attempt') {
      // eslint-disable-next-line effect/no-throw-use-effect -- sync factory, programmer error at startup
      throw new ConfigError({
        field: 'workerHeartbeatMode',
        value: m,
        reason: "must be 'per-iteration' or 'per-attempt'",
      });
    }
  }

  // Reject invalid `resultChannelCapacity` values up front. `Queue.bounded`
  // with zero or negative capacity would either reject all offers or behave
  // surprisingly; non-integers would be coerced by the runtime. Catch at
  // startup so the failure mode is a clear ConfigError, not a silent stall.
  //
  // `hasOwn` (not `Option.fromNullable`) so that explicit `null`/`undefined`
  // is rejected rather than silently falling back to the default — the
  // post-merge value would otherwise stay `null` and crash at
  // `Queue.bounded(null)`.
  const RESULT_CHANNEL_CAPACITY_MAX = 1_000_000;
  if (Object.prototype.hasOwnProperty.call(options, 'resultChannelCapacity')) {
    const c = options.resultChannelCapacity;
    const isUnbounded = c === 'unbounded';
    const isValidInt =
      typeof c === 'number' &&
      Number.isInteger(c) &&
      c >= 1 &&
      c <= RESULT_CHANNEL_CAPACITY_MAX;
    if (!isUnbounded && !isValidInt) {
      // eslint-disable-next-line effect/no-throw-use-effect -- sync factory, programmer error at startup
      throw new ConfigError({
        field: 'resultChannelCapacity',
        value: c,
        reason: `must be 'unbounded' or a positive integer between 1 and ${RESULT_CHANNEL_CAPACITY_MAX}`,
      });
    }
  }

  // Default file extension filters (all enabled like Scrapy)
  const defaultFileExtensionFilters: FileExtensionFilters = {
    filterArchives: true,
    filterImages: true,
    filterAudio: true,
    filterVideo: true,
    filterOfficeDocuments: true,
    filterOther: true,
  };

  // Default technical filters (all enabled like Scrapy)
  const defaultTechnicalFilters: TechnicalFilters = {
    filterUnsupportedSchemes: true,
    filterLongUrls: true,
    maxUrlLength: 2083, // Scrapy's default
    filterMalformedUrls: true,
  };

  const defaultOptions: SpiderConfigOptions = {
    ignoreRobotsTxt: false,
    maxConcurrentWorkers: 5,
    concurrency: 4,
    resultChannelCapacity: 'unbounded',
    requestDelayMs: 1000,
    maxRobotsCrawlDelayMs: 2000, // Maximum 1 second for robots.txt crawl delay
    userAgent: 'JambudipaSpider/1.0',
    allowedProtocols: ['http:', 'https:', 'file:', 'ftp:'], // Scrapy's allowed schemes
    followRedirects: true,
    respectNoFollow: true,
    fileExtensionFilters: defaultFileExtensionFilters,
    technicalFilters: defaultTechnicalFilters,
    maxConcurrentRequests: 10,
    maxRequestsPerSecondPerDomain: 2,
    normalizeUrlsForDeduplication: true,
    enableResumability: false,
  };

  const config: SpiderConfigOptions = {
    ...defaultOptions,
    ...options,
    // Merge nested objects properly
    fileExtensionFilters: options.fileExtensionFilters
      ? {
          ...defaultOptions.fileExtensionFilters,
          ...options.fileExtensionFilters,
        }
      : defaultOptions.fileExtensionFilters,
    technicalFilters: options.technicalFilters
      ? {
          ...defaultOptions.technicalFilters,
          ...options.technicalFilters,
        }
      : defaultOptions.technicalFilters,
  };

  // Determine which extensions to skip
  const skipExtensions =
    config.skipFileExtensions ??
    generateSkipExtensions(
      config.fileExtensionFilters ?? defaultFileExtensionFilters
    );

  return {
    getOptions: () => Effect.succeed(config),

    shouldFollowUrl: (
      urlString: string,
      fromUrl?: string,
      restrictToStartingDomain?: string
    ) =>
      Effect.try({
        try: () => new URL(urlString),
        catch: (error) =>
          error instanceof Error ? error.message : 'Unknown parsing error',
      }).pipe(
        Effect.flatMap((url) =>
          Effect.sync(() => {
            const fromUrlParsed = Option.fromNullable(fromUrl).pipe(
              Option.flatMap((u) => safeParseUrl(u))
            );
            const techFilters =
              config.technicalFilters ?? defaultTechnicalFilters;

            // Domain restriction override for multiple starting URLs
            if (restrictToStartingDomain) {
              const startingDomainUrlOpt = safeParseUrl(restrictToStartingDomain);
              if (Option.isSome(startingDomainUrlOpt)) {
                const equiv =
                  config.domainEquivalence ?? defaultDomainEquivalence;
                const startingUrl = startingDomainUrlOpt.value;
                const normStart = normaliseDomainForComparison(
                  startingUrl.hostname,
                  equiv
                );
                const normTarget = normaliseDomainForComparison(
                  url.hostname,
                  equiv
                );

                const isAllowedDomain =
                  normTarget === normStart ||
                  (equiv.subdomainHandling === 'ignore' &&
                    normTarget.endsWith(`.${normStart}`));

                // `permissive` accepts any protocol that's in the configured
                // allow-list (so `file:`/`ftp:` defaults work as documented).
                // `strict` additionally requires the candidate to match the
                // starting URL's protocol exactly. http/https users see
                // unchanged behaviour because both protocols remain in
                // `allowedProtocols` and the permissive branch still allows
                // either-to-either.
                const inAllowList = config.allowedProtocols.includes(
                  url.protocol
                );
                const isAllowedProtocol =
                  equiv.protocolHandling === 'permissive'
                    ? inAllowList
                    : inAllowList && url.protocol === startingUrl.protocol;

                if (!isAllowedDomain || !isAllowedProtocol) {
                  return {
                    follow: false,
                    reason: `Domain/protocol ${url.hostname} (${url.protocol}) restricted to starting domain ${startingUrl.hostname} (${startingUrl.protocol})`,
                  };
                }
              }
            }

            // Technical filter: URL length check (Scrapy equivalent)
            if (
              techFilters.filterLongUrls &&
              urlString.length > techFilters.maxUrlLength
            ) {
              return {
                follow: false,
                reason: `URL length ${urlString.length} exceeds maximum ${techFilters.maxUrlLength}`,
              };
            }

            // Technical filter: Protocol/scheme check (Scrapy equivalent)
            if (
              techFilters.filterUnsupportedSchemes &&
              !config.allowedProtocols.includes(url.protocol)
            ) {
              return {
                follow: false,
                reason: `Protocol ${url.protocol} not in allowed schemes: ${config.allowedProtocols.join(', ')}`,
              };
            }

            // Domain allowlist check
            if (config.allowedDomains && config.allowedDomains.length > 0) {
              const isDomainAllowed = config.allowedDomains.some(
                (domain) =>
                  url.hostname === domain || url.hostname.endsWith(`.${domain}`)
              );
              if (!isDomainAllowed) {
                return {
                  follow: false,
                  reason: `Domain ${url.hostname} not in allowlist`,
                };
              }
            }

            // Domain blocklist check
            if (config.blockedDomains && config.blockedDomains.length > 0) {
              const isDomainBlocked = config.blockedDomains.some(
                (domain) =>
                  url.hostname === domain || url.hostname.endsWith(`.${domain}`)
              );
              if (isDomainBlocked) {
                return {
                  follow: false,
                  reason: `Domain ${url.hostname} is blocked`,
                };
              }
            }

            // Custom URL filter check
            if (config.customUrlFilters && config.customUrlFilters.length > 0) {
              for (const pattern of config.customUrlFilters) {
                if (pattern.test(urlString)) {
                  return {
                    follow: false,
                    reason: `URL matches custom filter pattern: ${pattern}`,
                  };
                }
              }
            }

            // Fragment check (skip anchor links to same page)
            if (
              Option.isSome(fromUrlParsed) &&
              url.hostname === fromUrlParsed.value.hostname &&
              url.pathname === fromUrlParsed.value.pathname &&
              url.search === fromUrlParsed.value.search &&
              url.hash
            ) {
              return {
                follow: false,
                reason: 'Fragment-only link to same page',
              };
            }

            // File extension check (Scrapy IGNORED_EXTENSIONS equivalent)
            const pathname = url.pathname.toLowerCase();
            if (
              skipExtensions.some((ext) => pathname.endsWith(ext.toLowerCase()))
            ) {
              // Determine which category was filtered for better error reporting
              const filterReasonChunks = [
                config.fileExtensionFilters?.filterArchives &&
                FILE_EXTENSION_CATEGORIES.archives.some((ext) =>
                  pathname.endsWith(ext.toLowerCase())
                )
                  ? Chunk.of('archive')
                  : Chunk.empty<string>(),
                config.fileExtensionFilters?.filterImages &&
                FILE_EXTENSION_CATEGORIES.images.some((ext) =>
                  pathname.endsWith(ext.toLowerCase())
                )
                  ? Chunk.of('image')
                  : Chunk.empty<string>(),
                config.fileExtensionFilters?.filterAudio &&
                FILE_EXTENSION_CATEGORIES.audio.some((ext) =>
                  pathname.endsWith(ext.toLowerCase())
                )
                  ? Chunk.of('audio')
                  : Chunk.empty<string>(),
                config.fileExtensionFilters?.filterVideo &&
                FILE_EXTENSION_CATEGORIES.video.some((ext) =>
                  pathname.endsWith(ext.toLowerCase())
                )
                  ? Chunk.of('video')
                  : Chunk.empty<string>(),
                config.fileExtensionFilters?.filterOfficeDocuments &&
                FILE_EXTENSION_CATEGORIES.officeDocuments.some((ext) =>
                  pathname.endsWith(ext.toLowerCase())
                )
                  ? Chunk.of('office document')
                  : Chunk.empty<string>(),
                config.fileExtensionFilters?.filterOther &&
                FILE_EXTENSION_CATEGORIES.other.some((ext) =>
                  pathname.endsWith(ext.toLowerCase())
                )
                  ? Chunk.of('other file type')
                  : Chunk.empty<string>(),
              ] as const;

              const filterReasons = Chunk.toArray(
                Chunk.flatten(Chunk.fromIterable(filterReasonChunks))
              );

              const reason =
                filterReasons.length > 0
                  ? `Filtered ${filterReasons.join('/')} file extension`
                  : 'File extension not suitable for crawling';

              return {
                follow: false,
                reason,
              };
            }

            return { follow: true };
          })
        ),
        Effect.catchAll((errorMessage) =>
          Effect.succeed(
            // Technical filter: Malformed URL check (Scrapy equivalent)
            config.technicalFilters?.filterMalformedUrls
              ? {
                  follow: false,
                  reason: `Malformed URL: ${errorMessage}`,
                }
              : // If malformed URL filtering is disabled, silently allow
                { follow: true }
          )
        )
      ),

    getUserAgent: () => Effect.succeed(config.userAgent),
    getRequestDelay: () => Effect.succeed(config.requestDelayMs),
    getMaxRobotsCrawlDelay: () => Effect.succeed(config.maxRobotsCrawlDelayMs),
    shouldIgnoreRobotsTxt: () => Effect.succeed(config.ignoreRobotsTxt),
    getMaxConcurrentWorkers: () => Effect.succeed(config.maxConcurrentWorkers),
    getMaxDepth: () => Effect.succeed(config.maxDepth),
    getMaxPages: () => Effect.succeed(config.maxPages),
    shouldFollowRedirects: () => Effect.succeed(config.followRedirects),
    shouldRespectNoFollow: () => Effect.succeed(config.respectNoFollow),
    getSkipFileExtensions: () =>
      Effect.succeed(config.skipFileExtensions ?? []),
    getMaxConcurrentRequests: () =>
      Effect.succeed(config.maxConcurrentRequests),
    getMaxRequestsPerSecondPerDomain: () =>
      Effect.succeed(config.maxRequestsPerSecondPerDomain),
    shouldNormalizeUrlsForDeduplication: () =>
      Effect.succeed(config.normalizeUrlsForDeduplication),
    getConcurrency: () => Effect.succeed(config.concurrency),
    getResultChannelCapacity: () =>
      Effect.succeed(config.resultChannelCapacity),
    isResumabilityEnabled: () => Effect.succeed(config.enableResumability),
    getFetchRetry: () =>
      Effect.succeed(config.fetchRetry ?? defaultFetchRetry),
    getDomainRetry: () =>
      Effect.succeed(config.domainRetry ?? defaultDomainRetry),
    getDomainEquivalence: () =>
      Effect.succeed(config.domainEquivalence ?? defaultDomainEquivalence),
    getCrossDomainRedirects: () =>
      Effect.succeed(
        config.crossDomainRedirects ?? defaultCrossDomainRedirects
      ),
    getStopMode: () => Effect.succeed(resolveStopMode(config.stopMode)),
    getHttpAdapter: () => Effect.succeed(config.httpAdapter),
    getStaleWorkerThreshold: () =>
      Effect.succeed(
        config.staleWorkerThresholdMs ?? SPIDER_DEFAULTS.STALE_WORKER_THRESHOLD_MS
      ),
    getWorkerHeartbeatMode: () =>
      Effect.succeed(config.workerHeartbeatMode ?? 'per-iteration'),
    getStaleWorkerCheckInterval: () =>
      Effect.succeed(
        config.staleWorkerCheckIntervalMs ??
          SPIDER_DEFAULTS.STALE_WORKER_CHECK_INTERVAL_MS
      ),
  };
};
