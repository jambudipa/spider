# Getting Started with Spider

This guide will help you install Spider and create your first web crawler in TypeScript.

## Prerequisites

- Node.js 18+ installed
- TypeScript knowledge helpful but not required
- Basic understanding of async/await

## Installation

```bash
npm install @jambudipa/spider effect
```

Spider is built on Effect.js, so you'll need both packages.

### TypeScript Configuration

Add these compiler options to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  }
}
```

## Your First Crawler

### Basic Example

Create a file `crawler.ts`:

```typescript
import { SpiderService, makeSpiderConfig } from '@jambudipa/spider'
import { Effect, Sink } from 'effect'

const program = Effect.gen(function* () {
  // Get the spider service
  const spider = yield* SpiderService
  
  // Create a sink to collect results
  const collectSink = Sink.forEach(result =>
    Effect.sync(() => {
      console.log(`📄 Found page: ${result.pageData.title}`)
      console.log(`   URL: ${result.pageData.url}`)
      console.log(`   Links: ${result.pageData.links.length}`)
    })
  )
  
  // Start crawling
  yield* spider.crawl('https://example.com', collectSink)
})

// Run the program
Effect.runPromise(
  program.pipe(Effect.provide(SpiderService.Default))
).then(
  () => console.log('✅ Crawling completed!'),
  error => console.error('❌ Error:', error)
)
```

Run it:

```bash
npx tsx crawler.ts
```

## Configuration

### Basic Configuration

```typescript
import { makeSpiderConfig, SpiderService } from '@jambudipa/spider'
import { Effect, Layer } from 'effect'

// Create configuration
const config = makeSpiderConfig({
  maxDepth: 2,           // Only crawl 2 levels deep
  maxPages: 10,          // Stop after 10 pages
  requestDelayMs: 1000,  // Wait 1 second between requests
  userAgent: 'MyBot/1.0'
})

// Create a configured layer
const ConfiguredSpider = Layer.succeed(SpiderConfig, config).pipe(
  Layer.provide(SpiderService.Default)
)

// Use in your program
const program = Effect.gen(function* () {
  const spider = yield* SpiderService
  // ... crawling logic
})

Effect.runPromise(
  program.pipe(Effect.provide(ConfiguredSpider))
)
```

### Common Configuration Options

```typescript
const config = makeSpiderConfig({
  // Crawling limits
  maxDepth: 3,              // Maximum link depth
  maxPages: 100,            // Maximum pages to crawl
  
  // Performance
  maxConcurrentWorkers: 5,  // Parallel workers
  requestDelayMs: 2000,     // Delay between requests
  requestTimeout: 30000,    // Request timeout (30s)
  
  // Behaviour
  respectRobotsTxt: true,   // Respect robots.txt
  followRedirects: true,    // Follow HTTP redirects
  
  // User agent
  userAgent: 'MyBot/1.0 (+https://mysite.com/bot)'
})
```

## Handling Results

### Processing Pages

```typescript
const program = Effect.gen(function* () {
  const spider = yield* SpiderService
  
  const results: any[] = []
  
  const collectSink = Sink.forEach(result =>
    Effect.sync(() => {
      // Extract data from each page
      const pageData = {
        url: result.pageData.url,
        title: result.pageData.title,
        content: result.pageData.content,
        links: result.pageData.links,
        metadata: result.pageData.metadata
      }
      
      results.push(pageData)
      
      // Process immediately if needed
      if (pageData.url.includes('/product/')) {
        console.log('Found product page:', pageData.url)
      }
    })
  )
  
  yield* spider.crawl('https://example.com', collectSink)
  
  return results
})
```

### Error Handling

```typescript
import { NetworkError, ResponseError, RobotsTxtError } from '@jambudipa/spider'

const program = Effect.gen(function* () {
  const spider = yield* SpiderService
  
  yield* spider.crawl('https://example.com', collectSink).pipe(
    Effect.catchTags({
      NetworkError: (error) => {
        console.log('Network issue:', error.message)
        return Effect.succeed([]) // Return empty results
      },
      ResponseError: (error) => {
        console.log(`HTTP ${error.statusCode} error`)
        return Effect.succeed([])
      },
      RobotsTxtError: (error) => {
        console.log('Blocked by robots.txt:', error.message)
        return Effect.succeed([])
      }
    })
  )
})
```

## Adding Middleware

### Logging Middleware

```typescript
import { MiddlewareManager, LoggingMiddleware } from '@jambudipa/spider'

const middleware = new MiddlewareManager()
  .use(new LoggingMiddleware({ 
    level: 'info',
    logRequests: true,
    logResponses: true 
  }))

const config = makeSpiderConfig({
  middleware,
  maxPages: 10
})
```

### Rate Limiting

```typescript
import { RateLimitMiddleware } from '@jambudipa/spider'

const middleware = new MiddlewareManager()
  .use(new RateLimitMiddleware({
    requestsPerSecond: 2,
    perDomain: true
  }))
```

### Custom Headers

```typescript
class CustomHeaderMiddleware {
  name = 'custom-headers'
  
