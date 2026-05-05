import { Context, Data, Effect, Layer } from 'effect';
import type { PageFetchErrorKind } from '../Spider/Spider.types.js';

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
  readonly startUrl: string;
  readonly finalStartUrl: string;
  readonly pagesScraped: number;
  readonly pagesAttempted: number;
  readonly pagesFailed: ReadonlyArray<{ readonly kind: PageFetchErrorKind; readonly count: number }>;
  readonly reason: 'queue_empty' | 'max_pages' | 'error' | 'robots_blocked' | 'all_fetches_failed';
  readonly durationMs: number;
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
 * A URL was blocked by robots.txt before any fetch was attempted.
 *
 * @group Observability
 * @public
 */
export class RobotsBlockedEvent extends Data.TaggedClass('RobotsBlocked')<{
  readonly url: string;
  readonly domain: string;
  readonly disallowRule?: string;
}> {}

/**
 * A start URL was selected from a primary + fallback candidate list.
 *
 * Emitted once per starting entry after the start-URL probing phase, regardless
 * of whether a fallback was needed. `chosen` is the URL that responded; if every
 * candidate failed, `chosen` is the primary URL (the crawl will then surface a
 * fetch failure via {@link CrawlResultError}).
 *
 * @group Observability
 * @public
 */
export class StartUrlChosenEvent extends Data.TaggedClass('StartUrlChosen')<{
  readonly domain: string;
  readonly attempted: ReadonlyArray<string>;
  readonly chosen: string;
}> {}

/**
 * A start URL was followed via a cross-domain HTTP redirect.
 *
 * Emitted only when `crossDomainRedirects.enabled` is `true` and the start URL's
 * final response URL is on a different hostname. `chain` contains the original
 * URL and the final URL; intermediate hops are not exposed because
 * `globalThis.fetch` follows redirects transparently.
 *
 * @group Observability
 * @public
 */
export class StartUrlRedirectedEvent extends Data.TaggedClass('StartUrlRedirected')<{
  readonly domain: string;
  readonly from: string;
  readonly to: string;
  readonly chain: ReadonlyArray<string>;
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
  | PageScrapedEvent
  | RobotsBlockedEvent
  | StartUrlChosenEvent
  | StartUrlRedirectedEvent;

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
