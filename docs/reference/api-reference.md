# Spider API Reference

This reference provides complete documentation for all Effect services and interfaces in the Spider library.

## Core Architecture

Spider is built on [Effect](https://effect.website/) and uses service-based architecture with dependency injection. All services are implemented as `Effect.Service` classes and accessed through the Effect service pattern.

### Basic Usage Pattern

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, SpiderConfig, makeSpiderConfig } from '@jambudipa/spider';

// All operations are Effect programs
const program = Effect.gen(function* () {
  // Access services using yield*
  const spider = yield* SpiderService;
  
  // Create a sink to process results
  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => console.log(`Crawled: ${result.pageData.title}`))
  );
  
  // Call service methods within Effect.gen
  const stats = yield* spider.crawl('https://example.com', collectSink);
  
  return stats;
});

// Execute the program with required services
const result = await Effect.runPromise(
  program.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(makeSpiderConfig({ maxPages: 10 })))
  )
);
```

## Core Services

### SpiderService

The main service for web crawling operations.

```typescript
export class SpiderService extends Effect.Service<SpiderService>()(
  '@jambudipa/spider',
  { /* implementation */ }
) {}
```

**Access Pattern:**
```typescript
const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  // Use spider methods here
});
```

**Layer Composition:**
```typescript
// Default layer with all dependencies
SpiderService.Default

// Custom dependencies
Effect.provide(program, Layer.mergeAll(
  SpiderService.Default,
  SpiderConfig.Live(customConfig),
  SpiderLogger.Live({ logLevel: 'debug' })
));
```

#### Methods

##### `crawl<A, E, R>(startingUrls, sink, options?): Effect<{completed: boolean}, never>`

Crawls websites and streams results through an Effect Sink.

**Type Signature:**
```typescript
crawl: <A, E, R>(
  startingUrls: string | string[] | UrlWithMetadata | UrlWithMetadata[],
  sink: Sink.Sink<A, CrawlResult, E, R>,
  options?: SpiderLinkExtractionOptions
) => Effect.Effect<{ completed: boolean }, never>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `startingUrls` | `string \| string[] \| UrlWithMetadata \| UrlWithMetadata[]` | URL(s) to start crawling from |
| `sink` | `Sink.Sink<A, CrawlResult, E, R>` | Effect Sink to process crawl results |
| `options` | `SpiderLinkExtractionOptions?` | Optional link extraction configuration |

**Returns:** `Effect<{ completed: boolean }>` - Effect containing completion status

**Examples:**

*Single URL with collection:*
```typescript
const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  
  const results: CrawlResult[] = [];
  const collectSink = Sink.forEach((result: CrawlResult) =>
    Effect.sync(() => results.push(result))
  );
  
  yield* spider.crawl('https://example.com', collectSink);
  return results;
});
```

*Multiple URLs with processing:*
```typescript
const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  
  const processSink = Sink.forEach((result: CrawlResult) =>
    Effect.gen(function* () {
      console.log(`Title: ${result.pageData.title}`);
      console.log(`URL: ${result.pageData.url}`);
      console.log(`Links found: ${result.pageData.links?.length || 0}`);
    })
  );
  
  yield* spider.crawl([
    'https://example.com',
    'https://example.org'
  ], processSink);
});
```

*With metadata and enhanced extraction:*
```typescript
const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  
  const urlsWithMetadata = [
    { url: 'https://example.com', metadata: { category: 'main' } },
    { url: 'https://example.com/blog', metadata: { category: 'blog' } }
  ];
  
  const processSink = Sink.forEach((result: CrawlResult) =>
    Effect.sync(() => {
      console.log(`Processing ${result.pageData.url}`);
      console.log(`Category: ${result.metadata?.category}`);
    })
  );
  
  yield* spider.crawl(urlsWithMetadata, processSink, {
    useEnhancedExtraction: true,
    linkExtractorConfig: {
      allowPatterns: [/\/articles\//],
      restrictCss: ['.content a']
    },
    extractData: {
      title: 'h1',
      description: { selector: 'meta[name="description"]', attribute: 'content' },
      publishDate: '.publish-date'
    }
  });
});
```

