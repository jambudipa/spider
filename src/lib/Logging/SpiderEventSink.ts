import { Context, Data, Effect, Layer } from 'effect';

/**
 * Spider lifecycle started.
 *
 * @group Observability
 * @public
 */
export class SpiderStartEvent extends Data.TaggedClass('SpiderStart')<{
  readonly details?: Record<string, unknown>;
}> {}

/**
 * Spider lifecycle completed successfully.
 *
 * @group Observability
 * @public
 */
export class SpiderCompleteEvent extends Data.TaggedClass('SpiderComplete')<{
  readonly details?: Record<string, unknown>;
}> {}

/**
 * Spider lifecycle ended with an error.
 *
 * @group Observability
 * @public
 */
export class SpiderErrorEvent extends Data.TaggedClass('SpiderError')<{
  readonly details?: Record<string, unknown>;
}> {}

/**
 * Crawling started for a domain.
 *
 * @group Observability
 * @public
 */
export class DomainStartEvent extends Data.TaggedClass('DomainStart')<{
  readonly domain: string;
  readonly startUrl: string;
}> {}

/**
 * Crawling completed for a domain.
 *
 * @group Observability
 * @public
 */
export class DomainCompleteEvent extends Data.TaggedClass('DomainComplete')<{
  readonly domain: string;
  readonly pagesScraped: number;
  readonly reason: 'max_pages' | 'queue_empty' | 'error';
}> {}

/**
 * A single page was successfully scraped.
 *
 * @group Observability
 * @public
 */
export class PageScrapedEvent extends Data.TaggedClass('PageScraped')<{
  readonly url: string;
  readonly domain: string;
  readonly pageNumber: number;
}> {}

/**
 * Discriminated union of all structured domain events emitted by the spider.
 *
 * These represent observable lifecycle and progress signals — not log lines.
 * Diagnostic and edge-case messages flow through Effect's standard `Logger`
 * system instead, where clients override via `Logger.replace`.
 *
 * Clients consume these events by providing a custom {@link SpiderEventSink}
 * layer; the default ({@link SpiderEventSinkNoop}) discards them.
 *
 * Switch on `event._tag` for exhaustive handling.
 *
 * @group Observability
 * @public
 */
export type SpiderEvent =
  | SpiderStartEvent
  | SpiderCompleteEvent
  | SpiderErrorEvent
  | DomainStartEvent
  | DomainCompleteEvent
  | PageScrapedEvent;

/**
 * Service interface for consuming {@link SpiderEvent} signals.
 *
 * @group Observability
 * @public
 */
export interface SpiderEventSinkService {
  readonly emit: (event: SpiderEvent) => Effect.Effect<void>;
}

/**
 * Context tag for the spider's event sink.
 *
 * Provide a custom layer to subscribe to crawl events:
 *
 * ```typescript
 * const MySink = Layer.succeed(SpiderEventSink, {
 *   emit: (event) => Effect.sync(() => analytics.track(event._tag, event)),
 * });
 *
 * program.pipe(
 *   Effect.provide(SpiderService.Default),
 *   Effect.provide(MySink),
 * );
 * ```
 *
 * @group Observability
 * @public
 */
export class SpiderEventSink extends Context.Tag(
  '@jambudipa/spider/SpiderEventSink'
)<SpiderEventSink, SpiderEventSinkService>() {}

/**
 * Default no-op sink. Discards every event.
 *
 * @group Observability
 * @public
 */
export const SpiderEventSinkNoop: Layer.Layer<SpiderEventSink> = Layer.succeed(
  SpiderEventSink,
  { emit: () => Effect.void }
);
