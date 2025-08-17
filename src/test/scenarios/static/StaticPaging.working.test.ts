/**
 * Static Paging Tests - Working Version
 * Tests Spider's ability to handle static HTML pagination on real web-scraping.dev site
 */

import { describe, expect, it } from 'vitest';
import { Effect, Sink } from 'effect';
import { SpiderService } from '../../../lib/Spider/Spider.service.js';
import {
  makeSpiderConfig,
  SpiderConfig,
} from '../../../lib/Config/SpiderConfig.service.js';
import { SpiderLoggerLive } from '../../../lib/Logging/SpiderLogger.service.js';
import * as cheerio from 'cheerio';

describe('Static Paging - Real web-scraping.dev Tests', () => {
  const baseUrl = 'https://web-scraping.dev';

  const runSpiderTest = async (url: string, options?: any) => {
    const config = makeSpiderConfig({
      maxPages: 1,
      maxDepth: 0,
      requestDelayMs: 2000,
      ignoreRobotsTxt: false,
      userAgent: 'Spider Test Suite',
    });

    const results: any[] = [];
    const collectSink = Sink.forEach((result: any) =>
      Effect.sync(() => results.push(result))
    );

    const program = Effect.gen(function* () {
      const spider = yield* SpiderService;
      yield* spider.crawlSingle(url, collectSink as any, options);
      return results;
    });

    return Effect.runPromise(
      program.pipe(
        Effect.provide(SpiderService.Default),
        Effect.provide(SpiderConfig.Live(config)),
        Effect.provide(SpiderLoggerLive)
      )
    );
  };

  it('should extract products from /products page', async () => {
    const url = `${baseUrl}/products`;

    const options = {
      extractData: {
        pageTitle: { selector: 'h1', text: true },
        products: {
          selector: '.product',
          multiple: true,
          fields: {
            name: { selector: 'h3', text: true },
            price: { selector: '.price', text: true },
            link: { selector: 'a', attribute: 'href' },
          },
        },
        pagination: {
          selector: '.pagination a',
          multiple: true,
          attribute: 'href',
        },
      },
    };

    const results = await runSpiderTest(url, options);

    expect(results).toHaveLength(1);
    const pageData = results[0].pageData;
    expect(pageData.url).toBe(url);

    const extracted = pageData.extractedData;
    expect(extracted).toBeDefined();
    expect(extracted.products).toBeDefined();
    expect(Array.isArray(extracted.products)).toBe(true);
    expect(extracted.products.length).toBeGreaterThan(0);

    // Check first product has expected fields
    const firstProduct = extracted.products[0];
    expect(firstProduct).toHaveProperty('name');
    expect(firstProduct).toHaveProperty('price');
    expect(firstProduct.name).toBeTruthy();

    console.log(`Found ${extracted.products.length} products`);
    console.log('First product:', firstProduct);
  }, 30000);

  it('should navigate pagination links', async () => {
    const firstPageUrl = `${baseUrl}/products`;

    // Get first page
    const firstPageResults = await runSpiderTest(firstPageUrl, {
      extractData: {
        nextPageLink: {
          selector: '.pagination .next a, a:contains("Next")',
          attribute: 'href',
        },
        currentPage: { selector: '.pagination .active', text: true },
        products: { selector: '.product', multiple: true },
      },
    });

    expect(firstPageResults).toHaveLength(1);
    const firstPage = firstPageResults[0].pageData;
    const firstPageData = firstPage.extractedData;

    console.log('First page data:', {
      currentPage: firstPageData?.currentPage,
      productCount: firstPageData?.products?.length,
      hasNextPage: !!firstPageData?.nextPageLink,
    });

    // If there's a next page, fetch it
    if (firstPageData?.nextPageLink) {
      const nextPageUrl = firstPageData.nextPageLink.startsWith('http')
        ? firstPageData.nextPageLink
        : `${baseUrl}${firstPageData.nextPageLink}`;

      const secondPageResults = await runSpiderTest(nextPageUrl, {
        extractData: {
          currentPage: { selector: '.pagination .active', text: true },
          products: { selector: '.product', multiple: true },
        },
      });

      expect(secondPageResults).toHaveLength(1);
      const secondPage = secondPageResults[0].pageData;
      expect(secondPage.url).toContain('page');

      console.log('Second page data:', {
        url: secondPage.url,
        currentPage: secondPage.extractedData?.currentPage,
        productCount: secondPage.extractedData?.products?.length,
      });
    }
  }, 60000);

  it('should extract product details from product page', async () => {
    const url = `${baseUrl}/product/1`;

    const options = {
      extractData: {
        title: { selector: 'h3.card-title', text: true },
        price: { selector: '.price', text: true },
        description: { selector: 'p.product-description', text: true },
        inStock: { selector: '.text-success', exists: true },
        image: { selector: '.card-img-top', attribute: 'src' },
        variants: {
          selector: '.variant-option',
          multiple: true,
          fields: {
            name: { selector: '.variant-name', text: true },
            price: { selector: '.variant-price', text: true },
          },
        },
      },
    };

    const results = await runSpiderTest(url, options);

    expect(results).toHaveLength(1);
    const pageData = results[0].pageData;
    const extracted = pageData.extractedData;

    expect(extracted).toBeDefined();
    expect(extracted.title).toBeTruthy();
    expect(extracted.price).toBeTruthy();
    expect(extracted.description).toBeTruthy();
    expect(extracted.inStock).toBeDefined();

    console.log('Product details:', {
      title: extracted.title,
      price: extracted.price,
      inStock: extracted.inStock,
      hasImage: !!extracted.image,
    });
  }, 30000);

  it('should handle pages with no products gracefully', async () => {
    const url = `${baseUrl}/products?page=999`; // Non-existent page

    const options = {
      extractData: {
        products: { selector: '.product', multiple: true },
        errorMessage: { selector: '.error, .no-results', text: true },
      },
    };

    const results = await runSpiderTest(url, options);

    expect(results).toHaveLength(1);
    const pageData = results[0].pageData;
    const extracted = pageData.extractedData;

    expect(extracted).toBeDefined();
    // Either no products or an error message
    const hasNoProducts =
      !extracted.products || extracted.products.length === 0;
    const hasErrorMessage = !!extracted.errorMessage;

    expect(hasNoProducts || hasErrorMessage).toBe(true);

    console.log('Empty page handling:', {
      productCount: extracted.products?.length || 0,
      errorMessage: extracted.errorMessage,
    });
  }, 30000);

  it('should extract all text content when no selector specified', async () => {
    const url = `${baseUrl}/products`;

    const results = await runSpiderTest(url); // No extraction options

    expect(results).toHaveLength(1);
    const pageData = results[0].pageData;

    expect(pageData.html).toBeTruthy();
    expect(pageData.title).toBeTruthy();

    // Parse HTML to verify content
    const $ = cheerio.load(pageData.html);
    const productCount = $('.product').length;

    expect(productCount).toBeGreaterThan(0);

    console.log('Raw HTML extraction:', {
      htmlLength: pageData.html.length,
      title: pageData.title,
      productCount,
    });
  }, 30000);
});
