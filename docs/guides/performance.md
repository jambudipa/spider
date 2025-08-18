# Performance Guide

Optimise Spider for maximum crawling speed and efficiency. This guide covers configuration tuning, resource management, and scaling strategies.

## Performance Metrics

### Key Indicators

Monitor these metrics to assess performance:

- **Pages per second** - Crawling throughput
- **Response time** - Average page load time  
- **Memory usage** - RAM consumption
- **CPU utilisation** - Processing efficiency
- **Error rate** - Failed request percentage
- **Queue size** - Pending URLs

### Using WorkerHealthMonitor

```typescript
import { WorkerHealthMonitorService } from '@jambudipa/spider'
import { Effect } from 'effect'

const program = Effect.gen(function* () {
  const monitor = yield* WorkerHealthMonitorService
  
  // Start monitoring
  yield* monitor.startMonitoring()
  
  // Your crawling code...
  
  // Get metrics
  const metrics = yield* monitor.getMetrics()
  
  console.log('Performance metrics:', {
    requestsPerMinute: metrics.requestsPerMinute,
    averageResponseTime: metrics.averageResponseTime,
    errorRate: metrics.errorRate,
    memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 + ' MB'
  })
})
```

## Configuration Optimisation

### High-Performance Settings

Maximum speed configuration:

```typescript
const highPerfConfig = makeSpiderConfig({
  // Maximise parallelism
  maxConcurrentWorkers: 20,
  concurrency: 'unbounded',
  
  // Minimise delays
  requestDelayMs: 100,
  maxRequestsPerSecondPerDomain: 10,
  
  // Quick timeouts
  requestTimeout: 10000,
  
  // Skip unnecessary processing
  skipFileExtensions: ['jpg', 'png', 'gif', 'pdf', 'zip'],
  normalizeUrlsForDeduplication: true,
  
  // Disable safety features (use carefully)
  ignoreRobotsTxt: true,
  respectNoFollow: false
})
```

### Balanced Performance

Sustainable high performance:

```typescript
const balancedConfig = makeSpiderConfig({
  maxConcurrentWorkers: 10,
  concurrency: 4,
  requestDelayMs: 500,
  maxRequestsPerSecondPerDomain: 2,
  requestTimeout: 15000,
  maxPages: 10000,
  normalizeUrlsForDeduplication: true
})
```

### Resource-Constrained

For limited resources:

```typescript
const lowResourceConfig = makeSpiderConfig({
  maxConcurrentWorkers: 2,
  concurrency: 'inherit',
  requestDelayMs: 2000,
  maxConcurrentRequests: 5,
  requestTimeout: 30000,
  enableBrowserAutomation: false
})
```

## Concurrency Strategies

### Optimal Worker Count

Find the sweet spot for your system:

```typescript
async function findOptimalWorkers(baseUrl: string) {
  const results = []
  
  for (let workers = 1; workers <= 20; workers += 2) {
    const config = makeSpiderConfig({
      maxConcurrentWorkers: workers,
      maxPages: 100
    })
    
    const startTime = Date.now()
    await crawl(baseUrl, config)
    const duration = Date.now() - startTime
    
    results.push({
      workers,
      duration,
      pagesPerSecond: 100 / (duration / 1000)
    })
    
    console.log(`Workers: ${workers}, Pages/sec: ${results[results.length - 1].pagesPerSecond}`)
  }
  
  // Find optimal based on pages per second
  const optimal = results.reduce((best, current) => 
    current.pagesPerSecond > best.pagesPerSecond ? current : best
  )
  
  return optimal.workers
}
```

### Dynamic Worker Adjustment

Adapt workers based on performance:

