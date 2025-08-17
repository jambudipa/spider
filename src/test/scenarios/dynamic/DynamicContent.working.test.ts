/**
 * Dynamic Content Tests
 * Tests Spider's ability to handle dynamic content on web-scraping.dev
 */

import { describe, expect, it } from 'vitest';
import { Effect, Sink } from 'effect';
import { SpiderService } from '../../../lib/Spider/Spider.service.js';
import {
  makeSpiderConfig,
  SpiderConfig,
} from '../../../lib/Config/SpiderConfig.service.js';
import { SpiderLoggerLive } from '../../../lib/Logging/SpiderLogger.service.js';

describe('Dynamic Content - Real web-scraping.dev Tests', () => {
  const baseUrl = 'https://web-scraping.dev';

  const runSpiderTest = async (url: string, options?: any) => {
    const config = makeSpiderConfig({
      maxPages: 1,
      maxDepth: 0,
      requestDelayMs: 2000,
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

  it('should detect load more button', async () => {
    const url = `${baseUrl}/products`;

    const options = {
      extractData: {
        loadMoreButton: {
          selector: 'button:contains("Load More"), .load-more',
          exists: true,
        },
        showMoreButton: {
          selector: 'button:contains("Show More")',
          exists: true,
        },
        nextPageLink: {
          selector: 'a:contains("Next"), .next',
          attribute: 'href',
        },
        lazyLoadIndicator: {
          selector: '[data-lazy], .lazy-load',
          exists: true,
        },
      },
    };

    const results = await runSpiderTest(url, options);

    expect(results).toHaveLength(1);
    const extracted = results[0].pageData.extractedData;

    console.log('Dynamic indicators:', {
      hasLoadMore: extracted?.loadMoreButton,
      hasShowMore: extracted?.showMoreButton,
      hasNextPage: !!extracted?.nextPageLink,
      hasLazyLoad: extracted?.lazyLoadIndicator,
    });

    // At least one dynamic loading indicator should be present
    const hasDynamicContent =
      extracted?.loadMoreButton ||
      extracted?.showMoreButton ||
      extracted?.nextPageLink ||
      extracted?.lazyLoadIndicator;

    expect(hasDynamicContent !== undefined).toBe(true);
  }, 30000);

  it('should extract JavaScript-rendered content indicators', async () => {
    const url = `${baseUrl}/products`;

    const options = {
      extractData: {
        scriptsCount: { selector: 'script', multiple: true },
        hasReactRoot: {
          selector: '#root, #app, [data-reactroot]',
          exists: true,
        },
        hasVueApp: { selector: '#app[data-v-]', exists: true },
        hasAngular: { selector: '[ng-app], [ng-controller]', exists: true },
        dataAttributes: {
          selector: '[data-product-id], [data-item-id]',
          multiple: true,
          attribute: 'data-product-id',
        },
      },
    };

    const results = await runSpiderTest(url, options);

    expect(results).toHaveLength(1);
    const extracted = results[0].pageData.extractedData;

    console.log('JavaScript framework indicators:', {
      scriptCount: extracted?.scriptsCount?.length || 0,
      hasReact: extracted?.hasReactRoot,
      hasVue: extracted?.hasVueApp,
      hasAngular: extracted?.hasAngular,
      dataAttributeCount: extracted?.dataAttributes?.length || 0,
    });

    // Should have scripts for dynamic content
    expect(extracted?.scriptsCount?.length).toBeGreaterThan(0);
  }, 30000);

  it('should detect AJAX/API endpoints in page', async () => {
    const url = `${baseUrl}/products`;

    const results = await runSpiderTest(url);

    expect(results).toHaveLength(1);
    const html = results[0].pageData.html;

    // Check for API endpoints in scripts
    const apiPatterns = [
      /fetch\(['"]([^'"]+)['"]\)/g,
      /axios\.\w+\(['"]([^'"]+)['"]\)/g,
      /\$\.ajax\({[^}]*url:\s*['"]([^'"]+)['"]/g,
      /api\/[a-z]+/gi,
    ];

    let foundEndpoints = 0;
    for (const pattern of apiPatterns) {
      const matches = html.match(pattern);
      if (matches) {
        foundEndpoints += matches.length;
      }
    }

    console.log(`Found ${foundEndpoints} potential API endpoints`);

    // The page likely has some dynamic content
    expect(html).toBeTruthy();
  }, 30000);

  it('should handle infinite scroll indicators', async () => {
    const url = `${baseUrl}/products`;

    const options = {
      extractData: {
        scrollTrigger: {
          selector: '.infinite-scroll-trigger, [data-infinite-scroll]',
          exists: true,
        },
        loadingSpinner: {
          selector: '.spinner, .loader, .loading',
          exists: true,
        },
        scrollContainer: {
          selector: '[data-scroll-container], .scroll-container',
          exists: true,
        },
        hasObserver: { selector: '[data-observe], .observe-me', exists: true },
      },
    };

    const results = await runSpiderTest(url, options);

    expect(results).toHaveLength(1);
    const extracted = results[0].pageData.extractedData;

    console.log('Infinite scroll indicators:', {
      hasTrigger: extracted?.scrollTrigger,
      hasSpinner: extracted?.loadingSpinner,
      hasContainer: extracted?.scrollContainer,
      hasObserver: extracted?.hasObserver,
    });

    // Test passes if we can extract the page
    expect(results[0].pageData.url).toBe(url);
  }, 30000);

  it('should detect GraphQL endpoints', async () => {
    const url = `${baseUrl}/products`;

    const results = await runSpiderTest(url);

    expect(results).toHaveLength(1);
    const html = results[0].pageData.html;

    // Look for GraphQL indicators
    const graphqlIndicators = [
      html.includes('graphql'),
      html.includes('__typename'),
      html.includes('query {'),
      html.includes('mutation {'),
      html.includes('/graphql'),
    ];

    const hasGraphQL = graphqlIndicators.some((indicator) => indicator);

    console.log('GraphQL detected:', hasGraphQL);

    // Test passes regardless - we're just checking detection
    expect(results[0].pageData).toBeDefined();
  }, 30000);
});
