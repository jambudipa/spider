# Examples

Working examples demonstrating Spider's capabilities and common use cases.

## Getting Started Examples

### [Basic Crawling](./basic-crawling.md)
Simple examples to get you started with Spider:
- First crawler
- Processing results
- Error handling
- Configuration basics

### [Dynamic Content](./dynamic-content.md)
Handle JavaScript-rendered content:
- Single-page applications
- Infinite scroll
- AJAX content loading
- Button-triggered loading

### [Authentication](./authentication.md)
Work with protected content:
- Login forms
- Session management
- API authentication
- OAuth flows

## Advanced Examples

### [Anti-Bot Bypass](./anti-bot.md)
Handle anti-bot protections:
- User agent rotation
- Request delays
- Browser fingerprinting
- Cookie challenges

### [E-commerce Scraping](./e-commerce-scraping.md)
Extract product data:
- Product listings
- Price monitoring
- Inventory tracking
- Review extraction

### [Enterprise Patterns](./enterprise-patterns.md)
Production-ready patterns:
- Distributed crawling
- Error recovery
- Performance optimisation
- Monitoring and alerting

## Real-World Scenarios

### [Web-scraping.dev Solutions](./scenarios/)
Complete solutions for all 16 web-scraping.dev challenge scenarios:

#### Basic Scenarios
- Static pagination
- Product markup extraction
- Hidden data extraction

#### Dynamic Content
- Endless scroll pagination
- Button-triggered loading
- GraphQL background requests
- Local storage interaction

#### Security & Authentication
- Secret API tokens
- CSRF protection
- Cookie-based authentication

#### Special Cases
- PDF downloads
- Cookie popups
- New tab navigation

#### Anti-Bot Protection
- Block page detection
- Referer validation
- Persistent cookie blocking

## Quick Start Templates

### Minimal Crawler
```typescript
import { SpiderService } from '@jambudipa/spider'
import { Effect, Sink } from 'effect'

Effect.gen(function* () {
  const spider = yield* SpiderService
  yield* spider.crawl('https://example.com', Sink.drain)
}).pipe(
  Effect.provide(SpiderService.Default),
  Effect.runPromise
)
```

### Configured Crawler
```typescript
import { SpiderService, makeSpiderConfig } from '@jambudipa/spider'

const config = makeSpiderConfig({
  maxDepth: 3,
  maxPages: 100,
  requestDelayMs: 1000
})

// Use configuration...
```

### Browser-Enabled Crawler
```typescript
import { BrowserManager } from '@jambudipa/spider/browser'

const browser = new BrowserManager({
  headless: true,
  poolSize: 5
})

await browser.initialise()
// Use browser...
```

## Running the Examples

1. Clone the repository
2. Install dependencies: `npm install`
3. Run examples: `npx tsx examples/[example-name].ts`

## Contributing Examples

Have a useful example? Contributions are welcome! Please:
1. Follow the existing format
2. Include clear comments
3. Test your example
4. Submit a pull request

## Need Help?

- Check the [Getting Started Guide](../guides/getting-started.md)
- Review the [API Reference](../api/)
- Open an [issue on GitHub](https://github.com/jambudipa/spider/issues)