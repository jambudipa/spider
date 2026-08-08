# @jambudipa/spider

## 0.15.0

### Minor Changes

- Robots oracle distinguishes "no rules published" from "rules unknown", and adds interaction-driven discovery.

  **Robots (behaviour change).** `RobotsService.checkUrl` previously allowed a URL
  whenever `/robots.txt` could not be read, for any reason. It now separates the
  two facts:
  - HTTP 404/410 — the origin published no rules — **allowed**
  - 5xx, timeout, connection failure, or a body over 512 KiB — nothing is known —
    **refused**

  Every verdict now carries a `reason` (`no-rules-published`, `allowed-by-rule`,
  `disallowed-by-rule`, `robots-unavailable`) and `RobotsBlockedEvent` carries it
  too, so a transport failure no longer reads like the target disallowed you. Set
  `ignoreRobotsTxt: true` if an origin you control cannot serve `/robots.txt`
  reliably.

  Parsing is also corrected: `Allow` is honoured (it was previously ignored
  entirely), rules resolve by longest-match precedence with `Allow` winning an
  equal-length tie, the end-anchor wildcard is supported, patterns match against
  path _and_ query, consecutive `User-agent` lines form one group, inline
  comments are stripped, and robots is fetched with `credentials: 'omit'`.

  **New: `InteractionDiscoveryService`.** A second extraction source alongside
  `LinkExtractorService`. Where the link extractor reads identities out of
  delivered markup, this one drives declared in-place controls — tabs,
  disclosures, lightboxes, players — with a network ledger attached, and returns
  the requests that resulted, each naming the control that revealed it by stable
  id and human-readable label. Requests seen outside a control's window stay
  unattributed. It refuses rather than passing vacuously, with distinct errors for
  "no controls declared", "no control could be driven", "drove controls and
  revealed nothing", and "a control navigated away".

  **Fixed: `BrowserEngineWithConfig` ignored its argument** and always returned the
  default layer, so `{ headless: false }` silently gave you a headless browser. It
  now builds an engine bound to the supplied config. `makeBrowserEngine` and
  `DEFAULT_BROWSER_ENGINE_CONFIG` are exported for direct use.

## 0.14.0

### Minor Changes

- Add `domainRetry` config for in-cycle re-attempt of domains that exhaust on
  transient failures (cold TLS, DNS pressure, burst load).

  When enabled, `Spider.crawl()` runs the start-URL list as a multi-pass loop:
  pass 0 is the existing behaviour, residual domains matching `retryOn` are
  re-run after `backoffMs`. All passes share the same undici connection pool
  (process-global), robots cache, result channel, and event sink — sockets
  warmed during pass 0 are reused on pass 1. The URL deduplicator is per-pass
  by design, so pass 1 actually re-attempts the start URL that pass 0 failed.

  Default behaviour is preserved: omitting `domainRetry` (or setting
  `enabled: false`) keeps the pre-feature one-pass behaviour.

  Public surface (all additive):
  - `DomainRetryConfig`, `DomainRetryPredicate`, `DomainRetryPassOverrides`,
    `DomainCompleteReason` config types and `defaultDomainRetry` constant.
  - `SpiderConfigOptions.domainRetry?: DomainRetryConfig` field.
  - `SpiderConfigService.getDomainRetry()` getter.
  - Additive `cycle: number` field on `DomainCompleteEvent` — `0` for the
    initial pass, incremented for each retry pass. Defaults to `0` so
    existing consumers see no shape change.
  - New `DomainRetryScheduledEvent` tagged class emitted once per residual
    domain before each retry pass (lifecycle observability).

  Fixed: `SpiderCompleteEvent.details.totalDomains` now reflects the number of
  unique start URLs the consumer asked for, not the multi-pass result-row
  count. Default-disabled `domainRetry` keeps the prior value bit-identical.

  Validation: `makeSpiderConfig` now rejects, at construction:
  - `domainRetry.maxPasses < 1` or non-integer `maxPasses`
  - `domainRetry.enabled: true` paired with `maxPasses < 2` (silent no-op)
  - negative or non-finite `domainRetry.backoffMs`
  - empty `domainRetry.retryOn.reasons`
  - NaN or negative `domainRetry.retryOn.maxPagesAttempted` (`Infinity` is permitted)
  - `domainRetry.passOverrides.fetchRetry.maxAttempts < 1`
  - negative or non-finite `domainRetry.passOverrides.fetchRetry.baseBackoffMs`

## 0.13.1

### Patch Changes

