# Enterprise Patterns

Production-ready patterns for large-scale web crawling with Spider. These patterns demonstrate reliability, scalability, and maintainability for enterprise deployments.

## Distributed Crawling

### Multi-Process Architecture

Distribute crawling across multiple processes:

```typescript
import cluster from 'cluster'
import os from 'os'
import { SpiderService, makeSpiderConfig } from '@jambudipa/spider'
import { Effect, Queue, Sink } from 'effect'

if (cluster.isPrimary) {
  // Primary process - coordinator
  const numWorkers = os.cpus().length
  const urlQueue = new Queue<string>()
  const results = []
  
  // Spawn worker processes
  for (let i = 0; i < numWorkers; i++) {
    const worker = cluster.fork()
    
    worker.on('message', (msg) => {
      if (msg.type === 'result') {
        results.push(msg.data)
      } else if (msg.type === 'ready') {
        // Send URLs to worker
        const urls = urlQueue.dequeue(100)
        worker.send({ type: 'crawl', urls })
      }
    })
  }
  
  // Load URLs into queue
  const urls = await loadUrlsFromDatabase()
  urls.forEach(url => urlQueue.enqueue(url))
  
} else {
  // Worker process - crawler
  const config = makeSpiderConfig({
    maxConcurrentWorkers: 5,
    maxPages: 1000
  })
  
  process.on('message', async (msg) => {
    if (msg.type === 'crawl') {
      const program = Effect.gen(function* () {
        const spider = yield* SpiderService
        
        const results = []
        const collectSink = Sink.forEach(result =>
          Effect.sync(() => results.push(result))
        )
        
        for (const url of msg.urls) {
          yield* spider.crawl(url, collectSink)
        }
        
        return results
      })
      
      const results = await Effect.runPromise(
        program.pipe(Effect.provide(SpiderService.Default))
      )
      
      process.send({ type: 'result', data: results })
      process.send({ type: 'ready' })
    }
  })
  
  // Signal ready
  process.send({ type: 'ready' })
}
```

### Queue-Based Architecture

Use a message queue for coordination:

```typescript
import { SpiderService, makeSpiderConfig } from '@jambudipa/spider'
import { Effect } from 'effect'
// Assume we have a queue client (Redis, RabbitMQ, etc.)
import { QueueClient } from './queue'

class DistributedCrawler {
  private queue: QueueClient
  private resultQueue: QueueClient
  
  constructor() {
    this.queue = new QueueClient('crawl-queue')
    this.resultQueue = new QueueClient('result-queue')
  }
  
  async runWorker(workerId: string) {
    const config = makeSpiderConfig({
      maxConcurrentWorkers: 10,
      requestDelayMs: 500
    })
    
    while (true) {
      // Get batch of URLs
      const urls = await this.queue.dequeue(50)
      
      if (urls.length === 0) {
        await this.sleep(5000)
        continue
      }
      
      const program = Effect.gen(function* () {
        const spider = yield* SpiderService
        
        for (const url of urls) {
          try {
            const results = []
            const collectSink = Sink.forEach(result =>
              Effect.sync(() => results.push(result))
            )
            
            yield* spider.crawl(url, collectSink)
            
            // Send results to result queue
            await this.resultQueue.enqueue({
              workerId,
              url,
              results,
              timestamp: Date.now()
            })
          } catch (error) {
            // Handle error, maybe re-queue
            await this.handleError(url, error)
          }
        }
      })
      
      await Effect.runPromise(
        program.pipe(Effect.provide(SpiderService.Default))
      )
    }
  }
  
  private async handleError(url: string, error: any) {
    console.error(`Error crawling ${url}:`, error)
    
    // Re-queue with retry count
    const retryCount = await this.getRetryCount(url)
    if (retryCount < 3) {
      await this.queue.enqueue(url, { 
        priority: 'low',
        metadata: { retryCount: retryCount + 1 }
      })
    }
  }
}

// Start multiple workers
const crawler = new DistributedCrawler()
const workers = []

for (let i = 0; i < 4; i++) {
  workers.push(crawler.runWorker(`worker-${i}`))
}

await Promise.all(workers)
```

