# Spider Examples

This directory contains comprehensive examples demonstrating Spider's web scraping capabilities. All examples are tested against [web-scraping.dev](https://web-scraping.dev/) to showcase real-world scenarios.

## Quick Start

Run any example from the project root:

```bash
# Basic crawling example
npx tsx src/examples/01-basic-crawl-working.ts

# Multiple URLs with concurrent crawling
npx tsx src/examples/02-multiple-urls-working.ts
```

## 📚 Example Catalog

All examples are now working and fully tested! Each demonstrates different aspects of Spider's web scraping capabilities.

### ✅ Core Examples

#### 01. Basic Web Crawling
**File:** `01-basic-crawl-working.ts`
**Status:** ✅ Working

Demonstrates fundamental Spider usage:
- Basic Spider setup and configuration
- Single URL crawling with depth control
- Result collection and processing
- Error handling and statistics

```bash
npx tsx src/examples/01-basic-crawl-working.ts
```

**Key Learning Points:**
- Spider service configuration
- Sink-based result collection
- Depth and page limits
- Performance monitoring

---

#### 02. Multiple URLs and Domain Isolation
**File:** `02-multiple-urls-working.ts`
**Status:** ✅ Working

Showcases concurrent crawling capabilities:
- Multiple starting URLs with metadata
- Domain isolation and deduplication
- Concurrent request handling
- Result categorization by section

```bash
npx tsx src/examples/02-multiple-urls-working.ts
```

**Key Learning Points:**
- Concurrent domain handling
- Metadata persistence through crawl
- Result organization and analysis
- Performance with multiple starting points

---

#### 03. URL Filtering and Domain Restrictions
**File:** `03-url-filtering.ts`
**Status:** ✅ Working

Demonstrates advanced filtering capabilities:
- Custom URL filtering with regex patterns
- File extension filtering by category
- Domain allowlist/blocklist restrictions
- Technical URL filtering (malformed, long URLs)

```bash
npx tsx src/examples/03-url-filtering.ts
```

**Expected Output:**
```
🕷️ Example 03: URL Filtering and Restrictions
Demonstrating various filtering capabilities

🚀 Starting filtered crawl with restrictions:
  - Blocking admin and API paths
  - Blocking image and document files
  - Limiting to web-scraping.dev domain
  - Filtering malformed URLs

✓ Processed: https://web-scraping.dev/
  Title: web-scraping.dev
  Status: 200, Depth: 0

📊 Filtering Results:
- Pages processed: 6
- Total crawl time: 2.34s
- Filtered content: admin paths, API endpoints, media files
```

**Key Learning Points:**
- Comprehensive URL filtering strategies
- File extension categorization
- Domain-based access control
- Performance impact of filtering

---

#### 04. Robots.txt Compliance and Rate Limiting
**File:** `04-robots-compliance.ts`
**Status:** ✅ Working

Shows ethical crawling practices:
- Automatic robots.txt fetching and parsing
- Robots.txt compliance checking
- Crawl delay respect and rate limiting
- Timing analysis and statistics

```bash
npx tsx src/examples/04-robots-compliance.ts
```

**Expected Output:**
```
🕷️ Example 04: Robots.txt Compliance & Rate Limiting
Demonstrating respectful crawling practices

🤖 Checking robots.txt compliance:
Robots.txt permissions check:
  ✅ https://web-scraping.dev/ (delay: 800ms)
  ✅ https://web-scraping.dev/products (delay: 800ms)

📊 Rate Limiting Analysis:
- Total pages: 8
- Average delay between requests: 823ms
- Min delay: 801ms, Max delay: 1204ms
```

**Key Learning Points:**
- Robots.txt protocol compliance
- Rate limiting implementation
- Crawl delay management
- Respectful crawling practices

---

### ✅ Advanced Examples

#### 05. Link Extraction with CSS Selectors
**File:** `05-link-extraction-selectors.ts`
**Status:** ✅ Working