```typescript
class DynamicWorkerManager {
  private currentWorkers = 5
  private targetResponseTime = 2000  // 2 seconds
  
  adjustWorkers(avgResponseTime: number, errorRate: number) {
    if (errorRate > 0.1) {
      // High errors, reduce workers
      this.currentWorkers = Math.max(1, this.currentWorkers - 2)
    } else if (avgResponseTime < this.targetResponseTime && errorRate < 0.01) {
      // Good performance, increase workers
      this.currentWorkers = Math.min(20, this.currentWorkers + 1)
    } else if (avgResponseTime > this.targetResponseTime * 2) {
      // Slow responses, reduce workers
      this.currentWorkers = Math.max(1, this.currentWorkers - 1)
    }
    
    return this.currentWorkers
  }
}
```

## Memory Management

### Efficient Data Handling

Process and discard data immediately:

```typescript
const program = Effect.gen(function* () {
  const spider = yield* SpiderService
  
  // Process results immediately, don't accumulate
  const processSink = Sink.forEach(result =>
    Effect.gen(function* () {
      // Process data
      const extracted = extractData(result.pageData)
      
      // Save to database/file immediately
      yield* saveToDatabase(extracted)
      
      // Clear from memory
      result = null
      extracted = null
    })
  )
  
  yield* spider.crawl(urls, processSink)
})
```

### URL Deduplication

Efficient URL tracking:

```typescript
import { UrlDeduplicatorService } from '@jambudipa/spider'

// Use built-in deduplication
const config = makeSpiderConfig({
  normalizeUrlsForDeduplication: true  // Normalise URLs to reduce duplicates
})

// Or implement custom deduplication with size limits
class LimitedDeduplicator {
  private seen = new Set<string>()
  private maxSize = 100000
  
  hasSeen(url: string): boolean {
    // Implement LRU if set gets too large
    if (this.seen.size > this.maxSize) {
      // Clear oldest entries
      const toDelete = this.seen.size - this.maxSize / 2
      const iterator = this.seen.values()
      for (let i = 0; i < toDelete; i++) {
        this.seen.delete(iterator.next().value)
      }
    }
    
    const normalised = this.normalise(url)
    if (this.seen.has(normalised)) {
      return true
    }
    
    this.seen.add(normalised)
    return false
  }
  
  private normalise(url: string): string {
    // Remove fragments, normalise case, etc.
    const u = new URL(url)
    u.hash = ''
    return u.href.toLowerCase()
  }
}
```

### State Persistence

Use file storage for large crawls:

```typescript
import { ResumabilityService, FileStorageBackend } from '@jambudipa/spider'

const resumabilityLayer = Layer.succeed(
  ResumabilityService,
  ResumabilityService.of({
    strategy: 'delta',  // Only save changes
    backend: new FileStorageBackend('./crawler-state'),
    checkpointInterval: 1000  // Save every 1000 pages
  })
)
```

## Network Optimisation

### Connection Pooling

Reuse connections:

```typescript
import { EnhancedHttpClient } from '@jambudipa/spider'

const httpClient = makeEnhancedHttpClient({
  keepAlive: true,
  keepAliveTimeout: 30000,
  maxSockets: 100,
  maxSocketsPerHost: 10
})
```

### Compression

Enable compression to reduce bandwidth:

```typescript
class CompressionMiddleware {
  name = 'compression'
  
  processRequest(request) {
    return Effect.succeed({
      ...request,
      headers: {
        ...request.headers,
        'Accept-Encoding': 'gzip, deflate, br'
      }
    })
  }
}
```

### Selective Resource Loading

Skip unnecessary resources:

```typescript
const config = makeSpiderConfig({
  fileExtensionFilters: {
    filterImages: true,      // Skip images
    filterVideo: true,       // Skip videos
    filterAudio: true,       // Skip audio
    filterArchives: true,    // Skip archives
    filterOfficeDocuments: false,  // Keep documents if needed
    filterOther: true        // Skip CSS, JS, etc.
  }
})
```

## Browser Automation Performance

### Browser Pool Optimisation

```typescript
const browserConfig = {
  poolSize: 5,  // Balance between performance and resources
  headless: true,
  
  // Disable unnecessary features
  args: [
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-setuid-sandbox',
    '--no-sandbox',
    '--disable-web-security',
    '--disable-features=site-per-process'
  ]
}
```

