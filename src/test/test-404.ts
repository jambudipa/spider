import { Effect, Sink } from 'effect';
import { SpiderService } from '../lib/Spider/Spider.service.js';
import {
  makeSpiderConfig,
  SpiderConfig,
} from '../lib/Config/SpiderConfig.service.js';
import { SpiderLoggerLive } from '../lib/Logging/SpiderLogger.service.js';

const test404 = async () => {
  const config = makeSpiderConfig({
    maxPages: 1,
    maxDepth: 0,
    requestDelayMs: 0,
  });

  const results: any[] = [];
  const collectSink = Sink.forEach((result: any) =>
    Effect.sync(() => results.push(result))
  );

  const program = Effect.gen(function* () {
    const spider = yield* SpiderService;
    yield* spider.crawl(
      ['https://web-scraping.dev/404-page'],
      collectSink as any
    );
    return results;
  });

  try {
    const crawlResults = await Effect.runPromise(
      program.pipe(
        Effect.provide(SpiderService.Default),
        Effect.provide(SpiderConfig.Live(config)),
        Effect.provide(SpiderLoggerLive)
      )
    );

    console.log('Results:', crawlResults.length);
    if (crawlResults.length > 0) {
      console.log('Status:', crawlResults[0].pageData.statusCode);
      console.log('URL:', crawlResults[0].pageData.url);
    }
  } catch (error) {
    console.log('Error:', error);
  }
};

test404();
