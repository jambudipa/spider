import { Effect, Sink } from 'effect';
import { SpiderService } from '../lib/Spider/Spider.service.js';
import {
  makeSpiderConfig,
  SpiderConfig,
} from '../lib/Config/SpiderConfig.service.js';
import { SpiderLoggerLive } from '../lib/Logging/SpiderLogger.service.js';
import * as cheerio from 'cheerio';

const findDescription = async () => {
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
      ['https://web-scraping.dev/product/1'],
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

    // Look for text that looks like a description
    const searchText = 'Indulge your sweet tooth';

    $('*').each((i, el) => {
      const $el = $(el);
      const text = $el.text();
      if (text.includes(searchText) && !$el.children().length) {
        console.log('Found description in:', {
          tag: (el as any).tagName || el.type,
          class: $el.attr('class'),
          id: $el.attr('id'),
          parent: $el.parent().prop('tagName'),
          parentClass: $el.parent().attr('class'),
        });
      }
    });

    // Try common description selectors
    console.log('\nTrying selectors:');
    console.log('p.description:', $('p.description').text().substring(0, 50));
    console.log('p:', $('p').first().text().substring(0, 50));
    console.log(
      '.product-description:',
      $('.product-description').text().substring(0, 50)
    );
    console.log('.description:', $('.description').text().substring(0, 50));
  }
};

findDescription().catch(console.error);
