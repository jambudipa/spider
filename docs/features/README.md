# Features Documentation

Deep dives into Spider's key features and capabilities.

## Core Features

### Effect.js Integration
Spider is built on Effect.js, providing:
- Type-safe error handling
- Composable architecture
- Functional programming patterns
- Dependency injection
- Resource management

### Browser Automation
Playwright integration enables:
- JavaScript execution
- Dynamic content handling
- Form interaction
- Screenshot capture
- Multi-tab navigation

### Anti-Bot Capabilities
**Note: Spider doesn't have a dedicated anti-bot service.** Instead, it achieves anti-bot bypass through:
- Smart configuration (user agents, delays)
- Browser automation (JavaScript challenges)
- Proper session management
- Header customisation via middleware

Spider successfully handles all 16 web-scraping.dev anti-bot scenarios through these existing components.

### Concurrent Crawling
Efficient parallel processing:
- Worker pool management
- Configurable concurrency levels
- Rate limiting per domain
- Queue prioritisation
- Resource balancing

### Robots.txt Compliance
Automatic robots.txt handling:
- Parsing and caching
- Crawl-delay respect
- User-agent matching
- Allow/Disallow rules
- Sitemap discovery

### State Persistence
Resumable crawling support:
- Multiple storage backends (File, PostgreSQL, Redis)
- Checkpoint strategies
- Crash recovery
- Session management
- Progress tracking

### Monitoring & Observability
Built-in monitoring features:
- Worker health monitoring
- Performance metrics
- Error tracking
- Structured logging
- Resource usage tracking

## Architecture Overview

Spider follows a modular, service-based architecture:

```
┌─────────────────┐
│  SpiderService  │  Main orchestration
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌──▼──────┐
│Scraper│ │Scheduler│  Core components
└───┬───┘ └────┬────┘
    │          │
┌───▼────────┐ │
│LinkExtractor│ │       Data processing
└─────────────┘ │
                │
        ┌───────▼──────┐
        │ Middleware   │  Request/Response pipeline
        └──────────────┘
```

## Key Differentiators

### 1. Type Safety
Full TypeScript support with Effect.js ensures:
- Compile-time error detection
- IntelliSense support
- Self-documenting code
- Refactoring confidence

### 2. Composability
Modular design allows:
- Custom middleware
- Pluggable storage backends
- Flexible configuration
- Easy extension

### 3. Production Ready
Enterprise features include:
- Error recovery
- State persistence
- Monitoring integration
- Scalable architecture

### 4. Real-World Tested
100% success rate on web-scraping.dev scenarios:
- Static content extraction
- Dynamic JavaScript sites
- Authentication flows
- Anti-bot protection
- Special cases (PDFs, popups, etc.)

## Feature Matrix

| Feature | Spider | Traditional Crawlers |
|---------|--------|---------------------|
| TypeScript Native | ✅ | ❌ |
| Effect.js Based | ✅ | ❌ |
| Browser Automation | ✅ | Varies |
| Anti-Bot Handling | ✅ | Limited |
| State Persistence | ✅ | Limited |
| Concurrent Crawling | ✅ | ✅ |
| Robots.txt Compliance | ✅ | ✅ |
| Custom Middleware | ✅ | Limited |
| Session Management | ✅ | Varies |
| Worker Health Monitoring | ✅ | ❌ |

## Implementation Details

### Service Layer
Each major component is implemented as an Effect service:
- `SpiderService` - Main crawler
- `LinkExtractorService` - Link discovery
- `ResumabilityService` - State management
- `WorkerHealthMonitorService` - Monitoring

### Middleware System
Extensible request/response pipeline:
- `LoggingMiddleware` - Request logging
- `RateLimitMiddleware` - Rate limiting
- `UserAgentMiddleware` - User agent management
- `StatsMiddleware` - Statistics collection

### Storage Backends
Multiple persistence options:
- `FileStorageBackend` - Local file storage
- `PostgresStorageBackend` - PostgreSQL database
- `RedisStorageBackend` - Redis cache

## Performance Characteristics

### Concurrency
- Default: 5 concurrent workers
- Maximum tested: 20+ workers
- Configurable per domain limits

### Memory Usage
- Base: ~50MB
- Per worker: ~10-20MB
- With browser: ~100MB per instance

### Throughput
- HTTP only: 100+ pages/second (with appropriate config)
- With browser: 5-10 pages/second per browser instance
- Depends heavily on target site and network

## Limitations

### Current Limitations
- No built-in proxy support (can be added via middleware)
- No CAPTCHA solving
- No distributed crawling out-of-box (see enterprise patterns)
- Browser automation requires Playwright installation

### Design Decisions
- Effect.js dependency (powerful but learning curve)
- TypeScript-first (no plain JavaScript version)
- Service-based architecture (more complex for simple use cases)

## Future Roadmap

Potential future enhancements:
- Built-in proxy rotation
- Distributed crawling support
- More storage backends
- WebSocket support
- GraphQL client integration
- AI-powered content extraction

## Getting Started with Features

1. **Basic Crawling** - Start with [Getting Started Guide](../guides/getting-started.md)
2. **JavaScript Sites** - Enable [Browser Automation](../guides/browser-automation.md)
3. **Avoid Detection** - Configure for [Anti-Bot Protection](../guides/anti-bot.md)
4. **Scale Up** - Apply [Performance Optimisation](../guides/performance.md)
5. **Production** - Implement [Enterprise Patterns](../examples/enterprise-patterns.md)

## Contributing

Want to add features? We welcome contributions:
1. Check existing issues and discussions
2. Propose new features via GitHub issues
3. Submit pull requests with tests
4. Update documentation

## Support

- [GitHub Issues](https://github.com/jambudipa/spider/issues)
- [API Reference](../api/)
- [Examples](../examples/)