# Getting Started with Spider - Your First Web Scraper

Welcome to Spider! This tutorial will guide you through creating your first web scraper using the Spider library. By the end of this tutorial, you'll have built a working web scraper that can extract data from a website while respecting robots.txt rules and handling rate limiting.

## Prerequisites

- Node.js version 18 or higher
- Basic knowledge of JavaScript/TypeScript
- A code editor (VS Code recommended)

## Installation

First, create a new Node.js project and install Spider:

```bash
mkdir my-spider-project
cd my-spider-project
npm init -y
npm install @jambudipa/spider effect
```

If you're using TypeScript, also install the TypeScript dependencies:

```bash
npm install -D typescript @types/node
npx tsc --init
```

## Your First Spider

Let's start with a simple example that crawls a single page. Create a file called `basic-spider.js`:

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, SpiderConfig, makeSpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';

const program = Effect.gen(function* () {
  console.log('🕷️ Starting basic crawl...');
  
  // Create a collector for results
  const results = [];
  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      results.push(result);
      console.log(`✓ Crawled: ${result.pageData.url}`);
      console.log(`  Title: ${result.pageData.title || '(no title)'}`);
      console.log(`  Status: ${result.pageData.statusCode}`);
      console.log(`  Links found: ${result.pageData.links?.length || 0}`);
    })
  );

  // Get the spider service
  const spider = yield* SpiderService;
  
  // Start crawling
  yield* spider.crawl(['https://example.com'], collectSink);
  
  return results;
});

// Create configuration
const config = makeSpiderConfig({
  maxPages: 1,
  maxDepth: 0, // Only crawl the starting page
  requestDelayMs: 1000,
  userAgent: 'My First Spider 1.0',
  ignoreRobotsTxt: false // Respect robots.txt
});

// Run the program
Effect.runPromise(
  program.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
).then((results) => {
  console.log(`\n✅ Completed! Crawled ${results.length} page(s).`);
}).catch((error) => {
  console.error('❌ Crawling failed:', error.message);
});
```

Run your first spider:

```bash
node basic-spider.js
```

**What happened?**
- We used Effect to create a functional program that manages dependencies
- We configured the spider with `makeSpiderConfig()` instead of constructor options
- We used `yield* SpiderService` to access the spider within an Effect.gen function
- The spider crawled the page and streamed results through a Sink

## Adding Data Extraction

Now let's access the page data and HTML content. Create `data-extraction.js`:

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, SpiderConfig, makeSpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';
import * as cheerio from 'cheerio'; // You'll need to install cheerio: npm install cheerio

const program = Effect.gen(function* () {
  console.log('🕷️ Extracting data from webpages...');
  
  const results = [];
  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      results.push(result);
      
      // Access basic page data
      console.log(`\n✓ Page: ${result.pageData.url}`);
      console.log(`  Title: ${result.pageData.title || '(no title)'}`);
      console.log(`  Status: ${result.pageData.statusCode}`);
      console.log(`  Content length: ${result.pageData.html.length} characters`);
      
      // Parse HTML and extract custom data using Cheerio
      const $ = cheerio.load(result.pageData.html);
      
      // Extract all links
      const links = [];
      $('a[href]').each((i, elem) => {
        const href = $(elem).attr('href');
        const text = $(elem).text().trim();
        if (href && text) {
          links.push({ href, text: text.substring(0, 50) });
        }
      });
      
      console.log(`  Links found: ${links.length}`);
      
      // Show first few links
      links.slice(0, 3).forEach((link, index) => {
        console.log(`    ${index + 1}. ${link.text} -> ${link.href}`);
      });
      
      // Extract meta information (already available in PageData)
      if (result.pageData.commonMetadata?.description) {
        console.log(`  Description: ${result.pageData.commonMetadata.description.substring(0, 100)}...`);
      }
    })
  );

  const spider = yield* SpiderService;
  yield* spider.crawl(['https://example.com'], collectSink);
  
  return results;
});

const config = makeSpiderConfig({
  maxPages: 1,
  maxDepth: 0,
  requestDelayMs: 1000,
  userAgent: 'Data Extractor 1.0'
});

Effect.runPromise(
  program.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
).then(() => {
  console.log('\n✅ Data extraction completed!');
}).catch((error) => {
  console.error('❌ Extraction failed:', error.message);
});
```

**What's new here?**
- We access the raw HTML through `result.pageData.html`
- We use Cheerio to parse and extract data from the HTML
- We access built-in metadata through `result.pageData.commonMetadata`
- We demonstrate custom data extraction patterns you can extend

## Building a Simple Crawler