### Resource Blocking

Block resources that slow down page loads:

```typescript
await page.route('**/*', route => {
  const resourceType = route.request().resourceType()
  
  // Block heavy resources
  if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
    route.abort()
  } else {
    route.continue()
  }
})
```

### Page Reuse

Reuse browser pages:

```typescript
class PagePool {
  private available: Page[] = []
  private inUse = new Set<Page>()
  
  async acquire(): Promise<Page> {
    let page = this.available.pop()
    
    if (!page) {
      page = await this.browser.newPage()
    }
    
    this.inUse.add(page)
    return page
  }
  
  async release(page: Page) {
    this.inUse.delete(page)
    
    // Clear page state
    await page.goto('about:blank')
    await page.context().clearCookies()
    
    this.available.push(page)
  }
}
```

## Caching Strategies

### Response Caching

Cache frequently accessed content:

```typescript
class ResponseCache {
  private cache = new Map<string, { data: any, timestamp: number }>()
  private maxAge = 3600000  // 1 hour
  private maxSize = 1000
  
  get(url: string): any | null {
    const entry = this.cache.get(url)
    
    if (!entry) return null
    
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(url)
      return null
    }
    
    return entry.data
  }
  
  set(url: string, data: any) {
    // LRU eviction
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    
    this.cache.set(url, {
      data,
      timestamp: Date.now()
    })
  }
}
```

### DNS Caching

Cache DNS lookups:

```typescript
import dns from 'dns'
import { promisify } from 'util'

const lookup = promisify(dns.lookup)

class DNSCache {
  private cache = new Map<string, { ip: string, expires: number }>()
  
  async resolve(hostname: string): Promise<string> {
    const cached = this.cache.get(hostname)
    
    if (cached && cached.expires > Date.now()) {
      return cached.ip
    }
    
    const { address } = await lookup(hostname)
    
    this.cache.set(hostname, {
      ip: address,
      expires: Date.now() + 300000  // 5 minutes
    })
    
    return address
  }
}
```

## Queue Management

### Priority Queue

Process important URLs first:

```typescript
class PriorityQueue {
  private high: string[] = []
  private medium: string[] = []
  private low: string[] = []
  
  enqueue(url: string, priority: 'high' | 'medium' | 'low' = 'medium') {
    this[priority].push(url)
  }
  
  dequeue(): string | null {
    if (this.high.length > 0) return this.high.shift()!
    if (this.medium.length > 0) return this.medium.shift()!
    if (this.low.length > 0) return this.low.shift()!
    return null
  }
  
  size(): number {
    return this.high.length + this.medium.length + this.low.length
  }
}
```

### Batch Processing

Process URLs in batches:

```typescript
async function batchCrawl(urls: string[], batchSize = 100) {
  const results = []
  
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize)
    
    const batchResults = await Promise.all(
      batch.map(url => crawlSingle(url))
    )
    
    results.push(...batchResults)
    
    // Optional: Process batch results immediately
    await processBatchResults(batchResults)
    
    // Clear from memory
    batchResults.length = 0
  }
  
  return results
}
```

## Monitoring and Profiling

### Performance Tracking

```typescript
class PerformanceTracker {
  private metrics = {
    totalRequests: 0,
    totalTime: 0,
    errors: 0,
    responseTimes: [] as number[]
  }
  
  recordRequest(duration: number, error?: boolean) {
    this.metrics.totalRequests++
    this.metrics.totalTime += duration
    
    if (error) {
      this.metrics.errors++
    }
    
    this.metrics.responseTimes.push(duration)
    
    // Keep only last 1000 for memory efficiency
    if (this.metrics.responseTimes.length > 1000) {
      this.metrics.responseTimes.shift()
    }
  }
  
  getStats() {
    const avgResponseTime = this.metrics.totalTime / this.metrics.totalRequests
    const errorRate = this.metrics.errors / this.metrics.totalRequests
    
    return {
      totalRequests: this.metrics.totalRequests,
      avgResponseTime,
      errorRate,
      requestsPerSecond: this.metrics.totalRequests / (this.metrics.totalTime / 1000)
    }
  }
}
```

