# How to Extract Data from Websites

This guide covers advanced data extraction techniques using Spider's powerful extraction capabilities.

## Basic Data Extraction

Extract specific elements using CSS selectors:

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, makeSpiderConfig, SpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';

const basicExtractionProgram = Effect.gen(function* () {
  const spider = yield* SpiderService;

  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      console.log('Page title:', result.pageData.title);
      console.log('Extracted data:', (result.pageData as any).extractedData);
    })
  );

  yield* spider.crawl('https://news.ycombinator.com', collectSink, {
    extractData: {
      // Extract single element
      title: {
        selector: 'title',
        attribute: 'text'
      },
      
      // Extract multiple elements
      headlines: {
        selector: '.storylink',
        attribute: 'text',
        multiple: true
      },
      
      // Extract attributes
      links: {
        selector: '.storylink',
        attribute: 'href',
        multiple: true
      }
    }
  });
});

const config = makeSpiderConfig({
  maxPages: 1,
  maxDepth: 0
});

// Run the program
Effect.runPromise(
  basicExtractionProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Advanced Selector Techniques

Use complex CSS selectors for precise data extraction:

```typescript
const advancedSelectorsProgram = Effect.gen(function* () {
  const spider = yield* SpiderService;

  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      console.log('Extracted products:', (result.pageData as any).extractedData);
    })
  );

  yield* spider.crawl('https://example-ecommerce.com/products', collectSink, {
    extractData: {
      // Nested selectors
      products: {
        selector: '.product-card',
        multiple: true,
        extract: {
          name: {
            selector: '.product-title',
            attribute: 'text'
          },
          price: {
            selector: '.price',
            attribute: 'text',
            transform: (text) => parseFloat(text.replace('$', ''))
          },
          image: {
            selector: '.product-image img',
            attribute: 'src'
          },
          inStock: {
            selector: '.stock-status',
            attribute: 'text',
            transform: (text) => text.toLowerCase().includes('in stock')
          }
        }
      },
      
      // Pseudo-selectors
      firstProduct: {
        selector: '.product-card:first-child .product-title',
        attribute: 'text'
      },
      
      // Attribute selectors
      saleItems: {
        selector: '.product-card[data-sale="true"] .product-title',
        attribute: 'text',
        multiple: true
      }
    }
  });
});

const config2 = makeSpiderConfig({
  maxPages: 1,
  maxDepth: 0
});

// Run the program  
Effect.runPromise(
  advancedSelectorsProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(config2)),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Working with Tables

Extract structured data from HTML tables:

```typescript
const extractFromTableProgram = Effect.gen(function* () {
  const spider = yield* SpiderService;

  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      const extractedData = (result.pageData as any).extractedData;
      
      // Combine headers with data
      const tableData = extractedData.tableRows.map((row: any) => {
        const rowData: any = {};
        extractedData.tableHeaders.forEach((header: string, index: number) => {
          rowData[header] = row.cells[index];
        });
        return rowData;
      });

      console.log('Table data:', tableData);
    })
  );

  yield* spider.crawl('https://example.com/financial-data', collectSink, {
    extractData: {
      // Extract table headers
      tableHeaders: {
        selector: 'table thead th',
        attribute: 'text',
        multiple: true
      },
      
      // Extract all table rows
      tableRows: {
        selector: 'table tbody tr',
        multiple: true,
        extract: {
          cells: {
            selector: 'td',
            attribute: 'text',
            multiple: true
          }
        }
      },
      
      // Extract specific columns
      stockSymbols: {
        selector: 'table tbody tr td:nth-child(1)',
        attribute: 'text',
        multiple: true
      },
      
      prices: {
        selector: 'table tbody tr td:nth-child(3)',
        attribute: 'text',
        multiple: true,
        transform: (text: string) => parseFloat(text.replace('$', ''))
      }
    }
  });
});

const config3 = makeSpiderConfig({
  maxPages: 1,
  maxDepth: 0
});

// Run the program
Effect.runPromise(
  extractFromTableProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(config3)),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Extracting JSON Data

Many websites embed JSON data in script tags:

