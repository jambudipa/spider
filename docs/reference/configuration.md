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
