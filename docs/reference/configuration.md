# Configuration Reference

This reference covers all configuration options available in the Spider library.

## SpiderConfigOptions

Main configuration options passed to `makeSpiderConfig()`.

```typescript
interface SpiderConfigOptions {
  // Core
  ignoreRobotsTxt: boolean;
  maxConcurrentWorkers: number;
  concurrency: number | 'unbounded' | 'inherit';
  resultChannelCapacity: number | 'unbounded';
  requestDelayMs: number;
  maxRobotsCrawlDelayMs: number;
  userAgent: string;
  maxDepth?: number;
  maxPages?: number;

  // Domain / URL filters
  allowedDomains?: string[];
  blockedDomains?: string[];
  allowedProtocols: string[];
  followRedirects: boolean;
  respectNoFollow: boolean;
  fileExtensionFilters?: FileExtensionFilters;
  technicalFilters?: TechnicalFilters;
  skipFileExtensions?: string[];
  customUrlFilters?: RegExp[];
  normalizeUrlsForDeduplication: boolean;

  // Performance
  maxConcurrentRequests: number;
  maxRequestsPerSecondPerDomain: number;

  // Resumability
  enableResumability: boolean;

  // Advanced (v0.8+/v0.9+)
  domainEquivalence?: DomainEquivalenceConfig;
  fetchRetry?: FetchRetryConfig;
  crossDomainRedirects?: CrossDomainRedirectConfig;
  userAgentStrategy?: UserAgentStrategy;

  // Stop behaviour (v0.10+)
  stopMode?: StopMode;

  // Pluggable HTTP fetcher (v0.11+)
  httpAdapter?: HttpAdapter | HttpAdapterSelector;

  // Worker heartbeat & long fetches (v0.12+)
  staleWorkerThresholdMs?: number;
  staleWorkerCheckIntervalMs?: number;
  workerHeartbeatMode?: 'per-iteration' | 'per-attempt';
}
```

### Core Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ignoreRobotsTxt` | `boolean` | `false` | Skip robots.txt compliance checks |
| `maxConcurrentWorkers` | `number` | `5` | Worker fibers per domain |
| `concurrency` | `number \| 'unbounded' \| 'inherit'` | `4` | Inter-domain concurrency |
| `requestDelayMs` | `number` | `1000` | Courtesy delay between fetches (ms) |
| `maxRobotsCrawlDelayMs` | `number` | `2000` | Cap on robots.txt `Crawl-delay` (ms) |
| `userAgent` | `string` | `'JambudipaSpider/1.0'` | Default user agent string |
| `maxDepth` | `number` | — | Maximum BFS depth; unlimited if omitted |
| `maxPages` | `number` | — | Hard page cap per domain; unlimited if omitted |
| `followRedirects` | `boolean` | `true` | Follow HTTP redirects |
| `respectNoFollow` | `boolean` | `true` | Honour `rel="nofollow"` link attributes |
| `enableResumability` | `boolean` | `false` | Enable crawl-state persistence |
| `normalizeUrlsForDeduplication` | `boolean` | `true` | Normalise URLs (strip trailing slashes, sort query params, etc.) before dedup |

### Domain and URL Filters

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `allowedDomains` | `string[]` | — | Restrict crawling to these hostnames |
| `blockedDomains` | `string[]` | — | Never crawl these hostnames |
| `allowedProtocols` | `string[]` | `['http:','https:','file:','ftp:']` | Permitted URL schemes |
| `customUrlFilters` | `RegExp[]` | — | URLs matching any pattern are skipped |
| `skipFileExtensions` | `string[]` | — | Explicit extension blocklist (overrides `fileExtensionFilters`) |