```typescript
const extractJsonDataProgram = Effect.gen(function* () {
  const spider = yield* SpiderService;

  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      const extractedData = (result.pageData as any).extractedData;
      console.log('Structured data:', extractedData.structuredData);
      console.log('App config:', extractedData.configData);
    })
  );

  yield* spider.crawl('https://example.com/product/123', collectSink, {
    extractData: {
      // Extract JSON-LD structured data
      structuredData: {
        selector: 'script[type="application/ld+json"]',
        attribute: 'text',
        transform: (text: string) => {
          try {
            return JSON.parse(text);
          } catch {
            return null;
          }
        }
      },
      
      // Extract data from script tags
      configData: {
        selector: 'script',
        attribute: 'text',
        multiple: true,
        transform: (scripts: string[]) => {
          for (const script of scripts) {
            const match = script.match(/window\.appConfig\s*=\s*({.*?});/);
            if (match) {
              try {
                return JSON.parse(match[1]);
              } catch {
                return null;
              }
            }
          }
          return null;
        }
      }
    }
  });
});

const config4 = makeSpiderConfig({
  maxPages: 1,
  maxDepth: 0
});

// Run the program
Effect.runPromise(
  extractJsonDataProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(config4)),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Custom Data Transformations

Apply custom transformations to extracted data:

```typescript
const dataTransformationsProgram = Effect.gen(function* () {
  const spider = yield* SpiderService;

  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      const extractedData = (result.pageData as any).extractedData;
      extractedData.articles.forEach((article: any) => {
        console.log(`${article.title}`);
        console.log(`Published: ${new Date(article.publishDate).toDateString()}`);
        console.log(`Reading time: ${article.readingTime} minutes`);
        console.log(`Tags: ${article.tags.join(', ')}`);
        console.log(`Words: ${article.wordCount}`);
        console.log('---');
      });
    })
  );

  yield* spider.crawl('https://example-blog.com', collectSink, {
    extractData: {
      articles: {
        selector: '.article',
        multiple: true,
        extract: {
          title: {
            selector: '.article-title',
            attribute: 'text',
            transform: (title: string) => title.trim().toUpperCase()
          },
          
          publishDate: {
            selector: '.publish-date',
            attribute: 'datetime',
            transform: (dateString: string) => new Date(dateString)
          },
          
          readingTime: {
            selector: '.article-content',
            attribute: 'text',
            transform: (content: string) => {
              const wordCount = content.split(/\s+/).length;
              return Math.ceil(wordCount / 200); // Assuming 200 words per minute
            }
          },
          
          tags: {
            selector: '.tag',
            attribute: 'text',
            multiple: true,
            transform: (tags: string[]) => tags.map(tag => tag.toLowerCase().trim())
          },
          
          wordCount: {
            selector: '.article-content',
            attribute: 'text',
            transform: (content: string) => content.split(/\s+/).length
          }
        }
      }
    }
  });
});

const config5 = makeSpiderConfig({
  maxPages: 1,
  maxDepth: 0
});

// Run the program
Effect.runPromise(
  dataTransformationsProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(config5)),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Handling Dynamic Content

For pages that load content dynamically, use browser integration:

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, makeSpiderConfig, SpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';

const extractDynamicContentProgram = Effect.gen(function* () {
  const spider = yield* SpiderService;

  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      const extractedData = (result.pageData as any).extractedData;
      console.log('Dynamic products:', extractedData.dynamicProducts);
    })
  );

  yield* spider.crawl('https://spa-example.com/products', collectSink, {
    extractData: {
      // Extract after JavaScript execution
      dynamicProducts: {
        selector: '.product-item',
        multiple: true,
        extract: {
          name: {
            selector: '.product-name',
            attribute: 'text'
          },
          price: {
            selector: '.price',
            attribute: 'data-price',
            transform: (price: string) => parseFloat(price)
          }
        }
      }
    }
  });
});

// Configuration with browser support would be added here
const config6 = makeSpiderConfig({
  maxPages: 1,
  maxDepth: 0
  // Note: Browser configuration would be part of the config
});

// Run the program
Effect.runPromise(
  extractDynamicContentProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderConfig.Live(config6)),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Regular Expressions for Text Extraction

Use regex for complex text extraction:

