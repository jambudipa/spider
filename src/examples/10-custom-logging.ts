/**
 * Example 10: Custom logging and event handling
 *
 * Demonstrates the two override surfaces:
 *
 * 1. Effect's standard `Logger` — replace via `Logger.layer` to route every
 *    `Effect.log*` call (debug/info/warn/error + structured annotations) to
 *    your own destination (pino, datadog, OpenTelemetry, file, etc.).
 *
 * 2. `SpiderEventSink` — provide a custom layer to subscribe to typed
 *    domain events (`PageScraped`, `DomainComplete`, …). Useful for
 *    analytics, dashboards, or persistence.
 *
 * Both are independent. Override either, both, or neither.
 */

import { Chunk, Effect, Layer, Logger, References, Ref, Sink } from 'effect';
import {
  CrawlResult,
  makeSpiderConfig,
  SpiderConfig,
  SpiderEventSink,
  SpiderService,
} from '../index.js';

// 1. Custom Effect Logger — formats annotations alongside the message.
//    In production wire this to pino, OpenTelemetry, datadog, etc.
/** Converts Effect log annotations into a compact console suffix. */
const formatAnnotations = (
  annotations: Readonly<Record<string, unknown>>
): string => {
  let parts = Chunk.empty<string>();
  for (const [key, value] of Object.entries(annotations)) {
    parts = Chunk.append(parts, `${key}=${String(value)}`);
  }
  return Chunk.size(parts) > 0
    ? ` (${Chunk.toReadonlyArray(parts).join(' ')})`
    : '';
};

/** Logger implementation that writes structured Effect logs to standard output. */
const myLogger = Logger.make(({ logLevel, message, fiber, date }) => {
  const annotations = fiber.getRef(References.CurrentLogAnnotations);
  const messageText = Array.isArray(message)
    ? message.join(' ')
    : String(message);
  process.stdout.write(
    `[${date.toISOString()}] [${logLevel.toUpperCase()}] [fiber=${fiber.id}] ${messageText}${formatAnnotations(annotations)}\n`
  );
});

// Custom event sink: log every spider event with structured annotations.
// In production, route this to analytics, a database, or an event bus.
/** Event-sink layer that demonstrates typed domain-event routing. */
const AnalyticsSink = Layer.succeed(SpiderEventSink, {
  emit: (event) =>
    Effect.logInfo(`spider event: ${event._tag}`).pipe(
      Effect.annotateLogs({ event: event._tag })
    ),
});

/** Crawls a small target while emitting custom logs and domain events. */
const program = Effect.gen(function* () {
  yield* Effect.logInfo('starting custom-logging example');

  const pages = yield* Ref.make(Chunk.empty<CrawlResult>());
  const sink = Sink.forEach<CrawlResult, void, never, never>((result) =>
    Ref.update(pages, (chunk) => Chunk.append(chunk, result))
  );

  const spider = yield* SpiderService;
  yield* spider.crawl(['https://web-scraping.dev/'], sink);

  const collected = yield* Ref.get(pages);
  yield* Effect.logInfo(`crawl finished: ${Chunk.size(collected)} pages`);

  return Chunk.toReadonlyArray(collected);
});

/** Restricts the logging demonstration to a small polite crawl. */
const config = makeSpiderConfig({
  maxPages: 3,
  maxDepth: 1,
  requestDelayMs: 250,
  maxConcurrentWorkers: 2,
});

/** Provides the logger, event sink, configuration, and crawler services. */
const runnable = program.pipe(
  Effect.provide(
    SpiderService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          SpiderConfig.layerWith(config),
          // Override the SpiderEventSink — receives typed domain events.
          AnalyticsSink,
          // Override Effect's built-in Logger — every Effect.log* now flows through myLogger.
          Logger.layer([myLogger]),
          Layer.succeed(References.MinimumLogLevel, 'Info')
        )
      )
    )
  )
);

void Effect.runPromiseExit(runnable).then((exit) => {
  process.exit(exit._tag === 'Success' ? 0 : 1);
});
