import {
  Chunk,
  Data,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Fiber,
  HashMap,
  MutableRef,
  Option,
  Queue,
  Random,
  Ref,
  Schedule,
  Sink,
  Stream,
} from 'effect';
import * as cheerio from 'cheerio';
import type { AnyNode, Element as DomElement } from 'domhandler';
import {
  SpiderConfig,
  buildFetchRetrySchedule,
  resolveUserAgent,
  type UserAgentStrategy,
  type ResolvedStopMode,
  type DomainCompleteReason,
} from '../Config/SpiderConfig.service.js';
import { UrlDeduplicatorService } from '../UrlDeduplicator/UrlDeduplicator.service.js';
import { ScraperService } from '../Scraper/Scraper.service.js';
import { PageData } from '../PageData/PageData.js';
import { RobotsService } from '../Robots/Robots.service.js';
import {
  type LinkExtractorConfig,
  LinkExtractorService,
} from '../LinkExtractor/index.js';
import { SpiderSchedulerService } from '../Scheduler/SpiderScheduler.service.js';
import { StateError, ParseError, ConfigError } from '../errors/effect-errors.js';
import { classifyFetchError, type PageFetchError, type PageFetchErrorKind } from './Spider.types.js';
import {
  DomainCompleteEvent,
  DomainRetryScheduledEvent,
  DomainStartEvent,
  DomainStoppedEvent,
  PageScrapedEvent,
  RobotsBlockedEvent,
  SpiderCompleteEvent,
  SpiderEventSink,
  SpiderStartEvent,
  SpiderStoppedEvent,
  StartUrlChosenEvent,
  StartUrlRedirectedEvent,
  WorkerInterruptedEvent,
} from '../Logging/SpiderEventSink.js';
import { deduplicateUrls } from '../utils/url-deduplication.js';
import { SPIDER_DEFAULTS } from './Spider.defaults.js';
import { acquireUndiciTerminatedGuard } from './undiciTerminatedGuard.js';

/**
 * Configuration for extracting a nested field from an element.
 *
 * @group Data Types
 * @public
 */
interface NestedFieldConfig {
  /** CSS selector to find the nested element */
  readonly selector: string;
  /** HTML attribute to extract (if not specified, extracts text content) */
  readonly attribute?: string;
}

/**
 * Configuration for extracting a single field from the page.
 *
 * @group Data Types
 * @public
 */
interface FieldExtractionConfig {
  /** CSS selector to find the element */
  readonly selector: string;
  /** Extract text content (default: true) */
  readonly text?: boolean;
  /** HTML attribute to extract instead of text */
  readonly attribute?: string;
  /** Extract multiple matching elements */
  readonly multiple?: boolean;
  /** Check if element exists (returns boolean) */
  readonly exists?: boolean;
  /** Nested fields to extract from each matched element */
  readonly fields?: Record<string, NestedFieldConfig>;
}

/**
 * Data extraction configuration - either a simple CSS selector string
 * or a detailed field extraction configuration.
 *
 * @group Data Types
 * @public
 */
type DataExtractionFieldConfig = string | FieldExtractionConfig;

/**
 * Configuration for extracting structured data from pages.
 *
 * @group Data Types
 * @public
 */
type DataExtractionConfig = Record<string, DataExtractionFieldConfig>;

/**
 * Represents a single crawling task with URL and depth information.
 *
 * @group Data Types
 * @public
 */
interface CrawlTask {
  /** The URL to be crawled */
  url: string;
  /** The depth level of this URL relative to the starting URL */
  depth: number;
  /** The URL from which this URL was discovered (optional) */
  fromUrl?: string;
  /** Optional metadata to be passed through to the result */
  metadata?: Record<string, unknown>;
  /** Optional data extraction configuration */
  extractData?: DataExtractionConfig;
}

/**
 * Successful crawl result — discriminated by `_tag === 'ok'`.
 *
 * @group Data Types
 * @public
 */
class CrawlResultOk extends Data.TaggedClass('ok')<{
  readonly pageData: PageData;
  readonly depth: number;
  readonly timestamp: Date;
  readonly metadata?: Record<string, unknown>;
}> {}

/**
 * Failed crawl result — discriminated by `_tag === 'error'`. Carries a typed
 * `PageFetchError` describing the failure kind.
 *
 * @group Data Types
 * @public
 */
class CrawlResultError extends Data.TaggedClass('error')<{
  readonly url: string;
  readonly depth: number;
  readonly timestamp: Date;
  readonly metadata?: Record<string, unknown>;
  readonly error: PageFetchError;
}> {}

/**
 * The result of a crawl attempt — either a successful page scrape or a typed fetch failure.
 *
 * Use {@link CrawlResult.isOk} / {@link CrawlResult.isError} to narrow the union.
 *
 * @group Data Types
 * @public
 */
type CrawlResult = CrawlResultOk | CrawlResultError;

// Companion namespace pattern — TS allows a type and const value to share
// a name. The members are pure narrowing predicates on the union.
// eslint-disable-next-line no-redeclare
const CrawlResult = {
  isOk: (r: CrawlResult): r is CrawlResultOk => r._tag === 'ok',
  isError: (r: CrawlResult): r is CrawlResultError => r._tag === 'error',
} as const;

/**
 * The main Spider service that orchestrates web crawling operations.
 *
 * This service provides the core functionality for crawling websites, including:
 * - URL validation and filtering based on configuration
 * - Robots.txt compliance checking
 * - Concurrent crawling with configurable worker pools
 * - Request scheduling and rate limiting
 * - Result streaming through Effect sinks
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const spider = yield* Spider;
 *   const collectSink = Sink.forEach<CrawlResult>(result =>
 *     Effect.sync(() => console.log(result.pageData.url))
 *   );
 *
 *   const stats = yield* spider.crawl('https://example.com', collectSink);
 *   console.log(`Crawled ${stats.totalPages} pages`);
 * });
 * ```
 *
 * @group Services
 * @public
 */
/**
 * Options for enhanced link extraction during crawling.
 *
 * @group Configuration
 * @public
 */
/**
 * A single starting entry for a crawl. Plain strings passed to `crawl` are
 * normalised to `{ url }` shape internally.
 *
 * `fallbackUrls` are probed in order before the primary URL is selected.
 * The first reachable URL becomes the resolved start URL; if every candidate
 * fails the probe, the primary is used and the failure surfaces through the
 * normal fetch pipeline.
 *
 * @group Configuration
 * @public
 */
export interface StartUrlEntry {
  readonly url: string;
  readonly fallbackUrls?: ReadonlyArray<string>;
  readonly metadata?: Record<string, unknown>;
}

export interface SpiderLinkExtractionOptions {
  /** Configuration for the LinkExtractorService */
  readonly linkExtractorConfig?: LinkExtractorConfig;
  /** Whether to use enhanced extraction in addition to basic extraction (default: false) */
  readonly useEnhancedExtraction?: boolean;
  /** Whether to replace basic extraction with enhanced extraction (default: true) */
  readonly replaceBasicExtraction?: boolean;
  /** Data extraction configuration for structured data extraction */
  readonly extractData?: DataExtractionConfig;
  /**
   * Optional external stop signal. Resolve this `Deferred` to abort the crawl
   * early. Only takes effect when `stopMode` is `'interrupt'` in the config.
   *
   * @example
   * ```typescript
   * const stopSignal = yield* Deferred.make<void>();
   * const crawlFiber = yield* Effect.fork(
   *   spider.crawl(urls, sink, { externalStopSignal: stopSignal })
   * );
   * // … later:
   * yield* Deferred.succeed(stopSignal, undefined);
   * yield* Fiber.join(crawlFiber);
   * ```
   */
  readonly externalStopSignal?: Deferred.Deferred<void>;
}