Let's create a spider that follows links to crawl multiple pages. Create `simple-crawler.js`:

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, SpiderConfig, makeSpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';

const program = Effect.gen(function* () {
  console.log('🕷️ Starting multi-page crawl...');
  
  const visitedPages = [];
  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      visitedPages.push({
        url: result.pageData.url,
        title: result.pageData.title || '(no title)',
        statusCode: result.pageData.statusCode,
        depth: result.depth,
        timestamp: result.timestamp
      });
      
      console.log(`✓ Crawled: ${result.pageData.title || '(no title)'} (depth: ${result.depth})`);
      console.log(`  URL: ${result.pageData.url}`);
      console.log(`  Status: ${result.pageData.statusCode}`);
    })
  );

  const spider = yield* SpiderService;
  yield* spider.crawl(['https://example.com'], collectSink);
  
  return visitedPages;
});

// Configuration for multi-page crawling
const config = makeSpiderConfig({
  maxDepth: 2,           // Only go 2 levels deep
  maxPages: 10,          // Limit to 10 pages total
  requestDelayMs: 2000,  // Be polite - wait 2 seconds between requests
  maxConcurrentWorkers: 1, // Process one page at a time
  userAgent: 'Simple Crawler 1.0',
  ignoreRobotsTxt: false, // Respect robots.txt
  allowedDomains: ['example.com'] // Only follow links on the same domain
});

Effect.runPromise(
  program.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
).then((visitedPages) => {
  console.log('\n📊 Crawl Summary:');
  console.log(`Total pages crawled: ${visitedPages.length}`);
  
  // Show pages by depth
  const byDepth = visitedPages.reduce((acc, page) => {
    acc[page.depth] = (acc[page.depth] || 0) + 1;
    return acc;
  }, {});
  
  console.log('Pages by depth:', byDepth);
  
  visitedPages.forEach((page, index) => {
    console.log(`${index + 1}. ${page.title} (depth ${page.depth})`);
  });
  
  console.log('\n✅ Crawling completed!');
}).catch((error) => {
  console.error('❌ Crawling failed:', error.message);
});
```

**New concepts introduced:**
- **Crawling depth**: Use `maxDepth` in configuration to control how deep the spider goes
- **Page limiting**: Use `maxPages` to set a maximum number of pages to scrape
- **Domain filtering**: Use `allowedDomains` to restrict crawling to specific domains
- **Concurrency control**: Use `maxConcurrentWorkers` to control parallel processing
- **Results processing**: Each page is processed through the Sink as it's crawled

## Handling Errors Gracefully

Real-world scraping often encounters errors. Let's build a robust spider that handles common issues:

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, SpiderConfig, makeSpiderConfig, SpiderLoggerLive, NetworkError, ResponseError } from '@jambudipa/spider';

const program = Effect.gen(function* () {
  console.log('🕷️ Testing error handling...');
  
  const results = [];
  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      results.push(result);
      console.log(`✅ Success: ${result.pageData.title} (${result.pageData.statusCode})`);
    })
  );

  const spider = yield* SpiderService;
  
  // Test multiple URLs including some that might fail
  const testUrls = [
    'https://example.com',
    'https://httpbin.org/status/404', // Returns 404
    'https://httpbin.org/delay/10'    // Slow response for timeout testing
  ];

  for (const url of testUrls) {
    console.log(`\nTrying to crawl: ${url}`);
    
    // Handle each URL individually with error recovery
    const singleResult = yield* spider.crawl([url], collectSink).pipe(
      Effect.catchTags({
        NetworkError: (error) => {
          console.log(`❌ Network error for ${error.url}: ${error.message}`);
          return Effect.succeed({ failed: true, reason: 'network', url: error.url });
        },
        ResponseError: (error) => {
          console.log(`❌ Response error for ${error.url}: ${error.message}`);
          return Effect.succeed({ failed: true, reason: 'response', url: error.url });
        }
      }),
      Effect.timeout(5000) // 5 second timeout per URL
    ).pipe(
      Effect.catchTag('TimeoutException', () => {
        console.log(`❌ Timeout for ${url}`);
        return Effect.succeed({ failed: true, reason: 'timeout', url });
      })
    );
  }
  
  return results;
});

const config = makeSpiderConfig({
  maxPages: 1,
  maxDepth: 0,
  requestDelayMs: 1000,
  userAgent: 'Robust Spider 1.0',
  ignoreRobotsTxt: false
});

Effect.runPromise(
  program.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
).then((results) => {
  console.log(`\n📊 Results: ${results.length} successful crawls`);
  console.log('✅ Error handling test completed!');
}).catch((error) => {
  console.error('❌ Program failed:', error.message);
});
```

