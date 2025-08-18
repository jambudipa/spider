# Configuration Guide

Spider provides extensive configuration options to customise crawling behaviour. This guide covers all available settings and common configuration patterns.

## Basic Configuration

Use the `makeSpiderConfig()` factory function to create configurations:

```typescript
import { makeSpiderConfig } from '@jambudipa/spider'

const config = makeSpiderConfig({
  maxDepth: 3,
  maxPages: 100,
  requestDelayMs: 1000
})
```

## Configuration Options

### Core Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxDepth` | number \| undefined | undefined | Maximum crawl depth (link hops from start URL) |
| `maxPages` | number \| undefined | undefined | Maximum pages to crawl |
| `maxConcurrentWorkers` | number | 5 | Number of concurrent worker fibers |
| `concurrency` | number \| 'unbounded' \| 'inherit' | 4 | Concurrency for multiple start URLs |
| `userAgent` | string | 'JambudipaSpider/1.0' | User agent string |

```typescript
const config = makeSpiderConfig({
  maxDepth: 5,              // Crawl 5 levels deep
  maxPages: 1000,           // Stop after 1000 pages
  maxConcurrentWorkers: 10, // 10 parallel workers
  concurrency: 'unbounded', // No concurrency limit
  userAgent: 'MyBot/1.0 (+https://mysite.com/bot)'
})
```

### Rate Limiting

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `requestDelayMs` | number | 1000 | Base delay between requests (ms) |
| `maxRobotsCrawlDelayMs` | number | 10000 | Max crawl delay from robots.txt (ms) |
| `maxConcurrentRequests` | number | 10 | Max concurrent requests across all domains |
| `maxRequestsPerSecondPerDomain` | number | 2 | Max requests per second per domain |

```typescript
const config = makeSpiderConfig({
  requestDelayMs: 2000,                 // 2 second delay
  maxRobotsCrawlDelayMs: 30000,        // Max 30s from robots.txt
  maxConcurrentRequests: 5,             // 5 concurrent requests total
  maxRequestsPerSecondPerDomain: 1      // 1 request/second/domain
})
```

### URL Behaviour

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `followRedirects` | boolean | true | Follow HTTP redirects |
| `respectNoFollow` | boolean | true | Respect rel="nofollow" attributes |
| `normalizeUrlsForDeduplication` | boolean | true | Normalise URLs for deduplication |
| `ignoreRobotsTxt` | boolean | false | Ignore robots.txt files |

```typescript
const config = makeSpiderConfig({
  followRedirects: true,
  respectNoFollow: false,              // Crawl nofollow links
  normalizeUrlsForDeduplication: true, // Prevent duplicate crawls
  ignoreRobotsTxt: false              // Respect robots.txt
})
```

### Domain Filtering

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `allowedDomains` | string[] \| undefined | undefined | Domains to restrict crawling to |
| `blockedDomains` | string[] \| undefined | undefined | Domains to exclude from crawling |
| `allowedProtocols` | string[] | ['http:', 'https:'] | Allowed URL protocols |

```typescript
const config = makeSpiderConfig({
  // Only crawl these domains
  allowedDomains: ['example.com', 'subdomain.example.com'],
  
  // Never crawl these domains
  blockedDomains: ['ads.example.com', 'tracking.example.com'],
  
  // Allow additional protocols
  allowedProtocols: ['http:', 'https:', 'ftp:']
})
```

### File Extension Filtering

Control which file types to skip during crawling:

```typescript
interface FileExtensionFilters {
  filterArchives: boolean      // 7z, zip, tar, etc.
  filterImages: boolean        // jpg, png, gif, etc.
  filterAudio: boolean         // mp3, wav, ogg, etc.
  filterVideo: boolean         // mp4, avi, mov, etc.
  filterOfficeDocuments: boolean // pdf, doc, xls, etc.
  filterOther: boolean         // css, js, exe, etc.
}
```

```typescript
const config = makeSpiderConfig({
  fileExtensionFilters: {
    filterArchives: true,        // Skip archives
    filterImages: false,         // Crawl image URLs
    filterAudio: true,          // Skip audio
    filterVideo: true,          // Skip video
    filterOfficeDocuments: false, // Crawl PDFs, docs
    filterOther: true           // Skip other files
  }
})
```