- Suppress `TypeError: terminated` from undici's `Fetch.onAborted` during
  the abort-vs-TLS-socket-close race. The exception was emitted via an
  EventEmitter rather than a Promise rejection, so the adapter's
  `Effect.tryPromise` catch never saw it and Node's default
  `uncaughtException` behaviour terminated the process mid-crawl.

  A narrow process-level guard is installed for the lifetime of each
  `SpiderService.crawl` scope (reference-counted across concurrent
  crawls). It matches only TypeErrors whose message is `terminated` AND
  whose stack contains both `Fetch.onAborted` and `Fetch.terminate`
  frames — all other uncaught exceptions retain their normal behaviour
  (other listeners run; Node's default fatal path fires when the guard
  is the sole listener). Each suppression writes a structured
  `undici_terminated_swallowed` JSON line to stderr for observability.

  Upstream context: https://github.com/nodejs/undici/issues/3492

## 0.13.0

### Minor Changes

- Add `resultChannelCapacity: number | 'unbounded'` to `SpiderConfigOptions`
  to bound the worker → sink result channel.

  Default is `'unbounded'` for back-compat. Set a positive integer to use a
  bounded queue, which applies natural backpressure (workers suspend on
  `Queue.offer` when full) and keeps heap growth flat under slow sinks. Fixes
  unbounded heap growth observed when sinks do real I/O on long crawls with
  large HTML payloads. See `docs/how-to/backpressure.md` for guidance.

## 0.12.0

### Minor Changes

- Worker heartbeat refresh during long fetches.
  - New `staleWorkerThresholdMs` config option overrides the worker-health
    staleness threshold. Default raised from 60 s to 300 s to match the
    documented worst case of the default `fetchRetry` policy. Validated
    with an upper bound of 2_147_483_647 ms.
  - New `staleWorkerCheckIntervalMs` config option overrides the monitor
    scan interval (default 15_000 ms).
  - New `workerHeartbeatMode: 'per-iteration' | 'per-attempt'` config
    option. `'per-attempt'` refreshes the heartbeat on each retry decision
    via `Schedule.tapInput`, so slow adapters (got-scraping, sidecars)
    with long retry chains aren't flagged as dead workers mid-fetch.
    Default `'per-iteration'` preserves v0.11 behaviour byte-for-byte.
  - `buildFetchRetrySchedule` gains an optional second parameter
    `onAttempt?: Effect.Effect<unknown, never>` exposing the per-retry
    hook for downstream callers.
  - The standalone `WorkerHealthMonitor` service's internal threshold is
    now sourced from `SPIDER_DEFAULTS.STALE_WORKER_THRESHOLD_MS` so the
    two heartbeat surfaces share one default. New
    `WorkerHealthMonitor.WithThreshold(ms)` layer factory lets consumers
    construct the service with a custom threshold without forking.
  - `reportWorkerHealth` switched from `MutableRef` to `Ref` for atomic
    read-modify-write under concurrent worker heartbeats. The monitor's
    stale-worker removal path now re-checks each candidate against a
    fresh map read before removal (closes the heartbeat-vs-removal race)
    and guards against negative elapsed time (clock-rewind under NTP
    step or suspend/resume).

## 0.11.0

### Minor Changes

- Added pluggable `HttpAdapter` slot for `ScraperService`.
  - New optional `httpAdapter?: HttpAdapter | HttpAdapterSelector` on `SpiderConfigOptions`. Provide a single adapter applied to every page fetch, or a per-request selector function (e.g. route a small set of anti-bot domains to a TLS-impersonating adapter while the bulk of the crawl stays on undici). Pure addition — when undefined, behaviour matches v0.10 exactly via the new exported `defaultUndiciAdapter`.
  - Effect-native contract: `fetch(request) => Effect<HttpAdapterResponse, HttpAdapterError>`. The Effect must be cancellable so `stopMode: 'interrupt'` propagates; promise-based adapters should use `Effect.tryPromise` so the auto-injected `AbortSignal` reaches the underlying request.
  - `HttpAdapterError.kind` is drawn from the existing `PageFetchErrorKind` union (`timeout | dns | http_4xx | http_429 | http_5xx | connection_refused | other`) so `fetchRetry.retryOn` configuration keys work unchanged for both default and custom adapters.
  - The adapter owns timeout enforcement via `request.timeoutMs`; the spider no longer layers an additional `Effect.timeout` on top of adapter calls. The removed wrapper was redundant with the adapter's own timeout and contradicted the contract.
  - `defaultUndiciAdapter` preserves `Set-Cookie` multi-value semantics correctly via `Headers.getSetCookie()` (Node 20+), joining recovered entries with `\n`. This is a strict improvement over v0.10, where repeated `Set-Cookie` headers were silently overwritten by `Headers.forEach` leaving only the last value in `PageData.headers`.
  - A selector function that throws synchronously OR returns a non-adapter value fails the single fetch with `kind: 'other'` rather than crashing the worker fiber.
  - User-Agent precedence: caller-supplied `User-Agent` in `request.headers` is ignored by `defaultUndiciAdapter` — the spider's resolved `userAgent` (from `userAgentStrategy`) always wins.
  - New exports: `HttpAdapter`, `HttpAdapterRequest`, `HttpAdapterResponse`, `HttpAdapterError`, `HttpAdapterSelector`, `defaultUndiciAdapter`.

