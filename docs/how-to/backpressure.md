# How to Bound the Result Channel (Backpressure)

When the user-supplied sink is slow relative to fetch rate — DB writes, image
downloads, expensive parsing — buffered `CrawlResult` values accumulate
between worker fibers and the sink. With the default `resultChannelCapacity:
'unbounded'` this buffer grows without limit and can drive long crawls to
OOM, because each buffered `CrawlResultOk` retains the full HTML body.

Setting `resultChannelCapacity` to a positive integer switches the channel to
a bounded queue. When the queue is full, workers naturally suspend on their
next offer until the sink drains a slot — applying backpressure that matches
fetch rate to sink drain rate, with zero busy-waiting and no caller-side
changes.

## When to keep `'unbounded'` (the default)

- The sink is trivial: console writes, in-memory accumulation, `Sink.drain`.
- The crawl is short (< a few hundred pages) and the heap is reclaimed at
  the end.
- Benchmarks where you want fetch throughput unconstrained by sink work.

## When to set a numeric capacity

- The sink does any real I/O: DB inserts, HTTP calls, file writes,
  CPU-heavy parsing.
- The crawl is long-running (thousands of pages or more).
- HTML payloads are large (Wikipedia-style 1–5 MB bodies).
- You have seen heap growth, OOMs, or a queue-depth warning in production.

## Picking the number

Start at `2 × concurrency × maxConcurrentWorkers` and adjust:

- **Tighter bound** = flatter heap but more worker suspension. If you see
  significant worker idle time in profiles, raise it.
- **Looser bound** = burstier throughput but higher peak heap. If heap
  grows under load, lower it.

For the default `concurrency: 4 × maxConcurrentWorkers: 5 = 20` workers,
`resultChannelCapacity: 50` is a good starting point for sinks with real
I/O, and `100–200` for sinks whose work is occasionally bursty.

## Example

```typescript
import { Effect, Layer, Sink } from 'effect';
import {
  SpiderConfig,
  SpiderEventSinkNoop,
  SpiderService,
  makeSpiderConfig,
} from '@jambudipa/spider';

const config = makeSpiderConfig({
  concurrency: 4,
  maxConcurrentWorkers: 5,
  // Bound buffered results to ~50 to keep heap flat under a slow sink.
  resultChannelCapacity: 50,
});

const slowSink = Sink.forEach((result) =>
  Effect.gen(function* () {
    // Real I/O: DB upsert, image download, etc.
    yield* writeToDatabase(result);
  })
);

const program = Effect.gen(function* () {
  const spider = yield* SpiderService;
  yield* spider.crawl(['https://example.com'], slowSink);
}).pipe(
  Effect.provide(
    SpiderService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(SpiderConfig.layerWith(config), SpiderEventSinkNoop)
      )
    )
  )
);
```

## Caveat: `concurrency: 'unbounded'`

If you set `concurrency: 'unbounded'` and also pick a small
`resultChannelCapacity`, heap retention shifts from buffered `CrawlResult`
values to suspended worker fibers. Workers waiting on a full queue still
hold their fiber stacks, and with unbounded concurrency that set of
suspended fibers is itself unbounded. Prefer a finite `concurrency` when
you set a numeric `resultChannelCapacity`.

## Why not `Queue.dropping` or `Queue.sliding`?

Effect-TS also provides dropping and sliding queues. Neither is appropriate
here — a spider that silently drops fetched results breaks the contract with
the user-supplied sink and corrupts the crawl. The only correct backpressure
primitive for this pipeline is suspension via `Queue.bounded(n)`, which is
what `resultChannelCapacity: n` selects internally.

## Validation

`makeSpiderConfig` rejects non-positive and non-integer capacity values at
construction time with a `ConfigError`. Use `'unbounded'` (the default) or a
positive integer — nothing else is valid.