##### `resume<A, E, R>(stateKey, sink, persistence?): Effect<ResumeResult, StateError>`

Resumes a previously interrupted crawling session.

**Type Signature:**
```typescript
resume: <A, E, R>(
  stateKey: SpiderStateKey,
  sink: Sink.Sink<A, CrawlResult, E, R>,
  persistence?: StatePersistence
) => Effect.Effect<ResumeResult, StateError>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `stateKey` | `SpiderStateKey` | Unique identifier for the session to resume |
| `sink` | `Sink.Sink<A, CrawlResult, E, R>` | Effect Sink to process resumed crawl results |
| `persistence` | `StatePersistence?` | Optional persistence implementation |

**Example:**
```typescript
import { SpiderStateKey } from '@jambudipa/spider';

const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  
  const stateKey = new SpiderStateKey({
    id: 'my-crawl-session',
    timestamp: new Date('2024-01-01'),
    name: 'Example Crawl'
  });
  
  const resumeSink = Sink.forEach((result: CrawlResult) =>
    Effect.sync(() => console.log(`Resumed: ${result.pageData.title}`))
  );
  
  const result = yield* spider.resume(stateKey, resumeSink);
  console.log(`Resumed session: ${result.sessionId}`);
  return result;
});
```

##### `getVisitedUrls(): Effect<string[], never>`

Retrieves the list of URLs visited during the current crawling session.

**Returns:** `Effect<string[]>` - Effect containing array of visited URLs

**Example:**
```typescript
const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  
  // After crawling...
  const visitedUrls = yield* spider.getVisitedUrls();
  console.log(`Visited ${visitedUrls.length} URLs`);
  
  return visitedUrls;
});
```

### SpiderConfig

Configuration service for Spider crawling behaviour.

```typescript
export class SpiderConfig extends Effect.Service<SpiderConfigService>()(
  '@jambudipa/spiderConfig',
  { /* implementation */ }
) {
  static Live = (config: Partial<SpiderConfigOptions> | SpiderConfigService) =>
    Layer.effect(SpiderConfig, Effect.succeed(/* service implementation */));
}
```

**Usage:**
```typescript
import { SpiderConfig, makeSpiderConfig } from '@jambudipa/spider';

// Create configuration
const config = makeSpiderConfig({
  maxDepth: 3,
  maxPages: 100,
  maxConcurrentWorkers: 5,
  requestDelayMs: 1000,
  ignoreRobotsTxt: false
});

// Use with service
const program = Effect.gen(function* () {
  const spiderConfig = yield* SpiderConfig;
  const userAgent = yield* spiderConfig.getUserAgent();
  const maxDepth = yield* spiderConfig.getMaxDepth();
});

