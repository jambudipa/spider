import { Context, Effect, Layer } from 'effect';

/**
 * Structured domain events emitted by the spider during crawling.
 *
 * These represent observable lifecycle and progress signals — not log lines.
 * Diagnostic and edge-case messages flow through Effect's standard `Logger`
 * system instead, where clients can override via `Logger.replace`.
 *
 * Clients consume these events by providing a custom {@link SpiderEventSink}
 * layer; the default ({@link SpiderEventSinkNoop}) discards them.
 *
 * @group Observability
 * @public
 */
export type SpiderEvent =
  | {
      readonly _tag: 'SpiderStart';
      readonly details?: Record<string, unknown>;
    }
  | {
      readonly _tag: 'SpiderComplete';
      readonly details?: Record<string, unknown>;
    }
  | {
      readonly _tag: 'SpiderError';
      readonly details?: Record<string, unknown>;
    }
  | {
      readonly _tag: 'DomainStart';
      readonly domain: string;
      readonly startUrl: string;
    }
  | {
      readonly _tag: 'DomainComplete';
      readonly domain: string;
      readonly pagesScraped: number;
      readonly reason: 'max_pages' | 'queue_empty' | 'error';
    }
  | {
      readonly _tag: 'PageScraped';
      readonly url: string;
      readonly domain: string;
      readonly pageNumber: number;
    };

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
 *   emit: (event) => Effect.sync(() => analytics.track(event)),
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