Or use the legacy approach:

```typescript
const config = makeSpiderConfig({
  skipFileExtensions: ['jpg', 'png', 'pdf', 'zip']
})
```

### Technical URL Filtering

Control technical URL validation:

```typescript
interface TechnicalFilters {
  filterUnsupportedSchemes: boolean  // Only http/https/file/ftp
  filterLongUrls: boolean            // Filter URLs > max length
  maxUrlLength: number               // Maximum URL length
  filterMalformedUrls: boolean       // Filter invalid URLs
}
```

```typescript
const config = makeSpiderConfig({
  technicalFilters: {
    filterUnsupportedSchemes: true,
    filterLongUrls: true,
    maxUrlLength: 2083,    // IE's limit
    filterMalformedUrls: true
  }
})
```

### Custom URL Filters

Add regex patterns to exclude specific URL patterns:

```typescript
const config = makeSpiderConfig({
  customUrlFilters: [
    /\/wp-admin\//i,           // WordPress admin
    /\/api\//i,                // API endpoints
    /\?preview=/i,             // Preview URLs
    /\/private\//i,            // Private sections
    /\.(css|js)$/i             // Static assets
  ]
})
```

### Resumability

Enable state persistence for resumable crawling:

```typescript
const config = makeSpiderConfig({
  enableResumability: true
})

// Also configure ResumabilityService with a storage backend
import { ResumabilityService, FileStorageBackend } from '@jambudipa/spider'
import { Layer } from 'effect'

const resumabilityLayer = Layer.succeed(
  ResumabilityService,
  ResumabilityService.of({
    strategy: 'hybrid',
    backend: new FileStorageBackend('./crawler-state')
  })
)
```

## Configuration Patterns

### Conservative Crawling

For polite, respectful crawling:

```typescript
const politeConfig = makeSpiderConfig({
  maxConcurrentWorkers: 1,
  requestDelayMs: 3000,
  maxRequestsPerSecondPerDomain: 0.5,
  respectNoFollow: true,
  ignoreRobotsTxt: false,
  userAgent: 'PoliteBot/1.0 (+https://mysite.com/bot)'
})
```

### Aggressive Crawling

For maximum speed (use responsibly):

```typescript
const aggressiveConfig = makeSpiderConfig({
  maxConcurrentWorkers: 20,
  concurrency: 'unbounded',
  requestDelayMs: 100,
  maxConcurrentRequests: 50,
  maxRequestsPerSecondPerDomain: 10,
  normalizeUrlsForDeduplication: true
})
```

### Focused Crawling

For specific content extraction:

```typescript
const focusedConfig = makeSpiderConfig({
  maxDepth: 2,
  allowedDomains: ['target-site.com'],
  customUrlFilters: [
    /\/blog\//,     // Only blog posts
    /\/products\//  // Only products
  ],
  fileExtensionFilters: {
    filterArchives: true,
    filterImages: true,
    filterAudio: true,
    filterVideo: true,
    filterOfficeDocuments: false, // Keep PDFs
    filterOther: true
  }
})
```

### Large-Scale Crawling

For crawling thousands of pages:

```typescript
const largeScaleConfig = makeSpiderConfig({
  maxPages: 10000,
  maxConcurrentWorkers: 10,
  requestDelayMs: 500,
  normalizeUrlsForDeduplication: true,
  enableResumability: true,
  
  // Skip unnecessary files
  fileExtensionFilters: {
    filterArchives: true,
    filterImages: true,
    filterAudio: true,
    filterVideo: true,
    filterOfficeDocuments: true,
    filterOther: true
  }
})
```

## Using Configuration

### With Effect.js Layers

```typescript
import { SpiderService, SpiderConfig, makeSpiderConfig } from '@jambudipa/spider'
import { Effect, Layer } from 'effect'

const config = makeSpiderConfig({
  maxDepth: 3,
  maxPages: 100
})

const ConfigLayer = Layer.succeed(SpiderConfig, config)

const program = Effect.gen(function* () {
  const spider = yield* SpiderService
  // Spider will use the provided configuration
  yield* spider.crawl(['https://example.com'])
})

Effect.runPromise(
  program.pipe(
    Effect.provide(
      Layer.mergeAll(ConfigLayer, SpiderService.Default)
    )
  )
)
```