## 0.10.0

### Minor Changes

- Added `stopMode` config option (`'drain' | 'interrupt' | { kind: 'interrupt'; gracePeriodMs?: number }`). Default `'drain'` preserves existing behaviour. `'interrupt'` cancels in-flight fetches and exits within `gracePeriodMs` (default 5 000 ms) when a stop condition fires.
- Added `externalStopSignal?: Deferred.Deferred<void, never>` to `SpiderLinkExtractionOptions`. Pass a `Deferred` to `crawl()` to abort a running crawl programmatically; only takes effect when `stopMode: 'interrupt'`.
- Added three new `SpiderEvent` types (v0.10+):
  - `WorkerInterruptedEvent` — emitted per interrupted worker fiber (`workerId`, `domain`, `url`, `reason`)
  - `DomainStoppedEvent` — emitted per domain stopped by an interrupt signal (`domain`, `reason`, `gracefulMs`, `forced`)
  - `SpiderStoppedEvent` — emitted when an external abort signal resolves (`reason`, `totalDomains`, `totalPages`, `wallclockMs`)
- `DomainCompleteEvent.reason` now includes `'interrupted'` and `'interrupt_grace_exceeded'` variants.
- New exports: `StopMode`, `ResolvedStopMode`, `WorkerInterruptedEvent`, `DomainStoppedEvent`, `SpiderStoppedEvent`.

## 0.9.0

### Minor Changes

- **BREAKING**: `ScraperService.fetchAndParse` now returns `{ pageData: PageData; finalUrl: string }` instead of `PageData` directly. External callers must destructure the result.
- Added `StartUrlEntry` — `crawl()` now accepts `string | StartUrlEntry | ReadonlyArray<string | StartUrlEntry>`. `StartUrlEntry` supports `{ url, fallbackUrls?, metadata? }`; each candidate is HEAD-probed (5 s timeout) and the first reachable URL is used. `StartUrlChosenEvent` reports the selected URL.
- Added `CrossDomainRedirectConfig` (`enabled`, `maxHops`) via `SpiderConfigOptions.crossDomainRedirects`. When enabled, a depth-0 redirect to a different hostname updates the per-domain crawl restriction and emits `StartUrlRedirectedEvent`.
- Added `UserAgentStrategy` (`static | rotating | custom`) via `SpiderConfigOptions.userAgentStrategy`. The `rotating` variant with `perDomain: true` maintains a sticky user-agent per domain for the duration of a crawl session.
- Added `FileExtensionFilters` and `TechnicalFilters` for granular URL filter control via `SpiderConfigOptions.fileExtensionFilters` and `SpiderConfigOptions.technicalFilters`.
- New exports: `StartUrlEntry`, `FileExtensionFilters`, `TechnicalFilters`, `CrossDomainRedirectConfig`, `UserAgentStrategy`.

## 0.8.0

### Minor Changes

- **BREAKING**: The results channel is now drained by a single serial fibre. Sink handlers are no longer invoked concurrently across domains; any sink that relied on concurrent execution will now run sequentially.
- Added `DomainEquivalenceConfig` (`wwwHandling`, `protocolHandling`, `subdomainHandling`) via `SpiderConfigOptions.domainEquivalence`. Controls how `www.` prefix, HTTP vs HTTPS, and subdomains are treated during URL deduplication.
- Added `FetchRetryConfig` (`maxAttempts`, `baseBackoffMs`, `retryOn: RetryableErrorKind[]`) via `SpiderConfigOptions.fetchRetry`. `makeSpiderConfig` throws `ConfigError` synchronously if `fetchRetry.maxAttempts < 1`.
- New exports: `DomainEquivalenceConfig`, `FetchRetryConfig`, `RetryableErrorKind`, `buildFetchRetrySchedule`, `defaultDomainEquivalence`, `defaultFetchRetry`, `defaultCrossDomainRedirects`.

## 0.7.0

### Minor Changes

- **BREAKING**: `CrawlResult` is now a discriminated union `CrawlResultOk | CrawlResultError`. Sinks that assumed every result carried `.pageData` must add an `isOk` guard: `CrawlResult.isOk(result)` / `CrawlResult.isError(result)`.
- Added `RobotsBlockedEvent` — emitted when `robots.txt` disallows a URL before any fetch attempt is made.
- Changed `DomainCompleteEvent` — now carries `finalStartUrl`, `pagesAttempted`, `pagesFailed` (breakdown by `PageFetchErrorKind`), `reason` (`'queue_empty' | 'max_pages' | 'error' | 'robots_blocked' | 'all_fetches_failed'`), and `durationMs`.
- Added `PageFetchError` — structured error type on `CrawlResultError.error`, with `kind: PageFetchErrorKind`, `durationMs`, `statusCode?`, `message`, `attemptsMade`.
- Added `PageFetchErrorKind` — `'timeout' | 'dns' | 'http_4xx' | 'http_429' | 'http_5xx' | 'connection_refused' | 'other'`.
- New exports: `CrawlResultOk`, `CrawlResultError`, `CrawlResult`, `PageFetchError`, `PageFetchErrorKind`, `RobotsBlockedEvent`.