## Error Recovery

### Comprehensive Error Handling

```typescript
import { 
  NetworkError, 
  ResponseError, 
  RobotsTxtError,
  ConfigurationError 
} from '@jambudipa/spider'

class ResilientCrawler {
  private retryPolicy = {
    maxRetries: 3,
    backoffMs: 1000,
    backoffMultiplier: 2
  }
  
  async crawlWithRetry(url: string, attempt = 1): Promise<any> {
    const program = Effect.gen(function* () {
      const spider = yield* SpiderService
      
      const results = []
      const collectSink = Sink.forEach(result =>
        Effect.sync(() => results.push(result))
      )
      
      yield* spider.crawl(url, collectSink)
      return results
    })
    
    try {
      return await Effect.runPromise(
        program.pipe(
          Effect.provide(SpiderService.Default),
          Effect.catchTags({
            NetworkError: (error) => {
              if (attempt < this.retryPolicy.maxRetries) {
                // Network issues, retry with backoff
                const delay = this.retryPolicy.backoffMs * 
                  Math.pow(this.retryPolicy.backoffMultiplier, attempt - 1)
                
                return Effect.gen(function* () {
                  yield* Effect.sleep(delay)
                  return yield* Effect.promise(() => 
                    this.crawlWithRetry(url, attempt + 1)
                  )
                })
              }
              return Effect.fail(error)
            },
            ResponseError: (error) => {
              // Handle specific status codes
              if (error.statusCode === 429) {
                // Rate limited, wait longer
                return Effect.gen(function* () {
                  yield* Effect.sleep(60000)  // 1 minute
                  return yield* Effect.promise(() => 
                    this.crawlWithRetry(url, attempt + 1)
                  )
                })
              } else if (error.statusCode >= 500) {
                // Server error, retry
                if (attempt < this.retryPolicy.maxRetries) {
                  return Effect.gen(function* () {
                    yield* Effect.sleep(5000)
                    return yield* Effect.promise(() => 
                      this.crawlWithRetry(url, attempt + 1)
                    )
                  })
                }
              }
              // Don't retry client errors (4xx)
              return Effect.fail(error)
            },
            RobotsTxtError: (error) => {
              // Don't retry, URL is blocked
              console.log(`Blocked by robots.txt: ${url}`)
              return Effect.succeed([])
            },
            ConfigurationError: (error) => {
              // Configuration issues, don't retry
              console.error('Configuration error:', error)
              return Effect.fail(error)
            }
          })
        )
      )
    } catch (finalError) {
      // Log to monitoring system
      await this.logToMonitoring({
        url,
        error: finalError,
        attempts: attempt,
        timestamp: Date.now()
      })
      
      throw finalError
    }
  }
}
```

### Circuit Breaker Pattern

Prevent cascading failures:

```typescript
class CircuitBreaker {
  private failures = 0
  private successCount = 0
  private lastFailureTime = 0
  private state: 'closed' | 'open' | 'half-open' = 'closed'
  
  constructor(
    private threshold = 5,
    private timeout = 60000,
    private successThreshold = 2
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open'
        this.successCount = 0
      } else {
        throw new Error('Circuit breaker is open')
      }
    }
    
    try {
      const result = await fn()
      
      if (this.state === 'half-open') {
        this.successCount++
        if (this.successCount >= this.successThreshold) {
          this.state = 'closed'
          this.failures = 0
        }
      }
      
      return result
    } catch (error) {
      this.failures++
      this.lastFailureTime = Date.now()
      
      if (this.failures >= this.threshold) {
        this.state = 'open'
      }
      
      throw error
    }
  }
}

// Use with Spider
const breaker = new CircuitBreaker()

async function crawlWithBreaker(url: string) {
  return breaker.execute(async () => {
    // Your crawl logic
    return crawl(url)
  })
}
```

## Performance Monitoring

### Comprehensive Metrics Collection

