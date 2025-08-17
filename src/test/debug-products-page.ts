/**
 * Debug script to inspect products page structure
 */

import { Effect, Sink } from 'effect';
import { SpiderService } from '../lib/Spider/Spider.service.js';
import {
  makeSpiderConfig,
  SpiderConfig,
} from '../lib/Config/SpiderConfig.service.js';
import { SpiderLoggerLive } from '../lib/Logging/SpiderLogger.service.js';
import * as cheerio from 'cheerio';

const debugProductsPage = async () => {
  const config = makeSpiderConfig({
    maxPages: 1,
    maxDepth: 0,
    requestDelayMs: 0,
    ignoreRobotsTxt: false,
  });

  const results: any[] = [];
  const collectSink = Sink.forEach((result: any) =>
    Effect.sync(() => results.push(result))
  );

  const program = Effect.gen(function* () {
    const spider = yield* SpiderService;
    yield* spider.crawl(
      ['https://web-scraping.dev/products'],
      collectSink as any
    );
    return results;
  });

  const crawlResults = await Effect.runPromise(
    program.pipe(
      Effect.provide(SpiderService.Default),
      Effect.provide(SpiderConfig.Live(config)),
      Effect.provide(SpiderLoggerLive)
    )
  );

  if (crawlResults.length > 0) {
    const html = crawlResults[0].pageData.html;
    const $ = cheerio.load(html);

    console.log('Page title:', $('title').text());
    console.log('\nPotential product selectors:');
    console.log('- .product:', $('.product').length);
    console.log('- .product-item:', $('.product-item').length);
    console.log('- .card:', $('.card').length);
    console.log('- article:', $('article').length);
    console.log('- .col:', $('.col').length);
    console.log('- [data-product]:', $('[data-product]').length);
    console.log('- .product-card:', $('.product-card').length);
    console.log('- .item:', $('.item').length);
    console.log('- .grid-item:', $('.grid-item').length);

    // Try to find product containers by looking for price elements
    const priceElements = $('.price, .product-price, [class*="price"]');
    console.log('\nFound', priceElements.length, 'price elements');

    if (priceElements.length > 0) {
      const firstPrice = priceElements.first();
      const container = firstPrice.closest(
        '.card, .product, .item, article, [class*="product"]'
      );
      if (container.length > 0) {
        console.log('\nProduct container class:', container.attr('class'));
        console.log('Product container tag:', container.prop('tagName'));
      }
    }

    // Check for product titles
    console.log('\nProduct titles:');
    $('h3, h4, h5')
      .slice(0, 5)
      .each((i, el) => {
        console.log(`  ${i + 1}. ${$(el).text().trim()}`);
      });
  }
};

debugProductsPage().catch(console.error);