## 0.6.0

### Minor Changes

- **BREAKING**: `SpiderEvent` members are now `Data.TaggedClass` instances. Consumers that construct event objects directly (e.g. in custom sinks or tests) must use `new EventClass({…})` instead of plain object literals.
- All nine concrete event classes are now exported from the package entry point: `SpiderStartEvent`, `SpiderCompleteEvent`, `SpiderErrorEvent`, `DomainStartEvent`, `DomainCompleteEvent`, `PageScrapedEvent`, `RobotsBlockedEvent`, `StartUrlChosenEvent`, `StartUrlRedirectedEvent`.

## 0.5.0

### Minor Changes

- **BREAKING**: Replace custom `SpiderLogger` service with the idiomatic Effect logging pattern. Two override surfaces, both client-controllable:
  1. **Diagnostic logs** now flow through Effect's standard `Logger` (`Effect.logDebug`/`logInfo`/`logWarning`/`logError` + `Effect.annotateLogs`). Override with `Logger.replace(Logger.defaultLogger, myLogger)`.
  2. **Domain events** (`SpiderStart`, `DomainComplete`, `PageScraped`, etc.) emit through a new `SpiderEventSink` `Context.Tag`. Default `SpiderEventSinkNoop` discards them; provide a custom layer to subscribe.
- Removed: `SpiderLogger`, `SpiderLoggerLive`, `makeSpiderLogger`, `SpiderLogEvent`, `LoggingFetch`, `makeLoggingFetch`, `FetchError`, `LoggingFetchFn`.
- Added: `SpiderEvent`, `SpiderEventSink`, `SpiderEventSinkService`, `SpiderEventSinkNoop`.
- Added example: `src/examples/10-custom-logging.ts` demonstrating both override paths.
- Tests now run headless by default (`HEADLESS=false` to opt out).

## 0.4.0

### Minor Changes

- Export all previously internal modules from package entry point: PostgresStorageBackend, WorkerHealthMonitor, SPIDER_DEFAULTS, FetchLogger, StateManager errors, WebScrapingEngine errors, URL deduplication utilities, and Effect migration utilities

## 0.3.3

### Patch Changes

- Export BrowserEngineService and related types from package entry point

## 0.3.1

### Patch Changes

- Fix deduplicateUrls hanging with scoped layers by replacing unbounded concurrent Effect fibers with sequential plain JS Map deduplication

## 0.3.0

### Minor Changes

- ### Bug Fixes
  - Fix critical URL deduplication crash ("Cannot read private member #context") by eliminating URL object mutations in normalizeUrl across all 4 call sites

  ### Test Suite Overhaul
  - Rewrite all stub test files with real assertions (Spider, Scraper, SpiderMiddleware, PageData, Robots, UrlDeduplicator)
  - Add new utility test suites: UrlUtils (23 tests), JsonUtils (16 tests), RegexUtils (18 tests)
  - Remove 3 dead stub test files (BrowserManager, CSRFTokenLocks, SecretAPIToken)
  - Fix all pre-existing TypeScript type errors across scenario test files

  ### Structural Cleanup
  - Fix Effect layer composition patterns (Layer.mergeAll vs Layer.provide)
  - Fix Effect.Service access patterns in middleware tests
  - Extract Spider operational defaults to Spider.defaults.ts

## 0.2.1

### Patch Changes

- Comprehensive documentation validation and fixes
  - Fixed 39+ documentation issues across all guide files
  - Updated all Effect service usage patterns from `new SpiderService()` to `yield* SpiderService`
  - Converted ResumabilityService and other service patterns to proper Effect.js idioms
  - Added global doc-validation tool for automated documentation checking
  - Resolved syntax errors in API reference and configuration documentation
  - All code examples now follow idiomatic Effect.js patterns

## 0.2.0

### Minor Changes

- Add comprehensive documentation and achieve 100% test pass rate
  - Complete documentation structure with guides, API reference, and examples
  - Achieve 100% success rate on all 16 web-scraping.dev challenge scenarios
  - Add browser automation components (BrowserManager and PlaywrightAdapter)
  - Improve test organization and structure
  - Document all services and components accurately
  - Clarify anti-bot capabilities through configuration and browser automation
