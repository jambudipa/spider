# Spider Architecture and Design Philosophy

This document explains the architectural decisions, design patterns, and principles that underlie the Spider web scraping library.

## Core Design Philosophy

Spider is built around several key principles that guide its architecture and implementation:

### 1. Respectful Scraping by Default

Spider is designed to be a "good citizen" of the web. This means:

- **Robots.txt compliance is enabled by default** - The library automatically checks and respects robots.txt files
- **Built-in rate limiting** - Prevents overwhelming target servers with too many simultaneous requests
- **Configurable delays** - Ensures appropriate time gaps between requests
- **Proper User-Agent identification** - Clearly identifies the scraper to server administrators

This approach reflects a philosophy that web scraping should be sustainable and ethical. By being respectful by default, Spider helps maintain the health of the web ecosystem while still enabling legitimate data collection.

### 2. Effect-Based Functional Programming

Spider leverages the Effect library for functional programming patterns:

**Why Effect?**
- **Type-safe error handling** - Errors are part of the type system, not runtime surprises
- **Composable operations** - Complex scraping workflows can be built from simple, reusable components
- **Resource management** - Automatic cleanup of connections, files, and other resources
- **Concurrent processing** - Built-in support for parallelism with proper backpressure

This choice reflects a belief that web scraping involves many complex, potentially failing operations that benefit from explicit error handling and composable design patterns.

### 3. Service-Based Architecture

Spider uses Effect services for modular architecture:

- **Separation of concerns** - Each service handles a specific aspect (HTTP clients, cookie management, logging)
- **Composable behaviour** - Combine services using Effect layers to create custom functionality
- **Extensibility** - Add new services without modifying core implementations
- **Testing isolation** - Each service can be mocked and tested independently
- **Dependency injection** - Services declare their dependencies through the type system

### 4. Resumability as a First-Class Feature

Long-running web scraping operations are inherently fragile. Spider treats resumability not as an afterthought, but as a core architectural concern:

- **State persistence strategies** - Multiple approaches for saving and restoring scraping state
- **Pluggable storage backends** - File, database, or distributed storage options
- **Granular state management** - Track individual URL processing states, not just overall progress
- **Error recovery** - Graceful handling of partial failures and network interruptions

## Architectural Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     SpiderService (Effect.Context.Tag)           │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                 Effect Layer Dependencies                  │  │
│  │  SpiderConfig → SpiderLogger → EnhancedHttpClient          │  │
│  │                                        ↓                   │  │
│  │                               CookieManager                │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│    ┌─────────────────────────▼───────────────────────────────┐   │
│    │               Core Crawling Engine                      │   │
│    │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐│   │
│    │  │   URL       │ │   Page      │ │    Link             ││   │
│    │  │   Queue     │ │   Scraper   │ │    Extractor        ││   │
│    │  │   Manager   │ │             │ │                     ││   │
│    │  └─────────────┘ └─────────────┘ └─────────────────────┘│   │
│    └─────────────────────────────────────────────────────────┘   │
│                            │                                     │
│  ┌─────────────────────────▼─────────────────────────────────┐   │
│  │              Effect Streams & Sinks                       │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │   │
│  │  │   Stream    │ │    Sink     │ │   Error             │  │   │
│  │  │ Processing  │ │ Collection  │ │   Handling          │  │   │
│  │  └─────────────┘ └─────────────┘ └─────────────────────┘  │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## Core Components

### SpiderService - The Main Orchestrator

The `SpiderService` is implemented as an Effect.Context.Tag service that coordinates crawling operations:

**Responsibilities:**
- Manage URL queues and crawling state
- Coordinate HTTP requests through EnhancedHttpClient
- Stream results through Effect Sinks
- Handle configuration and dependency injection
- Provide the public crawling API

**Design Pattern:** Service Pattern with Effect - Uses dependency injection and functional composition for modularity.

### Service Composition - Layered Architecture

Spider uses Effect layers for service composition:

```typescript
// Service dependencies are declared in the type system
spider.crawl(urls, sink) // Requires: SpiderService
  ├── SpiderConfig     // Configuration layer
  ├── SpiderLogger     // Logging layer  
  └── EnhancedHttpClient // HTTP client layer
      ├── SpiderLogger    // Shared logging
      └── CookieManager   // Cookie management layer
```

**Key Benefits:**
- **Type-safe dependencies** - Dependencies are checked at compile time
- **Composable layers** - Mix and match service implementations
- **Testable isolation** - Replace any layer with mock implementations
- **Resource management** - Automatic cleanup through Effect scopes

### Effect-Based Service Architecture

Spider uses Effect Context.Tag services for dependency injection:

```typescript
// Services are defined as Context.Tag classes
export class SpiderService extends Context.Tag('SpiderService')<
  SpiderService,
  SpiderServiceInterface
>() {}

// Service interface defines the operations
interface SpiderServiceInterface {
  crawl(urls: string[], sink: Sink): Effect<void, CrawlError>;
  getProgress(): Effect<CrawlProgress, never>;
}

// Consumers access services through Effect.gen
const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  
  const collectSink = Sink.forEach((result) => 
    Effect.sync(() => console.log(result.pageData.title))
  );
  
  yield* spider.crawl(['https://example.com'], collectSink);
});
```

**Benefits:**
- **Testability** - Easy to provide mock implementations for testing
- **Configurability** - Different layers for different environments
- **Composition** - Services can depend on other services cleanly

## Data Flow Architecture

### 1. Request Processing Flow

```
URL Input → Configuration Check → URL Queue → EnhancedHttpClient → Cookie Management → Response
```

**Configuration Check:** URLs are validated against allowed domains, protocols, and file extension filters from SpiderConfig.

**URL Queue:** Internal queue management handles depth tracking, deduplication, and crawling limits (maxPages, maxDepth).

**EnhancedHttpClient:** Handles HTTP requests with built-in retry logic, timeout management, and error handling.

**Cookie Management:** CookieManager automatically handles session cookies, authentication state, and cookie persistence.

**Logging Integration:** SpiderLogger records all significant events, errors, and edge cases throughout the process.

### 2. Response Processing Flow

```
HTTP Response → Status Check → HTML Parse → Metadata Extract → Link Extract → Sink Processing
```

**Status Check:** HTTP status codes are evaluated to determine success, redirect handling, or error conditions.

**HTML Parse:** HTML content is parsed to extract title, meta tags, and other structured information.

**Metadata Extract:** Common metadata (description, keywords, Open Graph, Twitter Cards) is automatically extracted.

**Link Extract:** All links are discovered and filtered based on domain restrictions, depth limits, and file extension filters.

**Sink Processing:** The `CrawlResult` with `PageData` is streamed through the provided Sink for consumer processing.

### 3. Stream Processing Flow

```
Crawl Results → Effect Stream → Sink Processing → Consumer Effects
```

**Effect Streams:** Results are processed as they're generated, not collected in memory.

**Sink Processing:** Consumers define Sinks to handle results (collect, transform, save to disk, etc.).

**Backpressure Handling:** Effect automatically manages backpressure if consumers can't keep up with results.

**Error Isolation:** Errors in result processing don't stop the crawling operation.

## Concurrency Model

Spider uses Effect for built-in concurrency management:

### Configuration-Based Concurrency

```typescript
// Concurrency is controlled through SpiderConfig
const config = makeSpiderConfig({
  maxConcurrentWorkers: 3,  // Maximum parallel requests
  requestDelayMs: 1000,     // Delay between requests
  maxPages: 100,            // Total page limit
  maxDepth: 3               // Crawling depth limit
});

// EnhancedHttpClient handles retry logic and timeouts
const httpClient = yield* EnhancedHttpClient;
const response = yield* httpClient.get(url, {
  timeout: 30000,
  retries: 3,
  retryDelay: 1000
});
```

### Backpressure Management

