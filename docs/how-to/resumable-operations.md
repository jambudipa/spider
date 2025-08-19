# How to Use Resumable Operations

This guide shows you how to implement resumable web scraping operations that can survive crashes, network interruptions, and restarts.

## Basic Resumable Scraping

Enable resumable operations with minimal configuration:

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, FileStorageBackend, ResumabilityService, makeSpiderConfig, SpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';

const basicResumableScrapingProgram = Effect.gen(function* () {
  // Configure resumability with file-based storage
  const resumabilityService = yield* ResumabilityService;
  const spider = yield* SpiderService;
  
  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      console.log(`Processed: ${result.pageData.url} (depth: ${result.depth})`);
    })
  );
  
  try {
    yield* spider.crawl(['https://example.com'], collectSink);
  } catch (error) {
    console.error('Crawl interrupted:', error.message);
    console.log('State has been saved. You can resume this crawl later.');
  }
});

// Configuration
const config = makeSpiderConfig({
  maxDepth: 3,
  maxPages: 1000,
  requestDelayMs: 1000,
  userAgent: 'Resumable Spider 1.0'
});

// Run the program
Effect.runPromise(
  basicResumableScrapingProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(ResumabilityService.Default),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Resuming an Interrupted Crawl

Resume a previously interrupted crawling session:

```typescript
const resumeInterruptedCrawlProgram = Effect.gen(function* () {
  const resumabilityService = yield* ResumabilityService;
  const spider = yield* SpiderService;

  try {
    // Check if there's a saved state to resume
    const canResume = yield* resumabilityService.canResumeSession('my-crawl-session');
    
    if (canResume) {
      console.log('Found saved state. Resuming crawl...');
      
      const collectSink = Sink.forEach((result) =>
        Effect.sync(() => {
          console.log(`Resumed processing: ${result.pageData.url}`);
        })
      );
      
      yield* spider.resumeCrawl('my-crawl-session', collectSink);
    } else {
      console.log('No saved state found. Starting fresh crawl...');
      // Start new crawl as shown in previous example
    }

  } catch (error) {
    console.error('Resume failed:', error.message);
  }
});

// Configuration
const resumeConfig = makeSpiderConfig({
  requestDelayMs: 1000,
  userAgent: 'Resumable Spider 1.0'
});

// Run the program
Effect.runPromise(
  resumeInterruptedCrawlProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(ResumabilityService.Default),
    Effect.provide(SpiderConfig.Live(resumeConfig)),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Database-Based Persistence

Use PostgreSQL for distributed or high-performance scenarios:

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, ResumabilityService, makeSpiderConfig, SpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';

const databaseResumabilityProgram = Effect.gen(function* () {
  const resumabilityService = yield* ResumabilityService;
  const spider = yield* SpiderService;

  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      // Database persistence allows for real-time monitoring
      console.log(`Processed ${result.pageData.url} - State automatically saved`);
    })
  );

  yield* spider.crawl(['https://large-site.com'], collectSink);
});

// Configuration for database resumability
const dbConfig = makeSpiderConfig({
  maxDepth: 5,
  maxPages: 50000,
  requestDelayMs: 500
});

// Run the program
Effect.runPromise(
  databaseResumabilityProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(ResumabilityService.Default),
    Effect.provide(SpiderConfig.Live(dbConfig)),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Redis-Based Persistence for Distributed Systems

Use Redis for distributed crawling across multiple machines:

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, ResumabilityService, makeSpiderConfig, SpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';

const distributedResumabilityProgram = Effect.gen(function* () {
  const resumabilityService = yield* ResumabilityService;
  const spider = yield* SpiderService;

  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      console.log(`Worker processed: ${result.pageData.url}`);
    })
  );

  // Multiple spider instances can work on the same session
  yield* spider.crawl(['https://distributed-crawl-target.com'], collectSink);
});

// Configuration for distributed resumability
const distributedConfig = makeSpiderConfig({
  requestDelayMs: 100, // Faster for distributed scenarios
  maxConcurrentWorkers: 5
});

// Run the program
Effect.runPromise(
  distributedResumabilityProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(ResumabilityService.Default),
    Effect.provide(SpiderConfig.Live(distributedConfig)),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Custom Persistence Strategies

Implement custom persistence behaviour:

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, ResumabilityService, HybridPersistence, makeSpiderConfig, SpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';

const customPersistenceProgram = Effect.gen(function* () {
  const resumabilityService = yield* ResumabilityService;
  const spider = yield* SpiderService;

  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      console.log(`Processed: ${result.pageData.url}`);
    })
  );

  yield* spider.crawl(['https://example.com'], collectSink);
});

// Configuration for custom persistence
const hybridConfig = makeSpiderConfig({
  maxPages: 10000
});

// Run the program
Effect.runPromise(
  customPersistenceProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(ResumabilityService.Default),
    Effect.provide(SpiderConfig.Live(hybridConfig)),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Handling Resumption with Authentication

Resume authenticated sessions securely:

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, ResumabilityService, SessionStore, makeSpiderConfig, SpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';

const resumableAuthenticatedCrawlProgram = Effect.gen(function* () {
  const resumabilityService = yield* ResumabilityService;
  const spider = yield* SpiderService;
  const sessionStore = yield* SessionStore;

  try {
    // Check if we can resume an authenticated session
    const canResume = yield* resumabilityService.canResumeSession('auth-session');
    
    if (canResume) {
      console.log('Resuming authenticated session...');
      
      const resumeCollectSink = Sink.forEach((result) =>
        Effect.sync(() => {
          console.log(`Resumed authenticated crawl: ${result.pageData.url}`);
        })
      );
      
      yield* spider.resumeCrawl('auth-session', resumeCollectSink);
    } else {
      // Perform login first
      yield* spider.scrape('https://secure-site.com/login', {
        method: 'POST',
        body: { username: 'user', password: 'pass' }
      });
      
      const collectSink = Sink.forEach((result) =>
        Effect.sync(() => {
          console.log(`Processing authenticated: ${result.pageData.url}`);
        })
      );
      
      // Start crawl with session persistence
      yield* spider.crawl(['https://secure-site.com/protected-area'], collectSink);
    }

  } catch (error) {
    console.error('Authenticated crawl error:', error.message);
  }
});

// Configuration
const authConfig = makeSpiderConfig({
  userAgent: 'Authenticated Spider 1.0'
});

// Run the program
Effect.runPromise(
  resumableAuthenticatedCrawlProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(ResumabilityService.Default),
    Effect.provide(SessionStore.Default),
    Effect.provide(SpiderConfig.Live(authConfig)),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## State Inspection and Management

Monitor and manage resumable state:

```typescript
const stateManagementProgram = Effect.gen(function* () {
  const resumabilityService = yield* ResumabilityService;

  // List all available sessions
  const sessions = yield* resumabilityService.listSessions();
  console.log('Available sessions:', sessions);

  for (const sessionId of sessions) {
    // Get session information
    const sessionInfo = yield* resumabilityService.getSessionInfo(sessionId);
    console.log(`Session ${sessionId}:`);
    console.log(`  - URLs processed: ${sessionInfo.processedCount}`);
    console.log(`  - URLs in queue: ${sessionInfo.queueSize}`);
    console.log(`  - Last updated: ${sessionInfo.lastUpdated}`);
    console.log(`  - Can resume: ${sessionInfo.canResume}`);

    // Clean up old sessions (optional)
    const ageInHours = (Date.now() - sessionInfo.lastUpdated) / (1000 * 60 * 60);
    if (ageInHours > 24) {
      console.log(`  - Cleaning up old session (${ageInHours.toFixed(1)} hours old)`);
      yield* resumabilityService.clearSession(sessionId);
    }
  }
});

// Run the program
Effect.runPromise(
  stateManagementProgram.pipe(
    Effect.provide(ResumabilityService.Default)
  )
).catch(console.error);
```

## Error Recovery and Retry Logic

Handle errors with resumable operations:

```typescript
const robustResumableCrawlProgram = Effect.gen(function* () {
  const resumabilityService = yield* ResumabilityService;
  const spider = yield* SpiderService;

  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      console.log(`✅ Processed: ${result.pageData.url}`);
    })
  );

  yield* spider.crawl(['https://unreliable-site.com'], collectSink).pipe(
    Effect.catchTags({
      NetworkError: (error) => {
        console.log(`❌ Network error: ${error.message}`);
        return Effect.succeed(undefined);
      },
      ResponseError: (error) => {
        console.log(`❌ Response error: ${error.message}`);
        return Effect.succeed(undefined);
      }
    })
  );
});