### Performance

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxConcurrentRequests` | `number` | `10` | Total concurrent HTTP requests |
| `maxRequestsPerSecondPerDomain` | `number` | `2` | Per-domain rate cap |
| `resultChannelCapacity` | `number \| 'unbounded'` | `'unbounded'` | Buffered `CrawlResult` slots between workers and the sink. Numeric values apply backpressure on workers when the sink lags — see the [backpressure how-to](../how-to/backpressure.md). Validated: positive integer between 1 and 1,000,000. |

---

## FileExtensionFilters

Granular control over which file-extension categories to skip. All categories default to `true` (filtered out).

```typescript
interface FileExtensionFilters {
  filterArchives?: boolean;        // .zip, .tar, .gz, .rar, …
  filterImages?: boolean;          // .jpg, .png, .gif, .svg, …
  filterAudio?: boolean;           // .mp3, .wav, .ogg, …
  filterVideo?: boolean;           // .mp4, .avi, .mov, …
  filterOfficeDocuments?: boolean; // .pdf, .doc, .xls, .ppt, …
  filterOther?: boolean;           // .exe, .bin, .iso, …
}
```

**Example — allow images, filter everything else:**

```typescript
makeSpiderConfig({
  fileExtensionFilters: {
    filterArchives: true,
    filterImages: false, // allow images
    filterAudio: true,
    filterVideo: true,
    filterOfficeDocuments: true,
    filterOther: true,
  },
})
```

---

## TechnicalFilters

Controls automatic rejection of technically problematic URLs. All options default to `true` (filtered).

```typescript
interface TechnicalFilters {
  filterUnsupportedSchemes?: boolean; // reject mailto:, javascript:, data:, …
  filterLongUrls?: boolean;           // reject URLs over maxUrlLength
  maxUrlLength?: number;              // default 2083 (IE/Scrapy limit)
  filterMalformedUrls?: boolean;      // reject unparseable URLs
}
```

---

## DomainEquivalenceConfig

Controls how hostnames are compared when restricting a crawl to its starting domain. Added in v0.8.

```typescript
interface DomainEquivalenceConfig {
  wwwHandling: 'strict' | 'ignore-www';
  protocolHandling: 'strict' | 'ignore-protocol';
  subdomainHandling: 'strict' | 'allow-subdomains';
}
```

| Field | Values | Description |
|-------|--------|-------------|
| `wwwHandling` | `'strict'` / `'ignore-www'` | Whether `www.example.com` and `example.com` are treated as the same domain |
| `protocolHandling` | `'strict'` / `'ignore-protocol'` | Whether `http://` and `https://` variants are equivalent |
| `subdomainHandling` | `'strict'` / `'allow-subdomains'` | Whether `sub.example.com` is considered part of `example.com` |

**Default (`defaultDomainEquivalence`):**

```typescript
{ wwwHandling: 'ignore-www', protocolHandling: 'ignore-protocol', subdomainHandling: 'strict' }
```

---

## FetchRetryConfig

Retry policy for the page-fetch pipeline. Added in v0.8. `makeSpiderConfig` throws `ConfigError` if `maxAttempts < 1`.

```typescript
interface FetchRetryConfig {
  maxAttempts: number;
  baseBackoffMs: number;
  retryOn: RetryableErrorKind[];
}

type RetryableErrorKind = 'timeout' | 'dns' | 'http_4xx' | 'http_429' | 'http_5xx' | 'connection_refused' | 'other';
```

| Field | Default | Description |
|-------|---------|-------------|
| `maxAttempts` | `3` | Total attempts (including the first); must be ≥ 1 |
| `baseBackoffMs` | `500` | Initial exponential-backoff delay |
| `retryOn` | `['timeout','http_5xx','connection_refused']` | Which error kinds trigger a retry |

**Example:**

```typescript
makeSpiderConfig({
  fetchRetry: {
    maxAttempts: 4,
    baseBackoffMs: 1000,
    retryOn: ['timeout', 'http_429', 'http_5xx', 'connection_refused'],
  },
})
```

---

## CrossDomainRedirectConfig

Handles 3xx redirects that cross hostname boundaries when following a start URL. Added in v0.9.

```typescript
interface CrossDomainRedirectConfig {
  enabled: boolean;
  maxHops: number;
}
```

When `enabled: true`, a depth-0 redirect to a different hostname updates the per-domain crawl restriction so subsequent links are followed on the final domain. `StartUrlRedirectedEvent` is emitted.