export class SpiderService extends Effect.Service<SpiderService>()(
  '@jambudipa/spider',
  {
    effect: Effect.gen(function* () {
      const robots = yield* RobotsService;
      const scraper = yield* ScraperService;
      const events = yield* SpiderEventSink;

      // Note: SpiderConfig is resolved within the crawl method to allow runtime overrides

      const linkExtractor = yield* LinkExtractorService;

      // Try to get SpiderSchedulerService for resumability support
      // The scheduler is obtained optionally and kept for future resumability features
      const _maybeScheduler = yield* Effect.serviceOption(
        SpiderSchedulerService
      );

      const self = {
        /**
         * Starts crawling from the specified URL and processes results through the provided sink.
         *
         * This method:
         * 1. Validates the starting URL against configuration rules
         * 2. Starts a configurable number of worker fibers
         * 3. Each worker processes URLs from a shared queue
         * 4. Results are streamed through the provided sink
         * 5. New URLs discovered are queued for processing
         *
         * @param startingUrls - The starting URL(s) for crawling (single string or array)
         * @param sink - Sink to process crawl results as they're produced
         * @param options - Optional enhanced link extraction configuration
         * @returns Effect containing crawl statistics (total pages, completion status)
         *
         * @example
         * Basic usage:
         * ```typescript
         * const collectSink = Sink.forEach<CrawlResult>(result =>
         *   Effect.sync(() => console.log(`Found: ${result.pageData.title}`))
         * );
         *
         * const stats = yield* spider.crawl('https://example.com', collectSink);
         * ```
         *
         * With multiple starting URLs:
         * ```typescript
         * const stats = yield* spider.crawl([
         *   'https://example.com',
         *   'https://other-domain.com'
         * ], collectSink);
         * ```
         *
         * With enhanced link extraction:
         * ```typescript
         * const stats = yield* spider.crawl('https://example.com', collectSink, {
         *   useEnhancedExtraction: true,
         *   linkExtractorConfig: {
         *     allowPatterns: [/\/articles\//],
         *     restrictCss: ['.content a']
         *   }
         * });
         * ```
         */
        crawl: <A, E, R>(
          startingUrls:
            | string
            | StartUrlEntry
            | ReadonlyArray<string | StartUrlEntry>,
          sink: Sink.Sink<A, CrawlResult, E, R>,
          options?: SpiderLinkExtractionOptions
        ) =>
          // Effect.scoped supplies the Scope required by Effect.acquireRelease
          // for the resultChannel queue lifecycle. Eliminates Scope from R so
          // the public signature stays unchanged for callers.
          Effect.scoped(Effect.gen(function* () {
            // Install a process-level guard for undici's
            // `TypeError: terminated` race (Fetch abort vs TLS socket
            // close). The exception escapes via EventEmitter and would
            // otherwise crash the process mid-crawl, bypassing all
            // Effect error plumbing. Reference-counted across concurrent
            // crawls; removed on scope close.
            yield* acquireUndiciTerminatedGuard;

            // Get config at runtime when crawl() is called - allows custom configs to override
            const config = yield* SpiderConfig;

            if (!config) {
              return yield* Effect.fail(
                new ConfigError({
                  field: 'SpiderConfig',
                  reason: 'SpiderConfig is required for crawling operations'
                })
              );
            }

            // Normalize input to array of StartUrlEntry
            const normalizeUrlInput = (
              input: typeof startingUrls
            ): StartUrlEntry[] => {
              if (typeof input === 'string') {
                return [{ url: input }];
              }
              if (Array.isArray(input)) {
                // Type the loop variable explicitly — Array.isArray erases
                // ReadonlyArray<string | StartUrlEntry> to any[].
                const items: ReadonlyArray<string | StartUrlEntry> = input;
                return items.map(
                  (item): StartUrlEntry =>
                    typeof item === 'string' ? { url: item } : item
                );
              }
              // After the string and array checks above, the remaining
              // variant is StartUrlEntry. TS doesn't narrow ReadonlyArray via
              // Array.isArray (which is typed as `arg is any[]`), so an
              // explicit cast is the simplest way to keep type safety here.
              // eslint-disable-next-line custom-rules/no-type-assertion -- residual narrowing after explicit type guards
              return [input as StartUrlEntry];
            };

            const startEntries = normalizeUrlInput(startingUrls);
            // Lookup map for re-attaching `fallbackUrls` after deduplication
            // (the dedup helper only sees the `{ url, metadata }` slice).
            // When the same primary URL appears more than once in the input,
            // prefer the entry that carries `fallbackUrls` so a plain-string
            // duplicate doesn't clobber a richer entry.
            let entriesByUrl = HashMap.empty<string, StartUrlEntry>();
            for (const entry of startEntries) {
              const existing = HashMap.get(entriesByUrl, entry.url);
              if (
                Option.isNone(existing) ||
                ((entry.fallbackUrls?.length ?? 0) >
                  (existing.value.fallbackUrls?.length ?? 0))
              ) {
                entriesByUrl = HashMap.set(entriesByUrl, entry.url, entry);
              }
            }
            // Strip the `metadata` field entirely when absent — avoids
            // explicit `undefined` (Option-equivalent absence sentinel)
            // while keeping `UrlWithMetadata`'s optional field semantics.
            const urlsWithMetadata = startEntries.map((e) =>
              e.metadata
                ? { url: e.url, metadata: { ...e.metadata } }
                : { url: e.url }
            );

            // Domain-equivalence rules drive both up-front URL deduplication and
            // the per-link `shouldFollowUrl` check. Deriving both from the same
            // config keeps the two paths in sync.
            const equiv = yield* config.getDomainEquivalence();

            const deduplicationResult = yield* deduplicateUrls(
              urlsWithMetadata,
              {
                wwwHandling:
                  equiv.wwwHandling === 'ignore' ? 'ignore' : 'preserve',
                // 'preserve' (not 'prefer-https') in both branches: rewriting
                // http→https during up-front dedup silently breaks crawls of
                // http-only servers. Equivalence between the two protocols
                // is enforced later by `shouldFollowUrl` in 'permissive' mode.
                protocolHandling: 'preserve',
                trailingSlashHandling: 'ignore',
                queryParamHandling: 'preserve',
                fragmentHandling: 'ignore'
              }
            );
            
            const deduplicatedUrls = deduplicationResult.deduplicated;
            
            // Log deduplication statistics
            if (deduplicationResult.stats.duplicates > 0) {
              yield* Effect.logInfo(
                `URL deduplication: ${deduplicationResult.stats.total} total, ` +
                `${deduplicationResult.stats.unique} unique, ` +
                `${deduplicationResult.stats.duplicates} duplicates removed`
              );
            }
            
            // Log skipped URLs for debugging
            for (const skipped of deduplicationResult.skipped) {
              yield* Effect.logDebug(`Skipped URL: ${skipped.url} - Reason: ${skipped.reason}`);
            }

            // Deduplication happens silently to prevent excessive logging

            const concurrency = yield* config.getConcurrency();

            // Check if multiple URLs are being crawled and warn about domain restrictions
            if (deduplicatedUrls.length > 1) {
              const configOptions = yield* config.getOptions();
              if (
                configOptions.allowedDomains ||
                configOptions.blockedDomains
              ) {
                yield* Effect.logWarning(
                  'Multiple starting URLs detected with allowedDomains/blockedDomains configured. ' +
                    'Domain restrictions will be ignored - each URL will be restricted to its own domain instead.'
                );
              }
            }

            // Emit spider lifecycle start
            const spiderStartTime = yield* DateTime.now;
            const spiderStartMs = DateTime.toEpochMillis(spiderStartTime);
            yield* events.emit(
              new SpiderStartEvent({
                details: {
                  totalUrls: deduplicatedUrls.length,
                  urls: deduplicatedUrls.map((u) => u.url),
                  originalCount: urlsWithMetadata.length,
                  deduplicatedCount: deduplicatedUrls.length,
                },
              })
            );

            // When an externalStopSignal is provided and stopMode === 'interrupt',
            // emit SpiderStoppedEvent as soon as the signal resolves.
            const crawlStopMode: ResolvedStopMode = yield* (yield* SpiderConfig).getStopMode();
            if (crawlStopMode.kind === 'interrupt' && options?.externalStopSignal) {
              yield* Effect.fork(
                Deferred.await(options.externalStopSignal).pipe(
                  Effect.flatMap(() =>
                    Effect.gen(function* () {
                      const now = yield* DateTime.now;
                      yield* events.emit(new SpiderStoppedEvent({
                        reason: 'external_abort',
                        totalDomains: deduplicatedUrls.length,
                        totalPages: 0,
                        wallclockMs: DateTime.toEpochMillis(now) - spiderStartMs,
                      }));
                    })
                  ),
                  Effect.ignore
                )
              );
            }

            // Run each URL as a separate crawling operation with its own infrastructure.
            // ALWAYS restrict to starting domain to prevent crawling external sites.
            const restrictToStartingDomain = true;

            // Per-crawl UA cache. Lifetime is one `crawl()` invocation so per-domain
            // UA stickiness applies within a session but doesn't leak between calls.
            // MutableRef wraps an immutable HashMap so writes are visible across
            // concurrent crawlSingle invocations without sharing a mutable Map.
            const uaCache = MutableRef.make(HashMap.empty<string, string>());

            // Probe a candidate URL with a HEAD request (falling back to GET on 405).
            // Returns `true` only when the response is OK. Wrapped in `timeoutOption`
            // so a slow probe is interrupted via fiber cancellation, not raw timers.
            const PROBE_TIMEOUT_MS = 5000;
            const probeUrl = (
              candidate: string,
              ua: string
            ): Effect.Effect<boolean> => {
              // `signal` is auto-injected by Effect.tryPromise — the underlying
              // fetch is aborted when the fiber is interrupted (e.g. by the
              // Effect.timeoutOption below), so probe sockets close promptly.
              const doFetch = (method: 'HEAD' | 'GET') =>
                Effect.tryPromise({
                  try: (signal) =>
                    globalThis.fetch(candidate, {
                      method,
                      headers: { 'User-Agent': ua },
                      signal,
                    }),
                  catch: () => 'fetch_failed' as const,
                });
              return doFetch('HEAD').pipe(
                Effect.flatMap((res) =>
                  res.status === 405
                    ? doFetch('GET').pipe(Effect.map((r) => r.ok))
                    : Effect.succeed(res.ok)
                ),
                Effect.timeoutOption(Duration.millis(PROBE_TIMEOUT_MS)),
                Effect.map(Option.getOrElse(() => false)),
                Effect.catchAll(() => Effect.succeed(false))
              );
            };

            // Probe primary then fallbacks in order. If every candidate fails the
            // probe, fall back to the primary URL — `crawlSingle`'s fetch pipeline
            // will surface the failure normally as a `CrawlResultError`.
            const resolveStartUrl = (
              entry: StartUrlEntry,
              ua: string
            ): Effect.Effect<string> =>
              Effect.gen(function* () {
                const candidates = [entry.url, ...(entry.fallbackUrls ?? [])];
                for (const candidate of candidates) {
                  const reachable = yield* probeUrl(candidate, ua);
                  if (reachable) return candidate;
                }
                return entry.url;
              });

            const probeUserAgent = yield* config.getUserAgent();
            // Effect.forEach accepts 'inherit' natively, so pass through
            // the configured concurrency rather than rewriting it. This keeps
            // probe parallelism consistent with the domain-crawl Effect.all
            // call below.
            const crawlConcurrency = concurrency;

            // Resolve every start URL up front so `crawlSingle` always receives
            // a candidate that returned a non-error response (when one exists).
            const resolvedEntries = yield* Effect.forEach(
              deduplicatedUrls,
              (deduped) =>
                Effect.gen(function* () {
                  const fallback: StartUrlEntry = {
                    url: deduped.url,
                    metadata: deduped.metadata,
                  };
                  const entry = HashMap.get(entriesByUrl, deduped.url).pipe(
                    Option.getOrElse(() => fallback)
                  );
                  // In interrupt mode, race start-URL probing against the
                  // external stop signal so a hung HEAD probe can't pin the
                  // crawl for PROBE_TIMEOUT_MS after the caller aborts.
                  const chosen = yield* (
                    crawlStopMode.kind === 'interrupt' && options?.externalStopSignal
                      ? Effect.raceFirst(
                          resolveStartUrl(entry, probeUserAgent),
                          Deferred.await(options.externalStopSignal).pipe(
                            Effect.map(() => entry.url)
                          )
                        )
                      : resolveStartUrl(entry, probeUserAgent)
                  );
                  const chosenDomain = yield* Effect.try({
                    try: () => new URL(chosen).hostname,
                    catch: () => 'invalid-url',
                  }).pipe(Effect.catchAll(() => Effect.succeed('invalid-url')));
                  yield* events.emit(
                    new StartUrlChosenEvent({
                      domain: chosenDomain,
                      attempted: [
                        entry.url,
                        ...(entry.fallbackUrls ?? []),
                      ],
                      chosen,
                    })
                  );
                  return {
                    url: chosen,
                    originalUrl: entry.url,
                    metadata: deduped.metadata,
                  };
                }),
              { concurrency: crawlConcurrency }
            );

            // Shared serialiser channel: every domain worker offers `CrawlResult`
            // values here. A single fiber drains them into the user-supplied sink,
            // which guarantees the sink's element handler is never invoked
            // concurrently across domains.
            //
            // Use Effect.acquireRelease so Queue.shutdown runs via Scope
            // release — survives parent interrupt cleanly. Effect.ensuring
            // alone doesn't guarantee finaliser execution under all interrupt
            // scenarios. Stream.fromQueue terminates naturally when the
            // queue is shut down, so buffered offers drain before exit.
            //
            // Capacity is configurable: `'unbounded'` (default) preserves
            // historical behaviour; a numeric capacity uses `Queue.bounded(n)`
            // so `Queue.offer` suspends worker fibers when the sink lags,
            // bounding heap retention to roughly `n × avg(CrawlResult)`.
            const resultChannelCapacity = yield* config.getResultChannelCapacity();
            const resultChannel = yield* Effect.acquireRelease(
              resultChannelCapacity === 'unbounded'
                ? Queue.unbounded<CrawlResult>()
                : Queue.bounded<CrawlResult>(resultChannelCapacity),
              (q) => Queue.shutdown(q)
            );
            // If the sink fails or defects, the serialiser fiber would exit
            // without draining the channel — under `Queue.bounded`, workers
            // suspended on `Queue.offer` would then deadlock waiting for a
            // sink that no longer exists. `ensuring` runs `Queue.shutdown`
            // on any exit (success, failure, defect, interrupt), which
            // releases suspended offers so the main fiber can observe the
            // failure and unwind cleanly.
            const serialiserFiber = yield* Effect.fork(
              Stream.fromQueue(resultChannel).pipe(
                Stream.run(sink),
                Effect.ensuring(Queue.shutdown(resultChannel))
              )
            );

            // Multi-pass domain retry. Default config (`enabled: false`,
            // `maxPasses: 1`) collapses to a single `Effect.all` over every
            // resolved entry — identical to the pre-feature behaviour. When
            // enabled, residual domains matching `retryOn` are re-run after
            // `backoffMs`, sharing the same undici connection pool, URL
            // deduplicator, robots cache, result channel, and event sink
            // because every pass lives inside this `crawl()` invocation.
            const domainRetry = yield* config.getDomainRetry();
            type ResolvedEntry = (typeof resolvedEntries)[number];
            type CrawlPassResult = {
              readonly completed: boolean;
              readonly pagesScraped: number;
              readonly domain: string;
              readonly completionSummary: Option.Option<{
                readonly reason: DomainCompleteEvent['reason'];
                readonly pagesAttempted: number;
              }>;
            };

            const isRetryEligible = (
              summary: Option.Option<{
                readonly reason: DomainCompleteEvent['reason'];
                readonly pagesAttempted: number;
              }>
            ): boolean => {
              if (Option.isNone(summary)) return false;
              const { reason, pagesAttempted: pa } = summary.value;
              return (
                domainRetry.retryOn.reasons.includes(reason) &&
                pa <= domainRetry.retryOn.maxPagesAttempted
              );
            };

            const runPass = (
              entries: ReadonlyArray<ResolvedEntry>,
              cycleIndex: number
            ) => {
              // Apply pass overrides only for retry cycles (>= 1). Pass 0
              // always uses the base config so behaviour is identical when
              // domainRetry is disabled.
              const passConcurrency: number | 'unbounded' | 'inherit' =
                // eslint-disable-next-line effect/no-undefined-use-option -- `passOverrides.concurrency` is an optional config field where absence means "use the base value"; the comparison is to a sentinel-absence value, not a value-absence to encode in Option
                cycleIndex > 0 && domainRetry.passOverrides?.concurrency !== undefined
                  ? domainRetry.passOverrides.concurrency
                  : concurrency;
              const passEffects = entries.map(({ url, originalUrl, metadata }) =>
                self.crawlSingle(
                  url,
                  resultChannel,
                  options,
                  metadata,
                  restrictToStartingDomain,
                  uaCache,
                  originalUrl,
                  cycleIndex
                )
              );
              return Effect.all(passEffects, { concurrency: passConcurrency });
            };

            // When `domainRetry.enabled` is false (default), force a single
            // pass regardless of `maxPasses`.
            const effectiveMaxPasses = domainRetry.enabled
              ? domainRetry.maxPasses
              : 1;

            // For retry cycles, `passOverrides.fetchRetry` is applied by
            // installing a SpiderConfig layer for the duration of the pass.
            // This is the cleanest way to keep `crawlSingle` honest about
            // reading the active `getFetchRetry()` without threading a new
            // arg through its signature.
            const baseConfigOptions = yield* config.getOptions();
            const runPassWithOverrides = (
              entries: ReadonlyArray<ResolvedEntry>,
              cycleIndex: number
            ) => {
              if (
                cycleIndex === 0 ||
                // eslint-disable-next-line effect/no-undefined-use-option -- optional config field; sentinel-absence comparison rather than Option-wrapped value
                domainRetry.passOverrides?.fetchRetry === undefined
              ) {
                return runPass(entries, cycleIndex);
              }
              const overrideOptions = {
                ...baseConfigOptions,
                fetchRetry: domainRetry.passOverrides.fetchRetry,
              };
              return Effect.provide(
                runPass(entries, cycleIndex),
                SpiderConfig.Live(overrideOptions)
              );
            };

            // State shape note: `residuals` and `previousReasons` are paired
            // by index. `Effect.all` preserves input order, so we use the
            // same index-pairing trick to correlate `passResults[i]` back to
            // its source entry — far simpler (and correct) than a hostname
            // keyed Map, which silently collapses sibling start URLs that
            // share a hostname.
            const initialState: {
              cycle: number;
              residuals: ReadonlyArray<ResolvedEntry>;
              previousReasons: ReadonlyArray<DomainCompleteReason>;
              accumulated: ReadonlyArray<CrawlPassResult>;
            } = {
              cycle: 0,
              residuals: resolvedEntries,
              previousReasons: [],
              accumulated: [],
            };

            // Hostname extraction mirrors the same defensive shape used in
            // `crawlSingle` (where it produces the `domain` field on
            // `DomainCompleteEvent`). Used only to populate the `domain`
            // field of `DomainRetryScheduledEvent`.
            const domainOf = (rawUrl: string): string => {
              // eslint-disable-next-line effect/no-try-catch-use-effect -- sync helper, defensive guard
              try {
                return new URL(rawUrl).hostname;
              } catch {
                return 'invalid-url';
              }
            };

            const finalState = yield* Effect.iterate(initialState, {
              while: (s) =>
                s.residuals.length > 0 && s.cycle < effectiveMaxPasses,
              body: (s) =>
                Effect.gen(function* () {
                  if (s.cycle > 0) {
                    // Emit a DomainRetryScheduledEvent for every residual
                    // BEFORE the backoff sleep so consumers can observe
                    // the intended schedule.
                    const now = yield* DateTime.now;
                    const nowMs = DateTime.toEpochMillis(now);
                    const nextPassAt = nowMs + domainRetry.backoffMs;
                    yield* Effect.forEach(
                      s.residuals,
                      (entry, idx) =>
                        events.emit(
                          new DomainRetryScheduledEvent({
                            domain: domainOf(entry.url),
                            startUrl: entry.url,
                            previousReason: s.previousReasons[idx],
                            attempt: s.cycle,
                            nextPassAt,
                          })
                        ),
                      { discard: true }
                    );
                    yield* Effect.sleep(Duration.millis(domainRetry.backoffMs));
                  }
                  const passResults = yield* runPassWithOverrides(s.residuals, s.cycle);
                  // Domains in this pass that match retryOn become the next
                  // residual set. Index-pair the result with its source entry
                  // and propagate the just-observed completion reason so the
                  // next cycle's `DomainRetryScheduledEvent.previousReason`
                  // reflects the most recent pass, not the oldest.
                  const nextResiduals: ResolvedEntry[] = [];
                  const nextPreviousReasons: DomainCompleteReason[] = [];
                  for (let i = 0; i < passResults.length; i++) {
                    const r = passResults[i];
                    if (isRetryEligible(r.completionSummary)) {
                      // eslint-disable-next-line effect/no-array-mutation-use-chunk -- local accumulator for residual entries; short-lived loop-local array
                      nextResiduals.push(s.residuals[i]);
                      // eslint-disable-next-line effect/no-array-mutation-use-chunk -- paired by index with nextResiduals; same lifetime
                      nextPreviousReasons.push(
                        Option.isSome(r.completionSummary)
                          ? r.completionSummary.value.reason
                          : 'all_fetches_failed'
                      );
                    }
                  }
                  return {
                    cycle: s.cycle + 1,
                    residuals: nextResiduals,
                    previousReasons: nextPreviousReasons,
                    accumulated: [...s.accumulated, ...passResults],
                  };
                }),
            });
            const results = finalState.accumulated;

            // Trigger drain by shutting down the channel before joining.
            // The acquireRelease finaliser will be a no-op second shutdown
            // on success; on interrupt the finaliser is the only shutdown.
            yield* Queue.shutdown(resultChannel);

            // Wait for every offered result to drain through the sink.
            yield* Fiber.join(serialiserFiber);

            // Emit spider lifecycle complete. `totalDomains` reflects the
            // unique start-URL set the consumer asked for, not the number
            // of pass invocations (`accumulated` can hold multiple entries
            // per start URL when `domainRetry` runs retries). `totalPages`
            // sums scraped pages across all passes — when retries recover
            // pages on later passes, those scrapes are real work and count.
            yield* events.emit(
              new SpiderCompleteEvent({
                details: {
                  totalDomains: resolvedEntries.length,
                  totalPages: results.reduce(
                    (sum, r) => sum + (r.pagesScraped || 0),
                    0
                  ),
                },
              })
            );

            // All results have been processed through the sink
            return {
              completed: true,
            };
          })),

        // Single URL crawling - each gets its own queue, workers, and deduplicator.
        // Workers offer results to the shared `resultChannel` owned by the caller
        // (the public `crawl` method), which forks one serialiser fiber that
        // drains the channel into the user-supplied sink. The sink lives outside
        // `crawlSingle` so concurrent domains can't race against it.
        crawlSingle: (
          urlString: string,
          resultChannel: Queue.Queue<CrawlResult>,
          options?: SpiderLinkExtractionOptions,
          initialMetadata?: Record<string, unknown>,
          restrictToStartingDomain?: boolean,
          uaCache: MutableRef.MutableRef<
            HashMap.HashMap<string, string>
          > = MutableRef.make(HashMap.empty<string, string>()),
          // The user-supplied primary URL prior to any probe-driven fallback
          // selection. Used as the `from` field on `StartUrlRedirectedEvent`
          // so observability reports the URL the consumer actually requested,
          // not the post-probe winner. Defaults to `urlString` for backwards
          // compatibility when called outside `crawl()`.
          originalStartUrl?: string,
          // Pass index for `DomainCompleteEvent.cycle`. `0` for the initial
          // pass; incremented by the multi-pass retry loop in `crawl()`.
          // Defaults to `0` so the public single-domain entry point keeps
          // existing behaviour.
          cycle: number = 0
        ) =>
          Effect.gen(function* () {
            const config = yield* SpiderConfig;
            const fetchRetry = yield* config.getFetchRetry();
            const configOptions = yield* config.getOptions();
            const httpAdapter = yield* config.getHttpAdapter();

            // Extract domain from URL using Effect error handling
            const domain = yield* Effect.try({
              try: () => new URL(urlString).hostname,
              catch: () => 'invalid-url'
            });

            // The "effective" start URL — initially the requested URL, may be
            // updated to the post-redirect URL once the depth-0 fetch resolves
            // (only when `crossDomainRedirects.enabled`). Domain restriction
            // checks read this so subsequent links match the redirected host.
            const effectiveStartUrl = MutableRef.make(urlString);

            // Resolve UA once per domain. `resolveUserAgent` mutates `uaCache`
            // for `rotating` + `perDomain` strategies so subsequent crawls of
            // the same domain (within this `crawl()` invocation) reuse it.
            const uaStrategy: UserAgentStrategy =
              configOptions.userAgentStrategy ??
              { kind: 'static', userAgent: configOptions.userAgent };
            const userAgent = resolveUserAgent(uaStrategy, domain, uaCache);

            // Emit domain start
            yield* events.emit(
              new DomainStartEvent({ domain, startUrl: urlString })
            );

            // Create a fresh deduplicator instance for this domain
            const localDeduplicator = yield* Effect.provide(
              UrlDeduplicatorService,
              UrlDeduplicatorService.Default
            );

            const urlQueue = yield* Queue.unbounded<CrawlTask>();
            const activeWorkers = MutableRef.make(0);
            const maxPagesReached = MutableRef.make(false);
            // `domainCompleted` is the worker-loop-exit signal — flipped by
            // the first worker that detects max_pages or no_more_urls so peer
            // workers stop polling. It cannot also gate event emission
            // because by the time the post-join code runs, this is already
            // `true` for every successful crawl. `domainCompleteEmitted` is
            // a separate one-shot CAS for "exactly one DomainCompleteEvent".
            const domainCompleted = MutableRef.make(false);
            const domainCompleteEmitted = MutableRef.make(false);
            // Snapshot of the DomainCompleteEvent's `reason` and `pagesAttempted`
            // for whichever emission site fires first. The multi-pass retry
            // loop in `crawl()` reads this to decide whether the domain is
            // eligible for another pass. `Option.none` means the event was
            // never emitted (e.g. fiber interrupted before the post-join
            // emission block ran).
            const completionSummary = MutableRef.make(
              Option.none<{
                readonly reason: DomainCompleteEvent['reason'];
                readonly pagesAttempted: number;
              }>()
            );

            // Stop-signal infrastructure (used only when stopMode === 'interrupt')
            const stopMode: ResolvedStopMode = yield* config.getStopMode();

            // Read worker-heartbeat policy once per domain scope — same source
            // of truth for the workerHealthMonitor's stale-threshold check and
            // for the per-task decision about firing between-retry heartbeats.
            const staleWorkerThresholdMs = yield* config.getStaleWorkerThreshold();
            const workerHeartbeatMode = yield* config.getWorkerHeartbeatMode();
            const staleWorkerCheckIntervalMs =
              yield* config.getStaleWorkerCheckInterval();
            const domainStopSignal = yield* Deferred.make<void>();
            const domainStopReason = MutableRef.make<Option.Option<string>>(Option.none());
            // Tracks the URL currently being fetched so WorkerInterruptedEvent
            // can report it accurately when the fiber is interrupted.
            const currentTaskUrl = MutableRef.make('');

            // Cascade an external stop signal → domain stop signal
            if (stopMode.kind === 'interrupt' && options?.externalStopSignal) {
              yield* Effect.fork(
                Deferred.await(options.externalStopSignal).pipe(
                  Effect.flatMap(() => {
                    MutableRef.set(domainStopReason, Option.some('external_abort'));
                    return Deferred.complete(domainStopSignal, Effect.void);
                  }),
                  Effect.ignore
                )
              );
            }

            const domainStartTime = yield* DateTime.now;
            const domainStartMs = DateTime.toEpochMillis(domainStartTime);
            const pagesAttempted = MutableRef.make(0);
            const pagesFailed = MutableRef.make(
              HashMap.empty<PageFetchErrorKind, number>()
            );
            const robotsBlockedCount = MutableRef.make(0);

            const recordFailure = (kind: PageFetchErrorKind) =>
              Effect.sync(() => {
                MutableRef.update(pagesAttempted, (n) => n + 1);
                MutableRef.update(pagesFailed, (m) =>
                  HashMap.set(
                    m,
                    kind,
                    Option.getOrElse(HashMap.get(m, kind), () => 0) + 1
                  )
                );
              });

            // Create semaphore for atomic queue operations (mutex with 1 permit)
            const queueMutex = yield* Effect.makeSemaphore(1);

            // Worker health monitoring system. `Ref` (not `MutableRef`) so
            // concurrent `reportWorkerHealth` calls — top-of-loop from many
            // workers plus `Schedule.tapInput` taps from per-attempt mode —
            // each get an atomic read-modify-write and no heartbeat is lost
            // to a last-writer-wins race.
            const workerHealthChecks = yield* Ref.make<
              HashMap.HashMap<string, DateTime.Utc>
            >(HashMap.empty());

            const reportWorkerHealth = (workerId: string) =>
              Effect.gen(function* () {
                const now = yield* DateTime.now;
                yield* Ref.update(workerHealthChecks, (m) =>
                  HashMap.set(m, workerId, now)
                );
                // Debug-level so production logs aren't affected; tests can
                // raise the log level and count `event: 'worker_heartbeat'`
                // records to assert per-iteration vs per-attempt behaviour.
                yield* Effect.logDebug('worker heartbeat').pipe(
                  Effect.annotateLogs({
                    event: 'worker_heartbeat',
                    domain,
                    workerId,
                  })
                );
              });

            const workerHealthMonitor = Effect.gen(function* () {
              const now = yield* DateTime.now;
              const nowMs = DateTime.toEpochMillis(now);
              const staleThreshold = staleWorkerThresholdMs;

              // Identify stale workers from a snapshot, then re-check each
              // candidate against a fresh map read before removing it — a
              // heartbeat that arrives between snapshot and removal would
              // otherwise see the entry vanish and the worker would
              // silently drop out of monitoring while still alive.
              const snapshot = yield* Ref.get(workerHealthChecks);
              let candidatesChunk = Chunk.empty<readonly [string, number]>();
              for (const [workerId, lastCheck] of snapshot) {
                const elapsed = nowMs - DateTime.toEpochMillis(lastCheck);
                // Negative elapsed = clock moved backwards (NTP step,
                // suspend/resume). Skip; the next tick will see a sensible
                // positive elapsed.
                if (elapsed < 0) continue;
                if (elapsed > staleThreshold) {
                  candidatesChunk = Chunk.append(
                    candidatesChunk,
                    [workerId, elapsed] as const
                  );
                }
              }

              const candidates = Chunk.toArray(candidatesChunk);
              if (candidates.length === 0) return;

              // Atomic confirm-and-remove for each candidate: only emit the
              // death warning if the entry is *still* stale after a fresh
              // read. Closes the heartbeat-vs-removal race.
              for (const [workerId, elapsed] of candidates) {
                const stillStale = yield* Ref.modify(
                  workerHealthChecks,
                  (m) => {
                    const opt = HashMap.get(m, workerId);
                    if (Option.isNone(opt)) return [false, m] as const;
                    const elapsedNow = nowMs - DateTime.toEpochMillis(opt.value);
                    if (elapsedNow > staleThreshold) {
                      return [true, HashMap.remove(m, workerId)] as const;
                    }
                    return [false, m] as const;
                  }
                );
                if (stillStale) {
                  yield* Effect.logWarning(
                    `dead worker: ${workerId} - no heartbeat for ${Math.round(elapsed / 1000)}s`
                  ).pipe(
                    Effect.annotateLogs({
                      event: 'worker_death_detected',
                      domain,
                      workerId,
                      lastSeenMs: elapsed,
                    })
                  );
                }
              }
            }).pipe(
              Effect.repeat(
                Schedule.fixed(Duration.millis(staleWorkerCheckIntervalMs))
              )
            );

            // Atomic queue manager - synchronizes queue operations with worker state using semaphore
            const queueManager = {
              // Atomic take: either returns task and increments active count, or detects completion
              takeTaskOrComplete: queueMutex.withPermits(1)(
                Effect.gen(function* () {
                  // This entire block is atomic - only one worker can execute at a time

                  // Check completion conditions first
                  const isCompleted = MutableRef.get(domainCompleted);
                  if (isCompleted) {
                    return {
                      type: 'completed' as const,
                      reason: 'already_completed',
                      wasFirstToComplete: false,
                    };
                  }

                  const hasMaxPages = MutableRef.get(maxPagesReached);
                  if (hasMaxPages) {
                    // Mark domain as completed atomically
                    const wasCompleted = MutableRef.compareAndSet(
                      domainCompleted,
                      false,
                      true
                    );
                    return {
                      type: 'completed' as const,
                      reason: 'max_pages',
                      wasFirstToComplete: wasCompleted,
                    };
                  }

                  // Use non-blocking poll instead of blocking take to prevent deadlock
                  const pollResult = yield* Queue.poll(urlQueue);

                  if (pollResult._tag === 'Some') {
                    // We got a task - increment active count and return it
                    const activeCount = MutableRef.updateAndGet(
                      activeWorkers,
                      (n: number) => n + 1
                    );
                    return {
                      type: 'task' as const,
                      task: pollResult.value,
                      activeCount,
                    };
                  } else {
                    // Queue is empty - check completion conditions
                    const currentActive = MutableRef.get(activeWorkers);

                    // If there are already no active workers, we can safely check completion
                    if (currentActive === 0) {
                      // Double-check queue is still empty before marking complete
                      const wasCompleted = MutableRef.compareAndSet(
                        domainCompleted,
                        false,
                        true
                      );
                      return {
                        type: 'completed' as const,
                        reason: 'no_more_urls',
                        wasFirstToComplete: wasCompleted,
                      };
                    } else {
                      // Other workers are active - signal to wait
                      return {
                        type: 'empty_but_active' as const,
                        activeWorkers: currentActive,
                      };
                    }
                  }
                })
              ),

              // Add task to queue
              addTask: (task: CrawlTask) => Queue.offer(urlQueue, task),

              // Mark worker as idle (decrement active count with bounds checking)
              markIdle: () =>
                Effect.sync(() =>
                  MutableRef.updateAndGet(activeWorkers, (n: number) =>
                    Math.max(0, n - 1)
                  )
                ),

              // Get queue size for logging (with defensive bounds checking)
              size: () =>
                Effect.map(Queue.size(urlQueue), (size) => Math.max(0, size)),
            };

            // Generate unique worker IDs for this domain
            const generateWorkerId = () =>
              Effect.gen(function* () {
                const random = yield* Random.nextIntBetween(1000, 9999);
                return `${domain}-worker-${random}`;
              });

            // Worker implementation with enhanced logging
            const worker = (workerId: string) =>
              Effect.gen(function* () {
                // Log worker lifecycle: entering main loop
                yield* Effect.logDebug('worker entering_loop').pipe(
                  Effect.annotateLogs({ workerId, domain })
                );

                while (true) {
                  // Report worker health heartbeat
                  yield* reportWorkerHealth(workerId);

                  // Monitor memory usage and queue size for potential issues
                  const queueSize = yield* queueManager.size();
                  const memUsage = process.memoryUsage();

                  // Log warnings for concerning resource usage
                  if (memUsage.heapUsed > SPIDER_DEFAULTS.MEMORY_THRESHOLD_BYTES) {
                    yield* Effect.logWarning('high memory usage').pipe(
                      Effect.annotateLogs({
                        event: 'high_memory_usage',
                        domain,
                        workerId,
                        heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
                        heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
                        queueSize,
                      })
                    );
                  }

                  if (queueSize > SPIDER_DEFAULTS.QUEUE_SIZE_THRESHOLD) {
                    yield* Effect.logWarning(
                      'queue size exceeds threshold - potential memory issue'
                    ).pipe(
                      Effect.annotateLogs({
                        event: 'excessive_queue_size',
                        domain,
                        workerId,
                        queueSize,
                      })
                    );
                  }

                  // Log worker state: attempting to take task
                  yield* Effect.logDebug('worker taking_task').pipe(
                    Effect.annotateLogs({ workerId, domain, queueSize })
                  );

                  // Use atomic take-or-complete operation with timeout detection
                  const result = yield* queueManager.takeTaskOrComplete.pipe(
                    Effect.timeout(SPIDER_DEFAULTS.TASK_ACQUISITION_TIMEOUT),
                    Effect.tap(() =>
                      Effect.logDebug('task acquired').pipe(
                        Effect.annotateLogs({
                          event: 'task_acquisition_success',
                          domain,
                          workerId,
                        })
                      )
                    ),
                    Effect.tapError((error) =>
                      Effect.logError(
                        'deadlock: task acquisition timed out'
                      ).pipe(
                        Effect.annotateLogs({
                          event: 'deadlock_detected',
                          domain,
                          workerId,
                          error: String(error),
                        })
                      )
                    ),
                    Effect.catchAll((error) =>
                      Effect.gen(function* () {
                        yield* Effect.logWarning(
                          'task acquisition failed, marking worker idle and retrying'
                        ).pipe(
                          Effect.annotateLogs({
                            event: 'task_acquisition_failed',
                            domain,
                            workerId,
                            error: String(error),
                            isTimeout: error?.name === 'TimeoutException',
                          })
                        );

                        // Mark worker as idle before continuing - prevent stuck active count
                        yield* queueManager.markIdle();

                        // Return empty_but_active to trigger retry logic
                        return {
                          type: 'empty_but_active' as const,
                          activeWorkers: 0,
                        };
                      })
                    )
                  );

                  if (result.type === 'completed') {
                    if (
                      'wasFirstToComplete' in result &&
                      result.wasFirstToComplete
                    ) {
                      // This worker detected completion - log it
                      const reason = result.reason || 'unknown';
                      yield* Effect.logDebug(
                        `worker ${workerId} detected domain completion - ${reason}`
                      ).pipe(
                        Effect.annotateLogs({
                          event: 'domain_complete_detected',
                          domain,
                          workerId,
                          reason,
                        })
                      );
                    }
                    yield* Effect.logDebug('worker exiting_loop').pipe(
                      Effect.annotateLogs({
                        workerId,
                        domain,
                        reason: 'detected_completion',
                      })
                    );
                    break;
                  } else if (result.type === 'empty_but_active') {
                    // Queue empty but other workers active, sleep and retry
                    // Use exponential backoff to avoid busy-waiting using Effect Random service
                    const randomFactor = yield* Random.nextIntBetween(0, 3);
                    const backoffMs = Math.min(
                      1000 * Math.pow(2, randomFactor),
                      5000
                    );
                    yield* Effect.sleep(`${backoffMs} millis`);
                    continue;
                  } else if (result.type === 'task') {
                    // Got a task and active count was incremented atomically
                    const task = result.task;

                    yield* Effect.logDebug('worker marked_active').pipe(
                      Effect.annotateLogs({
                        workerId,
                        domain,
                        taskUrl: task.url,
                        activeWorkers: result.activeCount,
                      })
                    );

                    // Try to add URL to local deduplicator - skip if already seen
                    const wasAdded = yield* localDeduplicator.tryAdd(task.url);
                    if (!wasAdded) {
                      // Mark worker as idle before continuing to next iteration
                      const postIdleCount = yield* queueManager.markIdle();
                      yield* Effect.logDebug('worker marked_idle').pipe(
                        Effect.annotateLogs({
                          workerId,
                          domain,
                          taskUrl: task.url,
                          activeWorkers: postIdleCount,
                          reason: 'duplicate_url',
                        })
                      );
                      continue; // Already processed this URL
                    }
                  } else {
                    // Should not happen, but handle gracefully
                    yield* Effect.sleep('1 second');
                    continue;
                  }

                  // We have a valid task to process
                  const task = result.task;

                  // Use SpiderConfig to decide whether to follow URL
                  yield* Effect.logDebug('checking shouldFollowUrl').pipe(
                    Effect.annotateLogs({
                      event: 'before_shouldFollowUrl',
                      domain,
                      workerId,
                      url: task.url,
                    })
                  );

                  const restrictToStartingDomainOption = restrictToStartingDomain
                    ? Option.some(MutableRef.get(effectiveStartUrl))
                    : Option.none<string>();
                  const shouldFollow = yield* config.shouldFollowUrl(
                    task.url,
                    task.fromUrl,
                    Option.getOrUndefined(restrictToStartingDomainOption)
                  );

                  yield* Effect.logDebug('shouldFollowUrl complete').pipe(
                    Effect.annotateLogs({
                      event: 'after_shouldFollowUrl',
                      domain,
                      workerId,
                      url: task.url,
                      follow: shouldFollow.follow,
                      reason: shouldFollow.reason,
                    })
                  );

                  if (!shouldFollow.follow) {
                    // Mark worker as idle before continuing
                    const newIdleCount = yield* queueManager.markIdle();
                    yield* Effect.logDebug('worker marked_idle').pipe(
                      Effect.annotateLogs({
                        workerId,
                        domain,
                        reason: 'shouldNotFollow',
                        activeWorkers: newIdleCount,
                      })
                    );
                    continue;
                  }

                  // Check robots.txt unless configured to ignore
                  const ignoreRobots = yield* config.shouldIgnoreRobotsTxt();
                  if (!ignoreRobots) {
                    yield* Effect.logDebug('checking robots.txt').pipe(
                      Effect.annotateLogs({
                        event: 'before_robots_check',
                        domain,
                        workerId,
                        url: task.url,
                      })
                    );

                    const robotsCheck = yield* robots.checkUrl(task.url);

                    yield* Effect.logDebug('robots.txt check complete').pipe(
                      Effect.annotateLogs({
                        event: 'after_robots_check',
                        domain,
                        workerId,
                        url: task.url,
                        allowed: robotsCheck.allowed,
                        crawlDelay: robotsCheck.crawlDelay,
                      })
                    );
                    if (!robotsCheck.allowed) {
                      MutableRef.update(robotsBlockedCount, (n) => n + 1);
                      yield* events.emit(
                        new RobotsBlockedEvent({
                          url: task.url,
                          domain,
                          disallowRule: robotsCheck.disallowRule,
                        })
                      );
                      // Mark worker as idle before continuing
                      const newIdleCount = yield* queueManager.markIdle();
                      yield* Effect.logDebug('worker marked_idle').pipe(
                        Effect.annotateLogs({
                          workerId,
                          domain,
                          reason: 'robotsBlocked',
                          activeWorkers: newIdleCount,
                        })
                      );
                      continue;
                    }

                    // Apply crawl delay if specified, but cap at maximum
                    if (robotsCheck.crawlDelay) {
                      const maxCrawlDelayMs =
                        yield* config.getMaxRobotsCrawlDelay();
                      const maxCrawlDelaySeconds = maxCrawlDelayMs / 1000;
                      const effectiveCrawlDelay = Math.min(
                        robotsCheck.crawlDelay,
                        maxCrawlDelaySeconds
                      );

                      if (effectiveCrawlDelay < robotsCheck.crawlDelay) {
                        yield* Effect.logInfo(
                          `capping robots.txt delay from ${robotsCheck.crawlDelay}s to ${effectiveCrawlDelay}s`
                        ).pipe(
                          Effect.annotateLogs({
                            event: 'crawl_delay_capped',
                            domain,
                            workerId,
                            robotsCrawlDelay: robotsCheck.crawlDelay,
                            maxCrawlDelay: maxCrawlDelaySeconds,
                            effectiveDelay: effectiveCrawlDelay,
                          })
                        );
                      }

                      yield* Effect.sleep(`${effectiveCrawlDelay} seconds`);
                    }
                  }

                  // Apply configured request delay
                  const requestDelay = yield* config.getRequestDelay();
                  yield* Effect.sleep(`${requestDelay} millis`);

                  const fetchStartDateTime = yield* DateTime.now;
                  const fetchStartTime = DateTime.toEpochMillis(fetchStartDateTime);
                  yield* Effect.logDebug('about to fetch and parse page').pipe(
                    Effect.annotateLogs({
                      event: 'before_fetch',
                      domain,
                      workerId,
                      url: task.url,
                      depth: task.depth,
                      timestamp: DateTime.formatIso(fetchStartDateTime),
                      fetchStartMs: fetchStartTime,
                    })
                  );

                  // Track actual attempts so the final error event reports the
                  // real count, not the configured ceiling. Schedule.whileInput
                  // can short-circuit before all attempts are exhausted; the
                  // counter increments inside `Effect.tapError` which runs on
                  // every failure, including the final one.
                  const attemptCounter = MutableRef.make(0);

                  // Schedule built from config — single source of truth in
                  // `buildFetchRetrySchedule` so production and tests can't
                  // drift apart silently. When `workerHeartbeatMode` is
                  // `'per-attempt'` the schedule fires a heartbeat on each
                  // failure input (before the backoff delay) so long retry
                  // chains don't trigger the dead-worker detector.
                  // `reportWorkerHealth` is infallible (only `DateTime.now`,
                  // `MutableRef` ops, and `Effect.logDebug` — none can fail in
                  // the error channel). The schedule hook is typed
                  // `Effect.Effect<unknown, never>` so we don't wrap with
                  // `Effect.ignore` — that would also swallow defects, hiding
                  // real bugs (e.g. logger encoder crashes) instead of
                  // surfacing them.
                  const heartbeatOnAttempt: Effect.Effect<unknown> | undefined =
                    workerHeartbeatMode === 'per-attempt'
                      ? reportWorkerHealth(workerId)
                      // eslint-disable-next-line effect/no-undefined-use-option -- `heartbeatOnAttempt` is the optional `onAttempt` slot of buildFetchRetrySchedule; absence is the JS shape, not a value-absence to encode in Option
                      : undefined;
                  const retrySchedule = buildFetchRetrySchedule(
                    fetchRetry,
                    heartbeatOnAttempt
                  );

                  // Track current task URL so WorkerInterruptedEvent can
                  // report it if this fiber is interrupted mid-fetch.
                  MutableRef.set(currentTaskUrl, task.url);

                  // Fetch and parse the page with aggressive timeout.
                  // Wrap the success branch in `Option.some` so the catchAll
                  // branch can return `Option.none` and the resulting type is
                  // a clean `Option.Option<FetchOk>` — no runtime cast needed.
                  // In interrupt mode the fetch is raced against the domain
                  // stop signal so an in-flight retry schedule is abandoned
                  // immediately when the signal resolves.
                  type FetchOk = { pageData: PageData; finalUrl: string };
                  // The HttpAdapter contract puts timeout enforcement on the
                  // adapter itself (request.timeoutMs); the spider does not
                  // layer an additional Effect.timeout. Buggy adapters that
                  // ignore the deadline can still be interrupted via
                  // stopMode: 'interrupt'.
                  const fetchCore = scraper
                    .fetchAndParse(task.url, task.depth, userAgent, httpAdapter)
                    .pipe(
                      Effect.tapError(() =>
                        Effect.sync(() =>
                          MutableRef.update(attemptCounter, (n) => n + 1)
                        )
                      ),
                      Effect.retry(retrySchedule),
                    );
                  const maybeFetchResult: Option.Option<FetchOk> = yield* (
                    stopMode.kind === 'interrupt'
                      ? Effect.raceFirst(
                          fetchCore,
                          Deferred.await(domainStopSignal).pipe(
                            Effect.flatMap(() => Effect.interrupt)
                          )
                        )
                      : fetchCore
                  ).pipe(
                      Effect.map((result): Option.Option<FetchOk> =>
                        Option.some(result)
                      ),
                      Effect.catchAll((error) =>
                        Effect.gen(function* () {
                          const fetchEndDateTime = yield* DateTime.now;
                          const fetchDuration = DateTime.toEpochMillis(fetchEndDateTime) - fetchStartTime;
                          const attemptsMade = MutableRef.get(attemptCounter);
                          const fetchError = classifyFetchError(error, fetchDuration, attemptsMade);

                          yield* Effect.logWarning(
                            error?.name === 'TimeoutException'
                              ? `fetch timed out after ${fetchDuration}ms`
                              : `fetch failed after ${fetchDuration}ms`
                          ).pipe(
                            Effect.annotateLogs({
                              event: 'fetch_error',
                              domain,
                              workerId,
                              url: task.url,
                              errorKind: fetchError.kind,
                              statusCode: fetchError.statusCode,
                              durationMs: fetchDuration,
                            })
                          );

                          yield* recordFailure(fetchError.kind);

                          const crawlTimestamp = yield* DateTime.now;
                          yield* Queue.offer(
                            resultChannel,
                            new CrawlResultError({
                              url: task.url,
                              depth: task.depth,
                              timestamp: DateTime.toDateUtc(crawlTimestamp),
                              metadata: task.metadata,
                              error: fetchError,
                            })
                          );

                          return Option.none<FetchOk>();
                        })
                      )
                    );

                  if (Option.isSome(maybeFetchResult)) {
                    const { pageData: actualPageData, finalUrl } =
                      maybeFetchResult.value;
                    const fetchEndDateTime = yield* DateTime.now;
                    const fetchDuration = DateTime.toEpochMillis(fetchEndDateTime) - fetchStartTime;

                    // Cross-domain redirect detection (depth-0 only). When the
                    // start URL's response landed on a different host AND the
                    // consumer opted in via `crossDomainRedirects.enabled`,
                    // update `effectiveStartUrl` so subsequent `shouldFollowUrl`
                    // checks treat the redirected host as the in-domain target.
                    // Guard `finalUrl` truthy: a hand-built `Response` (e.g.
                    // from a custom fetch wrapper) defaults `Response.url` to
                    // `''`, which would otherwise trigger spurious redirect
                    // logic and a `new URL('')` throw.
                    if (
                      task.depth === 0 &&
                      finalUrl &&
                      finalUrl !== task.url
                    ) {
                      const crossDomainConfig =
                        yield* config.getCrossDomainRedirects();
                      if (crossDomainConfig.enabled) {
                        const hostnamesOpt = yield* Effect.try({
                          try: () => ({
                            finalHostname: new URL(finalUrl).hostname,
                            startHostname: new URL(
                              MutableRef.get(effectiveStartUrl)
                            ).hostname,
                          }),
                          catch: () => 'parse_failed' as const,
                        }).pipe(
                          Effect.map(Option.some),
                          Effect.catchAll(() =>
                            Effect.succeed(
                              Option.none<{
                                readonly finalHostname: string;
                                readonly startHostname: string;
                              }>()
                            )
                          )
                        );
                        if (
                          Option.isSome(hostnamesOpt) &&
                          hostnamesOpt.value.finalHostname !==
                            hostnamesOpt.value.startHostname
                        ) {
                          const hostnames = hostnamesOpt.value;
                          MutableRef.set(effectiveStartUrl, finalUrl);
                          // `from` is the user-supplied primary URL (or the
                          // post-probe `urlString` when no original was
                          // threaded in), so the chain reflects the consumer's
                          // requested URL, not just the probe winner.
                          const fromUrl = originalStartUrl ?? urlString;
                          yield* events.emit(
                            new StartUrlRedirectedEvent({
                              domain: hostnames.startHostname,
                              from: fromUrl,
                              to: finalUrl,
                              chain:
                                fromUrl === urlString
                                  ? [fromUrl, finalUrl]
                                  : [fromUrl, urlString, finalUrl],
                            })
                          );
                        }
                      }
                    }

                    // Apply data extraction if configured
                    // We need to create a mutable copy since PageData is from scraper
                    let pageDataWithExtraction = actualPageData;
                    if (task.extractData) {
                      const extractedData = yield* Effect.sync(() => {
                        const $ = cheerio.load(actualPageData.html);
                        const result: Record<string, unknown> = {};
                        const extractDataConfig = task.extractData;
                        if (!extractDataConfig) return result;

                        // Type guard function for FieldExtractionConfig
                        const isFieldExtractionConfig = (
                          fieldCfg: DataExtractionFieldConfig
                        ): fieldCfg is FieldExtractionConfig =>
                          Option.fromNullable(fieldCfg).pipe(
                            Option.filter((cfg): cfg is FieldExtractionConfig =>
                              typeof cfg === 'object' && 'selector' in cfg
                            ),
                            Option.isSome
                          );

                        // Type guard for NestedFieldConfig
                        const isNestedFieldConfig = (
                          nestedCfg: unknown
                        ): nestedCfg is NestedFieldConfig =>
                          Option.fromNullable(nestedCfg).pipe(
                            Option.filter((cfg): cfg is NestedFieldConfig =>
                              typeof cfg === 'object' && Object.prototype.hasOwnProperty.call(cfg, 'selector')
                            ),
                            Option.isSome
                          );

                        // Type guard to check if a cheerio node is a DOM Element
                        const isDomElement = (node: AnyNode): node is DomElement =>
                          node.type === 'tag' || node.type === 'script' || node.type === 'style';

                        for (const [fieldName, fieldConfig] of Object.entries(
                          extractDataConfig
                        )) {
                          if (typeof fieldConfig === 'string') {
                            // Simple selector - extract text
                            const text = $(fieldConfig).text().trim();
                            // Store empty string as Option.none, non-empty as Option.some (unwrapped for result)
                            result[fieldName] = Option.fromNullable(text.length > 0 ? text : Option.none<string>().pipe(Option.getOrUndefined)).pipe(Option.getOrUndefined);
                          } else if (isFieldExtractionConfig(fieldConfig)) {
                            // FieldExtractionConfig object - no type assertion needed
                            const {
                              selector,
                              attribute,
                              multiple,
                              exists,
                              fields,
                            } = fieldConfig;

                            if (exists) {
                              result[fieldName] = $(selector).length > 0;
                            } else if (multiple) {
                              const elements = $(selector);
                              let valuesChunk = Chunk.empty<unknown>();
                              elements.each((_index, el) => {
                                if (!isDomElement(el)) return;
                                const $el = $(el);
                                if (fields) {
                                  // Handle nested fields extraction
                                  const nestedResult: Record<string, unknown> = {};
                                  for (const [
                                    nestedName,
                                    nestedConfig,
                                  ] of Object.entries(fields)) {
                                    if (isNestedFieldConfig(nestedConfig)) {
                                      const $nested = $el.find(nestedConfig.selector);
                                      if (nestedConfig.attribute) {
                                        nestedResult[nestedName] = $nested.attr(
                                          nestedConfig.attribute
                                        );
                                      } else {
                                        nestedResult[nestedName] = $nested
                                          .text()
                                          .trim();
                                      }
                                    }
                                  }
                                  valuesChunk = Chunk.append(valuesChunk, nestedResult);
                                } else if (attribute) {
                                  valuesChunk = Chunk.append(valuesChunk, $el.attr(attribute));
                                } else {
                                  valuesChunk = Chunk.append(valuesChunk, $el.text().trim());
                                }
                              });
                              const values = Chunk.toArray(valuesChunk);
                              // Store empty array as Option.none, non-empty as Option.some (unwrapped for result)
                              result[fieldName] = Option.fromNullable(values.length > 0 ? values : Option.none<unknown[]>().pipe(Option.getOrUndefined)).pipe(Option.getOrUndefined);
                            } else {
                              const $el = $(selector);
                              if (attribute) {
                                result[fieldName] = $el.attr(attribute);
                              } else {
                                const text = $el.text().trim();
                                // Store empty string as Option.none, non-empty as Option.some (unwrapped for result)
                                result[fieldName] = Option.fromNullable(text.length > 0 ? text : Option.none<string>().pipe(Option.getOrUndefined)).pipe(Option.getOrUndefined);
                              }
                            }
                          }
                        }

                        return result;
                      });

                      // Create a new PageData object with extractedData
                      pageDataWithExtraction = {
                        ...actualPageData,
                        extractedData,
                      };
                    }

                    // Get current page count for logging
                    const currentPageCount = yield* localDeduplicator.size();

                    // Log successful fetch completion
                    yield* Effect.logDebug('fetch completed').pipe(
                      Effect.annotateLogs({
                        event: 'fetch_success',
                        domain,
                        workerId,
                        url: task.url,
                        durationMs: fetchDuration,
                      })
                    );

                    // Emit page scraped event
                    yield* events.emit(
                      new PageScrapedEvent({
                        url: task.url,
                        domain,
                        pageNumber: currentPageCount,
                      })
                    );

                    // Publish result
                    MutableRef.update(pagesAttempted, (n) => n + 1);
                    const crawlTimestamp = yield* DateTime.now;
                    yield* Queue.offer(
                      resultChannel,
                      new CrawlResultOk({
                        pageData: pageDataWithExtraction,
                        depth: task.depth,
                        timestamp: DateTime.toDateUtc(crawlTimestamp),
                        metadata: task.metadata,
                      })
                    );

                    // Queue new URLs if not at max depth
                    const maxDepth = yield* config.getMaxDepth();

                    if (!maxDepth || task.depth < maxDepth) {
                      let linksToProcess: string[] = [];

                      // Extract links using LinkExtractorService if available
                      const extractionResult = linkExtractor
                        ? yield* (() => {
                            const extractorConfig =
                              options?.linkExtractorConfig ?? {};
                            return (
                              linkExtractor
                                // NOTE: We use the service interface (.extractLinks) rather than the pure function
                                // (extractRawLinks) to allow for dependency injection and alternative implementations.
                                // The service wraps the pure function with Effect error handling and enables
                                // testing with mock implementations or enhanced extractors with different capabilities.
                                .extractLinks(pageDataWithExtraction.html, extractorConfig)
                                .pipe(
                                  Effect.catchAll(() =>
                                    Effect.succeed({
                                      links: [],
                                      totalElementsProcessed: 0,
                                      extractionBreakdown: {},
                                    })
                                  )
                                )
                            );
                          })()
                        : {
                            links: [],
                            totalElementsProcessed: 0,
                            extractionBreakdown: {},
                          };

                      // Resolve raw URLs to absolute URLs using Effect error handling
                      const resolvedLinks = yield* Effect.forEach(
                        extractionResult.links,
                        (url) =>
                          Effect.try({
                            try: () => new URL(url, pageDataWithExtraction.url).toString(),
                            catch: () => Option.none<string>()
                          }).pipe(
                            Effect.map(Option.some),
                            Effect.catchAll(() => Effect.succeed(Option.none<string>()))
                          ),
                        { concurrency: 'unbounded' }
                      );
                      linksToProcess = resolvedLinks
                        .filter(Option.isSome)
                        .map((opt) => opt.value);

                      // Note: These counters could be used for debugging/metrics in the future
                      // Statistics tracking would go here

                      for (const link of linksToProcess) {
                        // Use config to validate each link first
                        const linkRestrictOption = restrictToStartingDomain
                          ? Option.some(MutableRef.get(effectiveStartUrl))
                          : Option.none<string>();
                        const linkShouldFollow = yield* config.shouldFollowUrl(
                          link,
                          task.url,
                          Option.getOrUndefined(linkRestrictOption)
                        );
                        if (!linkShouldFollow.follow) {
                          // URL filtered by robots.txt
                          continue;
                        }

                        // Check if we've already seen this URL (but don't mark as seen yet)
                        const alreadySeen =
                          yield* localDeduplicator.contains(link);
                        if (!alreadySeen) {
                          yield* queueManager.addTask({
                            url: link,
                            depth: task.depth + 1,
                            fromUrl: task.url,
                            metadata: task.metadata,
                          });
                          // Log queue state after adding URL
                          const newQueueSize = yield* queueManager.size();
                          if (newQueueSize % 10 === 0 || newQueueSize <= 5) {
                            yield* Effect.logDebug(
                              `queue: url added: ${link}`
                            ).pipe(
                              Effect.annotateLogs({
                                event: 'queue_status',
                                domain,
                                workerId,
                                queueSize: newQueueSize,
                                addedUrl: link,
                                fromUrl: task.url,
                              })
                            );
                          }
                        }
                      }
                    }
                  }

                  // Mark worker as idle (finished processing this task)
                  const newIdleCount = yield* queueManager.markIdle();
                  yield* Effect.logDebug('worker task_completed').pipe(
                    Effect.annotateLogs({
                      workerId,
                      domain,
                      taskUrl: task.url,
                      activeWorkers: newIdleCount,
                      pageProcessed: Option.isSome(maybeFetchResult),
                    })
                  );

                  // Check if we've reached max pages for this domain (atomic check)
                  const maxPages = yield* config.getMaxPages();
                  if (maxPages) {
                    const currentPageCount = yield* localDeduplicator.size();
                    if (currentPageCount >= maxPages) {
                      // Atomically check and set maxPagesReached to prevent multiple workers from logging completion
                      const wasFirstToReachMax = MutableRef.compareAndSet(
                        maxPagesReached,
                        false,
                        true
                      );
                      if (wasFirstToReachMax) {
                        // Only the first worker to reach max pages logs completion
                        yield* events.emit(
                          new PageScrapedEvent({
                            url: task.url,
                            domain,
                            pageNumber: currentPageCount,
                          })
                        );
                        yield* Effect.logInfo(
                          `domain ${domain} reached max pages limit: ${currentPageCount}`
                        ).pipe(
                          Effect.annotateLogs({
                            event: 'domain_max_pages_reached',
                            domain,
                            currentPageCount,
                            maxPages,
                          })
                        );
                      }
                      yield* Effect.logDebug('worker exiting_loop').pipe(
                        Effect.annotateLogs({
                          workerId,
                          domain,
                          reason: 'max_pages_reached',
                          currentPageCount,
                          maxPages,
                        })
                      );
                      // In interrupt mode, resolve the stop signal so
                      // peer workers abandon their in-flight fetches.
                      if (stopMode.kind === 'interrupt') {
                        MutableRef.set(domainStopReason, Option.some('max_pages'));
                        yield* Deferred.complete(domainStopSignal, Effect.void).pipe(
                          Effect.ignore
                        );
                      }
                      break;
                    }
                  }

                  // Log queue status periodically
                  const pageCount = yield* localDeduplicator.size();
                  if (pageCount % 10 === 0) {
                    const queueSize = yield* queueManager.size();
                    const activeCount = MutableRef.get(activeWorkers);
                    const maxWorkers = yield* config.getMaxConcurrentWorkers();

                    // Log detailed domain status
                    yield* Effect.logDebug('domain status').pipe(
                      Effect.annotateLogs({
                        event: 'domain_status',
                        domain,
                        pagesScraped: pageCount,
                        queueSize,
                        activeWorkers: activeCount,
                        maxWorkers,
                      })
                    );
                  }
                }

                // Log worker lifecycle: exiting main loop (normal exit)
                yield* Effect.logDebug('worker exiting_loop').pipe(
                  Effect.annotateLogs({
                    workerId,
                    domain,
                    reason: 'normal_completion',
                  })
                );
              }).pipe(
                // Emit WorkerInterruptedEvent when this fiber is interrupted
                // by a stop signal (interrupt mode only).
                Effect.onInterrupt(() =>
                  events.emit(new WorkerInterruptedEvent({
                    workerId,
                    domain,
                    url: MutableRef.get(currentTaskUrl),
                    reason: Option.getOrElse(MutableRef.get(domainStopReason), () => 'interrupted'),
                  })).pipe(Effect.ignore)
                ),
                // Ensure this runs even if the worker is interrupted/crashes
                Effect.ensuring(
                  Effect.logDebug('worker exiting_loop').pipe(
                    Effect.annotateLogs({
                      workerId,
                      domain,
                      reason: 'effect_ensuring_cleanup',
                    })
                  )
                ),
                // Add catchAll to handle any unhandled errors
                Effect.catchAll((error) =>
                  Effect.gen(function* () {
                    yield* Effect.logError(
                      `worker ${workerId} crashed: ${error}`
                    ).pipe(
                      Effect.annotateLogs({
                        event: 'worker_crash',
                        domain,
                        workerId,
                        error: String(error),
                      })
                    );

                    // Mark worker as exited due to error
                    yield* Effect.logDebug('worker exiting_loop').pipe(
                      Effect.annotateLogs({
                        workerId,
                        domain,
                        reason: 'error_exit',
                      })
                    );

                    // Re-throw to maintain error semantics
                  })
                )
              );

            // Queue the initial URL
            yield* queueManager.addTask({
              url: urlString,
              depth: 0,
              metadata: initialMetadata,
              extractData: options?.extractData,
            });
            yield* Effect.logDebug(`initial url queued: ${urlString}`).pipe(
              Effect.annotateLogs({
                event: 'queue_status',
                domain,
                queueSize: 1,
                initialUrl: urlString,
              })
            );

            // Start workers with unique IDs using Chunk for immutable collection
            const maxWorkers = yield* config.getMaxConcurrentWorkers();
            let workerFibersChunk = Chunk.empty<Fiber.RuntimeFiber<void, unknown>>();
            for (let i = 0; i < maxWorkers; i++) {
              const workerId = yield* generateWorkerId();

              // Log worker lifecycle: creation
              yield* Effect.logDebug('worker created').pipe(
                Effect.annotateLogs({
                  workerId,
                  domain,
                  workerIndex: i,
                  totalWorkers: maxWorkers,
                })
              );

              // Workers start idle, they'll mark themselves active when processing tasks
              const fiber = yield* Effect.fork(worker(workerId));
              workerFibersChunk = Chunk.append(workerFibersChunk, fiber);
            }
            const workerFibers = Chunk.toArray(workerFibersChunk);

            // Grace period enforcer: when stopMode === 'interrupt' and the stop
            // signal fires, interrupt all worker fibers then wait gracePeriodMs.
            // If DomainCompleteEvent has not been emitted by then, force-emit it
            // with reason 'interrupt_grace_exceeded' as a belt-and-braces cap.
            if (stopMode.kind === 'interrupt') {
              yield* Effect.fork(Effect.gen(function* () {
                yield* Deferred.await(domainStopSignal);
                const stopTime = yield* DateTime.now;

                // Interrupt workers that are still running
                yield* Fiber.interruptAll(workerFibers).pipe(Effect.ignore);

                // Wait gracePeriodMs for clean exit
                yield* Effect.sleep(Duration.millis(stopMode.gracePeriodMs));

                const wasFirst = MutableRef.compareAndSet(domainCompleteEmitted, false, true);
                if (wasFirst) {
                  const finalCount = yield* localDeduplicator.size();
                  const now = yield* DateTime.now;
                  const gracefulMs = DateTime.toEpochMillis(now) - DateTime.toEpochMillis(stopTime);
                  const failedMap = MutableRef.get(pagesFailed);
                  MutableRef.set(
                    completionSummary,
                    Option.some({
                      reason: 'interrupt_grace_exceeded' as const,
                      pagesAttempted: MutableRef.get(pagesAttempted),
                    })
                  );
                  yield* events.emit(new DomainCompleteEvent({
                    domain,
                    startUrl: urlString,
                    finalStartUrl: MutableRef.get(effectiveStartUrl),
                    pagesScraped: finalCount,
                    pagesAttempted: MutableRef.get(pagesAttempted),
                    pagesFailed: Array.from(HashMap.entries(failedMap)).map(([kind, count]) => ({ kind, count })),
                    reason: 'interrupt_grace_exceeded',
                    durationMs: DateTime.toEpochMillis(now) - domainStartMs,
                    cycle,
                  }));
                  yield* events.emit(new DomainStoppedEvent({
                    domain,
                    reason: Option.getOrElse(MutableRef.get(domainStopReason), () => 'interrupted'),
                    gracefulMs,
                    forced: true,
                  }));
                }
              }).pipe(Effect.ignore));
            }

            // Start worker health monitoring
            const healthMonitorFiber = yield* Effect.fork(workerHealthMonitor);

            // Domain failure detection - mark domains as failed if they get stuck
            const failureDetector = Effect.gen(function* () {
              let lastPageCount = 0;
              let stuckIterations = 0;

              while (!MutableRef.get(domainCompleted)) {
                yield* Effect.sleep(SPIDER_DEFAULTS.FAILURE_DETECTOR_INTERVAL);

                const pageCount = yield* localDeduplicator.size();
                const queueSize = yield* queueManager.size();
                const activeCount = MutableRef.get(activeWorkers);

                // Check for various stuck states
                const hasQueueItems = queueSize > 0;
                const hasNoActiveWorkers = activeCount === 0;
                const hasNegativeQueue = queueSize < 0;
                const noProgressMade = pageCount === lastPageCount;

                if (hasNegativeQueue) {
                  yield* Effect.logWarning('negative queue size').pipe(
                    Effect.annotateLogs({
                      event: 'negative_queue_detected',
                      domain,
                      queueSize,
                      activeWorkers: activeCount,
                      pageCount,
                    })
                  );
                }

                // Critical failure states that require intervention
                const criticalFailures = [
                  hasNoActiveWorkers && hasQueueItems && pageCount > 0, // 0 workers with queue items
                  hasNegativeQueue, // Invalid queue state
                  activeCount === 0 && pageCount <= 1 && stuckIterations >= 2, // Completely stuck
                ];

                if (criticalFailures.some(Boolean)) {
                  const reason =
                    hasNoActiveWorkers && hasQueueItems
                      ? 'no_workers_with_queue_items'
                      : hasNegativeQueue
                        ? 'negative_queue_size'
                        : 'no_progress_for_60s';

                  yield* Effect.logError('critical failure detected').pipe(
                    Effect.annotateLogs({
                      event: 'critical_failure_detected',
                      domain,
                      timeElapsedSeconds: (stuckIterations + 1) * 30,
                      pageCount,
                      queueSize,
                      activeWorkers: activeCount,
                      reason,
                    })
                  );

                  // Mark domain as completed (loop-exit signal) AND claim
                  // the one-shot emission slot. Two separate refs so the
                  // worker-loop signal can fire many times without
                  // suppressing the event.
                  MutableRef.compareAndSet(domainCompleted, false, true);
                  const wasFirstToEmit = MutableRef.compareAndSet(
                    domainCompleteEmitted,
                    false,
                    true
                  );
                  if (wasFirstToEmit) {
                    const failedMap = MutableRef.get(pagesFailed);
                    const pagesFailedArray = Array.from(HashMap.entries(failedMap)).map(([kind, count]) => ({ kind, count }));
                    const completeTime = yield* DateTime.now;
                    MutableRef.set(
                      completionSummary,
                      Option.some({
                        reason: 'error' as const,
                        pagesAttempted: MutableRef.get(pagesAttempted),
                      })
                    );
                    yield* events.emit(
                      new DomainCompleteEvent({
                        domain,
                        startUrl: urlString,
                        finalStartUrl: MutableRef.get(effectiveStartUrl),
                        pagesScraped: pageCount,
                        pagesAttempted: MutableRef.get(pagesAttempted),
                        pagesFailed: pagesFailedArray,
                        reason: 'error',
                        durationMs:
                          DateTime.toEpochMillis(completeTime) - domainStartMs,
                        cycle,
                      })
                    );
                  }
                  break;
                }

                // Track progress to detect stalled domains
                if (noProgressMade) {
                  stuckIterations++;
                } else {
                  stuckIterations = 0;
                  lastPageCount = pageCount;
                }
              }
            });

            const failureDetectorFiber = yield* Effect.fork(failureDetector);

            // Wait for all workers to complete. In interrupt mode workers may
            // be interrupted by the grace period enforcer; Effect.ignore only
            // catches typed errors, so we use catchAllCause which also absorbs
            // interruptions. In drain mode workers exit cleanly so this is a no-op.
            yield* Effect.all(
              workerFibers.map((f) =>
                Fiber.join(f).pipe(Effect.catchAllCause(() => Effect.void))
              ),
              { concurrency: 'unbounded' }
            );

            // Clean up failure detector and health monitor
            yield* Fiber.interrupt(failureDetectorFiber).pipe(Effect.ignore);
            yield* Fiber.interrupt(healthMonitorFiber).pipe(Effect.ignore);

            // Shut down the queue to signal workers to exit
            yield* Effect.logDebug(
              'shutting down queue for domain completion'
            ).pipe(
              Effect.annotateLogs({
                event: 'queue_status',
                domain,
                finalQueueSize: yield* queueManager.size(),
              })
            );
            // Log final page count
            const finalPageCount = yield* localDeduplicator.size();
            const maxPages = yield* config.getMaxPages();
            const totalAttempts = MutableRef.get(pagesAttempted);
            const robotsBlocked = MutableRef.get(robotsBlockedCount);
            const failedCountMap = MutableRef.get(pagesFailed);
            const totalFailed = Array.from(HashMap.values(failedCountMap)).reduce((a, b) => a + b, 0);
            const stopReasonValue = MutableRef.get(domainStopReason);
            const completionReason: DomainCompleteEvent['reason'] =
              Option.isSome(stopReasonValue) && stopMode.kind === 'interrupt'
                ? 'interrupted'
                : maxPages && finalPageCount >= maxPages
                  ? 'max_pages'
                  : totalAttempts === 0 && robotsBlocked > 0
                    ? 'robots_blocked'
                    : totalAttempts > 0 && totalFailed === totalAttempts
                      ? 'all_fetches_failed'
                      : 'queue_empty';
            const pagesFailedArray = Array.from(HashMap.entries(failedCountMap)).map(([kind, count]) => ({ kind, count }));
            // Gate emission on the dedicated `domainCompleteEmitted` ref
            // (NOT `domainCompleted`, which workers flip for loop-exit).
            // Failure-detector path and grace-period enforcer use the same CAS
            // so only one DomainCompleteEvent fires per crawlSingle invocation.
            const wasFirstToEmit = MutableRef.compareAndSet(
              domainCompleteEmitted,
              false,
              true
            );
            if (wasFirstToEmit) {
              const completeTime = yield* DateTime.now;
              MutableRef.set(
                completionSummary,
                Option.some({
                  reason: completionReason,
                  pagesAttempted: totalAttempts,
                })
              );
              yield* events.emit(
                new DomainCompleteEvent({
                  domain,
                  startUrl: urlString,
                  finalStartUrl: MutableRef.get(effectiveStartUrl),
                  pagesScraped: finalPageCount,
                  pagesAttempted: totalAttempts,
                  pagesFailed: pagesFailedArray,
                  reason: completionReason,
                  durationMs:
                    DateTime.toEpochMillis(completeTime) - domainStartMs,
                  cycle,
                })
              );
              // Emit DomainStoppedEvent when domain was cleanly interrupted
              // (i.e. workers exited within the grace period).
              if (completionReason === 'interrupted') {
                yield* events.emit(new DomainStoppedEvent({
                  domain,
                  reason: Option.getOrElse(stopReasonValue, () => 'interrupted'),
                  gracefulMs: DateTime.toEpochMillis(completeTime) - domainStartMs,
                  forced: false,
                }));
              }
            }

            return {
              completed: true,
              pagesScraped: finalPageCount,
              domain,
              // Snapshot of the DomainCompleteEvent that was actually emitted
              // (Option.none when the fiber unwound before any emission site
              // fired). Consumed by the multi-pass retry loop in `crawl()`.
              completionSummary: MutableRef.get(completionSummary),
            };
          }),

        /**
         * Resume a previous crawling session from persistent storage.
         *
         * This method requires resumability to be enabled in the SpiderConfig and
         * a StatePersistence implementation to be configured. It will restore the
         * crawling state and continue processing from where it left off.
         *
         * @param stateKey - The unique identifier for the session to resume
         * @param sink - Sink to process crawl results as they're produced
         * @param persistence - Optional persistence implementation (uses configured one if not provided)
         * @returns Effect containing crawl statistics
         *
         * @example
         * ```typescript
         * const stateKey = new SpiderStateKey({
         *   id: 'my-crawl-session',
         *   timestamp: new Date('2024-01-01'),
         *   name: 'Example Crawl'
         * });
         *
         * const collectSink = Sink.forEach<CrawlResult>(result =>
         *   Effect.sync(() => console.log(`Resumed: ${result.pageData.title}`))
         * );
         *
         * const stats = yield* spider.resume(stateKey, collectSink);
         * ```
         */
        resume: <A, E, R>(
          stateKey: import('../Scheduler/SpiderScheduler.service.js').SpiderStateKey,
          resumeSink: Sink.Sink<A, CrawlResult, E, R>,
          _persistence?: import('../Scheduler/SpiderScheduler.service.js').StatePersistence
        ) =>
          Effect.gen(function* () {
            const config = yield* SpiderConfig;

            if (!config) {
              return yield* Effect.fail(
                new ConfigError({
                  field: 'SpiderConfig',
                  reason: 'SpiderConfig is required for resumability operations'
                })
              );
            }

            const resumabilityEnabled = yield* config.isResumabilityEnabled();
            if (!resumabilityEnabled) {
              return yield* Effect.fail(
                new ConfigError({
                  field: 'enableResumability',
                  reason: 'Resume functionality requires resumability to be enabled in SpiderConfig. ' +
                    'Set enableResumability: true in your spider configuration.'
                })
              );
            }

            // Implement resume logic using Effect patterns
            const resumeScheduler = yield* SpiderSchedulerService;

            const startTime = yield* DateTime.now;
            yield* events.emit(
              new SpiderStartEvent({
                details: {
                  sessionId: stateKey.id,
                  timestamp: DateTime.formatIso(startTime),
                },
              })
            );

            // Load the saved state using Effect patterns
            const savedStateOption = yield* Effect.gen(function* () {
              // Note: In a full implementation, this would use ResumabilityService
              // For now, we'll use the scheduler's state management
              if (resumeScheduler.getState) {
                const state = yield* resumeScheduler.getState();
                return Option.fromNullable(state);
              }
              return Option.none<unknown>();
            }).pipe(
              Effect.catchAll((error) =>
                Effect.fail(new StateError({
                  operation: 'load',
                  stateKey: stateKey.id,
                  cause: error
                }))
              )
            );

            if (Option.isNone(savedStateOption)) {
              return yield* Effect.fail(
                new StateError({
                  operation: 'load',
                  stateKey: stateKey.id,
                  cause: 'No saved state found for session'
                })
              );
            }

            const savedState = savedStateOption.value;

            // Restore the crawl state using Chunk for immutable collection building
            // Type guard for state record using Option pattern
            const isStateRecord = (value: unknown): value is Record<string, unknown> =>
              Option.fromNullable(value).pipe(
                Option.filter((v): v is Record<string, unknown> => typeof v === 'object'),
                Option.isSome
              );

            const restoredUrls = yield* Effect.try({
              try: () => {
                // Extract URLs from saved state
                let urlsChunk = Chunk.empty<string>();
                if (isStateRecord(savedState)) {
                  // Extract pending URLs from state
                  if ('pendingUrls' in savedState && Array.isArray(savedState.pendingUrls)) {
                    for (const url of savedState.pendingUrls) {
                      if (typeof url === 'string') {
                        urlsChunk = Chunk.append(urlsChunk, url);
                      }
                    }
                  }
                  // Extract visited URLs to avoid re-crawling
                  // These would be marked as already processed
                }
                return Chunk.toArray(urlsChunk);
              },
              catch: (error) => new ParseError({
                input: 'saved state',
                expected: 'crawl state',
                cause: error
              })
            });

            const loadTime = yield* DateTime.now;
            yield* events.emit(
              new SpiderStartEvent({
                details: {
                  sessionId: stateKey.id,
                  pendingUrls: restoredUrls.length,
                  timestamp: DateTime.formatIso(loadTime),
                },
              })
            );

            // Resume crawling with restored URLs
            if (restoredUrls.length > 0) {
              // Use the crawl method with restored URLs
              const crawlResult = yield* self.crawl(
                restoredUrls,
                resumeSink,
                {}
              );

              const completeTime = yield* DateTime.now;
              yield* events.emit(
                new SpiderCompleteEvent({
                  details: {
                    sessionId: stateKey.id,
                    urlsProcessed: restoredUrls.length,
                    timestamp: DateTime.formatIso(completeTime),
                  },
                })
              );

              return {
                ...crawlResult,
                resumed: true,
                sessionId: stateKey.id
              };
            }

            return {
              completed: true,
              resumed: true,
              sessionId: stateKey.id,
              urlsProcessed: 0
            };
          }),

      };

      return self;
    }),
    dependencies: [
      RobotsService.Default,
      ScraperService.Default,
      UrlDeduplicatorService.Default,
      SpiderConfig.Default,
      LinkExtractorService.Default,
    ],
  }
) {}

export type {
  CrawlResultOk,
  CrawlResultError,
  CrawlTask,
  DataExtractionConfig,
  DataExtractionFieldConfig,
  FieldExtractionConfig,
  NestedFieldConfig,
};
export { CrawlResult };