**Error handling concepts:**
- **Tagged errors**: Use `Effect.catchTags` to handle specific error types
- **Timeouts**: Use `Effect.timeout` to prevent hanging on slow sites
- **Graceful recovery**: Convert errors into success values to continue processing
- **Individual URL handling**: Process URLs one by one with isolated error handling

## Advanced Configuration

Let's explore more advanced configuration options for different scraping scenarios:

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, SpiderConfig, makeSpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';

const program = Effect.gen(function* () {
  console.log('🕷️ Testing advanced configuration...');
  
  const results = [];
  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      results.push(result);
      console.log(`✓ Crawled: ${result.pageData.title}`);
      console.log(`  Depth: ${result.depth}, Duration: ${result.pageData.scrapeDurationMs}ms`);
    })
  );

  const spider = yield* SpiderService;
  yield* spider.crawl(['https://example.com'], collectSink);
  
  return results;
});

// Advanced configuration for different scenarios
const configurations = {
  // Fast scraping for development/testing
  development: makeSpiderConfig({
    maxPages: 5,
    maxDepth: 1,
    requestDelayMs: 500,
    maxConcurrentWorkers: 3,
    ignoreRobotsTxt: true, // Only for testing!
    userAgent: 'Development Spider 1.0'
  }),

  // Production-ready configuration
  production: makeSpiderConfig({
    maxPages: 1000,
    maxDepth: 5,
    requestDelayMs: 2000, // Be polite
    maxConcurrentWorkers: 2,
    ignoreRobotsTxt: false,
    userAgent: 'Production Spider 1.0 (+https://example.com/bot)',
    allowedDomains: ['example.com', 'subdomain.example.com'],
    allowedProtocols: ['https:'] // Only HTTPS
  }),

  // Large-scale crawling configuration
  largescale: makeSpiderConfig({
    maxPages: undefined, // Unlimited
    maxDepth: undefined, // Unlimited
    requestDelayMs: 1000,
    maxConcurrentWorkers: 5,
    ignoreRobotsTxt: false,
    userAgent: 'Large Scale Spider 1.0',
    // Filter out non-HTML content
    fileExtensionFilters: {
      filterArchives: true,
      filterImages: true,
      filterAudio: true,
      filterVideo: true,
      filterOfficeDocuments: true,
      filterOther: true
    }
  })
};

// Run with production configuration
Effect.runPromise(
  program.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(configurations.production)),
    Effect.provide(SpiderLoggerLive)
  )
).then((results) => {
  console.log(`\n✅ Advanced crawling completed! Found ${results.length} pages.`);
}).catch((error) => {
  console.error('❌ Crawling failed:', error.message);
});
```

## Next Steps

Congratulations! You've built your first web scrapers with Spider. You've learned:

- ✅ How to install and set up Spider with Effect
- ✅ How to configure Spider for different scenarios
- ✅ How to crawl single pages and extract data
- ✅ How to build multi-page crawlers that follow links
- ✅ How to handle errors gracefully using Effect error handling
- ✅ How to use advanced configuration for production-ready scrapers

### What to explore next:

1. **[Authentication](../how-to/authentication.md)**: Learn how to handle logins, sessions, and auth flows
2. **[Data Extraction](../how-to/data-extraction.md)**: Master advanced techniques for extracting structured data
3. **[Resumable Operations](../how-to/resumable-operations.md)**: Build fault-tolerant crawlers that can recover from interruptions
4. **[Architecture](../explanation/architecture.md)**: Understand Spider's design and Effect patterns
5. **[API Reference](../reference/api-reference.md)**: Explore all available classes and methods

### Practice exercises:

1. **News Aggregator**: Build a crawler that collects headlines from multiple news sites
2. **Price Monitor**: Create a system that tracks product prices across e-commerce sites
3. **Content Archiver**: Build a tool that saves articles and blog posts locally
4. **Link Checker**: Create a crawler that finds broken links on websites
5. **Site Mapper**: Build a tool that creates a sitemap by crawling a website

### Key concepts to remember:

- **Effect patterns**: Always use `yield*` to access services and handle errors with `Effect.catchTags`
- **Streaming**: Results are processed as streams through Sinks, not collected in memory
- **Configuration**: Use `makeSpiderConfig()` and `SpiderConfig.Live()` to configure behavior
- **Respectful crawling**: Always respect robots.txt and use appropriate delays

Head to the **[How-to Guides](../how-to/)** section to learn specific techniques, or check the **[Reference documentation](../reference/)** for detailed API information.