**Default (`defaultCrossDomainRedirects`):** `{ enabled: false, maxHops: 3 }`

---

## UserAgentStrategy

Replaces the `userAgent` shorthand when more advanced behaviour is needed. Added in v0.9.

```typescript
type UserAgentStrategy =
  | { kind: 'static'; userAgent: string }
  | { kind: 'rotating'; pool: string[]; perDomain: boolean }
  | { kind: 'custom'; resolver: (url: string) => string };
```

| Kind | Description |
|------|-------------|
| `static` | Always sends the same user agent |
| `rotating` | Picks from `pool`; when `perDomain: true` the same agent is used for all requests to a given domain within a single crawl |
| `custom` | Calls `resolver(url)` per request |

**Example:**

```typescript
makeSpiderConfig({
  userAgentStrategy: {
    kind: 'rotating',
    pool: ['BotA/1.0', 'BotB/1.0', 'BotC/1.0'],
    perDomain: true,
  },
})
```

---

## Resumability Configuration

### enableResumability

Set `enableResumability: true` in `makeSpiderConfig` to enable state persistence. The spider uses `SpiderSchedulerService` internally; no separate layer configuration is needed for file-backed storage.

### FileStorageBackend

```typescript
import { FileStorageBackend } from '@jambudipa/spider';

const backend = new FileStorageBackend('./spider-state');
```

Constructor accepts a single `basePath: string` argument pointing to a writable directory.

### PostgresStorageBackend

```typescript
interface PostgresStorageConfig {
  connectionString: string;
  tableName?: string;
  persistInterval?: number;
  batchSize?: number;
  connectionPool?: {
    min: number;
    max: number;
    idleTimeoutMillis: number;
  };
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `connectionString` | `string` | Required | PostgreSQL connection string |
| `tableName` | `string` | `'spider_state'` | Table name for state storage |
| `persistInterval` | `number` | `5000` | Save interval (ms) |
| `batchSize` | `number` | `100` | Bulk operation batch size |

**Example:**

```typescript
const postgresStorage = new PostgresStorageBackend({
  connectionString: 'postgresql://user:pass@localhost:5432/spider_db',
  tableName: 'crawl_sessions',
  batchSize: 500,
});
```

---

## Persistence Strategies

### FullStatePersistence

Saves complete state on each persistence operation.

```typescript
const fullStrategy = new FullStatePersistence();
```

### DeltaPersistence

Saves only changes since the last full save.

```typescript
const deltaStrategy = new DeltaPersistence();
```

### HybridPersistence

Interleaves delta saves with periodic full saves.

```typescript
const hybridStrategy = new HybridPersistence({
  deltaInterval: 1000,
  fullStateInterval: 30000,
  maxDeltaCount: 200,
});
```

---

## Configuration Validation

`makeSpiderConfig` validates options synchronously and throws `ConfigError` for programmer errors caught at startup:

```typescript
import { ConfigError, makeSpiderConfig } from '@jambudipa/spider';

try {
  const config = makeSpiderConfig({
    fetchRetry: { maxAttempts: 0 }, // throws — must be >= 1
  });
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`Config error: ${error.field} — ${error.reason}`);
  }
}
```

Known validation rules:

- `fetchRetry.maxAttempts` must be a positive integer ≥ 1

---

## StopMode (v0.10+)

Controls what happens to in-flight work when a stop condition fires (`maxPages` reached, external abort signal).

```typescript
type StopMode =
  | 'drain'                                        // default
  | 'interrupt'
  | { kind: 'interrupt'; gracePeriodMs?: number };  // tune grace period
```

| Value | Behaviour |
|-------|-----------|
| `'drain'` (default) | Current behaviour — in-flight tasks complete their full retry schedule before the domain exits. |
| `'interrupt'` | Cancel in-flight fetches immediately. Workers exit within `gracePeriodMs` (5 000 ms by default). |
| `{ kind: 'interrupt', gracePeriodMs: N }` | Same as `'interrupt'` with a custom grace period in milliseconds. |

**Examples:**

```typescript
// Opt-in to interrupt mode with default 5 s grace period
makeSpiderConfig({
  maxPages: 50,
  stopMode: 'interrupt',
});

