import { Context, Data, Effect, Layer } from 'effect';
import type { PageFetchErrorKind } from '../Spider/Spider.types.js';
import type { RobotsCheckReason } from '../Robots/Robots.service.js';

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
 * `cycle` disambiguates events emitted by successive passes when `domainRetry`
 * is enabled. `cycle: 0` is the initial pass (and the only event for callers
 * who leave `domainRetry` disabled); subsequent passes increment `cycle`.
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
  readonly reason: 'queue_empty' | 'max_pages' | 'error' | 'robots_blocked' | 'all_fetches_failed' | 'interrupted' | 'interrupt_grace_exceeded';
  readonly durationMs: number;
  /**
   * Pass index this completion belongs to. `0` for the initial pass (always
   * the case when `domainRetry` is disabled); incremented for each retry
   * pass triggered by `domainRetry`. Defaults to `0` for backwards
   * compatibility.
   */
  readonly cycle: number;
}> {}

/**
 * A residual domain has been scheduled for a retry pass.
 *
 * Emitted once per residual domain at the start of each retry pass (i.e.
 * after pass 0 has finished and before pass 1 begins, repeated for each
 * subsequent cycle when `domainRetry.maxPasses > 2`). The event fires
 * *before* the `backoffMs` sleep so consumers can observe the intended
 * retry schedule.
 *
 * @group Observability
 * @public
 */
export class DomainRetryScheduledEvent extends Data.TaggedClass(
  'DomainRetryScheduled'
)<{
  readonly domain: string;
  readonly startUrl: string;
  /** Reason from the just-completed `DomainCompleteEvent` that triggered the retry. */
  readonly previousReason:
    | 'queue_empty'
    | 'max_pages'
    | 'error'
    | 'robots_blocked'
    | 'all_fetches_failed'
    | 'interrupted'
    | 'interrupt_grace_exceeded';
  /**
   * The cycle index this retry pass will run at — i.e. `1` for the first
   * retry, `2` for the second, etc.
   */
  readonly attempt: number;
  /**
   * Wall-clock epoch milliseconds at which the retry pass is expected to
   * begin (`emittedAt + backoffMs`). Informational only.
   */
  readonly nextPassAt: number;
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
 * A URL was refused before any fetch was attempted, either because a published
 * rule forbade it or because the rules could not be established at all.
 *
 * Read {@link RobotsBlockedEvent.reason} before concluding the target
 * disallowed you: `robots-unavailable` means the origin never answered, which
 * is a transport problem wearing a compliance refusal's clothes.
 *
 * @group Observability
 * @public
 */
export class RobotsBlockedEvent extends Data.TaggedClass('RobotsBlocked')<{
  readonly url: string;
  readonly domain: string;
  readonly disallowRule?: string;
  /** Why the URL was refused. */
  readonly reason?: RobotsCheckReason;
  /** What went wrong, when `reason` is `robots-unavailable`. */
  readonly unavailableCause?: string;
}> {}

/**
 * A worker fiber was interrupted by a stop signal.
 *
 * @group Observability
 * @public
 */
export class WorkerInterruptedEvent extends Data.TaggedClass('WorkerInterrupted')<{
  readonly workerId: string;
  readonly domain: string;
  readonly url: string;
  readonly reason: string;
}> {}

/**
 * A domain's crawl was stopped early by an interrupt signal.
 *
 * Emitted once per domain when `stopMode: 'interrupt'` fires.
 * `forced` is `true` when the grace period expired before workers exited cleanly.
 *
 * @group Observability
 * @public
 */
export class DomainStoppedEvent extends Data.TaggedClass('DomainStopped')<{
  readonly domain: string;
  readonly reason: string;
  readonly gracefulMs: number;
  readonly forced: boolean;
}> {}

/**
 * The entire spider was stopped by an external abort signal.
 *
 * Emitted once when an `externalStopSignal` Deferred is resolved while
 * a `crawl()` is in progress.
 *
 * @group Observability
 * @public
 */
export class SpiderStoppedEvent extends Data.TaggedClass('SpiderStopped')<{
  readonly reason: string;
  readonly totalDomains: number;
  readonly totalPages: number;
  readonly wallclockMs: number;
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
  | DomainRetryScheduledEvent
  | PageScrapedEvent
  | RobotsBlockedEvent
  | StartUrlChosenEvent
  | StartUrlRedirectedEvent
  | WorkerInterruptedEvent
  | DomainStoppedEvent
  | SpiderStoppedEvent;

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