The system automatically handles backpressure when:
- Target servers respond slowly
- Storage backends can't keep up with state changes
- Memory usage approaches configured limits

**Implementation:** Effect's built-in backpressure mechanisms ensure that slow consumers don't cause memory buildup in producers.

### Error Isolation

Errors in one part of the system don't cascade to other parts:

- **Request failures** don't stop other concurrent requests
- **Storage failures** don't prevent scraping from continuing
- **Middleware errors** are isolated to specific middleware components

## Memory Management

Spider is designed for long-running operations that may process thousands or millions of URLs:

### Sink-Based Processing

Results are processed through Effect Sinks for memory efficiency:

```typescript
// Process results as they arrive, not collecting in memory
const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  
  // Define how to process each result
  const processSink = Sink.forEach((result: CrawlResult) =>
    Effect.sync(() => {
      console.log(`Crawled: ${result.pageData.title}`);
      // Process result without storing in memory
    })
  );
  
  // Results stream through the sink as they're generated
  yield* spider.crawl(['https://example.com'], processSink);
});
```

### Garbage Collection Friendly

- **Weak references** for caches that can be cleaned up under memory pressure
- **Bounded queues** prevent unlimited memory growth
- **Configurable limits** allow tuning for available system resources

### Resource Cleanup

Effect ensures that resources are properly cleaned up:

```typescript
const scrapingOperation = Effect.gen(function* () {
  // Services are acquired through dependency injection
  const spider = yield* SpiderService;
  const httpClient = yield* EnhancedHttpClient;
  const cookieManager = yield* CookieManager;
  
  // If an error occurs here, services are still cleaned up
  const collectSink = Sink.collectAll<CrawlResult>();
  yield* spider.crawl(['https://example.com'], collectSink);
  
  // Cookies can be persisted for session management
  const cookieData = yield* cookieManager.serialize();
  
}).pipe(
  // Automatic cleanup happens here, even on errors
  Effect.scoped
);
```

## Error Handling Philosophy

Spider uses Effect tagged errors for precise error handling:

### Tagged Error Types

**NetworkError:**
- Connection failures, timeouts, DNS issues
- Handled with automatic retry logic in EnhancedHttpClient

**ParseError:**
- JSON parsing failures, malformed content
- Logged and skipped to continue processing

**TimeoutError:**
- Request timeouts, operation timeouts
- Handled with configurable retry strategies

**ConfigurationError:**
- Invalid configuration values
- Fail fast during program setup

### Error Context Preservation

Effect tagged errors preserve context for debugging:

```typescript
// Tagged errors include relevant context
class NetworkError extends Data.TaggedError('NetworkError')<{
  url: string;
  method: string;
  statusCode?: number;
  cause?: unknown;
}> {}

// Usage with error handling
const program = Effect.gen(function* () {
  const httpClient = yield* EnhancedHttpClient;
  
  const response = yield* httpClient.get('https://example.com').pipe(
    Effect.catchTags({
      NetworkError: (error) => {
        console.error(`Network error for ${error.url}: ${error.cause}`);
        return Effect.succeed(null); // Continue processing
      },
      TimeoutError: (error) => {
        console.error(`Timeout for ${error.operation}: ${error.timeoutMs}ms`);
        return Effect.succeed(null);
      }
    })
  );
});
```

### Graceful Degradation

The system is designed to continue operating even when parts fail:

- **Storage failures** → Continue scraping without persistence
- **Robots.txt unreachable** → Assume allowed with warning
- **Link extraction failures** → Process page content without following links

## Extensibility Points

Spider provides several extension points through Effect services:

### Custom Service Implementations

