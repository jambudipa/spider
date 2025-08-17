# LinkExtractorService

Advanced link extraction functionality for the Spider framework with Scrapy-equivalent capabilities.

## Overview

The LinkExtractorService provides sophisticated link extraction and filtering capabilities that go beyond the basic link discovery in the core spider framework. It's designed to work alongside the existing spider system, offering fine-grained control over which links are extracted and processed.

## Key Features

- **CSS Selector Support**: Extract links using flexible CSS selectors
- **Pattern Filtering**: Allow/deny regex patterns for precise link control
- **Domain Filtering**: Restrict extraction to specific domains
- **URL Canonicalization**: Normalize URLs to standard form
- **Duplicate Removal**: Automatic deduplication of extracted links
- **Statistics**: Detailed metrics about extraction and filtering

## Basic Usage

### Simple Link Extraction

```typescript
import { Effect } from 'effect';
import { LinkExtractorService } from '@jambudipa.io/spider';

const program = Effect.gen(function* () {
  const extractor = yield* LinkExtractorService;

  const html = `
    <div class="content">
      <a href="/page1">Page 1</a>
      <a href="/page2">Page 2</a>
    </div>
  `;

  const result = yield* extractor.extractLinks(html, 'https://example.com');

  console.log(result.links);
  // Output: ['https://example.com/page1', 'https://example.com/page2']
  console.log(`Found ${result.totalFound} links, filtered ${result.filtered}`);
});

Effect.runPromise(program.pipe(Effect.provide(LinkExtractorService.Default)));
```

### Advanced Filtering

```typescript
const program = Effect.gen(function* () {
  const extractor = yield* LinkExtractorService;

  const config = {
    // Only extract article links
    allowPatterns: [/\/articles\/\d+/],

    // Exclude admin areas
    denyPatterns: [/\/admin\//, /\/wp-admin\//],

    // Only look in content area
    restrictCss: ['.content a', '.article-list a'],

    // Normalize URLs
    canonicalize: true,

    // Only from specific domains
    allowDomains: ['example.com', 'blog.example.com'],
  };

  const result = yield* extractor.extractLinks(htmlContent, baseUrl, config);

  console.log(`Extracted ${result.links.length} article links`);
  console.log('Filter breakdown:', result.filterReasons);
});
```

## Integration with Spider Framework

The LinkExtractorService can be used alongside the existing spider framework for enhanced link discovery:

```typescript
import { Effect, Sink } from 'effect';
import {
  Spider,
  LinkExtractorService,
  type CrawlResult,
} from '@jambudipa.io/spider';

const enhancedSpider = Effect.gen(function* () {
  const spider = yield* Spider;
  const extractor = yield* LinkExtractorService;

  // Create a sink that uses advanced link extraction
  const advancedSink = Sink.forEach<CrawlResult>((result) =>
    Effect.gen(function* () {
      // Use basic spider results
      console.log(`Basic spider found: ${result.pageData.links.length} links`);

      // Use advanced extraction for additional insights
      const advancedResult = yield* extractor.extractLinks(
        result.pageData.html,
        result.pageData.url,
        {
          // Only extract navigation links
          restrictCss: ['nav a', '.navigation a'],
          allowPatterns: [/\/category\//, /\/tag\//],
          canonicalize: true,
        },
      );

      console.log(
        `Advanced extractor found: ${advancedResult.links.length} navigation links`,
      );

      // Process both sets of links as needed
      for (const link of advancedResult.links) {
        console.log(`Navigation link: ${link}`);
      }
    }),
  );

  yield* spider.follow('https://example.com', advancedSink);
});

const program = enhancedSpider.pipe(
  Effect.provide(Spider.Default),
  Effect.provide(LinkExtractorService.Default),
);
```

## Pre-configured Extractors

For common use cases, you can create pre-configured extractors:

```typescript
const program = Effect.gen(function* () {
  const linkExtractor = yield* LinkExtractorService;

  // Create specialized extractors
  const productExtractor = linkExtractor.createExtractor({
    allowPatterns: [/\/products\/\d+/],
    restrictCss: ['a.product-link', '.product-grid a'],
    canonicalize: true,
  });

  const articleExtractor = linkExtractor.createExtractor({
    allowPatterns: [/\/articles\//, /\/blog\//],
    denyPatterns: [/\/admin\//],
    restrictCss: ['.content a', '.article-list a'],
  });

  // Use extractors
  const productLinks = yield* productExtractor(htmlContent, baseUrl);
  const articleLinks = yield* articleExtractor(htmlContent, baseUrl);

  console.log(`Found ${productLinks.links.length} product pages`);
  console.log(`Found ${articleLinks.links.length} articles`);
});
```

## Configuration Options

### LinkExtractorConfig

| Option           | Type       | Description                          | Default         |
| ---------------- | ---------- | ------------------------------------ | --------------- |
| `allowPatterns`  | `RegExp[]` | URLs must match these patterns       | `[]`            |
| `denyPatterns`   | `RegExp[]` | URLs must NOT match these patterns   | `[]`            |
| `allowDomains`   | `string[]` | Allowed domains                      | `[]`            |
| `denyDomains`    | `string[]` | Blocked domains                      | `[]`            |
| `restrictCss`    | `string[]` | CSS selectors to restrict extraction | `[]`            |
| `canonicalize`   | `boolean`  | Normalize URLs                       | `false`         |
| `unique`         | `boolean`  | Remove duplicates                    | `true`          |
| `stripFragments` | `boolean`  | Remove URL fragments                 | `true`          |
| `attrs`          | `string[]` | Attributes to extract from           | `['href']`      |
| `tags`           | `string[]` | HTML tags to search                  | `['a', 'link']` |

## URL Canonicalization

The service includes a powerful URL canonicalization function:

```typescript
import { canonicalizeUrl } from '@jambudipa.io/spider';

// Normalize URLs to standard form
const canonical = canonicalizeUrl(
  'https://Example.COM:443/Path//page?b=2&a=1#frag',
);
console.log(canonical); // 'https://example.com/path/page?a=1&b=2'
```

## Error Handling

All operations return proper Effect error channels:

```typescript
const program = Effect.gen(function* () {
  const extractor = yield* LinkExtractorService;

  const result = yield* extractor
    .extractLinks(invalidHtml, 'invalid-url', config)
    .pipe(
      Effect.catchAll((error) => {
        console.error('Link extraction failed:', error.message);
        return Effect.succeed({
          links: [],
          totalFound: 0,
          filtered: 0,
          filterReasons: {},
          baseUrl: '',
          config: {},
        });
      }),
    );
});
```

## Performance Considerations

- The service uses Cheerio for HTML parsing, which is fast for server-side operations
- URL canonicalization includes domain normalization and query parameter sorting
- Large HTML documents are processed efficiently with streaming-like CSS selector application
- Memory usage is optimized with Set-based deduplication

## Comparison with Basic Spider Link Extraction

| Feature              | Basic Spider         | LinkExtractorService            |
| -------------------- | -------------------- | ------------------------------- |
| CSS Selectors        | Basic (`a[href]`)    | Advanced (any CSS selector)     |
| Pattern Filtering    | File extensions only | Full regex allow/deny patterns  |
| Domain Filtering     | Via SpiderConfig     | Built-in with subdomain support |
| URL Canonicalization | None                 | Full normalization              |
| Statistics           | None                 | Detailed extraction metrics     |
| Duplicate Removal    | None                 | Automatic deduplication         |

The LinkExtractorService is designed to complement, not replace, the basic spider functionality. Use it when you need fine-grained control over link discovery and filtering.
