/**
 * Example 10: Custom logging and event handling
 *
 * Demonstrates the two override surfaces:
 *
 * 1. Effect's standard `Logger` — replace via `Logger.replace` to route every
 *    `Effect.log*` call (debug/info/warn/error + structured annotations) to
 *    your own destination (pino, datadog, OpenTelemetry, file, etc.).
 *
 * 2. `SpiderEventSink` — provide a custom layer to subscribe to typed
 *    domain events (`PageScraped`, `DomainComplete`, …). Useful for
 *    analytics, dashboards, or persistence.
 *
 * Both are independent. Override either, both, or neither.
 */

import { Chunk, Effect, Layer, Logger, LogLevel, Sink } from 'effect';
import {
  CrawlResult,
  makeSpiderConfig,
  SpiderConfig,
  SpiderEvent,
  SpiderEventSink,
  SpiderService,
} from '../index.js';

// 1. Custom Effect Logger — route logs to a JSON-line console writer
const jsonLineLogger = Logger.make(
  ({ logLevel, message, annotations, fiberId, date }) => {
    const annotationsObj: Record<string, unknown> = {};
    for (const [key, value] of annotations) {
      annotationsObj[key] = value;
    }
    const entry = {
      timestamp: date.toISOString(),
      level: logLevel.label,
      fiberId: String(fiberId),
      message: Array.isArray(message) ? message.join(' ') : String(message),
      ...annotationsObj,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  }
);

// 2. Custom event sink — collect domain events for analytics
const collectedEvents: SpiderEvent[] = [];
const AnalyticsEventSink = Layer.succeed(SpiderEventSink, {
  emit: (event) =>
    Effect.sync(() => {
      collectedEvents.push(event);
      // eslint-disable-next-line no-console
      console.log(`[event] ${event._tag}`, event);
    }),
});

const program = Effect.gen(function* () {
  yield* Effect.logInfo('starting custom-logging example');

  let pages: Chunk.Chunk<CrawlResult> = Chunk.empty();
  const sink = Sink.forEach<CrawlResult, void, never, never>((result) =>
    Effect.sync(() => {
      pages = Chunk.append(pages, result);
    })
  );

  const spider = yield* SpiderService;
  yield* spider.crawl(['https://web-scraping.dev/'], sink);

  yield* Effect.logInfo(
    `crawl finished: ${Chunk.size(pages)} pages, ${collectedEvents.length} events emitted`
  );

  return Chunk.toReadonlyArray(pages);
});

const config = makeSpiderConfig({
  maxPages: 3,
  maxDepth: 1,
  requestDelayMs: 250,
  maxConcurrentWorkers: 2,
});

const runnable = program.pipe(
  Effect.provide(SpiderService.Default),
  Effect.provide(SpiderConfig.Live(config)),
  // Override the event sink for analytics
  Effect.provide(AnalyticsEventSink),
  // Override the Effect Logger — every Effect.log* now flows through jsonLineLogger
  Effect.provide(Logger.replace(Logger.defaultLogger, jsonLineLogger)),
  // Show debug logs from the spider internals
  Logger.withMinimumLogLevel(LogLevel.Info)
);

void Effect.runPromiseExit(runnable).then((exit) => {
  process.exit(exit._tag === 'Success' ? 0 : 1);
});