Advanced link extraction techniques:
- Custom CSS selectors for targeted extraction
- LinkExtractorService usage patterns
- Form action URL extraction
- Multi-element link extraction strategies

```bash
npx tsx src/examples/05-link-extraction-selectors.ts
```

**Key Learning Points:**
- CSS selector-based extraction
- Service-oriented extraction patterns
- Link analysis and statistics
- Extraction workflow design

---

#### 06. Custom Middleware Usage
**File:** `06-custom-middleware.ts`
**Status:** ✅ Working

Middleware system demonstration:
- Custom middleware implementation
- Request timing and header injection
- Content analysis middleware
- URL pattern detection

```bash
npx tsx src/examples/06-custom-middleware.ts
```

**Key Learning Points:**
- Middleware interface implementation
- Request/response processing pipeline
- Custom logging and analytics
- Middleware composition patterns

---

#### 07. Resumability and State Persistence
**File:** `07-resumability-demo.ts`
**Status:** ✅ Working

State persistence and resumable crawling:
- ResumabilityService configuration
- File-based state storage
- Session management and cleanup
- State persistence demonstrations

```bash
npx tsx src/examples/07-resumability-demo.ts
```

**Key Learning Points:**
- Resumable crawling patterns
- State persistence strategies
- Session lifecycle management
- Recovery mechanisms

---

#### 08. Worker Health Monitoring
**File:** `08-worker-monitoring.ts`
**Status:** ✅ Working

Worker performance and health monitoring:
- Concurrent worker management
- Real-time performance metrics
- Memory usage tracking
- Worker efficiency analysis

```bash
npx tsx src/examples/08-worker-monitoring.ts
```

**Key Learning Points:**
- Worker performance monitoring
- Memory usage optimization
- Concurrent request management
- Performance analysis techniques

---

#### 09. Error Handling and Recovery
**File:** `09-error-handling-recovery.ts`
**Status:** ✅ Working

Comprehensive error handling strategies:
- Error classification and tracking via `CrawlResult.isError` + `PageFetchErrorKind`
- Recovery mechanism implementation
- Statistics collection and analysis
- Graceful degradation patterns

```bash
npx tsx src/examples/09-error-handling-recovery.ts
```

**Key Learning Points:**
- Error handling best practices with `CrawlResultError`
- Recovery strategy implementation
- Error analytics and reporting
- Reliability engineering

---

#### 10. Custom Logging and Event Handling
**File:** `10-custom-logging.ts`
**Status:** ✅ Working

Demonstrates both independent observability surfaces:
- Custom Effect Logger for diagnostic log redirection
- Custom `SpiderEventSink` for typed domain events
- Structured log formatting with timestamps, levels, and fiber IDs
- Integration with external analytics or event buses

```bash
npx tsx src/examples/10-custom-logging.ts
```

**Key Learning Points:**
- Two observability surfaces: Effect Logger vs SpiderEventSink
- `Logger.replace` for redirecting all Effect.log* calls
- Custom sink layer for `SpiderStart`, `DomainComplete`, `PageScraped`, etc.
- Both surfaces independently overridable

---

## 🚀 Running Examples

### Prerequisites

Ensure you're in the project root directory and have dependencies installed:

```bash
npm install
```

### Execution

Examples can be run directly with tsx:

```bash
# Run a specific example
npx tsx src/examples/<example-name>.ts

# Examples with output
npx tsx src/examples/01-basic-crawl-working.ts
npx tsx src/examples/02-multiple-urls-working.ts
```

### Expected Output

Working examples will show:
- Real-time crawling progress
- Page extraction results
- Performance statistics
- Link analysis
- Error handling (if applicable)

Example output from `01-basic-crawl-working.ts`:
```
🕷️ Example 01: Basic Web Crawling
Crawling web-scraping.dev for basic functionality

✓ Crawled: https://web-scraping.dev/
  Title: web-scraping.dev
  Status: 200
  Duration: 302ms

📊 Crawl Summary:
- Total pages crawled: 5
- Average page load time: 320ms
- Status code distribution: { '200': 5 }
```