```typescript
const regexExtractionProgram = Effect.gen(function* () {
  const spider = yield* SpiderService;

  const result = yield* spider.scrape('https://example.com/article', {
    extractData: {
      // Extract emails from content
      emails: {
        selector: 'body',
        attribute: 'text',
        transform: (text) => {
          const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
          return text.match(emailRegex) || [];
        }
      },
      
      // Extract phone numbers
      phoneNumbers: {
        selector: 'body',
        attribute: 'text',
        transform: (text) => {
          const phoneRegex = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g;
          return text.match(phoneRegex) || [];
        }
      },
      
      // Extract prices
      prices: {
        selector: '.content',
        attribute: 'text',
        transform: (text) => {
          const priceRegex = /\$\d+(?:\.\d{2})?/g;
          const matches = text.match(priceRegex) || [];
          return matches.map(price => parseFloat(price.replace('$', '')));
        }
      }
    }
  });

  console.log('Emails found:', result.extractedData.emails);
  console.log('Phone numbers:', result.extractedData.phoneNumbers);
  console.log('Prices:', result.extractedData.prices);
});

// Run the program
Effect.runPromise(
  regexExtractionProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Extracting Images and Media

Extract and process media files:

```typescript
const extractMediaProgram = Effect.gen(function* () {
  const spider = yield* SpiderService;

  const result = yield* spider.scrape('https://example-gallery.com', {
    extractData: {
      images: {
        selector: 'img',
        multiple: true,
        extract: {
          src: {
            selector: '',
            attribute: 'src',
            transform: (src) => new URL(src, 'https://example-gallery.com').href // Convert relative URLs to absolute
          },
          alt: {
            selector: '',
            attribute: 'alt'
          },
          width: {
            selector: '',
            attribute: 'width',
            transform: (width) => parseInt(width) || null
          },
          height: {
            selector: '',
            attribute: 'height',
            transform: (height) => parseInt(height) || null
          }
        }
      },
      
      videos: {
        selector: 'video',
        multiple: true,
        extract: {
          src: {
            selector: 'source',
            attribute: 'src'
          },
          poster: {
            selector: '',
            attribute: 'poster'
          },
          duration: {
            selector: '',
            attribute: 'duration'
          }
        }
      }
    }
  });

  // Filter for high-quality images
  const highQualityImages = result.extractedData.images.filter(img => 
    img.width && img.height && img.width >= 800 && img.height >= 600
  );

  console.log(`Found ${result.extractedData.images.length} images`);
  console.log(`High quality images: ${highQualityImages.length}`);
});

// Run the program
Effect.runPromise(
  extractMediaProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Error Handling in Data Extraction

Handle extraction errors gracefully:

```typescript
const robustExtractionProgram = Effect.gen(function* () {
  const spider = yield* SpiderService;

  const result = yield* spider.scrape('https://example.com', {
    extractData: {
      safePrice: {
        selector: '.price',
        attribute: 'text',
        transform: (text) => {
          try {
            const price = parseFloat(text.replace(/[^0-9.]/g, ''));
            return isNaN(price) ? 0 : price;
          } catch (error) {
            console.warn('Price extraction failed:', error.message);
            return 0;
          }
        }
      },
      
      safeDate: {
        selector: '.date',
        attribute: 'datetime',
        transform: (dateString) => {
          try {
            const date = new Date(dateString);
            return isNaN(date.getTime()) ? new Date() : date;
          } catch (error) {
            console.warn('Date parsing failed:', error.message);
            return new Date();
          }
        }
      },
      
      fallbackTitle: {
        selector: 'h1, .main-title, title',
        attribute: 'text',
        transform: (text) => text || 'No title found'
      }
    }
  });

  console.log('Extracted data with fallbacks:', result.extractedData);
});

// Run the program
Effect.runPromise(
  robustExtractionProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(SpiderLoggerLive)
  )
).catch(console.error);
```

## Best Practices for Data Extraction

1. **Start simple**: Begin with basic selectors and add complexity as needed
2. **Use specific selectors**: Avoid overly generic selectors that might break
3. **Handle missing data**: Always provide fallbacks for missing elements
4. **Transform data appropriately**: Clean and format extracted data consistently
5. **Test with multiple pages**: Ensure selectors work across different page layouts
6. **Use browser tools**: Inspect elements to find the best selectors
7. **Consider performance**: Complex extractions can slow down scraping
8. **Validate extracted data**: Check that extracted data meets expected formats

## Common Data Extraction Patterns

- **E-commerce**: Product names, prices, descriptions, reviews, ratings
- **News sites**: Headlines, articles, publish dates, authors, categories
- **Social media**: Posts, comments, likes, shares, user profiles
- **Job boards**: Job titles, companies, locations, salaries, requirements
- **Real estate**: Property details, prices, locations, features, photos
