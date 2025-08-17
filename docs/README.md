# Spider Documentation

Welcome to the comprehensive documentation for Spider - a powerful, Effect.js-based web crawling framework designed for modern TypeScript applications.

## What is Spider?

Spider is a feature-rich web crawling framework that combines the power of Effect.js functional programming with robust crawling capabilities. It provides type-safe, composable, and highly configurable web scraping solutions for everything from simple data extraction to enterprise-scale crawling operations.

### Key Features

- **🔥 Effect.js Foundation**: Built on Effect.js for type safety, error handling, and functional composition
- **⚡ High Performance**: Concurrent crawling with intelligent worker pool management
- **🤖 Robots.txt Compliant**: Automatic robots.txt parsing and compliance checking
- **🔄 Resumable Crawls**: State persistence and crash recovery capabilities
- **🛡️ Middleware System**: Extensible middleware for rate limiting, authentication, and custom processing
- **📊 Built-in Monitoring**: Comprehensive logging and performance monitoring
- **🎯 TypeScript First**: Full type safety with excellent IntelliSense support

## Quick Start

### Installation

```bash
npm install @jambudipa/spider effect
```

### Your First Crawl

```typescript
import { SpiderService, makeSpiderConfig } from '@jambudipa/spider'
import { Effect, pipe } from 'effect'

const program = Effect.gen(function* () {
  // Create spider configuration
  const config = makeSpiderConfig({
    maxDepth: 2,
    maxPages: 10,
    respectRobotsTxt: true,
    concurrent: true
  })

  // Create spider instance
  const spider = yield* SpiderService

  // Perform crawl
  const results = yield* spider.crawl('https://example.com')
  
  console.log(`Crawled ${results.length} pages`)
  results.forEach(result => {
    console.log(`${result.pageData.url}: ${result.pageData.title}`)
  })
})

// Run the program
await Effect.runPromise(program)
```

## Documentation Structure

### 📖 API Reference
Complete API documentation for all components:

- **[Spider Service](./api/spider.md)** - Core crawling functionality
- **[Configuration](./api/config.md)** - Configuration options and patterns  
- **[Middleware](./api/middleware.md)** - Middleware system and built-in middleware
- **[Scheduler](./api/scheduler.md)** - Request scheduling and prioritisation
- **[Link Extractor](./api/link-extractor.md)** - Link discovery and filtering
- **[Resumability](./api/resumability.md)** - State persistence and recovery
- **[HTTP Client](./api/http-client.md)** - Enhanced HTTP client with session management
- **[Error Handling](./api/errors.md)** - Error types and handling strategies

### 📚 User Guides
Step-by-step guides for common scenarios:

- **[Getting Started](./guides/getting-started.md)** - Installation, setup, and first crawl
- **[Configuration Guide](./guides/configuration.md)** - Complete configuration reference
- **[Middleware Development](./guides/middleware.md)** - Creating custom middleware
- **[Advanced Patterns](./guides/advanced-patterns.md)** - Complex crawling strategies
- **[Performance Optimisation](./guides/performance.md)** - Scaling and performance tuning
- **[Error Handling](./guides/error-handling.md)** - Robust error handling patterns
- **[Testing Crawlers](./guides/testing.md)** - Testing strategies and best practices
- **[Migration Guide](./guides/migration.md)** - Migrating from other libraries

### ⭐ Features
Deep dives into key capabilities:

- **[Effect.js Integration](./features/effect-integration.md)** - Functional programming benefits
- **[Concurrent Crawling](./features/concurrent-crawling.md)** - Parallel processing and worker management
- **[Robots.txt Compliance](./features/robots-compliance.md)** - Automatic compliance handling
- **[State Persistence](./features/state-persistence.md)** - Resumability and crash recovery
- **[Monitoring & Observability](./features/monitoring.md)** - Built-in monitoring capabilities

### 🎯 Examples
Working examples organised by use case:

- **[Basic Crawling](./examples/basic-crawling.md)** - Simple crawling scenarios
- **[E-commerce Scraping](./examples/e-commerce-scraping.md)** - Product data extraction
- **[News Aggregation](./examples/news-aggregation.md)** - News site crawling patterns
- **[Enterprise Patterns](./examples/enterprise-patterns.md)** - Large-scale crawling solutions

## Core Concepts

### Spider Architecture

