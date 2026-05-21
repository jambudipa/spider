# Bug: unbounded `resultChannel` causes heap growth when sinks lag

**Affects:** `@jambudipa/spider@0.12.0` and likely all prior versions.
**Severity:** High for long-running crawls with non-trivial sink work; low for
toy crawls where the sink is a no-op or trivially fast.
**Filed by:** events-scrape OOM investigation, 2026-05-21.

---

## Problem

The shared serialiser channel between worker fibers and the user-supplied sink
is constructed with `Queue.unbounded()`. When the sink does any real work
(image downloads, DB inserts, network calls), the queue grows without bound
and the heap fills with buffered `CrawlResult` values — which carry full HTML
page bodies.

### Where it lives

`src/lib/Spider/Spider.service.ts:602-608`:

```typescript
const resultChannel = yield* Effect.acquireRelease(
  Queue.unbounded<CrawlResult>(),
  (q) => Queue.shutdown(q)
);
const serialiserFiber = yield* Effect.fork(
  Stream.fromQueue(resultChannel).pipe(Stream.run(sink))
);
```

Workers offer to this queue at two sites — both call `Queue.offer` after a
fetch completes:

- `Spider.service.ts:1367-1376` — `CrawlResultError` after fetch failure.
- `Spider.service.ts:1593-1601` — `CrawlResultOk` after fetch success
  (carries the `PageData` object with `html` body string).

Because the queue is unbounded, `Queue.offer` never suspends. Workers fetch as
fast as the configured `concurrency × maxConcurrentWorkers` allows. The
serialiser fiber drains in lockstep with the sink's processing rate, which can
be orders of magnitude slower than fetch rate.

### Observed symptoms

Real-world reproduction from `apps/events-scrape` (sink does HTML cleaning +
batched Postgres upserts + per-image-URL HTTP downloads + sharp resize +
second Postgres upsert):

| Metric | Healthy run (iter 4b) | Stuck run (iter 6 stall) |
|---|---|---|
| Steady-state heap | ~800 MB | climbing 90 MB/min |
| `CrawlResultOk` retained | not measured | 3,876 buffered |
| HTML strings in heap | not measured | 1.29 GB |
| % heap = HTML | not measured | 93 % |
| Sink throughput | 528 pages/min | stalled at first batch |

Heap-snapshot forensics (see below) confirm 3,876 buffered `CrawlResultOk`
values, each carrying a ~333 KB HTML body — accounting for 1.29 GB of the
1.46 GB live set. The events-scrape app's own per-batch buffer is bounded to
50 rows, so the HTML is **not** in user code; it is in the spider's
`resultChannel`.

### Why this isn't visible in trivial benchmarks

If the sink is a no-op (`sink: Sink.drain` or similar) or only writes to a
console, the serialiser drains at line speed and the queue stays at depth ≤ 1
on average. The bug only manifests when the sink does I/O whose duration
exceeds the inter-fetch interval — image downloads, DB writes with retry,
expensive HTML parsing, etc.

It also doesn't manifest in short crawls (< 100 pages) because the queue
empties when the crawl ends and the heap is reclaimed.

---

## Root cause

`Queue.unbounded()` is the wrong primitive for a producer/consumer channel
when:

1. The producer rate is not naturally rate-limited by the consumer (Effect
   workers fetch independently of sink readiness).
2. The values being queued are large (HTML bodies can be 1–5 MB each in real
   crawls).
3. The crawl runs long enough that buffer accumulation outpaces any
   transient sink slow-down.

Under Effect-TS, the correct primitive for this pattern is `Queue.bounded(n)`.
On a full bounded queue, `Queue.offer` returns an `Effect` that **suspends
the calling fiber** until capacity frees up — natural backpressure with zero
busy-waiting, no error path, and no caller-side polling.

This is exactly what the spider needs. When the sink lags, workers should
pause on their next `Queue.offer` until the sink catches up. The throughput
ceiling becomes the sink's drain rate, which is what physics demands anyway.
Heap stays flat because only `n` results are ever live.

---

## Proposed fix

### Public API: add `resultChannelCapacity` to `SpiderConfigOptions`

In `src/lib/Config/SpiderConfig.service.ts:312` after the existing
`concurrency` / `maxConcurrentWorkers` options:

```typescript
/**
 * Maximum number of buffered `CrawlResult` values between worker fibers
 * and the user-supplied sink.
 *
 * When the sink lags behind worker fetch rate, results queue up here. With
 * `'unbounded'`, the queue grows without limit — convenient for trivial
 * sinks, but causes heap growth for any sink doing real I/O (DB writes,
 * downloads, etc.). With a numeric capacity, workers naturally suspend on
 * `Queue.offer` when the queue is full, applying backpressure that
 * matches fetch rate to sink drain rate. Heap stays flat at roughly
 * `capacity × avg(CrawlResult)`.
 *
 * Recommended: a small multiple of `concurrency × maxConcurrentWorkers`.
 * For the default `4 × 5 = 20` workers, capacity 50–100 gives sinks
 * breathing room without unbounded growth. Workers will block briefly
 * on slow sinks, which is the desired behaviour.
 *
 * Default: `'unbounded'` for back-compat. New users should set this to
 * a numeric value matched to their working-set tolerance.
 */
readonly resultChannelCapacity: number | 'unbounded';
```

