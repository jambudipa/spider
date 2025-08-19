# Configuration Reference

This reference covers all configuration options available in the Spider library.

## SpiderConfigOptions

Main configuration options for the SpiderService.

```typescript
interface SpiderConfigOptions {
  userAgent?: string;
  respectRobotsTxt?: boolean;
  requestDelay?: number;
  maxConcurrency?: number;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  maxPages?: number;
  maxDepth?: number;
  followRedirects?: boolean;
  useBrowser?: boolean;
  resumability?: ResumabilityService;
  defaultHeaders?: Record<string, string>;
  cookieJar?: CookieJar;
  proxy?: ProxyConfig;
}
```

### Basic Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `userAgent` | `string` | `'Spider/1.0'` | User agent string for requests |
| `respectRobotsTxt` | `boolean` | `true` | Whether to check and obey robots.txt |
| `requestDelay` | `number` | `1000` | Delay between requests (milliseconds) |
| `maxConcurrency` | `number` | `1` | Maximum concurrent requests |
| `timeout` | `number` | `30000` | Request timeout (milliseconds) |

### Retry Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `retryAttempts` | `number` | `3` | Maximum retry attempts for failed requests |
| `retryDelay` | `number` | `1000` | Delay between retry attempts (milliseconds) |

### Crawling Limits

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxPages` | `number` | `Infinity` | Maximum pages to crawl |
| `maxDepth` | `number` | `Infinity` | Maximum crawl depth |

### Network Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `followRedirects` | `boolean` | `true` | Whether to follow HTTP redirects |
| `defaultHeaders` | `Record<string, string>` | `{}` | Default headers for all requests |

### Browser Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `useBrowser` | `boolean` | `false` | Use browser engine for JavaScript rendering |

## Middleware Configuration

### RateLimitConfig

```typescript
interface RateLimitConfig {
  maxConcurrentRequests: number;
  maxRequestsPerSecondPerDomain: number;
  requestDelayMs?: number;
  burstLimit?: number;
  windowSizeMs?: number;
}
```

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `maxConcurrentRequests` | `number` | Yes | Global concurrent request limit |
| `maxRequestsPerSecondPerDomain` | `number` | Yes | Per-domain rate limit |
| `requestDelayMs` | `number` | No | Additional delay between requests |
| `burstLimit` | `number` | No | Burst request allowance |
| `windowSizeMs` | `number` | No | Rate limiting window size |

**Example:**
```typescript
const rateLimiter = new RateLimitMiddleware({
  maxConcurrentRequests: 5,
  maxRequestsPerSecondPerDomain: 2,
  requestDelayMs: 500,
  burstLimit: 10,
  windowSizeMs: 1000
});
```

### LoggingConfig

```typescript
interface LoggingConfig {
  logRequests?: boolean;
  logResponses?: boolean;
  logErrors?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  includeHeaders?: boolean;
  includeBody?: boolean;
  maxBodyLength?: number;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `logRequests` | `boolean` | `true` | Log outgoing requests |
| `logResponses` | `boolean` | `true` | Log incoming responses |
| `logErrors` | `boolean` | `true` | Log errors |
| `logLevel` | `string` | `'info'` | Minimum log level |
| `includeHeaders` | `boolean` | `false` | Include headers in logs |
| `includeBody` | `boolean` | `false` | Include body content in logs |
| `maxBodyLength` | `number` | `1000` | Maximum body length to log |

**Example:**
```typescript
const logger = new LoggingMiddleware({
  logLevel: 'debug',
  includeHeaders: true,
  maxBodyLength: 500
});
```

### UserAgentConfig

```typescript
interface UserAgentConfig {
  userAgents: string | string[];
  rotateOnEachRequest?: boolean;
  rotationStrategy?: 'random' | 'sequential';
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `userAgents` | `string \| string[]` | Required | User agent string(s) |
| `rotateOnEachRequest` | `boolean` | `false` | Rotate user agents per request |
| `rotationStrategy` | `string` | `'sequential'` | How to rotate user agents |

**Example:**
```typescript
const userAgent = new UserAgentMiddleware({
  userAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
  ],
  rotateOnEachRequest: true,
  rotationStrategy: 'random'
});
```

## Resumability Configuration

### ResumabilityConfig

```typescript
interface ResumabilityConfig {
  storageBackend: StorageBackend;
  enableResumption: boolean;
  retryFailedUrls?: boolean;
  maxRetries?: number;
  persistenceStrategy?: PersistenceStrategy;
  autoSaveInterval?: number;
  compressionEnabled?: boolean;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storageBackend` | `StorageBackend` | Required | Storage implementation |
| `enableResumption` | `boolean` | Required | Enable resumable operations |
| `retryFailedUrls` | `boolean` | `true` | Retry failed URLs on resume |
| `maxRetries` | `number` | `3` | Maximum retry attempts |
| `persistenceStrategy` | `PersistenceStrategy` | `FullStatePersistence` | Persistence strategy |
| `autoSaveInterval` | `number` | `5000` | Auto-save interval (milliseconds) |
| `compressionEnabled` | `boolean` | `false` | Compress stored state |

### Storage Backend Configurations

#### FileStorageBackend

```typescript
interface FileStorageConfig {
  basePath: string;
  persistInterval?: number;
  maxFileSize?: number;
  backupCount?: number;
  compressionLevel?: number;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `basePath` | `string` | Required | Directory for state files |
| `persistInterval` | `number` | `5000` | Save interval (milliseconds) |
| `maxFileSize` | `number` | `100MB` | Maximum file size |
| `backupCount` | `number` | `3` | Number of backups to keep |
| `compressionLevel` | `number` | `6` | Gzip compression level (0-9) |

**Example:**
```typescript
const fileStorage = new FileStorageBackend({
  basePath: './spider-state',
  persistInterval: 10000,
  maxFileSize: 50 * 1024 * 1024, // 50MB
  backupCount: 5
});
```

#### PostgresStorageBackend

```typescript
interface PostgresStorageConfig {
  connectionString: string;
  tableName?: string;
  persistInterval?: number;
  batchSize?: number;
  connectionPool?: {
    min: number;
    max: number;
    idleTimeoutMillis: number;
  };
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `connectionString` | `string` | Required | PostgreSQL connection string |
| `tableName` | `string` | `'spider_state'` | Table name for state storage |
| `persistInterval` | `number` | `5000` | Save interval (milliseconds) |
| `batchSize` | `number` | `100` | Batch size for bulk operations |

**Example:**
```typescript
const postgresStorage = new PostgresStorageBackend({
  connectionString: 'postgresql://user:pass@localhost:5432/spider_db',
  tableName: 'crawl_sessions',
  persistInterval: 2000,
  batchSize: 500,
  connectionPool: {
    min: 2,
    max: 10,
    idleTimeoutMillis: 30000
  }
});
```

#### RedisStorageBackend

```typescript
interface RedisStorageConfig {
  host: string;
  port: number;
  password?: string;
  database?: number;
  keyPrefix?: string;
  persistInterval?: number;
  ttl?: number;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | `string` | Required | Redis server hostname |
| `port` | `number` | Required | Redis server port |
| `password` | `string` | - | Redis password |
| `database` | `number` | `0` | Redis database number |
| `keyPrefix` | `string` | `'spider:'` | Key prefix for stored data |
| `persistInterval` | `number` | `5000` | Save interval (milliseconds) |
| `ttl` | `number` | - | Time-to-live for keys (seconds) |

**Example:**
```typescript
const redisStorage = new RedisStorageBackend({
  host: 'localhost',
  port: 6379,
  password: 'secret',
  keyPrefix: 'myapp:spider:',
  ttl: 86400 // 24 hours
});
```

## Persistence Strategies

### FullStatePersistence

Saves complete state on each persistence operation.

```typescript
const fullStrategy = new FullStatePersistence({
  interval: 10000 // Save every 10 seconds
});
```

### DeltaPersistence

Saves only changes since last persistence.

```typescript
const deltaStrategy = new DeltaPersistence({
  interval: 1000,     // Save deltas every second
  maxDeltas: 100      // Full save after 100 deltas
});
```

### HybridPersistence

Combines delta and full state persistence.

```typescript
const hybridStrategy = new HybridPersistence({
  deltaInterval: 1000,      // Delta saves every second
  fullStateInterval: 30000, // Full saves every 30 seconds
  maxDeltaCount: 200        // Full save after 200 deltas
});
```

## Browser Configuration

### BrowserConfig

```typescript
interface BrowserConfig {
  headless?: boolean;
  viewport?: {
    width: number;
    height: number;
  };
  userAgent?: string;
  timeout?: number;
  waitForContent?: boolean;
  javascript?: boolean;
  images?: boolean;
  css?: boolean;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `headless` | `boolean` | `true` | Run browser in headless mode |
| `viewport` | `object` | `{width: 1920, height: 1080}` | Browser viewport size |
| `userAgent` | `string` | - | Override browser user agent |
| `timeout` | `number` | `30000` | Page load timeout |
| `waitForContent` | `boolean` | `true` | Wait for dynamic content |
| `javascript` | `boolean` | `true` | Enable JavaScript execution |
| `images` | `boolean` | `false` | Load images |
| `css` | `boolean` | `true` | Load CSS |

**Example:**
```typescript
import { Effect } from 'effect';
import { SpiderService, makeSpiderConfig, SpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';

const browserProgram = Effect.gen(function* () {
  const spider = yield* SpiderService;
  
  // Browser configuration would be handled via SpiderConfig
  // Example usage here
});

const browserConfig = makeSpiderConfig({
  // Browser options would be configured here
  userAgent: 'Browser Spider 1.0'
});

Effect.runPromise(
  browserProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(browserConfig)),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Authentication Configuration

### SessionConfig

```typescript
interface SessionConfig {
  persistToFile?: string;
  cookieJar?: CookieJar;
  sessionTimeout?: number;
  autoRenew?: boolean;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `persistToFile` | `string` | - | File to persist session data |
| `cookieJar` | `CookieJar` | - | Custom cookie jar |
| `sessionTimeout` | `number` | `3600000` | Session timeout (milliseconds) |
| `autoRenew` | `boolean` | `false` | Automatically renew expired sessions |

### CookieConfig

```typescript
interface CookieConfig {
  persistCookies?: boolean;
  cookieFile?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `persistCookies` | `boolean` | `false` | Persist cookies to file |
| `cookieFile` | `string` | - | File to store cookies |
| `domain` | `string` | - | Default domain for cookies |
| `secure` | `boolean` | `false` | Only send over HTTPS |
| `httpOnly` | `boolean` | `true` | Prevent JavaScript access |

## Environment Variables

Spider recognises these environment variables:

| Variable | Type | Description |
|----------|------|-------------|
| `SPIDER_USER_AGENT` | `string` | Default user agent |
| `SPIDER_RESPECT_ROBOTS` | `boolean` | Respect robots.txt |
| `SPIDER_REQUEST_DELAY` | `number` | Default request delay |
| `SPIDER_MAX_CONCURRENCY` | `number` | Default concurrency |
| `SPIDER_TIMEOUT` | `number` | Default timeout |
| `SPIDER_LOG_LEVEL` | `string` | Logging level |
| `SPIDER_STORAGE_PATH` | `string` | Default storage path |

**Example:**
```bash
export SPIDER_USER_AGENT="MyBot/2.0"
export SPIDER_RESPECT_ROBOTS=true
export SPIDER_REQUEST_DELAY=2000
export SPIDER_MAX_CONCURRENCY=3
```

## Configuration Validation

Spider validates configuration at runtime and provides helpful error messages:

```typescript
import { Effect } from 'effect';
import { SpiderService, makeSpiderConfig, SpiderConfig, ConfigurationError } from '@jambudipa/spider';

const validationProgram = Effect.gen(function* () {
  try {
    // Configuration validation happens during config creation
    const invalidConfig = makeSpiderConfig({
      maxConcurrentWorkers: -1, // Invalid
      requestDelayMs: -500 // Invalid
    });
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(`Configuration error: ${error.message}`);
    }
  }
});
```

Common validation errors:

- `maxConcurrency` must be a positive integer
- `requestDelay` must be a non-negative number
- `timeout` must be a positive number
- `maxPages` and `maxDepth` must be positive integers
- `userAgent` must be a non-empty string
- Storage backend must implement required interface