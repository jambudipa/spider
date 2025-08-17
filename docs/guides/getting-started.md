# Getting Started with Spider

Welcome to Spider - a powerful, Effect.js-based web crawling framework. This guide will get you up and running with your first web crawl in just a few minutes.

## Prerequisites

- **Node.js 18+** - Spider requires modern Node.js features
- **TypeScript 5.0+** - For TypeScript projects (recommended)
- **Basic Effect.js knowledge** - Helpful but not required for basic usage

## Installation

Install Spider and its peer dependency Effect.js:

```bash
npm install @jambudipa/spider effect
```

For TypeScript projects, types are included automatically.

## Your First Crawl

Let's start with a simple example that crawls a website and logs the page titles:

```typescript
import { SpiderService, makeSpiderConfig } from '@jambudipa/spider'
import { Effect, Sink } from 'effect'

// Create a simple program
const crawlProgram = Effect.gen(function* () {
  // Get the spider service
  const spider = yield* SpiderService
  
  // Define how to handle each crawled page
  const collectSink = Sink.forEach(result =>
    Effect.sync(() => {
      console.log(`📄 ${result.pageData.title}`)
      console.log(`🔗 ${result.pageData.url}`)
      console.log(`📊 Depth: ${result.depth}`)
      console.log('---')
    })
  )
  
  // Start crawling
  yield* spider.crawl('https://example.com', collectSink)
  
  console.log('✅ Crawling completed!')
})

// Run the program with default configuration
Effect.runPromise(crawlProgram.pipe(
  Effect.provide(SpiderService.Default)
)).catch(console.error)
```

Run this example:

```bash
npx tsx your-crawler.ts  # or ts-node if you prefer
```

## Understanding the Example

Let's break down what's happening:

### 1. The Spider Service
```typescript
const spider = yield* SpiderService
```
This gets the SpiderService using Effect.js dependency injection. The spider handles all crawling operations.

### 2. The Result Sink
```typescript
const collectSink = Sink.forEach(result =>
  Effect.sync(() => {
    // Process each crawled page here
  })
)
```
Sinks define how to process crawled pages. Spider streams results to your sink as pages are discovered and processed.

### 3. Starting the Crawl
```typescript
yield* spider.crawl('https://example.com', collectSink)
```
This starts crawling from the given URL, sending all results to your sink.

### 4. Configuration Layer
```typescript
Effect.provide(SpiderService.Default)
```
This provides the default Spider configuration. You can customise this as needed.

## Adding Configuration

Let's enhance the example with some configuration:

```typescript
import { SpiderService, makeSpiderConfig } from '@jambudipa/spider'
import { Effect, Sink } from 'effect'

const crawlProgram = Effect.gen(function* () {
  const spider = yield* SpiderService
  
  const collectSink = Sink.forEach(result =>
    Effect.sync(() => {
      console.log(`📄 ${result.pageData.title} (depth: ${result.depth})`)
    })
  )
  
  // Start crawling with multiple URLs
  yield* spider.crawl([
    'https://example.com',
    'https://httpbin.org'
  ], collectSink)
})

// Custom configuration
const customConfig = makeSpiderConfig({
  maxDepth: 2,        // Only crawl 2 levels deep
  maxPages: 20,       // Stop after 20 pages
  requestDelayMs: 1000, // 1 second between requests
  ignoreRobotsTxt: false, // Follow robots.txt rules
  maxConcurrentWorkers: 3 // Use 3 concurrent workers
})

Effect.runPromise(crawlProgram.pipe(
  Effect.provide(customConfig)
)).catch(console.error)
```

## Error Handling

Spider uses Effect.js for robust error handling:

```typescript
const safeCrawlProgram = Effect.gen(function* () {
  const spider = yield* SpiderService
  
  const collectSink = Sink.forEach(result =>
    Effect.sync(() => {
      console.log(`✅ Successfully crawled: ${result.pageData.url}`)
    })
  )
  
  // Crawl with error handling
  const result = yield* spider.crawl('https://example.com', collectSink).pipe(
    Effect.catchTags({
      NetworkError: (error) => {
        console.log(`🌐 Network error: ${error.message}`)
        return Effect.succeed(null)
      },
      RobotsTxtError: (error) => {
        console.log(`🤖 Robots.txt blocked: ${error.message}`)
        return Effect.succeed(null)
      }
    })
  )
  
  console.log('Crawl completed:', result)
})
```

## Working with Different Data

You can extract structured data from pages:

```typescript
const dataExtractionProgram = Effect.gen(function* () {
  const spider = yield* SpiderService
  
  // Collect results into an array
  const results = yield* spider.crawl('https://example.com', Sink.collectAll())
  
  // Process the collected data
  for (const result of results) {
    const { pageData } = result
    
    console.log({
      title: pageData.title,
      url: pageData.url,
      linkCount: pageData.links.length,
      contentLength: pageData.html.length
    })
  }
  
  return results
})
```

## Next Steps

Now that you have Spider running, explore these topics:

### Configuration
- **[Configuration Guide](./configuration.md)** - Learn about all configuration options
- **[Performance Tuning](./performance.md)** - Optimise crawling performance
- **[Rate Limiting](./configuration.md#rate-limiting)** - Control request rates

### Advanced Features
- **[Middleware Development](./middleware.md)** - Create custom processing middleware
- **[Resumability](../features/state-persistence.md)** - Pause and resume crawls
- **[Monitoring](../features/monitoring.md)** - Monitor crawling operations

### Examples
- **[Basic Examples](../examples/basic-crawling.md)** - More crawling patterns
- **[E-commerce Examples](../examples/e-commerce-scraping.md)** - Product data extraction
- **[Enterprise Patterns](../examples/enterprise-patterns.md)** - Production-ready solutions

### API Reference
- **[Spider API](../api/spider.md)** - Complete Spider service documentation
- **[Configuration API](../api/config.md)** - All configuration options
- **[Error Handling](../api/errors.md)** - Error types and handling

## Common Issues

### Permission Errors
If you get robots.txt permission errors, you can disable robots.txt checking:

```typescript
const config = makeSpiderConfig({
  ignoreRobotsTxt: true // ⚠️ Use responsibly
})
```

### Memory Usage
For large crawls, consider using streaming sinks instead of collecting all results:

```typescript
// Instead of Sink.collectAll()
const streamingSink = Sink.forEach(result =>
  Effect.sync(() => {
    // Process each result immediately
    processResult(result)
  })
)
```

### TypeScript Issues
Ensure you have Effect.js types installed:

```bash
npm install --save-dev @types/node
```

## Getting Help

- **[Documentation](../README.md)** - Complete documentation index
- **[API Reference](../api/)** - Detailed API documentation  
- **[Examples](../examples/)** - Working code examples
- **[GitHub Issues](https://github.com/jambudipa/spider/issues)** - Report bugs or request features

Ready to build something amazing? Check out our [examples](../examples/) or dive into the [API documentation](../api/)!