  processRequest(request) {
    return Effect.succeed({
      ...request,
      headers: {
        ...request.headers,
        'X-Custom-Header': 'value',
        'Accept': 'text/html'
      }
    })
  }
}

const middleware = new MiddlewareManager()
  .use(new CustomHeaderMiddleware())
```

## Link Filtering

### Domain Filtering

```typescript
const config = makeSpiderConfig({
  // Only crawl these domains
  allowedDomains: ['example.com', 'subdomain.example.com'],
  
  // Skip these file types
  skipFileExtensions: ['pdf', 'jpg', 'png', 'zip']
})
```

### Custom Link Extraction

```typescript
import { LinkExtractorService } from '@jambudipa/spider'

const program = Effect.gen(function* () {
  const linkExtractor = yield* LinkExtractorService
  
  const result = yield* linkExtractor.extractLinks({
    html: '<html>...</html>',
    baseUrl: 'https://example.com',
    filters: {
      allowedDomains: ['example.com'],
      excludePatterns: ['/admin', '/private', '/api']
    }
  })
  
  console.log(`Found ${result.links.length} valid links`)
})
```

## Browser Automation

For JavaScript-heavy sites, enable browser automation:

```typescript
const config = makeSpiderConfig({
  enableBrowserAutomation: true,
  browserOptions: {
    headless: true,
    viewport: { width: 1920, height: 1080 }
  },
  waitForDynamicContent: true
})
```

See the [Browser Automation Guide](./browser-automation.md) for details.

## State Persistence

Enable resumable crawling:

```typescript
import { ResumabilityService, FileStorageBackend } from '@jambudipa/spider'

const resumabilityLayer = Layer.succeed(
  ResumabilityService,
  ResumabilityService.of({
    strategy: 'hybrid',
    backend: new FileStorageBackend('./crawler-state')
  })
)

// Your crawler can now resume from crashes
```

See the [Resumability API](../api/resumability.md) for details.

## Complete Example

Here's a complete example that crawls a website and saves product data:

```typescript
import { 
  SpiderService, 
  makeSpiderConfig,
  MiddlewareManager,
  LoggingMiddleware,
  RateLimitMiddleware
} from '@jambudipa/spider'
import { Effect, Sink, Layer } from 'effect'
import * as fs from 'fs/promises'

// Configure middleware
const middleware = new MiddlewareManager()
  .use(new LoggingMiddleware({ level: 'info' }))
  .use(new RateLimitMiddleware({ 
    requestsPerSecond: 2,
    perDomain: true 
  }))

// Configure spider
const config = makeSpiderConfig({
  maxDepth: 3,
  maxPages: 50,
  middleware,
  userAgent: 'ProductBot/1.0',
  allowedDomains: ['shop.example.com'],
  skipFileExtensions: ['jpg', 'png', 'pdf']
})

// Create program
const program = Effect.gen(function* () {
  const spider = yield* SpiderService
  const products: any[] = []
  
  // Create sink to process results
  const productSink = Sink.forEach(result =>
    Effect.sync(() => {
      // Extract product data if this is a product page
      if (result.pageData.url.includes('/product/')) {
        const product = {
          url: result.pageData.url,
          title: result.pageData.title,
          // Extract structured data if available
          metadata: result.pageData.metadata,
          crawledAt: new Date().toISOString()
        }
        products.push(product)
        console.log(`Found product: ${product.title}`)
      }
    })
  )
  
  // Start crawling
  yield* spider.crawl('https://shop.example.com', productSink)
  
  // Save results
  yield* Effect.promise(() => 
    fs.writeFile(
      'products.json', 
      JSON.stringify(products, null, 2)
    )
  )
  
  console.log(`✅ Saved ${products.length} products to products.json`)
  return products
})

// Run with configuration
const ConfiguredSpider = Layer.succeed(SpiderConfig, config).pipe(
  Layer.provide(SpiderService.Default)
)

Effect.runPromise(
  program.pipe(Effect.provide(ConfiguredSpider))
).catch(console.error)
```

## Next Steps

- [Configuration Guide](./configuration.md) - Learn about all configuration options
- [Browser Automation](./browser-automation.md) - Handle JavaScript-rendered content
- [Middleware Development](../api/middleware.md) - Create custom middleware
- [Example Scenarios](../examples/scenarios.md) - See real-world examples

## Troubleshooting

### Common Issues

**Module not found errors**
- Ensure both `@jambudipa/spider` and `effect` are installed
- Check your TypeScript configuration

**Robots.txt blocking**
- Set `respectRobotsTxt: false` in config (use responsibly)
- Or ensure your user agent is allowed

**Rate limiting**
- Increase `requestDelayMs` in configuration
- Use `RateLimitMiddleware` with appropriate settings

**Memory issues with large crawls**
- Reduce `maxConcurrentWorkers`
- Process results in batches
- Enable state persistence for resumability

## Getting Help

- Check the [API documentation](../api/)
- View [example code](../examples/)
- Open an [issue on GitHub](https://github.com/jambudipa/spider/issues)