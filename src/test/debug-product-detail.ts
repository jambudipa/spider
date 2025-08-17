import { Effect, Sink } from 'effect';
import { SpiderService } from '../lib/Spider/Spider.service.js';
import {
  makeSpiderConfig,
  SpiderConfig,
} from '../lib/Config/SpiderConfig.service.js';
import { SpiderLoggerLive } from '../lib/Logging/SpiderLogger.service.js';
import * as cheerio from 'cheerio';

const debugProductPage = async () => {
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

    console.log('Looking for selectors:');
    console.log('h3:', $('h3').first().text());
    console.log('.price:first:', $('.price:first').text());
    console.log('.price:', $('.price').first().text());
    console.log('.card-description:', $('.card-description').text());
    console.log('.text-success:', $('.text-success').length, 'elements');

    // Look for actual selectors
    console.log('\nActual structure:');
    $('.card').each((i, card) => {
      const $card = $(card);
      console.log(`Card ${i}:`, {
        title: $card.find('.card-title').text().trim(),
        body: $card.find('.card-body').length > 0,
        text: $card.find('.card-text').text().substring(0, 50),
      });
    });
  }
};

debugProductPage().catch(console.error);