// Tune grace period to 3 seconds
makeSpiderConfig({
  maxPages: 50,
  stopMode: { kind: 'interrupt', gracePeriodMs: 3000 },
});
```

**External abort handle:**

Pass a `Deferred<void>` via `crawl()` options to abort from outside the crawl. Only has effect when `stopMode` is `'interrupt'`.

```typescript
import { Deferred, Effect } from 'effect';
import { makeSpiderConfig, SpiderService, SpiderConfig } from '@jambudipa/spider';

const program = Effect.gen(function* () {
  const stopSignal = yield* Deferred.make<void>();
  const spider = yield* SpiderService;

  // Fork the crawl so we can resolve the stop signal concurrently
  const crawlFiber = yield* Effect.fork(
    spider.crawl(urls, sink, { externalStopSignal: stopSignal })
  );

  // Abort after 30 seconds
  yield* Effect.sleep('30 seconds');
  yield* Deferred.succeed(stopSignal, undefined);
  yield* Fiber.join(crawlFiber);
});
```

**New events emitted in interrupt mode:**

| Event | When emitted |
|-------|-------------|
| `WorkerInterruptedEvent` | Once per interrupted worker fiber |
| `DomainStoppedEvent` | Once per domain when it stops due to an interrupt signal |
| `SpiderStoppedEvent` | Once when the whole-spider external abort signal resolves |

**`DomainCompleteEvent.reason` values added in v0.10+:**

| Reason | Meaning |
|--------|---------|
| `'interrupted'` | Workers exited cleanly within `gracePeriodMs` |
| `'interrupt_grace_exceeded'` | Grace period expired before workers exited; domain was force-completed |

---

## HttpAdapter (v0.11+)

Pluggable HTTP fetcher slot. When `httpAdapter` is undefined, the spider uses `defaultUndiciAdapter` and behaviour matches v0.10 exactly. When set, every page fetch is dispatched through the adapter (or per-request selector).

```typescript
type HttpAdapterSelector = (request: HttpAdapterRequest) => HttpAdapter;

interface HttpAdapter {
  readonly fetch: (request: HttpAdapterRequest) =>
    Effect.Effect<HttpAdapterResponse, HttpAdapterError>;
}

interface HttpAdapterRequest {
  readonly url: string;
  readonly userAgent: string;        // resolved via userAgentStrategy
  readonly timeoutMs: number;        // adapter MUST honour this
  readonly requestId: string;        // per-request id for adapter logs
  readonly headers?: Readonly<Record<string, string>>; // reserved
}

interface HttpAdapterResponse {
  readonly url: string;              // post-redirect final URL
  readonly statusCode: number;       // 4xx/5xx returned as success (v0.10 parity)
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;             // decoded body
}

interface HttpAdapterError {
  readonly kind: PageFetchErrorKind; // timeout | dns | http_4xx | http_429 | http_5xx | connection_refused | other
  readonly message: string;
  readonly statusCode?: number;      // present for http_* kinds
  readonly cause?: unknown;
}
```

**Single adapter:**

```typescript
import { defaultUndiciAdapter, makeSpiderConfig } from '@jambudipa/spider';

makeSpiderConfig({
  httpAdapter: defaultUndiciAdapter, // explicit; equivalent to omitting the field
});
```

**Per-domain selector** — route a small set of anti-bot domains to a TLS-impersonating adapter, leave the bulk of the crawl on undici:

```typescript
import {
  defaultUndiciAdapter,
  makeSpiderConfig,
  type HttpAdapterSelector,
} from '@jambudipa/spider';
import { gotScrapingAdapter } from './got-scraping-adapter.js'; // your impl

const promoted = new Set(['example.com', 'other-cdn.com']);
const httpAdapter: HttpAdapterSelector = (req) =>
  promoted.has(new URL(req.url).hostname.replace(/^www\./, ''))
    ? gotScrapingAdapter
    : defaultUndiciAdapter;

