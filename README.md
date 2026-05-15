# @jambudipa/spider

[![CI Status](https://github.com/jambudipa/spider/workflows/Spider%20Scenario%20Tests/badge.svg)](https://github.com/jambudipa/spider/actions)
[![Coverage](https://codecov.io/gh/jambudipa/spider/branch/main/graph/badge.svg)](https://codecov.io/gh/jambudipa/spider)
[![npm version](https://badge.fury.io/js/@jambudipa%2Fspider.svg)](https://badge.fury.io/js/@jambudipa%2Fspider)
[![Node.js Version](https://img.shields.io/node/v/@jambudipa/spider.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A powerful, Effect-based web crawling framework for modern TypeScript applications. Built for type safety, composability, and enterprise-scale crawling operations.

> **⚠️ Pre-Release API**: Spider is currently in pre-release development (v0.x.x). The API may change frequently as we refine the library towards a stable v1.0.0 release. Consider this when using Spider in production environments and expect potential breaking changes in minor version updates.

## 🏆 **Battle-Tested Against Real-World Scenarios**

**Spider successfully handles ALL 16 https://web-scraping.dev challenge scenarios** - the most comprehensive web scraping test suite available:

| ✅ Scenario | Description | Complexity |
|-------------|-------------|------------|
| **Static Paging** | Traditional pagination navigation | Basic |
| **Endless Scroll** | Infinite scroll content loading | Dynamic |
| **Button Loading** | Dynamic content via button clicks | Dynamic |
| **GraphQL Requests** | Background API data fetching | Advanced |
| **Hidden Data** | Extracting non-visible content | Intermediate |
| **Product Markup** | Structured data extraction | Intermediate |
| **Local Storage** | Browser storage interaction | Advanced |
| **Secret API Tokens** | Authentication handling | Security |
| **CSRF Protection** | Token-based security bypass | Security |
| **Cookie Authentication** | Session-based access control | Security |
| **PDF Downloads** | Binary file handling | Special |
| **Cookie Popups** | Modal interaction handling | Special |
| **New Tab Links** | Multi-tab navigation | Special |
| **Block Pages** | Anti-bot detection handling | Anti-Block |
| **Invalid Referer Blocking** | Header-based access control | Anti-Block |
| **Persistent Cookie Blocking** | Long-term blocking mechanisms | Anti-Block |

🎯 **[View Live Test Results](https://github.com/jambudipa/spider/actions/workflows/ci.yml)** | 📊 **All Scenario Tests Passing** | 🚀 **Production Ready**

> **Live Testing**: Our CI pipeline runs all 16 web scraping scenarios against real websites daily, ensuring Spider remains robust against changing web technologies.

### 🔍 **Current Status** (Updated: May 2026)
- ✅ **Core Functionality**: All web scraping scenarios working
- ✅ **Type Safety**: Full TypeScript compilation without errors
- ✅ **Build System**: Package builds successfully for distribution
- ✅ **Test Suite**: 243 tests passing against live websites (25 test files)
- ✅ **Code Quality**: Clean - only 3 linting warnings (skipped test suites)

## ✨ Key Features

- **🔥 Effect Foundation**: Type-safe, functional composition with robust error handling
- **⚡ High Performance**: Concurrent crawling with intelligent worker pool management  
- **🤖 Robots.txt Compliant**: Automatic robots.txt parsing and compliance checking
- **🔄 Resumable Crawls**: State persistence and crash recovery capabilities
- **🛡️ Anti-Bot Bypass**: Handles complex blocking mechanisms and security measures
- **🌐 Browser Automation**: Playwright integration for JavaScript-heavy sites
- **📊 Built-in Monitoring**: Comprehensive logging and performance monitoring
- **🎯 TypeScript First**: Full type safety with excellent IntelliSense support

## 🚀 Getting Started

### Installation

```bash
npm install @jambudipa/spider effect
```

### Your First Crawl

```typescript
import { CrawlResult, SpiderService } from '@jambudipa/spider'
import { Effect, Sink } from 'effect'

const program = Effect.gen(function* () {
  // Create spider instance
  const spider = yield* SpiderService
  
  // Set up result collection
  const collectSink = Sink.forEach<CrawlResult>(result =>
    Effect.sync(() => {
      if (CrawlResult.isOk(result)) {
        console.log(`Found: ${result.pageData.title}`)
      }
    })
  )
  
  // Start crawling
  yield* spider.crawl('https://example.com', collectSink)
})

// Run with default configuration
Effect.runPromise(program.pipe(
  Effect.provide(SpiderService.Default)
))
```

## 📚 Documentation

**Comprehensive documentation is now available** following the [Diátaxis framework](https://diataxis.fr/) for better learning and reference:

### 🎓 New to Spider?
Start with our **[Tutorial](./docs/tutorial/getting-started.md)** - a hands-on guide that takes you from installation to building advanced scrapers.

### 📋 Need to solve a specific problem?
Check our **[How-to Guides](./docs/how-to/)** for targeted solutions:
- **[Authentication](./docs/how-to/authentication.md)** - Handle logins, sessions, and auth flows
- **[Data Extraction](./docs/how-to/data-extraction.md)** - Extract structured data from HTML
- **[Resumable Operations](./docs/how-to/resumable-operations.md)** - Build fault-tolerant crawlers

### 📚 Need technical details?
See our **[Reference Documentation](./docs/reference/)**:
- **[API Reference](./docs/reference/api-reference.md)** - Complete API documentation
- **[Configuration](./docs/reference/configuration.md)** - All configuration options

### 🧠 Want to understand the design?
Read our **[Explanations](./docs/explanation/)**:
- **[Architecture](./docs/explanation/architecture.md)** - System design and philosophy
- **[Web Scraping Concepts](./docs/explanation/web-scraping-concepts.md)** - Core principles

**📖 [Browse All Documentation →](./docs/README.md)**

## 🛠️ Quick Configuration

```typescript
import { makeSpiderConfig } from '@jambudipa/spider'

const config = makeSpiderConfig({
  maxDepth: 3,
  maxPages: 100,
  maxConcurrentWorkers: 5,
  ignoreRobotsTxt: false, // Respect robots.txt
  requestDelayMs: 1000
})
```

## Core Concepts

### Spider Configuration

The spider can be configured for different scraping scenarios:

```typescript
import { makeSpiderConfig } from '@jambudipa/spider';

const config = makeSpiderConfig({
  // Crawl limits
  maxDepth: 5,
  maxPages: 1000,
  ignoreRobotsTxt: false,

  // Rate limiting
  requestDelayMs: 2000,
  maxConcurrentRequests: 3,
  maxRequestsPerSecondPerDomain: 1,

  // Content handling
  followRedirects: true,

  // User agent
  userAgent: 'MyBot/1.0'
});
```

### Middleware System

Add custom processing with middleware:

```typescript
import { 
  SpiderService, 
  MiddlewareManager,
  LoggingMiddleware,
  RateLimitMiddleware,
  UserAgentMiddleware 
} from '@jambudipa/spider';

const middlewares = new MiddlewareManager()
  .use(new LoggingMiddleware({ level: 'info' }))
  .use(new RateLimitMiddleware({ delay: 1000 }))
  .use(new UserAgentMiddleware({ 
    userAgent: 'MyBot/1.0 (+https://example.com/bot)' 
  }));

// Use with spider configuration
const config = makeSpiderConfig({
  middleware: middlewares
});
```

### Resumable Scraping

Resume interrupted scraping sessions:

```typescript
import { 
  CrawlResult,
  makeSpiderConfig,
  SpiderConfig,
  SpiderEventSinkNoop,
  SpiderService,
  SpiderStateKey,
} from '@jambudipa/spider';
import { Effect, Sink } from 'effect';

// Enable resumability in config
const config = makeSpiderConfig({ enableResumability: true, maxPages: 50 });

const collectSink = Sink.forEach<CrawlResult>(result =>
  Effect.sync(() => {
    if (CrawlResult.isOk(result)) console.log(`Scraped: ${result.pageData.url}`)
  })
);

// Initial crawl — saves state automatically
const startCrawl = Effect.gen(function* () {
  const spider = yield* SpiderService;
  yield* spider.crawl('https://example.com', collectSink);
}).pipe(
  Effect.provide(SpiderService.Default),
  Effect.provide(SpiderConfig.Live(config)),
  Effect.provide(SpiderEventSinkNoop),
);

// Resume a previous session
const resumeCrawl = Effect.gen(function* () {
  const spider = yield* SpiderService;
  const stateKey = new SpiderStateKey({
    id: 'my-crawl-session',
    timestamp: new Date('2024-01-01'),
    name: 'Example Crawl',
  });
  yield* spider.resume(stateKey, collectSink);
}).pipe(
  Effect.provide(SpiderService.Default),
  Effect.provide(SpiderConfig.Live(config)),
  Effect.provide(SpiderEventSinkNoop),
);
```

See `src/examples/07-resumability-demo.ts` for a complete example with `FileStorageBackend`.

### Link Extraction

Extract and process links from pages:

```typescript
import { LinkExtractorService } from '@jambudipa/spider';

const program = Effect.gen(function* () {
  const linkExtractor = yield* LinkExtractorService;
  
  const result = yield* linkExtractor.extractLinks({
    html: '<html>...</html>',
    baseUrl: 'https://example.com',
    filters: {
      allowedDomains: ['example.com', 'sub.example.com'],
      excludePatterns: ['/admin', '/private']
    }
  });
  
  console.log(`Found ${result.links.length} links`);
  return result;
}).pipe(
  Effect.provide(LinkExtractorService.Default)
);
```

## API Reference

### Core Services

- **SpiderService**: Main spider service for web crawling
- **SpiderSchedulerService**: Manages crawling queue and prioritisation
- **LinkExtractorService**: Extracts and filters links from HTML content
- **ResumabilityService**: Handles state persistence and resumption
- **ScraperService**: Low-level HTTP scraping functionality

### Configuration

- **SpiderConfig**: Main configuration interface
- **makeSpiderConfig()**: Factory function for creating configurations

### Middleware

- **MiddlewareManager**: Manages middleware chain
- **LoggingMiddleware**: Logs requests and responses
- **RateLimitMiddleware**: Implements rate limiting
- **UserAgentMiddleware**: Sets custom user agents
- **StatsMiddleware**: Collects scraping statistics

### Storage Backends

- **FileStorageBackend**: File-based state storage
- **PostgresStorageBackend**: PostgreSQL storage (requires database)
- **RedisStorageBackend**: Redis storage (requires Redis server)

## Logging and Observability

Spider exposes two independent observability surfaces, both overridable by client code.

### 1. Diagnostic logs (Effect Logger)

All `Effect.log*` calls inside Spider (`logDebug`, `logInfo`, `logWarning`, `logError`) flow through the standard Effect `Logger` system, with structured fields attached via `Effect.annotateLogs`. Override with `Logger.replace`:

```typescript
import { Effect, Logger, LogLevel } from 'effect';

const myLogger = Logger.make(({ logLevel, message, annotations }) => {
  // Route to pino, datadog, OpenTelemetry, file, etc.
  console.log(JSON.stringify({ level: logLevel.label, message, ...Object.fromEntries(annotations) }));
});

program.pipe(
  Effect.provide(SpiderService.Default),
  Effect.provide(Logger.replace(Logger.defaultLogger, myLogger)),
  Logger.withMinimumLogLevel(LogLevel.Info),
);
```

### 2. Domain events (`SpiderEventSink`)

Typed lifecycle and progress signals — `SpiderStart`, `SpiderComplete`, `SpiderError`, `DomainStart`, `DomainComplete`, `PageScraped` — are emitted to a `SpiderEventSink`. The default sink (`SpiderEventSinkNoop`) discards them. Subscribe by providing your own:

```typescript
import { Effect, Layer } from 'effect';
import { SpiderEventSink } from '@jambudipa/spider';

const AnalyticsSink = Layer.succeed(SpiderEventSink, {
  emit: (event) => Effect.sync(() => analytics.track(event._tag, event)),
});

program.pipe(
  Effect.provide(SpiderService.Default),
  Effect.provide(AnalyticsSink),
);
```

`SpiderEvent` is a discriminated union — switch on `_tag` for exhaustive handling.

See `src/examples/10-custom-logging.ts` for a complete example.

## Configuration Options

### Basic

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ignoreRobotsTxt` | `boolean` | `false` | Skip robots.txt checks |
| `maxDepth` | `number` | — | Maximum BFS depth from start URL |
| `maxPages` | `number` | — | Hard page cap per domain |
| `userAgent` | `string` | `'JambudipaSpider/1.0'` | Default user agent string |
| `followRedirects` | `boolean` | `true` | Follow HTTP redirects |
| `respectNoFollow` | `boolean` | `true` | Honour `rel="nofollow"` |
| `enableResumability` | `boolean` | `false` | Enable crawl state persistence |
| `allowedDomains` | `string[]` | — | Restrict crawling to these domains |
| `blockedDomains` | `string[]` | — | Never crawl these domains |
| `allowedProtocols` | `string[]` | `['http:','https:','file:','ftp:']` | Permitted URL schemes |
| `normalizeUrlsForDeduplication` | `boolean` | `true` | Normalise URLs before dedup |
| `customUrlFilters` | `RegExp[]` | — | Patterns to exclude from crawling |

### Rate Limiting / Workers

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxConcurrentWorkers` | `number` | `5` | Worker fibers per domain |
| `concurrency` | `number \| 'unbounded' \| 'inherit'` | `4` | Inter-domain concurrency |
| `maxConcurrentRequests` | `number` | `10` | Total concurrent requests |
| `maxRequestsPerSecondPerDomain` | `number` | `2` | Per-domain rate cap |
| `requestDelayMs` | `number` | `1000` | Base courtesy delay (ms) |
| `maxRobotsCrawlDelayMs` | `number` | `2000` | Max robots.txt crawl-delay cap (ms) |

### URL Filtering

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `fileExtensionFilters` | `FileExtensionFilters` | all enabled | Toggle filtering by file category |
| `technicalFilters` | `TechnicalFilters` | all enabled | Toggle scheme/length/malformed checks |
| `skipFileExtensions` | `string[]` | — | Legacy: explicit extension blocklist (overrides `fileExtensionFilters`) |

### Advanced Config Objects

| Option | Type | Description |
|--------|------|-------------|
| `domainEquivalence` | `DomainEquivalenceConfig` | `www.` handling, protocol strictness, subdomain matching |
| `fetchRetry` | `FetchRetryConfig` | Retry policy: `maxAttempts`, `baseBackoffMs`, `retryOn` |
| `crossDomainRedirects` | `CrossDomainRedirectConfig` | Follow cross-domain redirects from start URLs |
| `userAgentStrategy` | `UserAgentStrategy` | `static`, `rotating`, or `custom` user-agent selection |

## Interrupt Mode (v0.10+)

By default, when a stop condition fires (`maxPages` reached, queue empty) the spider lets every in-flight fetch finish its full retry schedule before exiting. With production configs (`maxAttempts: 5`, `baseBackoffMs: 1000`) a stuck URL can tail for several minutes per worker.

`stopMode: 'interrupt'` changes this: when a stop condition fires, in-flight fetches are cancelled immediately and workers exit within `gracePeriodMs` (default 5 seconds).

```typescript
makeSpiderConfig({
  maxPages: 50,
  stopMode: 'interrupt',            // cancel in-flight on stop
  // or tune grace period:
  // stopMode: { kind: 'interrupt', gracePeriodMs: 3000 },
})
```

### External abort handle

To abort a running crawl programmatically, pass a `Deferred<void>` via `crawl()` options. Requires `stopMode: 'interrupt'` in the config.

```typescript
import { Deferred, Effect, Fiber } from 'effect';
import { makeSpiderConfig, SpiderConfig, SpiderEventSinkNoop, SpiderService } from '@jambudipa/spider';

const program = Effect.gen(function* () {
  const stopSignal = yield* Deferred.make<void>();
  const spider = yield* SpiderService;

  // Fork so we can resolve the stop signal concurrently
  const crawlFiber = yield* Effect.fork(
    spider.crawl(['https://example.com'], sink, { externalStopSignal: stopSignal })
  );

  // Abort after 30 seconds
  yield* Effect.sleep('30 seconds');
  yield* Deferred.succeed(stopSignal, undefined);
  return yield* Fiber.join(crawlFiber);
}).pipe(
  Effect.provide(SpiderService.Default),
  Effect.provide(SpiderConfig.Live(makeSpiderConfig({ stopMode: 'interrupt' }))),
  Effect.provide(SpiderEventSinkNoop),
);
```

### Interrupt events

Subscribe to new events emitted in interrupt mode via `SpiderEventSink`:

| Event | When emitted |
|-------|-------------|
| `WorkerInterruptedEvent` | Per interrupted worker fiber — fields: `workerId`, `domain`, `url`, `reason` |
| `DomainStoppedEvent` | Per domain that stopped — fields: `domain`, `reason`, `gracefulMs`, `forced` |
| `SpiderStoppedEvent` | When external abort fires — fields: `reason`, `totalDomains`, `totalPages`, `wallclockMs` |

`DomainCompleteEvent.reason` gains two new values: `'interrupted'` (clean exit within grace period) and `'interrupt_grace_exceeded'` (grace period expired, domain force-completed).

---

## Error Handling

Fetch errors are surfaced as `CrawlResultError` values inside the sink — they do not fail the Effect channel. Inspect `result.error.kind` (a `PageFetchErrorKind`) to branch on the failure type:

```typescript
import { CrawlResult } from '@jambudipa/spider';
import { Effect, Sink } from 'effect';

const collectSink = Sink.forEach<CrawlResult>(result =>
  Effect.sync(() => {
    if (CrawlResult.isOk(result)) {
      console.log(`OK: ${result.pageData.title}`);
    } else {
      switch (result.error.kind) {
        case 'timeout':
          console.log(`Timed out: ${result.url}`); break;
        case 'http_4xx':
          console.log(`Client error ${result.error.statusCode}: ${result.url}`); break;
        case 'http_5xx':
          console.log(`Server error ${result.error.statusCode}: ${result.url}`); break;
        case 'dns':
          console.log(`DNS failure: ${result.url}`); break;
        case 'http_429':
          console.log(`Rate limited: ${result.url}`); break;
        default:
          console.log(`Error (${result.error.kind}): ${result.error.message}`);
      }
    }
  })
);

const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  yield* spider.crawl('https://example.com', collectSink);
});
```

See `src/examples/09-error-handling-recovery.ts` for a full example.

## Advanced Usage

### Custom Middleware

Create custom middleware for specific needs:

```typescript
import { SpiderMiddleware, SpiderRequest, SpiderResponse } from '@jambudipa/spider';
import { Effect } from 'effect';

class CustomAuthMiddleware implements SpiderMiddleware {
  constructor(private apiKey: string) {}
  
  processRequest(request: SpiderRequest): Effect.Effect<SpiderRequest, never> {
    return Effect.succeed({
      ...request,
      headers: {
        ...request.headers,
        'Authorization': `Bearer ${this.apiKey}`
      }
    });
  }
  
  processResponse(response: SpiderResponse): Effect.Effect<SpiderResponse, never> {
    return Effect.succeed(response);
  }
}

// Use in middleware chain
const middlewares = new MiddlewareManager()
  .use(new CustomAuthMiddleware('your-api-key'));
```

### Performance Monitoring

Monitor scraping performance:

```typescript
import { WorkerHealthMonitor } from '@jambudipa/spider';

const program = Effect.gen(function* () {
  const healthMonitor = yield* WorkerHealthMonitor;
  
  // Start monitoring
  yield* healthMonitor.startMonitoring();
  
  // Your scraping code here...
  
  // Get health metrics
  const metrics = yield* healthMonitor.getMetrics();
  
  console.log('Performance metrics:', {
    requestsPerMinute: metrics.requestsPerMinute,
    averageResponseTime: metrics.averageResponseTime,
    errorRate: metrics.errorRate
  });
});
```

## Development

```bash
# Install dependencies
npm install

# Build the package
npm run build

# Run tests (all scenarios)
npm test

# Run tests with coverage
npm run test:coverage

# Type checking (must pass)
npm run typecheck

# Validate CI setup locally
npm run ci:validate

# Code quality
npm run lint        # Shows 3 warnings (skipped tests)
npm run format     # Formats code consistently
```

### 🛠️ Contributing & Code Quality

**Current State**: The codebase is fully functional with comprehensive test coverage and clean linting.

- ✅ **Functional Changes**: All PRs must pass scenario tests
- ✅ **Type Safety**: TypeScript compilation must succeed
- ✅ **Build System**: Package must build without errors
- ✅ **Code Style**: ESLint configured with Effect-idiomatic rules

**Code Quality Commands**:
```bash
# Check for linting issues
npm run lint

# Fix auto-fixable issues
npm run lint:fix
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## 📚 Complete Documentation

All documentation is organized in the [`/docs`](./docs/) directory following the [Diátaxis framework](https://diataxis.fr/):

- **🎓 [Tutorial](./docs/tutorial/)** - Learning-oriented lessons for getting started
- **📋 [How-to Guides](./docs/how-to/)** - Problem-solving guides for specific tasks
- **📚 [Reference](./docs/reference/)** - Technical reference and API documentation  
- **🧠 [Explanation](./docs/explanation/)** - Understanding-oriented documentation

**📖 [Start with the Documentation Index →](./docs/README.md)**

## Support

- [GitHub Issues](https://github.com/jambudipa/spider/issues) - Bug reports and feature requests
- [Documentation](./docs/) - Comprehensive guides and reference material
- [Tutorial](./docs/tutorial/getting-started.md) - Step-by-step learning guide

---

Built with ❤️ by [JAMBUDIPA](https://jambudipa.io)