```typescript
import { WorkerHealthMonitorService } from '@jambudipa/spider'
import { StatsD } from 'node-statsd'

class MetricsCollector {
  private statsd: StatsD
  private metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalBytes: 0,
    responseTimes: []
  }
  
  constructor() {
    this.statsd = new StatsD({
      host: 'metrics.example.com',
      port: 8125,
      prefix: 'spider.'
    })
  }
  
  recordRequest(url: string, duration: number, success: boolean, bytes: number) {
    this.metrics.totalRequests++
    
    if (success) {
      this.metrics.successfulRequests++
      this.statsd.increment('requests.success')
    } else {
      this.metrics.failedRequests++
      this.statsd.increment('requests.failed')
    }
    
    this.metrics.totalBytes += bytes
    this.metrics.responseTimes.push(duration)
    
    // Send to StatsD
    this.statsd.timing('response_time', duration)
    this.statsd.gauge('bytes_downloaded', bytes)
    
    // Log to time series database
    this.logToTimeSeries({
      timestamp: Date.now(),
      url,
      duration,
      success,
      bytes
    })
  }
  
  getStats() {
    const avgResponseTime = this.metrics.responseTimes.reduce((a, b) => a + b, 0) / 
                           this.metrics.responseTimes.length
    
    return {
      totalRequests: this.metrics.totalRequests,
      successRate: this.metrics.successfulRequests / this.metrics.totalRequests,
      avgResponseTime,
      totalBytes: this.metrics.totalBytes,
      requestsPerSecond: this.calculateRequestsPerSecond()
    }
  }
  
  private calculateRequestsPerSecond() {
    // Calculate based on time window
    const window = 60000  // 1 minute
    const now = Date.now()
    const recentRequests = this.metrics.responseTimes.filter(
      (_, index) => (now - this.getTimestamp(index)) < window
    )
    
    return recentRequests.length / (window / 1000)
  }
}
```

### Health Checks

```typescript
class HealthChecker {
  private checks = {
    database: this.checkDatabase,
    queue: this.checkQueue,
    storage: this.checkStorage,
    memory: this.checkMemory,
    cpu: this.checkCPU
  }
  
  async performHealthCheck(): Promise<HealthStatus> {
    const results = {}
    
    for (const [name, check] of Object.entries(this.checks)) {
      try {
        const result = await check.call(this)
        results[name] = { status: 'healthy', ...result }
      } catch (error) {
        results[name] = { status: 'unhealthy', error: error.message }
      }
    }
    
    const overallStatus = Object.values(results).every(
      r => r.status === 'healthy'
    ) ? 'healthy' : 'unhealthy'
    
    return {
      status: overallStatus,
      timestamp: Date.now(),
      checks: results
    }
  }
  
  private async checkMemory() {
    const usage = process.memoryUsage()
    const heapPercentage = (usage.heapUsed / usage.heapTotal) * 100
    
    if (heapPercentage > 90) {
      throw new Error('Memory usage critical')
    }
    
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      percentage: heapPercentage
    }
  }
  
  private async checkCPU() {
    const usage = process.cpuUsage()
    const total = usage.user + usage.system
    
    return {
      user: usage.user,
      system: usage.system,
      total
    }
  }
}

// Expose health endpoint
app.get('/health', async (req, res) => {
  const checker = new HealthChecker()
  const status = await checker.performHealthCheck()
  
  res.status(status.status === 'healthy' ? 200 : 503).json(status)
})
```

## State Management

### Persistent State with PostgreSQL