makeSpiderConfig({
  stopMode: { kind: 'interrupt', gracePeriodMs: 5000 },
  httpAdapter,
});
```

### Contract rules

- **Cancellable Effect.** The returned `Effect` must be cancellable so `stopMode: 'interrupt'` propagates. Promise-based adapters should use `Effect.tryPromise` so the auto-injected `AbortSignal` reaches the underlying request.
- **Adapter owns the timeout.** The spider does not layer additional `Effect.timeout` on adapter calls; the adapter must honour `request.timeoutMs` itself.
- **All status codes return as success in `defaultUndiciAdapter`.** Matching v0.10, 4xx and 5xx responses flow through as `HttpAdapterResponse` with the status intact. Custom adapters may opt into failing with `kind: 'http_5xx'` for retry semantics.
- **Error kinds map to existing retry config.** `HttpAdapterError.kind` reuses `PageFetchErrorKind`, so `fetchRetry.retryOn` keys (`'timeout'`, `'http_5xx'`, etc.) work for both default and custom adapters.
- **User-Agent precedence.** Caller-supplied `User-Agent` in `request.headers` is ignored by `defaultUndiciAdapter` — the spider's resolved `userAgent` always wins.
- **Selector safety.** A selector that throws synchronously OR returns a non-adapter value fails the single fetch with `kind: 'other'`; the worker does not crash.

## Worker heartbeat (v0.12+)

The spider's worker loop fires a heartbeat per iteration to drive the dead-worker detector. With slow `HttpAdapter` implementations a single task — bounded by `fetchRetry.maxAttempts × adapter timeout + backoff` — can run for minutes, which used to exceed the pre-0.12 60 s staleness threshold and got busy workers flagged dead mid-fetch.

### staleWorkerThresholdMs

```typescript
makeSpiderConfig({
  staleWorkerThresholdMs: 600_000, // 10 min for very slow adapters
});
```

- **Type:** `number` (milliseconds)
- **Default:** `300_000` (5 minutes; bumped from 60 s in v0.12)
- **Bounds:** `1..2_147_483_647`. Validated at `makeSpiderConfig`; `ConfigError` on non-positive, non-integer, `NaN`, `Infinity`, or out-of-bounds values.
- **Guideline:** `fetchRetry.maxAttempts × per-attempt adapter timeout + sum(backoff) + 30 s` for headroom.

### staleWorkerCheckIntervalMs

How often the worker-health monitor scans for stale workers.

```typescript
makeSpiderConfig({
  staleWorkerCheckIntervalMs: 5_000, // scan every 5 s
});
```

- **Type:** `number` (milliseconds)
- **Default:** `15_000`
- **Bounds:** same as `staleWorkerThresholdMs`. Same validation.

### workerHeartbeatMode

Controls whether the worker heartbeat refreshes between retry attempts.

```typescript
makeSpiderConfig({
  workerHeartbeatMode: 'per-attempt', // refresh on each retry-decision input
});
```

- **Type:** `'per-iteration' | 'per-attempt'`
- **Default:** `'per-iteration'` (preserves pre-0.12 behaviour byte-for-byte)
- **`'per-attempt'`** wires `reportWorkerHealth` into the fetch retry schedule via `Schedule.tapInput`, firing on each failure input (before the backoff delay). Recommended whenever a single attempt can approach `staleWorkerThresholdMs / maxAttempts` — e.g. TLS-impersonating adapters, sidecar APIs.
- Runtime-validated; `ConfigError` on values outside the union.

Note: the `WorkerHealthMonitor` standalone service shares the new 300 s default but is independent of `SpiderConfig`. Use `WorkerHealthMonitor.WithThreshold(ms)` for a custom threshold there.

The spider emits a debug-level `event: 'worker_heartbeat'` log record on every heartbeat. Default-level loggers filter these out; raise `minimumLogLevel` to `Debug` only when actively diagnosing heartbeat behaviour.
