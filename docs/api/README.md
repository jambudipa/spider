# API Reference

Complete API documentation for Spider's components and services.

## Core Services

### [SpiderService](./spider-service.md)
Main crawling orchestration service. Coordinates all crawling operations, manages workers, and processes results.

### [SpiderSchedulerService](./scheduler.md)
Request scheduling and prioritisation. Manages the crawl queue, handles URL prioritisation, and coordinates worker assignments.

### [LinkExtractorService](./link-extractor.md)
Link discovery and filtering service. Extracts links from HTML content and applies filtering rules.

### [ResumabilityService](./resumability.md)
State persistence and recovery. Enables crawls to be paused and resumed, surviving crashes and restarts.

## Configuration

### [SpiderConfig](./config.md)
Configuration system and factory functions. Define crawling behaviour, limits, and filtering rules.

### [MiddlewareManager](./middleware.md)
Request/response processing pipeline. Add custom processing logic, authentication, and monitoring.

## HTTP & State Management

### [EnhancedHttpClient](./http-client.md)
HTTP client with session support, cookie management, and enhanced features for web scraping.

### [CookieManager](./cookie-manager.md)
Cookie storage and management across domains and sessions.

### [SessionStore](./session-store.md)
Session persistence for maintaining authentication state.

### [TokenExtractor](./token-extractor.md)
Extract authentication tokens, CSRF tokens, and other security tokens from pages.

### [StateManager](./state-manager.md)
Manage application state including tokens, session data, and crawl state.

## Browser Automation

### [BrowserManager](./browser-manager.md)
Browser lifecycle management and pooling for Playwright integration.

### [PlaywrightAdapter](./playwright-adapter.md)
Wrapper for Playwright functionality, providing Spider-specific browser automation features.

## Data Processing

### [PageData](./page-data.md)
Structure representing extracted page content and metadata.

### [UrlDeduplicator](./url-deduplicator.md)
Efficient URL deduplication to prevent re-crawling.

### [WebScrapingEngine](./web-scraping-engine.md)
Core scraping engine coordinating extraction and processing.

## Monitoring & Logging

### [WorkerHealthMonitor](./worker-health.md)
Performance monitoring and health checks for crawler workers.

### [SpiderLogger](./spider-logger.md)
Structured logging service for debugging and monitoring.

## Storage Backends

### [FileStorageBackend](./file-storage.md)
File-based persistence for state and data.

### [PostgresStorageBackend](./postgres-storage.md)
PostgreSQL storage backend for enterprise deployments.

### [RedisStorageBackend](./redis-storage.md)
Redis backend for distributed crawling and caching.

## Error Types

### [Error Reference](./errors.md)
All error types and error handling strategies.

## Quick Links

- **Most Used**: [SpiderService](./spider-service.md), [SpiderConfig](./config.md), [MiddlewareManager](./middleware.md)
- **Authentication**: [SessionStore](./session-store.md), [CookieManager](./cookie-manager.md), [TokenExtractor](./token-extractor.md)
- **Browser**: [BrowserManager](./browser-manager.md), [PlaywrightAdapter](./playwright-adapter.md)
- **Persistence**: [ResumabilityService](./resumability.md), [Storage Backends](./file-storage.md)