### Memory Profiling

Monitor memory usage:

```typescript
setInterval(() => {
  const usage = process.memoryUsage()
  console.log('Memory usage:', {
    rss: (usage.rss / 1024 / 1024).toFixed(2) + ' MB',
    heap: (usage.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
    external: (usage.external / 1024 / 1024).toFixed(2) + ' MB'
  })
  
  // Trigger GC if available
  if (global.gc) {
    global.gc()
  }
}, 60000)  // Every minute
```

## Scaling Strategies

### Horizontal Scaling

Distribute crawling across multiple processes:

```typescript
import cluster from 'cluster'
import os from 'os'

if (cluster.isPrimary) {
  const numWorkers = os.cpus().length
  
  // Spawn workers
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork()
  }
  
  // Distribute URLs to workers
  const urls = getUrlsToCrawl()
  const chunkSize = Math.ceil(urls.length / numWorkers)
  
  let workerIndex = 0
  for (const worker of Object.values(cluster.workers!)) {
    const chunk = urls.slice(
      workerIndex * chunkSize,
      (workerIndex + 1) * chunkSize
    )
    worker!.send({ urls: chunk })
    workerIndex++
  }
} else {
  // Worker process
  process.on('message', async (msg) => {
    if (msg.urls) {
      await crawlUrls(msg.urls)
      process.send({ done: true })
    }
  })
}
```

### Load Balancing

Distribute load across Spider instances:

```typescript
class LoadBalancer {
  private instances: SpiderInstance[] = []
  private currentIndex = 0
  
  addInstance(instance: SpiderInstance) {
    this.instances.push(instance)
  }
  
  async crawl(url: string) {
    const instance = this.instances[this.currentIndex]
    this.currentIndex = (this.currentIndex + 1) % this.instances.length
    
    return instance.crawl(url)
  }
}
```

## Best Practices

### 1. Profile Before Optimising

Always measure first:

```typescript
console.time('crawl')
const results = await crawl(urls)
console.timeEnd('crawl')

console.log('Memory:', process.memoryUsage())
console.log('Results:', results.length)
```

### 2. Start Conservative

Begin with safe defaults:

```typescript
// Start with
const config = makeSpiderConfig({
  maxConcurrentWorkers: 5,
  requestDelayMs: 1000
})

// Gradually increase based on performance
```

### 3. Monitor Continuously

Track metrics in production:

```typescript
const monitor = new PerformanceMonitor()

setInterval(() => {
  const stats = monitor.getStats()
  
  if (stats.errorRate > 0.1) {
    // Reduce load
    config.maxConcurrentWorkers--
  } else if (stats.avgResponseTime < 1000) {
    // Increase load
    config.maxConcurrentWorkers++
  }
}, 30000)  // Every 30 seconds
```

### 4. Handle Backpressure

Prevent queue overflow:

```typescript
if (queueSize > 10000) {
  // Pause crawling
  await pause()
  
  // Process queue
  await processQueue()
  
  // Resume
  await resume()
}
```

## Troubleshooting

### High Memory Usage
- Reduce `maxConcurrentWorkers`
- Process results immediately
- Enable state persistence
- Clear caches periodically

### Slow Performance
- Increase workers
- Reduce delays
- Skip unnecessary files
- Use caching
- Disable browser automation if not needed

### High Error Rate
- Reduce concurrency
- Increase delays
- Check rate limits
- Verify network stability

## Next Steps

- [Configuration Guide](./configuration.md) - All performance options
- [Browser Automation](./browser-automation.md) - Browser performance
- [Anti-Bot Protection](./anti-bot.md) - Balance speed and stealth
- [Enterprise Patterns](../examples/enterprise-patterns.md) - Large-scale patterns