// Provide configuration layer
Effect.provide(program, SpiderConfig.Live(config));
```

## Data Types

### CrawlResult

Result of crawling a single page.

```typescript
interface CrawlResult {
  /** The extracted page data including content, links, and metadata */
  pageData: PageData;
  /** The depth at which this page was crawled */
  depth: number;
  /** When this page was crawled */
  timestamp: Date;
  /** Optional metadata passed through from the original request */
  metadata?: Record<string, unknown>;
}
```

### PageData

Extracted information from a crawled webpage.

```typescript
class PageData {
  constructor(
    /** The URL of the page */
    public url: string,
    /** The page title */
    public title: string,
    /** Raw HTML content */
    public html: string,
    /** HTTP status code */
    public statusCode: number,
    /** Response headers */
    public headers: Record<string, string>,
    /** Extracted links from the page */
    public links?: string[],
    /** Additional metadata extracted from the page */
    public metadata?: Record<string, any>,
    /** Response time in milliseconds */
    public responseTime?: number,
    /** Any extracted structured data */
    public extractedData?: Record<string, any>
  ) {}
}
```

### SpiderLinkExtractionOptions

Options for enhanced link extraction during crawling.

```typescript
export interface SpiderLinkExtractionOptions {
  /** Configuration for the LinkExtractorService */
  readonly linkExtractorConfig?: LinkExtractorConfig;
  /** Whether to use enhanced extraction in addition to basic extraction */
  readonly useEnhancedExtraction?: boolean;
  /** Whether to replace basic extraction with enhanced extraction */
  readonly replaceBasicExtraction?: boolean;
  /** Data extraction configuration for structured data extraction */
  readonly extractData?: Record<string, any>;
}
```

### UrlWithMetadata

URL input with optional metadata.

```typescript
interface UrlWithMetadata {
  url: string;
  metadata?: Record<string, unknown>;
}
```

## Supporting Services

### ScraperService

Low-level HTTP scraping functionality.

```typescript
export class ScraperService extends Effect.Service<ScraperService>()(
  '@jambudipa/scraper',
  { /* implementation */ }
) {}
```

**Methods:**
- `fetchAndParse(url: string, depth: number): Effect<PageData, NetworkError | ParseError>`

### RobotsService

Handles robots.txt parsing and compliance.

```typescript
export class RobotsService extends Effect.Service<RobotsService>()(
  '@jambudipa/robots',
  { /* implementation */ }
) {}
```

**Methods:**
- `checkUrl(url: string): Effect<{ allowed: boolean; crawlDelay?: number }, NetworkError>`

### LinkExtractorService

Extracts and filters links from HTML content.

```typescript
export class LinkExtractorService extends Effect.Service<LinkExtractorService>()(
  '@jambudipa/link-extractor',
  { /* implementation */ }
) {}
```

**Methods:**
- `extractLinks(html: string, config?: LinkExtractorConfig): Effect<LinkExtractionResult, ParseError>`

### UrlDeduplicatorService

Handles URL deduplication during crawling.

```typescript
export class UrlDeduplicatorService extends Effect.Service<UrlDeduplicatorService>()(
  '@jambudipa/url-deduplicator',
  { /* implementation */ }
) {}
```

**Methods:**
- `tryAdd(url: string): Effect<boolean, never>`
- `contains(url: string): Effect<boolean, never>`
- `size(): Effect<number, never>`

## Effect Patterns

### Service Access

All services are accessed through the Effect service pattern:

```typescript
const program = Effect.gen(function* () {
  // Access services with yield*
  const spider = yield* SpiderService;
  const config = yield* SpiderConfig;
  const scraper = yield* ScraperService;
  
  // Use services within the Effect context
  const userAgent = yield* config.getUserAgent();
  const pageData = yield* scraper.fetchAndParse('https://example.com', 0);
  
  return { userAgent, pageData };
});
```

### Dependency Injection

Services declare their dependencies through the Effect layer system:

```typescript
// Default service configuration
const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  // Use spider...
}).pipe(
  Effect.provide(SpiderService.Default) // Provides all default dependencies
);

// Custom configuration
const customConfig = makeSpiderConfig({
  maxPages: 100,
  maxDepth: 3,
  requestDelayMs: 2000
});

const programWithConfig = Effect.gen(function* () {
  const spider = yield* SpiderService;
  // Use spider with custom config...
}).pipe(
  Effect.provide(SpiderService.Default),
  Effect.provide(SpiderConfig.Live(customConfig))
);
```

### Layer Composition

Combine multiple services and configurations:

```typescript
import { Layer } from 'effect';

const customLayers = Layer.mergeAll(
  SpiderService.Default,
  SpiderConfig.Live(customConfig),
  BrowserEngineService.Live({ headless: true })
);

const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  const browser = yield* BrowserEngineService;
  
  // Both services available with custom configuration
}).pipe(
  Effect.provide(customLayers)
);
```

### Sink-Based Result Processing

Results are processed through Effect Sinks for memory efficiency:

```typescript
import { Sink } from 'effect';

// Collect all results
const collectSink = Sink.collectAll<CrawlResult>();

