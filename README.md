# @jambudipa/spider

A powerful, Effect.js-based web crawling framework for modern TypeScript applications. Built for type safety, composability, and enterprise-scale crawling operations.

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

🎯 **[View Live Test Results](https://github.com/jambudipa/spider/actions)** | 📊 **100% Test Pass Rate** | 🚀 **Production Ready**

## ✨ Key Features

- **🔥 Effect.js Foundation**: Type-safe, functional composition with robust error handling
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
import { SpiderService, makeSpiderConfig } from '@jambudipa/spider'
import { Effect, Sink } from 'effect'

const program = Effect.gen(function* () {
  // Create spider instance
  const spider = yield* SpiderService
  
  // Set up result collection
  const collectSink = Sink.forEach(result =>
    Effect.sync(() => console.log(`Found: ${result.pageData.title}`))
  )
  
  // Start crawling
  yield* spider.crawl('https://example.com', collectSink)
})

// Run with default configuration
Effect.runPromise(program.pipe(
  Effect.provide(SpiderService.Default)
))
```

## 🎯 What's Next?

### 🆕 New to Spider?
- **[Getting Started Guide](./docs/guides/getting-started.md)** - Complete setup and first crawl
- **[Examples](./docs/examples/)** - Working examples to get you started
- **[Basic Configuration](./docs/guides/configuration.md)** - Configuration options

### 🔄 Advanced Usage
- **[Browser Automation](./docs/guides/browser-automation.md)** - Handle dynamic content
- **[Anti-Bot Protection](./docs/guides/anti-bot.md)** - Bypass blocking mechanisms
- **[Security Handling](./docs/guides/security.md)** - Authentication and sessions

### 🏭 Building Production Systems?
- **[Performance Guide](./docs/guides/performance.md)** - Scale your crawling operations
- **[API Reference](./docs/api/)** - Complete technical documentation
- **[Enterprise Patterns](./docs/examples/enterprise-patterns.md)** - Production-ready patterns

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
  // Basic settings
  maxDepth: 5,
  maxPages: 1000,
  respectRobotsTxt: true,
  
  // Rate limiting
  rateLimitDelay: 2000,
  maxConcurrentRequests: 3,
  
  // Content handling
  followRedirects: true,
  maxRedirects: 5,
  
  // Timeouts
  requestTimeout: 30000,
  
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
  SpiderService, 
  ResumabilityService,
  FileStorageBackend 
} from '@jambudipa/spider';
import { Effect, Layer } from 'effect';

// Configure resumability with file storage
const resumabilityLayer = Layer.succeed(
  ResumabilityService,
  ResumabilityService.of({
    strategy: 'hybrid',
    backend: new FileStorageBackend('./spider-state')
  })
);

const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  const resumability = yield* ResumabilityService;
  
  // Configure session
  const sessionKey = 'my-scraping-session';
  
  // Check for existing session
  const existingState = yield* resumability.restore(sessionKey);
  
  if (existingState) {
    console.log('Resuming previous session...');
    // Resume from saved state
    yield* spider.resumeFromState(existingState);
  }
  
  // Start or continue crawling
  const result = yield* spider.crawl({
    url: 'https://example.com',
    sessionKey,
    saveState: true
  });
  
  return result;
}).pipe(
  Effect.provide(Layer.mergeAll(
    SpiderService.Default,
    resumabilityLayer
  ))
);
```

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

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxDepth` | number | 3 | Maximum crawling depth |
| `maxPages` | number | 100 | Maximum pages to crawl |
| `respectRobotsTxt` | boolean | true | Follow robots.txt rules |
| `rateLimitDelay` | number | 1000 | Delay between requests (ms) |
| `maxConcurrentRequests` | number | 1 | Maximum concurrent requests |
| `requestTimeout` | number | 30000 | Request timeout (ms) |
| `followRedirects` | boolean | true | Follow HTTP redirects |
| `maxRedirects` | number | 5 | Maximum redirect hops |
| `userAgent` | string | Auto-generated | Custom user agent string |

## Error Handling

The library uses Effect for comprehensive error handling:

```typescript
import { NetworkError, ResponseError, RobotsTxtError } from '@jambudipa/spider';

const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  
  const result = yield* spider.crawl({
    url: 'https://example.com'
  }).pipe(
    Effect.catchTags({
      NetworkError: (error) => {
        console.log('Network issue:', error.message);
        return Effect.succeed(null);
      },
      ResponseError: (error) => {
        console.log('HTTP error:', error.statusCode);
        return Effect.succeed(null);
      },
      RobotsTxtError: (error) => {
        console.log('Robots.txt blocked:', error.message);
        return Effect.succeed(null);
      }
    })
  );
  
  return result;
});
```

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
import { WorkerHealthMonitorService } from '@jambudipa/spider';

const program = Effect.gen(function* () {
  const healthMonitor = yield* WorkerHealthMonitorService;
  
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

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type checking
npm run typecheck

# Linting
npm run lint

# Format code
npm run format
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## 📚 Documentation

Comprehensive documentation is available in the [`/docs`](./docs) directory:

### 🚀 Quick Links
- **[Getting Started Guide](./docs/guides/getting-started.md)** - Installation, setup, and first crawl
- **[API Reference](./docs/api/)** - Complete API documentation
- **[Examples](./docs/examples/)** - Working examples for common use cases

### 📖 Complete Documentation
- **[Documentation Index](./docs/README.md)** - Overview of all available documentation
- **[User Guides](./docs/guides/)** - Step-by-step tutorials and best practices
- **[Feature Documentation](./docs/features/)** - Deep dives into key capabilities
- **[Advanced Examples](./docs/examples/)** - Real-world usage patterns

## Support

- [GitHub Issues](https://github.com/jambudipa/spider/issues)
- [Complete Documentation](./docs/)
- [Working Examples](./docs/examples/)

---

Built with ❤️ by [JAMBUDIPA](https://jambudipa.io)