```typescript
// Create custom HTTP client implementation
const CustomHttpClient = Layer.succeed(
  EnhancedHttpClient,
  {
    get: (url: string, options?: HttpRequestOptions) => 
      Effect.gen(function* () {
        // Custom HTTP client logic
        return { status: 200, body: 'custom response', headers: {}, url };
      }),
    post: (url: string, data?: any, options?: HttpRequestOptions) => 
      Effect.gen(function* () {
        // Custom POST logic
        return { status: 200, body: 'posted', headers: {}, url };
      }),
    // ... other methods
  } as EnhancedHttpClientService
);

// Use custom implementation
const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  // Spider will use your custom HTTP client
}).pipe(
  Effect.provide(SpiderService.Default),
  Effect.provide(CustomHttpClient) // Replace default HTTP client
);
```

### Custom Cookie Management

```typescript
// Create custom cookie manager for special session handling
const CustomCookieManager = Layer.succeed(
  CookieManager,
  {
    setCookie: (cookieString: string, url: string) => 
      Effect.gen(function* () {
        // Custom cookie storage logic
        console.log(`Setting custom cookie for ${url}`);
      }),
    getCookies: (url: string) => 
      Effect.succeed(['custom=cookie']),
    getCookieHeader: (url: string) => 
      Effect.succeed('custom=cookie'),
    clearCookies: () => Effect.succeed(undefined),
    serialize: () => Effect.succeed('{}'),
    deserialize: (data: string) => Effect.succeed(undefined)
  } as CookieManagerService
);
```

### Custom Sink Processing

```typescript
// Create custom result processing logic
const customProcessingSink = Sink.forEach((result: CrawlResult) =>
  Effect.gen(function* () {
    // Custom processing for each crawled page
    const pageData = result.pageData;
    
    // Extract custom data using Cheerio
    const $ = cheerio.load(pageData.html);
    const customData = {
      title: pageData.title,
      links: pageData.links?.length || 0,
      images: $('img').length,
      forms: $('form').length
    };
    
    // Save to custom storage, send to API, etc.
    console.log(`Custom data for ${pageData.url}:`, customData);
  })
);

// Use with spider
const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  yield* spider.crawl(['https://example.com'], customProcessingSink);
});
```

## Performance Considerations

### Optimisation Strategies

**Connection Pooling:** HTTP connections are reused across requests to the same domain.

**DNS Caching:** Domain name resolution results are cached to reduce lookup time.

**Content Compression:** Requests accept gzip/deflate compression to reduce bandwidth.

**Selective Processing:** Only requested data is extracted from pages to reduce CPU usage.

### Scaling Patterns

**Horizontal Scaling:** Multiple Spider instances can coordinate through shared cookie storage and result sinks.

**Vertical Scaling:** Single instances are tuned through SpiderConfig parameters (maxConcurrentWorkers, requestDelayMs, maxPages).

**Hybrid Approaches:** Combine multiple strategies based on use case requirements.

## Design Trade-offs

### Complexity vs. Flexibility

**Trade-off:** The middleware and service architecture adds complexity compared to a simple scraping script.

**Rationale:** The complexity pays off for non-trivial scraping needs where requirements change over time.

### Memory vs. Resumability

**Trade-off:** Storing state for resumability uses memory and storage resources.

**Rationale:** The ability to resume long-running operations is crucial for production scraping scenarios.

### Performance vs. Respectfulness

**Trade-off:** Built-in delays and rate limiting reduce scraping speed.

**Rationale:** Sustainable scraping practices are more important than maximum speed.

## Future Architecture Evolution

The architecture is designed to accommodate future enhancements:

### Planned Extensions

- **Additional HTTP Services** - WebSocket support, GraphQL client integration
- **Enhanced Storage Services** - Redis-based cookie management, database result storage
- **Advanced Sink Implementations** - Streaming to message queues, real-time processing
- **Observability Integration** - OpenTelemetry tracing, metrics collection services
- **Browser Automation Services** - Playwright/Puppeteer integration for JavaScript-heavy sites

### Architectural Principles for Evolution

- **Backward Compatibility** - New features won't break existing code
- **Gradual Adoption** - New capabilities are opt-in, not mandatory
- **Performance Preservation** - Enhancements won't degrade existing performance characteristics

This architecture reflects years of experience with web scraping challenges and is designed to handle both simple scripts and production-scale data collection operations.