// Process each result individually
const processSink = Sink.forEach((result: CrawlResult) =>
  Effect.gen(function* () {
    yield* Console.log(`Processing: ${result.pageData.url}`);
    // Additional processing...
  })
);

// Transform results
const transformSink = Sink.map(
  Sink.collectAll<CrawlResult>(),
  (results) => results.map(r => ({ title: r.pageData.title, url: r.pageData.url }))
);

// Use with spider
const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  
  const results = yield* spider.crawl('https://example.com', collectSink);
  return results;
});
```

## Resumability Services

### ResumabilityService

Manages resumable crawling operations.

#### Constructor

```typescript
// ResumabilityService is accessed as an Effect service
const resumabilityService = yield* ResumabilityService;
```

**Configuration:**

```typescript
interface ResumabilityConfig {
  /** Storage backend for persistence */
  storageBackend: StorageBackend;
  
  /** Enable resumable operations */
  enableResumption: boolean;
  
  /** Retry failed URLs */
  retryFailedUrls?: boolean;
  
  /** Maximum retry attempts */
  maxRetries?: number;
  
  /** Persistence strategy */
  persistenceStrategy?: PersistenceStrategy;
}
```

#### Methods

##### `canResumeSession(sessionId: string): Promise<boolean>`

Checks if a session can be resumed.

##### `clearSession(sessionId: string): Promise<void>`

Clears a saved session.

##### `listSessions(): Promise<string[]>`

Lists all available sessions.

##### `getSessionInfo(sessionId: string): Promise<SessionInfo>`

Gets information about a specific session.

### Storage Backends

#### FileStorageBackend

File-based storage for single-machine operations.

```typescript
new FileStorageBackend({
  basePath: string,
  persistInterval?: number
})
```

#### PostgresStorageBackend

PostgreSQL-based storage for distributed operations.

```typescript
new PostgresStorageBackend({
  connectionString: string,
  tableName?: string,
  persistInterval?: number,
  batchSize?: number
})
```

#### RedisStorageBackend

Redis-based storage for distributed operations.

```typescript
new RedisStorageBackend({
  host: string,
  port: number,
  keyPrefix?: string,
  persistInterval?: number
})
```

## Error Types

Spider uses Effect's Data.TaggedError for type-safe error handling. All errors extend Data.TaggedError and can be handled using Effect.catchTags.

### NetworkError

Thrown when network-level errors occur.

```typescript
export class NetworkError extends Data.TaggedError('NetworkError')<{
  readonly url: string;
  readonly statusCode?: number;
  readonly method?: string;
  readonly cause?: unknown;
}> {}

// Usage with error handling
const program = Effect.gen(function* () {
  const httpClient = yield* EnhancedHttpClient;
  
  yield* httpClient.get('https://example.com').pipe(
    Effect.catchTags({
      NetworkError: (error) => {
        console.error(`Network error for ${error.url}: ${error.statusCode}`);
        return Effect.succeed(null);
      }
    })
  );
});
```

### TimeoutError

Thrown when operations exceed configured timeout limits.

```typescript
export class TimeoutError extends Data.TaggedError('TimeoutError')<{
  readonly url: string;
  readonly timeoutMs: number;
  readonly operation: string;
}> {}
```

### ParseError

Thrown when parsing operations fail.

```typescript
export class ParseError extends Data.TaggedError('ParseError')<{
  readonly input?: string;
  readonly expected: string;
  readonly cause?: unknown;
}> {
  static json(input: string, cause?: unknown): ParseError;
  static html(input: string, cause?: unknown): ParseError;
}
```

### CrawlError

Thrown when crawling-specific operations fail.

```typescript
export class CrawlError extends Data.TaggedError('CrawlError')<{
  readonly url: string;
  readonly depth: number;
  readonly reason: string;
  readonly cause?: unknown;
}> {
  static maxDepthReached(url: string, depth: number): CrawlError;
  static robotsBlocked(url: string): CrawlError;
}
```

### ConfigError

Thrown when configuration is invalid.

```typescript
export class ConfigError extends Data.TaggedError('ConfigError')<{
  readonly field: string;
  readonly value?: unknown;
  readonly reason: string;
}> {
  static invalid(field: string, value: unknown, expected: string): ConfigError;
}
```

### StateError

Thrown when state management operations fail.

```typescript
export class StateError extends Data.TaggedError('StateError')<{
  readonly operation: 'save' | 'load' | 'delete' | 'update';
  readonly stateKey?: string;
  readonly cause?: unknown;
}> {}
```

## Helper Services

### UrlDeduplicatorService

Service for URL deduplication during crawling operations.

```typescript
export class UrlDeduplicatorService extends Effect.Service<UrlDeduplicatorService>()(
  '@jambudipa/url-deduplicator',
  { /* implementation */ }
) {}