---

## 🎯 Learning Path

### Beginner
1. **01-basic-crawl-working.ts** - Learn Spider fundamentals
2. **02-multiple-urls-working.ts** - Understand concurrent crawling

### Intermediate
3. **03-url-filtering.ts** - Master URL filtering strategies
4. **04-robots-compliance.ts** - Learn ethical crawling practices
5. **05-link-extraction-selectors.ts** - Advanced data extraction

### Advanced
6. **06-custom-middleware.ts** - Extend Spider with custom logic
7. **07-resumability-demo.ts** - Implement persistent crawling
8. **08-worker-monitoring.ts** - Monitor and optimize performance
9. **09-error-handling-recovery.ts** - Build robust crawling systems
10. **10-custom-logging.ts** - Override logging and event observability

---

## 🔧 Testing Against Web-scraping.dev

All examples target [web-scraping.dev](https://web-scraping.dev/), which provides:

- **Static content** - Product pages, pagination
- **Dynamic content** - Infinite scroll, load more buttons
- **Authentication** - Login forms, CSRF tokens
- **Complex scenarios** - GraphQL, file downloads, modals

This ensures examples demonstrate real-world web scraping challenges.

---

## 🐛 Troubleshooting

### Common Issues

**Module resolution errors:**
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
```
- Ensure you're running from project root
- Check that `npm install` completed successfully
- Verify file paths in import statements

**Service not found errors:**
```
Service not found: @jambudipa.io/ScraperService
```
- Some examples may need updates for new service structure
- Check the example status in this README

**Network timeouts:**
- web-scraping.dev may occasionally be slow
- Examples include reasonable delays and retry logic
- Check your internet connection

### Getting Help

1. Check this README for example status
2. Verify you're using working examples (✅)
3. Run examples from project root directory
4. Check that all dependencies are installed

### Performance Tips

**Faster Testing:**
- Use `maxPages: 3` for quick tests
- Set `maxDepth: 1` to limit crawl scope
- Reduce `maxConcurrentWorkers` for debugging

**Debugging Output:**
- All examples include detailed console output
- Watch for domain isolation messages: `[domain_start]`
- Monitor page processing: `✓ Processed: <URL>`

### Common Runtime Issues

**"Cannot find module" errors:**
```bash
# Ensure you're in project root
pwd  # Should show spider project directory
npm install  # Reinstall dependencies
```

**Slow or hanging examples:**
- web-scraping.dev may have rate limits
- Examples include built-in delays for ethical crawling
- Some examples run for 30+ seconds intentionally

**Network connection issues:**
```bash
# Test basic connectivity
curl -I https://web-scraping.dev/
# Expected: HTTP/2 200
```

---

## 📝 Example Status Summary

| Example | Status | Description |
|---------|--------|-------------|
| 01-basic-crawl-working.ts | ✅ Working | Basic Spider usage |
| 02-multiple-urls-working.ts | ✅ Working | Concurrent crawling |
| 03-url-filtering.ts | ✅ Working | URL filtering |
| 04-robots-compliance.ts | ✅ Working | Robots.txt handling |
| 05-link-extraction-selectors.ts | ✅ Working | Advanced extraction |
| 06-custom-middleware.ts | ✅ Working | Middleware system |
| 07-resumability-demo.ts | ✅ Working | State persistence |
| 08-worker-monitoring.ts | ✅ Working | Performance monitoring |
| 09-error-handling-recovery.ts | ✅ Working | Error handling with `CrawlResultError` |
| 10-custom-logging.ts | ✅ Working | Custom logging and event handling |

**Summary:** 10/10 examples compile cleanly and demonstrate current API.

---

*For comprehensive Spider testing, see `/src/test/complete-web-scraping-scenarios.ts` which validates 16 web-scraping.dev scenarios with a 43.8% success rate.*