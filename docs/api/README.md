# Spider API Reference

This directory contains comprehensive API documentation for all Spider components, generated from JSDoc comments in the source code.

## Available Documentation

### Core Components
- **[spider.md](./spider.md)** - Main Spider service for orchestrating crawls
- **[config.md](./config.md)** - Configuration system and options
- **[scheduler.md](./scheduler.md)** - Request scheduling and prioritisation

### Processing Components  
- **[middleware.md](./middleware.md)** - Middleware system and built-in middleware
- **[link-extractor.md](./link-extractor.md)** - Link discovery and filtering
- **[http-client.md](./http-client.md)** - Enhanced HTTP client with sessions

### Infrastructure Components
- **[resumability.md](./resumability.md)** - State persistence and recovery
- **[errors.md](./errors.md)** - Error types and handling

## Documentation Format

Each API reference includes:
- Complete type signatures
- Parameter descriptions and constraints
- Return value documentation
- Usage examples with working code
- Performance characteristics
- Error conditions

## Usage Examples

API documentation includes practical examples:

```typescript
import { Spider, SpiderConfig } from '@jambudipa/spider'
import { Effect } from 'effect'

// Example from spider.md
const spider = yield* Spider
const results = yield* spider.crawl('https://example.com')
```

## Type Information

All APIs include complete TypeScript type information:

```typescript
interface CrawlResult {
  pageData: PageData
  depth: number  
  timestamp: Date
  metadata?: Record<string, unknown>
}
```

*This documentation is automatically generated from JSDoc comments in the source code.*