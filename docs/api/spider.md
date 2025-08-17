# Spider Service API Reference

The Spider service is the main orchestrator for web crawling operations in the Spider framework. It provides high-level crawling functionality with support for concurrent processing, state management, and result streaming.

## Table of Contents

- [Service Overview](#service-overview)
- [Core Methods](#core-methods)
- [Data Types](#data-types)
- [Configuration](#configuration)
- [Examples](#examples)
- [Error Handling](#error-handling)

## Service Overview

The `SpiderService` is built on Effect.js and provides type-safe, composable web crawling capabilities. It handles:

- URL validation and filtering
- Robots.txt compliance checking
- Concurrent crawling with configurable worker pools
- Request scheduling and rate limiting
- Result streaming through Effect sinks

### Import and Usage

```typescript
import { SpiderService, makeSpiderConfig } from '@jambudipa/spider'
import { Effect, Sink } from 'effect'

const program = Effect.gen(function* () {
  const spider = yield* SpiderService
  // Use spider methods here
})
```

## Core Methods

### `crawl(startingUrls, sink, options?)`

Starts crawling from the specified URL(s) and processes results through the provided sink.

**Signature:**
```typescript
crawl: <A, E, R>(
  startingUrls: string | string[] | 
    { url: string; metadata?: Record<string, unknown> } |
    { url: string; metadata?: Record<string, unknown> }[],
  sink: Sink.Sink<A, CrawlResult, E, R>,
  options?: SpiderLinkExtractionOptions
) => Effect.Effect<{ completed: boolean }, SpiderError, SpiderDependencies>
```

**Parameters:**
- `startingUrls` - The starting URL(s) for crawling. Can be:
  - Single string URL: `'https://example.com'`
  - Array of URLs: `['https://example.com', 'https://other.com']`
  - Objects with metadata: `{ url: 'https://example.com', metadata: { tag: 'homepage' } }`
- `sink` - Sink to process crawl results as they're produced
- `options` - Optional enhanced link extraction configuration

**Returns:**
Effect containing crawl completion status

**Examples:**

Basic single URL crawling:
```typescript
const program = Effect.gen(function* () {
  const spider = yield* SpiderService
  const collectSink = Sink.forEach(result =>
    Effect.sync(() => console.log(`Found: ${result.pageData.title}`))
  )
  
  yield* spider.crawl('https://example.com', collectSink)
})
```

Multiple URLs with metadata:
```typescript
const urls = [
  { url: 'https://example.com', metadata: { category: 'homepage' } },
  { url: 'https://example.com/products', metadata: { category: 'products' } }
]

yield* spider.crawl(urls, collectSink)
```

With enhanced link extraction:
```typescript
yield* spider.crawl('https://example.com', collectSink, {
  useEnhancedExtraction: true,
  linkExtractorConfig: {
    restrictCss: ['.content a'],
    allowPatterns: [/\/articles\//]
  }
})
```

**Error Handling:**
The crawl method can throw several types of errors:
- `NetworkError` - Network connectivity issues
- `ResponseError` - HTTP error responses
- `RobotsTxtError` - Robots.txt compliance violations
- `ConfigurationError` - Invalid configuration

### `resume(stateKey, sink, persistence?)`

Resumes a previous crawling session from persistent storage.

**Signature:**
```typescript
resume: <A, E, R>(
  stateKey: SpiderStateKey,
  sink: Sink.Sink<A, CrawlResult, E, R>,
  persistence?: StatePersistence
) => Effect.Effect<{ completed: boolean; resumed: boolean }, SpiderError, SpiderDependencies>
```

**Parameters:**
- `stateKey` - Unique identifier for the session to resume
- `sink` - Sink to process crawl results
- `persistence` - Optional persistence implementation (uses configured one if not provided)

**Example:**
```typescript
import { SpiderStateKey } from '@jambudipa/spider'

const stateKey = new SpiderStateKey({
  id: 'my-crawl-session',
  timestamp: new Date('2024-01-01'),
  name: 'Product Crawl'
})

const program = Effect.gen(function* () {
  const spider = yield* SpiderService
  const collectSink = Sink.forEach(result =>
    Effect.sync(() => console.log(`Resumed: ${result.pageData.title}`))
  )
  
  yield* spider.resume(stateKey, collectSink)
})
```

**Requirements:**
- Resumability must be enabled in SpiderConfig
- SpiderSchedulerService must be available
- StatePersistence implementation must be configured

### `getVisitedUrls()`

Returns the list of URLs that have been visited during crawling.

**Signature:**
```typescript
getVisitedUrls: () => Effect.Effect<string[], never, never>
```

**Example:**
```typescript
const program = Effect.gen(function* () {
  const spider = yield* SpiderService
  
  // ... perform crawling ...
  
  const visitedUrls = yield* spider.getVisitedUrls()
  console.log(`Visited ${visitedUrls.length} unique URLs`)
})
```

**Note:** This is currently a placeholder implementation that returns an empty array.

## Data Types

### `CrawlResult`

Contains the result of a successful crawl operation.

```typescript
interface CrawlResult {
  /** The extracted page data including content, links, and metadata */
  pageData: PageData
  /** The depth at which this page was crawled */
  depth: number
  /** When this page was crawled */
  timestamp: Date
  /** Optional metadata passed through from the original request */
  metadata?: Record<string, unknown>
}
```

### `CrawlTask`

Represents a single crawling task with URL and depth information.

```typescript
interface CrawlTask {
  /** The URL to be crawled */
  url: string
  /** The depth level of this URL relative to the starting URL */
  depth: number
  /** The URL from which this URL was discovered (optional) */
  fromUrl?: string
  /** Optional metadata to be passed through to the result */
  metadata?: Record<string, unknown>
  /** Optional data extraction configuration */
  extractData?: Record<string, any>
}
```

### `SpiderLinkExtractionOptions`

Options for enhanced link extraction during crawling.

```typescript
interface SpiderLinkExtractionOptions {
  /** Configuration for the LinkExtractorService */
  linkExtractorConfig?: LinkExtractorConfig
  /** Whether to use enhanced extraction in addition to basic extraction */
  useEnhancedExtraction?: boolean
  /** Whether to replace basic extraction with enhanced extraction */
  replaceBasicExtraction?: boolean
  /** Data extraction configuration for structured data extraction */
  extractData?: Record<string, any>
}
```

## Configuration

The Spider service uses `SpiderConfig` for configuration. Key settings include:

### Crawling Limits
```typescript
const config = makeSpiderConfig({
  maxDepth: 3,        // Maximum crawl depth
  maxPages: 100,      // Maximum pages to crawl
  maxConcurrentWorkers: 5  // Concurrent workers
})
```

### Rate Limiting
```typescript
const config = makeSpiderConfig({
  requestDelayMs: 1000,  // Delay between requests
  maxRobotsCrawlDelayMs: 10000  // Max robots.txt delay
})
```

### Domain Filtering
```typescript
const config = makeSpiderConfig({
  allowedDomains: ['example.com', 'subdomain.example.com'],
  blockedDomains: ['spam.example.com']
})
```

See the [Configuration API Reference](./config.md) for complete details.

## Examples

### Basic Web Crawling

```typescript
import { SpiderService, makeSpiderConfig } from '@jambudipa/spider'
import { Effect, Sink } from 'effect'

const basicCrawl = Effect.gen(function* () {
  const spider = yield* SpiderService
  
  // Collect all results
  const results = yield* spider.crawl(
    'https://example.com',
    Sink.collectAll()
  )
  
  console.log(`Crawled ${results.length} pages`)
  return results
})

Effect.runPromise(basicCrawl.pipe(
  Effect.provide(SpiderService.Default)
))
```

### Streaming Results

```typescript
const streamingCrawl = Effect.gen(function* () {
  const spider = yield* SpiderService
  
  // Process results as they arrive
  const streamingSink = Sink.forEach(result =>
    Effect.gen(function* () {
      // Process each result immediately
      yield* saveToDatabase(result.pageData)
      console.log(`Saved: ${result.pageData.title}`)
    })
  )
  
  yield* spider.crawl('https://example.com', streamingSink)
})
```

### Concurrent Domain Crawling

```typescript
const multiDomainCrawl = Effect.gen(function* () {
  const spider = yield* SpiderService
  
  const urls = [
    'https://example.com',
    'https://another-site.com',
    'https://third-site.com'
  ]
  
  // Spider automatically handles each domain with its own worker pool
  yield* spider.crawl(urls, Sink.forEach(result =>
    Effect.sync(() => {
      console.log(`${result.pageData.url}: ${result.pageData.title}`)
    })
  ))
})
```

### Error Recovery

```typescript
const resilientCrawl = Effect.gen(function* () {
  const spider = yield* SpiderService
  
  const result = yield* spider.crawl(
    'https://example.com',
    Sink.collectAll()
  ).pipe(
    Effect.retry({
      times: 3,
      schedule: Schedule.exponential('1 second')
    }),
    Effect.catchTags({
      NetworkError: (error) => {
        console.log('Network issues, continuing with partial results')
        return Effect.succeed([])
      },
      RobotsTxtError: (error) => {
        console.log('Blocked by robots.txt')
        return Effect.succeed([])
      }
    })
  )
  
  return result
})
```

## Error Handling

The Spider service uses typed errors from Effect.js. Common error types:

### NetworkError
Thrown for network connectivity issues:
```typescript
Effect.catchTag('NetworkError', (error) => {
  console.log(`Network error: ${error.message}`)
  console.log(`Failed URL: ${error.url}`)
  return Effect.succeed(null)
})
```

### ResponseError  
Thrown for HTTP error responses:
```typescript
Effect.catchTag('ResponseError', (error) => {
  console.log(`HTTP ${error.statusCode}: ${error.message}`)
  return Effect.succeed(null)
})
```

### RobotsTxtError
Thrown when robots.txt blocks access:
```typescript
Effect.catchTag('RobotsTxtError', (error) => {
  console.log(`Robots.txt violation: ${error.message}`)
  return Effect.succeed(null)
})
```

### Comprehensive Error Handling
```typescript
const safeCrawl = spider.crawl(url, sink).pipe(
  Effect.catchAll((error) => {
    console.error('Crawl failed:', error)
    return Effect.succeed({ completed: false, error })
  })
)
```

## Performance Considerations

### Memory Usage
- Use streaming sinks for large crawls to avoid memory buildup
- Configure appropriate `maxPages` limits for your environment
- Monitor worker pool size with `maxConcurrentWorkers`

### Request Rate
- Set appropriate `requestDelayMs` to respect server limits
- Enable `respectRobotsTxt` for compliant crawling
- Use `maxRobotsCrawlDelayMs` to cap excessive delays

### Concurrency
- Balance `maxConcurrentWorkers` with target server capacity
- Consider domain-level rate limiting for multiple domains
- Monitor system resources under concurrent load

## Related APIs

- **[SpiderConfig](./config.md)** - Configuration options and factory functions
- **[LinkExtractor](./link-extractor.md)** - Link discovery and filtering
- **[Middleware](./middleware.md)** - Request/response processing pipeline
- **[Errors](./errors.md)** - Error types and handling strategies

## Dependencies

The Spider service requires these Effect.js services:
- `SpiderConfig` - Configuration provider
- `ScraperService` - HTTP fetching and parsing
- `RobotsService` - Robots.txt compliance
- `LinkExtractorService` - Link extraction
- `SpiderLogger` - Logging functionality

Optional dependencies:
- `SpiderSchedulerService` - For resumability support
- `UrlDeduplicatorService` - For custom deduplication

Provide these through Effect.js dependency injection for full functionality.