// Usage
const program = Effect.gen(function* () {
  const deduplicator = yield* UrlDeduplicatorService;
  
  const isNew = yield* deduplicator.tryAdd('https://example.com');
  const contains = yield* deduplicator.contains('https://example.com');
  const size = yield* deduplicator.size();
  
  console.log({ isNew, contains, size });
});
```

**Methods:**
- `tryAdd(url: string): Effect<boolean, never>` - Add URL if not seen before, returns true if added
- `contains(url: string): Effect<boolean, never>` - Check if URL has been seen
- `size(): Effect<number, never>` - Get count of unique URLs seen

### RobotsService

Service for robots.txt parsing and compliance checking.

```typescript
export class RobotsService extends Effect.Service<RobotsService>()(
  '@jambudipa/robots',
  { /* implementation */ }
) {}

// Usage
const program = Effect.gen(function* () {
  const robots = yield* RobotsService;
  
  const result = yield* robots.checkUrl('https://example.com/page');
  console.log(`Allowed: ${result.allowed}`);
  if (result.crawlDelay) {
    console.log(`Crawl delay: ${result.crawlDelay}ms`);
  }
});
```

**Methods:**
- `checkUrl(url: string): Effect<{ allowed: boolean; crawlDelay?: number }, NetworkError>` - Check URL against robots.txt

## Configuration Types

### SpiderConfigOptions

Configuration options for Spider behaviour.

```typescript
export interface SpiderConfigOptions {
  /** Maximum crawling depth */
  maxDepth?: number;
  
  /** Maximum number of pages to crawl */
  maxPages?: number;
  
  /** Maximum concurrent workers */
  maxConcurrentWorkers?: number;
  
  /** Delay between requests in milliseconds */
  requestDelayMs?: number;
  
  /** User agent string */
  userAgent?: string;
  
  /** Whether to ignore robots.txt */
  ignoreRobotsTxt?: boolean;
  
  /** Allowed domains for crawling */
  allowedDomains?: string[];
  
  /** File extensions to ignore */
  ignoreFileExtensions?: string[];
}

// Create configuration
const config = makeSpiderConfig({
  maxDepth: 3,
  maxPages: 100,
  requestDelayMs: 1000,
  userAgent: 'MySpider 1.0'
});
```

### LinkExtractorConfig

Configuration for link extraction behaviour.

```typescript
export interface LinkExtractorConfig {
  /** CSS selectors to restrict link extraction */
  restrictCss?: string[];
  
  /** Regex patterns to allow */
  allowPatterns?: RegExp[];
  
  /** Regex patterns to deny */
  denyPatterns?: RegExp[];
  
  /** Whether to extract from specific tags only */
  tagsOnly?: string[];
}
```

### Effect Error Union Types

```typescript
// Union of all possible Spider errors
export type AllSpiderErrors =
  | SpiderError
  | NetworkError
  | TimeoutError
  | ParseError
  | ValidationError
  | CrawlError
  | StateError
  | ConfigError;

// Network-related errors
export type NetworkErrors = NetworkError | TimeoutError;

// State management errors
export type StateErrors = StateError | FileSystemError;
```
