# Spider Documentation

Welcome to the Spider documentation. Spider is a powerful, Effect.js-based web crawling framework for TypeScript applications.

## 📚 Documentation Structure

### Getting Started
- [Installation & Setup](./guides/getting-started.md) - Get Spider up and running
- [Configuration Guide](./guides/configuration.md) - Configure Spider for your needs
- [Basic Examples](./examples/basic-crawling.md) - Simple crawling examples

### Core Concepts
- [Spider Service](./api/spider-service.md) - Main crawling orchestration
- [Middleware System](./api/middleware.md) - Request/response processing pipeline
- [Link Extraction](./api/link-extractor.md) - Discovering and filtering links
- [Resumability](./api/resumability.md) - State persistence and recovery

### Advanced Features
- [Browser Automation](./guides/browser-automation.md) - Playwright integration for dynamic content
- [HTTP Client](./api/http-client.md) - Enhanced HTTP client with sessions
- [State Management](./api/state-manager.md) - Token and state management
- [Worker Health Monitoring](./api/worker-health.md) - Performance monitoring

### Real-World Examples
- [Web-scraping.dev Scenarios](./examples/scenarios.md) - Solutions for all 16 challenge scenarios
- [Enterprise Patterns](./examples/enterprise-patterns.md) - Production-ready patterns

## 🎯 Quick Start

```typescript
import { SpiderService, makeSpiderConfig } from '@jambudipa/spider'
import { Effect, Sink } from 'effect'

const program = Effect.gen(function* () {
  const spider = yield* SpiderService
  
  const collectSink = Sink.forEach(result =>
    Effect.sync(() => console.log(`Found: ${result.pageData.title}`))
  )
  
  yield* spider.crawl('https://example.com', collectSink)
})

Effect.runPromise(program.pipe(
  Effect.provide(SpiderService.Default)
))
```

## 🏆 Battle-Tested

Spider successfully handles ALL 16 [web-scraping.dev](https://web-scraping.dev) challenge scenarios with 100% pass rate:

- ✅ Static & dynamic content crawling
- ✅ Authentication & security handling  
- ✅ Anti-bot protection bypass
- ✅ Browser automation for JavaScript-heavy sites
- ✅ Session management & cookie handling
- ✅ PDF downloads & file handling

## 📦 What's Exported

Spider exports the following main components:

### Services
- `SpiderService` - Main crawler service
- `LinkExtractorService` - Link discovery and filtering
- `ResumabilityService` - State persistence
- `SpiderSchedulerService` - Request scheduling
- `UrlDeduplicatorService` - URL deduplication

### Configuration
- `makeSpiderConfig()` - Configuration factory
- `SpiderConfig` - Configuration class
- `SpiderConfigOptions` - Configuration interface

### Middleware
- `MiddlewareManager` - Middleware chain management
- `LoggingMiddleware` - Request/response logging
- `RateLimitMiddleware` - Rate limiting
- `UserAgentMiddleware` - User agent management
- `StatsMiddleware` - Statistics collection

### HTTP & State
- `EnhancedHttpClient` - Enhanced HTTP client
- `CookieManager` - Cookie management
- `SessionStore` - Session storage
- `TokenExtractor` - Token extraction
- `StateManager` - State management

### Browser Automation
- `BrowserManager` - Browser pool management
- `PlaywrightAdapter` - Playwright wrapper

### Storage Backends
- `FileStorageBackend` - File-based persistence
- `PostgresStorageBackend` - PostgreSQL storage
- `RedisStorageBackend` - Redis storage

### Error Types
- `NetworkError` - Network-related errors
- `ResponseError` - HTTP response errors
- `RobotsTxtError` - Robots.txt violations
- `ConfigurationError` - Configuration errors
- `MiddlewareError` - Middleware processing errors

## 🔍 Finding What You Need

### "I want to..."

**...crawl a simple website**
→ Start with [Getting Started](./guides/getting-started.md)

**...handle JavaScript-rendered content**
→ See [Browser Automation](./guides/browser-automation.md)

**...bypass anti-bot protection**
→ Check the [web-scraping.dev scenarios](./examples/scenarios.md)

**...resume interrupted crawls**
→ Learn about [Resumability](./api/resumability.md)

**...customise request processing**
→ Explore [Middleware](./api/middleware.md)

**...scale to thousands of pages**
→ Read about [Configuration](./guides/configuration.md)

## 📖 API Reference

Detailed API documentation for all exported components:

- [Spider Service API](./api/spider-service.md)
- [Middleware API](./api/middleware.md)
- [Link Extractor API](./api/link-extractor.md)
- [Resumability API](./api/resumability.md)
- [HTTP Client API](./api/http-client.md)
- [State Manager API](./api/state-manager.md)

## 🚀 Next Steps

1. [Install Spider](./guides/getting-started.md#installation)
2. [Configure your first crawler](./guides/configuration.md)
3. [Run the examples](./examples/basic-crawling.md)
4. [Explore advanced features](./guides/browser-automation.md)

## 📞 Support

- [GitHub Issues](https://github.com/jambudipa/spider/issues)
- [NPM Package](https://www.npmjs.com/package/@jambudipa/spider)

---

Built with Effect.js for type-safe, composable web crawling.