Spider follows a modular, composable architecture built on Effect.js principles:

```
┌─────────────────────────────────────┐
│ Spider Service (Orchestration)      │
├─────────────────────────────────────┤
│ Scheduler (Request Management)       │
├─────────────────────────────────────┤
│ Middleware (Processing Pipeline)     │
├─────────────────────────────────────┤
│ Scraper & Link Extractor           │
├─────────────────────────────────────┤
│ HTTP Client (Session Management)    │
├─────────────────────────────────────┤
│ Effect.js Foundation               │
└─────────────────────────────────────┘
```

### Effect.js Integration

Spider leverages Effect.js for:

- **Type Safety**: Compile-time guarantees and runtime validation
- **Error Handling**: Structured error handling with typed errors
- **Resource Management**: Automatic cleanup and resource safety
- **Composition**: Functional composition of crawling operations
- **Concurrency**: Safe concurrent operations with fiber management

### Configuration-Driven

Spider uses declarative configuration for maximum flexibility:

```typescript
const config = makeSpiderConfig({
  // Basic settings
  maxDepth: 3,
  maxPages: 100,
  
  // Performance tuning
  concurrent: true,
  maxConcurrent: 5,
  requestDelay: 1000,
  
  // Filtering
  allowedDomains: ['example.com'],
  urlPatterns: [/\/products\//],
  
  // Compliance
  respectRobotsTxt: true,
  userAgent: 'MyBot/1.0',
  
  // Middleware
  middleware: [
    rateLimitMiddleware,
    authMiddleware,
    customProcessingMiddleware
  ]
})
```

## Framework Comparison

| Feature | Spider | Puppeteer | Playwright | Scrapy |
|---------|---------|-----------|------------|---------|
| **Type Safety** | ✅ Full TypeScript | ⚠️ Limited | ⚠️ Limited | ❌ Python |
| **Functional Programming** | ✅ Effect.js | ❌ Imperative | ❌ Imperative | ❌ OOP |
| **Built-in Middleware** | ✅ Extensible | ❌ Manual | ❌ Manual | ✅ Yes |
| **State Persistence** | ✅ Multiple backends | ❌ Manual | ❌ Manual | ✅ Yes |
| **Robots.txt Compliance** | ✅ Automatic | ❌ Manual | ❌ Manual | ✅ Yes |
| **Error Recovery** | ✅ Effect.js errors | ⚠️ Try/catch | ⚠️ Try/catch | ✅ Built-in |
| **Resource Management** | ✅ Automatic | ⚠️ Manual | ⚠️ Manual | ✅ Built-in |

## Getting Help

### Documentation
- **[Complete API Reference](./api/)** - Detailed API documentation
- **[User Guides](./guides/)** - Step-by-step tutorials
- **[Working Examples](./examples/)** - Real-world usage patterns

### Community
- **[GitHub Issues](https://github.com/jambudipa/spider/issues)** - Bug reports and feature requests
- **[GitHub Discussions](https://github.com/jambudipa/spider/discussions)** - Questions and community chat
- **[Examples Repository](../examples/)** - Additional working examples

### Contributing
We welcome contributions! Please:

1. Read our [Contributing Guide](../CONTRIBUTING.md)
2. Check existing [Issues](https://github.com/jambudipa/spider/issues)
3. Join [Discussions](https://github.com/jambudipa/spider/discussions)
4. Submit PRs with tests and documentation

## What's Next?

### New to Spider?
1. **[Getting Started Guide](./guides/getting-started.md)** - Install and run your first crawl
2. **[Configuration Guide](./guides/configuration.md)** - Learn about configuration options
3. **[Basic Examples](./examples/basic-crawling.md)** - See working examples

### Migrating from Another Library?
1. **[Migration Guide](./guides/migration.md)** - Migration strategies and code comparisons
2. **[Advanced Patterns](./guides/advanced-patterns.md)** - Implement sophisticated crawling logic
3. **[Performance Guide](./guides/performance.md)** - Optimise for your use case

### Building Production Systems?
1. **[Performance Optimisation](./guides/performance.md)** - Scale crawling operations
2. **[Monitoring Guide](./features/monitoring.md)** - Set up observability
3. **[Enterprise Patterns](./examples/enterprise-patterns.md)** - Production-ready patterns

Ready to start crawling? Begin with the [Getting Started Guide](./guides/getting-started.md)!