// Configuration for robust crawling
const robustConfig = makeSpiderConfig({
  maxPages: 5000,
  requestDelayMs: 1000,
  userAgent: 'Robust Spider 1.0'
});

// Run the program
Effect.runPromise(
  robustResumableCrawlProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(ResumabilityService.Default),
    Effect.provide(SpiderConfig.Live(robustConfig)),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Performance Optimisation for Large Crawls

Optimise resumable operations for large-scale crawling:

```typescript
const optimisedResumableCrawlProgram = Effect.gen(function* () {
  const resumabilityService = yield* ResumabilityService;
  const spider = yield* SpiderService;

  let processedCount = 0;
  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      processedCount++;
      // Minimal logging for performance
      if (result.depth === 0 || processedCount % 1000 === 0) {
        console.log(`Progress: ${processedCount} pages processed`);
      }
    })
  );

  yield* spider.crawl(['https://massive-site.com'], collectSink);
});

// Configuration for optimised crawling
const optimisedConfig = makeSpiderConfig({
  maxPages: 1000000,
  requestDelayMs: 100,
  maxConcurrentWorkers: 10
});

// Run the program
Effect.runPromise(
  optimisedResumableCrawlProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(ResumabilityService.Default),
    Effect.provide(SpiderConfig.Live(optimisedConfig)),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Monitoring Resumable Operations

Set up monitoring for long-running resumable crawls:

```typescript
const monitoredResumableCrawlProgram = Effect.gen(function* () {
  const resumabilityService = yield* ResumabilityService;
  const spider = yield* SpiderService;

  // Set up monitoring
  const monitoringProgram = Effect.gen(function* () {
    const sessions = yield* resumabilityService.listSessions();
    
    for (const sessionId of sessions) {
      const info = yield* resumabilityService.getSessionInfo(sessionId);
      
      console.log(`📊 Session ${sessionId}:`);
      console.log(`   Processed: ${info.processedCount}`);
      console.log(`   Queue: ${info.queueSize}`);
      
      if (info.processedCount > 0) {
        const successRate = (info.successCount / info.processedCount * 100).toFixed(1);
        console.log(`   Success rate: ${successRate}%`);
        console.log(`   Avg response time: ${info.avgResponseTime}ms`);
      }
      
      // Alert on potential issues
      if (info.errorCount > info.successCount * 0.1) {
        console.warn(`⚠️  High error rate in session ${sessionId}`);
      }
      
      if (info.avgResponseTime > 5000) {
        console.warn(`⚠️  Slow responses in session ${sessionId}`);
      }
    }
  });

  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      console.log(`Processed: ${result.pageData.url}`);
    })
  );

  // Start crawling with monitoring
  yield* Effect.fork(Effect.repeatWithDelay(monitoringProgram, '30 seconds'));
  yield* spider.crawl(['https://example.com'], collectSink);
});

// Configuration
const monitoredConfig = makeSpiderConfig({
  maxPages: 10000
});

// Run the program
Effect.runPromise(
  monitoredResumableCrawlProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(ResumabilityService.Default),
    Effect.provide(SpiderConfig.Live(monitoredConfig)),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Best Practices for Resumable Operations

1. **Use unique session IDs**: Ensure session IDs are unique and descriptive
2. **Choose appropriate storage backends**: File storage for single-machine, database for distributed
3. **Configure persistence intervals**: Balance between data safety and performance
4. **Implement monitoring**: Track progress and detect issues early
5. **Handle authentication properly**: Ensure authentication state is preserved
6. **Clean up old sessions**: Regularly remove completed or abandoned sessions
7. **Test resumption logic**: Verify that resumption works correctly with your specific use case
8. **Plan for failure**: Implement error handling and alerting for state persistence issues

## Troubleshooting Resumable Operations

Common issues and solutions:

- **State corruption**: Implement state validation and backup strategies
- **Memory leaks**: Monitor memory usage and implement cleanup routines
- **Slow resumption**: Optimise storage backend performance and persistence strategies
- **Authentication expiration**: Implement session refresh logic
- **Concurrent access**: Use appropriate locking mechanisms for shared storage backends