Add the default in `Spider.defaults.ts`:
```typescript
resultChannelCapacity: 'unbounded',
```

Add the getter in `SpiderConfig.service.ts` alongside the existing
`getConcurrency` / `getMaxConcurrentWorkers`:
```typescript
getResultChannelCapacity: () => Effect.succeed(config.resultChannelCapacity),
```

### Internal: use the config when constructing the queue

In `Spider.service.ts:602-605`:

```typescript
// Before:
const resultChannel = yield* Effect.acquireRelease(
  Queue.unbounded<CrawlResult>(),
  (q) => Queue.shutdown(q)
);

// After:
const capacity = yield* config.getResultChannelCapacity();
const resultChannel = yield* Effect.acquireRelease(
  capacity === 'unbounded'
    ? Queue.unbounded<CrawlResult>()
    : Queue.bounded<CrawlResult>(capacity),
  (q) => Queue.shutdown(q)
);
```

### No changes needed at offer sites

`Queue.offer` on a bounded queue is already the correct API — it returns an
`Effect<void>` that suspends the calling fiber when the queue is full. The
existing `yield* Queue.offer(resultChannel, ...)` calls at lines 1367 and
1593 work unchanged.

### Documentation

Add a section to the existing concurrency docs (`docs/explanation/` or
`docs/how-to/`) covering:

- When to keep `'unbounded'` (trivial sinks, short crawls, benchmarks).
- When to set a numeric capacity (real-world crawls with DB / network sinks).
- How to pick the number (start at `2 × workers`, raise if you see
  worker-suspension idle time in profiles, lower if heap grows).
- Tradeoff: a tighter bound = flatter heap but more worker suspension; a
  looser bound = burstier throughput but higher peak heap.

---

## Why `Queue.dropping` / `Queue.sliding` are wrong

Effect-TS also provides `Queue.dropping(n)` (rejects offers when full) and
`Queue.sliding(n)` (silently drops the oldest entry). Neither is appropriate
here — a spider that drops fetched results breaks the contract with the
user-supplied sink and corrupts the crawl. The only correct backpressure
primitive for this case is `Queue.bounded(n)` with suspension.

---

## Alternative considered: per-sink wrapper

We considered exposing a `bufferedSink` helper that wraps the user's sink in
its own bounded buffer. That doesn't fix the bug — by the time results reach
the wrapper, they've already passed through the spider's unbounded
`resultChannel`. The fix has to live at the channel construction site,
which is internal to `Spider.service.ts`.

---

## Heap snapshot evidence

Snapshot taken at peak in events-scrape iter 5 (heap = 2.1 GB, 18 min into
run):

```
=== Self-size by node type ===
string               1286.9 MB   311,619 nodes   avg 4,330 B/node
concatenated string    69.6 MB 2,279,092 nodes   avg    32 B/node
code                   42.3 MB   185,776 nodes   avg   239 B/node
…
TOTAL                1456.6 MB

=== Top 30 individual objects ===
size      type    name (truncated)
4195 KB   string  <!DOCTYPE html><html lang="en">...
3578 KB   string  <!DOCTYPE html><html lang="en">...
… (28 more, all DOCTYPE html strings, 2.6-4.2 MB each)

=== Top 20 object constructors (by total self_size) ===
CrawlResultOk        0.24 MB   3,876 instances   avg 64 B/instance
(plus the HTML strings hanging off each via the PageData reference)
```

The `CrawlResultOk` header struct is only 64 B per instance, but each holds a
reference to a `PageData` containing the full HTML body — explaining how
3,876 structs balloon to 1.29 GB of retained strings.

Analysis script: `apps/events-scrape/_scratch/analyze-heap-snapshot.mjs` in
the consuming project (parses the raw `.heapsnapshot` JSON without DevTools).

---

## Recommended rollout

1. Land the `resultChannelCapacity` option with default `'unbounded'` —
   strictly back-compat, no existing user is affected.
2. Document the tradeoff prominently in the README's "Configuration" section
   and the events-scrape iteration log.
3. Consider changing the **default** to a numeric value (e.g. `100`) in the
   next major version — most real-world users will benefit, and the
   `'unbounded'` escape hatch remains for benchmarks/trivial sinks.

Effort estimate: ~30 lines of code + tests across three files
(`SpiderConfig.service.ts`, `Spider.defaults.ts`, `Spider.service.ts`),
plus one new integration test (slow sink + bounded queue, assert workers
suspend rather than buffer unboundedly), plus README/doc updates.