### Runtime Configuration

Access configuration at runtime:

```typescript
const program = Effect.gen(function* () {
  const config = yield* SpiderConfig
  
  const options = yield* config.getOptions()
  console.log('Max depth:', options.maxDepth)
  
  const userAgent = yield* config.getUserAgent()
  console.log('User agent:', userAgent)
  
  const delay = yield* config.getRequestDelay()
  console.log('Request delay:', delay)
})
```

### Dynamic Configuration

Check URL filtering decisions:

```typescript
const program = Effect.gen(function* () {
  const config = yield* SpiderConfig
  
  const result = yield* config.shouldFollowUrl(
    'https://example.com/page',
    'https://example.com/',
    'example.com'
  )
  
  if (result.follow) {
    console.log('URL will be crawled')
  } else {
    console.log('URL filtered:', result.reason)
  }
})
```

## Configuration Validation

Spider validates configuration at runtime:

```typescript
// These will throw errors:
const badConfig1 = makeSpiderConfig({
  maxDepth: -1              // Error: negative depth
})

const badConfig2 = makeSpiderConfig({
  requestDelayMs: -1000     // Error: negative delay
})

const badConfig3 = makeSpiderConfig({
  maxConcurrentWorkers: 0   // Error: no workers
})
```

## Environment-Based Configuration

Use environment variables for configuration:

```typescript
const config = makeSpiderConfig({
  maxDepth: parseInt(process.env.CRAWL_DEPTH || '3'),
  maxPages: parseInt(process.env.MAX_PAGES || '100'),
  requestDelayMs: parseInt(process.env.REQUEST_DELAY || '1000'),
  userAgent: process.env.USER_AGENT || 'MyBot/1.0',
  ignoreRobotsTxt: process.env.IGNORE_ROBOTS === 'true'
})
```

## Best Practices

### 1. Start Conservative
Begin with restrictive settings and gradually increase:

```typescript
// Start with this
const startConfig = makeSpiderConfig({
  maxDepth: 2,
  maxPages: 10,
  maxConcurrentWorkers: 1,
  requestDelayMs: 2000
})

// Then optimise based on performance
```

### 2. Respect Robots.txt
Always respect robots.txt unless you have permission:

```typescript
const config = makeSpiderConfig({
  ignoreRobotsTxt: false,  // Default
  maxRobotsCrawlDelayMs: 10000
})
```

### 3. Use Domain Filtering
Prevent crawling unintended domains:

```typescript
const config = makeSpiderConfig({
  allowedDomains: ['intended-site.com'],
  blockedDomains: ['ads.site.com', 'tracking.site.com']
})
```

### 4. Filter Unnecessary Files
Skip files that don't contain useful content:

```typescript
const config = makeSpiderConfig({
  fileExtensionFilters: {
    filterArchives: true,
    filterImages: true,
    filterAudio: true,
    filterVideo: true,
    filterOfficeDocuments: false,  // Keep if needed
    filterOther: true
  }
})
```

### 5. Enable Resumability for Long Crawls
For crawls that might be interrupted:

```typescript
const config = makeSpiderConfig({
  enableResumability: true,
  maxPages: 10000
})
```

## Troubleshooting

### Crawl is Too Slow
- Increase `maxConcurrentWorkers`
- Decrease `requestDelayMs`
- Increase `maxConcurrentRequests`

### Getting Rate Limited
- Increase `requestDelayMs`
- Decrease `maxRequestsPerSecondPerDomain`
- Reduce `maxConcurrentWorkers`

### Crawling Wrong URLs
- Check `allowedDomains` and `blockedDomains`
- Add patterns to `customUrlFilters`
- Verify `fileExtensionFilters`

### Running Out of Memory
- Reduce `maxConcurrentWorkers`
- Enable `enableResumability` with file storage
- Process results in batches

## Next Steps

- [Getting Started](./getting-started.md) - Basic usage
- [Browser Automation](./browser-automation.md) - JavaScript rendering
- [Middleware API](../api/middleware.md) - Custom processing
- [Resumability API](../api/resumability.md) - State persistence