```typescript
import { PostgresStorageBackend } from '@jambudipa/spider'
import { ResumabilityService } from '@jambudipa/spider'
import { Pool } from 'pg'

class PostgresCrawlerState {
  private pool: Pool
  
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    })
  }
  
  async saveProgress(crawlId: string, state: CrawlState) {
    const client = await this.pool.connect()
    
    try {
      await client.query('BEGIN')
      
      // Save main state
      await client.query(
        `INSERT INTO crawl_state (id, state, updated_at) 
         VALUES ($1, $2, NOW()) 
         ON CONFLICT (id) DO UPDATE 
         SET state = $2, updated_at = NOW()`,
        [crawlId, JSON.stringify(state)]
      )
      
      // Save URL queue
      for (const url of state.pendingUrls) {
        await client.query(
          `INSERT INTO url_queue (crawl_id, url, priority, status) 
           VALUES ($1, $2, $3, 'pending') 
           ON CONFLICT DO NOTHING`,
          [crawlId, url, state.urlPriorities[url] || 0]
        )
      }
      
      // Save results
      for (const result of state.results) {
        await client.query(
          `INSERT INTO crawl_results (crawl_id, url, data, crawled_at) 
           VALUES ($1, $2, $3, NOW())`,
          [crawlId, result.url, JSON.stringify(result.data)]
        )
      }
      
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  
  async loadProgress(crawlId: string): Promise<CrawlState | null> {
    const client = await this.pool.connect()
    
    try {
      // Load main state
      const stateResult = await client.query(
        'SELECT state FROM crawl_state WHERE id = $1',
        [crawlId]
      )
      
      if (stateResult.rows.length === 0) {
        return null
      }
      
      const state = JSON.parse(stateResult.rows[0].state)
      
      // Load pending URLs
      const urlsResult = await client.query(
        `SELECT url, priority FROM url_queue 
         WHERE crawl_id = $1 AND status = 'pending' 
         ORDER BY priority DESC`,
        [crawlId]
      )
      
      state.pendingUrls = urlsResult.rows.map(r => r.url)
      state.urlPriorities = Object.fromEntries(
        urlsResult.rows.map(r => [r.url, r.priority])
      )
      
      return state
    } finally {
      client.release()
    }
  }
}

// Use with Spider
const stateManager = new PostgresCrawlerState()
const backend = new PostgresStorageBackend({
  connectionString: process.env.DATABASE_URL
})

const resumabilityLayer = Layer.succeed(
  ResumabilityService,
  ResumabilityService.of({
    strategy: 'hybrid',
    backend,
    checkpointInterval: 100
  })
)
```

## Deployment Patterns

### Docker Container

```dockerfile
FROM node:20-alpine

# Install Playwright dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set Playwright environment
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

# Run as non-root
USER node

CMD ["node", "dist/index.js"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: spider-crawler
spec:
  replicas: 3
  selector:
    matchLabels:
      app: spider-crawler
  template:
    metadata:
      labels:
        app: spider-crawler
    spec:
      containers:
      - name: crawler
        image: spider-crawler:latest
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: spider-secrets
              key: database-url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: spider-secrets
              key: redis-url
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: spider-crawler
spec:
  selector:
    app: spider-crawler
  ports:
  - port: 3000
    targetPort: 3000
```

## Best Practices

### 1. Graceful Shutdown

```typescript
class GracefulCrawler {
  private isShuttingDown = false
  
  constructor() {
    process.on('SIGTERM', () => this.shutdown())
    process.on('SIGINT', () => this.shutdown())
  }
  
  async shutdown() {
    if (this.isShuttingDown) return
    this.isShuttingDown = true
    
    console.log('Graceful shutdown initiated...')
    
    // Stop accepting new work
    await this.stopAcceptingWork()
    
    // Wait for current work to complete
    await this.waitForCompletion()
    
    // Save state
    await this.saveState()
    
    // Close connections
    await this.closeConnections()
    
    console.log('Shutdown complete')
    process.exit(0)
  }
}
```

### 2. Resource Limits

```typescript
const config = makeSpiderConfig({
  maxConcurrentWorkers: Math.min(10, os.cpus().length),
  maxPages: 10000,
  maxMemoryMB: 1024,
  
  // Custom resource checks
  beforeCrawl: async () => {
    const usage = process.memoryUsage()
    if (usage.heapUsed > 1024 * 1024 * 1024) {
      throw new Error('Memory limit exceeded')
    }
  }
})
```

### 3. Logging Strategy

```typescript
import winston from 'winston'

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ 
      filename: 'error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'combined.log' 
    })
  ]
})

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }))
}
```

## Next Steps

- [Performance Guide](../guides/performance.md) - Optimisation strategies
- [Configuration Guide](../guides/configuration.md) - Advanced configuration
- [API Reference](../api/) - Complete API documentation
- [Examples](../examples/) - More example code