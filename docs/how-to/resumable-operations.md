# How to Use Resumable Operations

Spider separates durable state storage from the spider service. Configure
`ResumabilityService` for the storage strategy. Configure `SpiderService` with
`enableResumability: true` when you call `spider.resume`.

`SpiderService` does not connect a `ResumabilityService` to the scheduler for
you. The application must configure the scheduler persistence implementation
that saves and restores a `SpiderStateKey`.

## Configure durable storage

Use `ResumabilityService.fromConfig` to build a configured service. Wrap the
result in `Layer.effect` before you provide it to an Effect program.

```typescript
import { Effect, Layer } from 'effect';
import {
  ResumabilityConfigs,
  ResumabilityService,
} from '@jambudipa/spider';

const resumabilityLayer = Layer.effect(
  ResumabilityService,
  ResumabilityService.fromConfig(
    ResumabilityConfigs.file('./spider-state', 'hybrid'),
  ),
);

const program = Effect.gen(function* () {
  const resumability = yield* ResumabilityService;
  const info = yield* resumability.getInfo();
  console.log(`Using ${info.strategy.name} with ${info.backend.name}`);
});

Effect.runPromise(
  program.pipe(Effect.provide(resumabilityLayer)),
);
```

`ResumabilityConfigs.file` creates a `FileStorageBackend`. Use
`ResumabilityConfigs.redis` or `ResumabilityConfigs.postgres` when the
application owns a compatible client.

## Inspect saved sessions

Use a `SpiderStateKey` to identify a session. `restore` returns `Option.none`
when the configured backend has no saved state for that key.

```typescript
import { Effect, Option } from 'effect';
import {
  ResumabilityService,
  SpiderStateKey,
} from '@jambudipa/spider';

const sessionKey = new SpiderStateKey({
  id: 'my-crawl-session',
  timestamp: new Date('2026-08-31T00:00:00Z'),
  name: 'Example crawl',
});

const inspectSession = Effect.gen(function* () {
  const resumability = yield* ResumabilityService;
  const sessions = yield* resumability.listSessions();
  const state = yield* resumability.restore(sessionKey);

  console.log(`Stored sessions: ${sessions.length}`);
  if (Option.isNone(state)) {
    console.log('No state exists for this session.');
    return;
  }

  console.log(`Pending requests: ${state.value.pendingRequests.length}`);
  console.log(`Processed requests: ${state.value.totalProcessed}`);
});
```

Call `resumability.cleanup(sessionKey)` after the application finishes with a
session. Not every storage backend supports listing sessions. Handle the
`PersistenceError` failure when that capability is optional.

## Resume a spider session

`spider.resume` is the current resume API. It accepts a `SpiderStateKey`, not a
session ID string. Provide the spider, configuration, and scheduler layers as
one composed runtime layer.

```typescript
import { Effect, Layer, Sink } from 'effect';
import {
  CrawlResult,
  ResumabilityConfigs,
  ResumabilityService,
  SpiderConfig,
  SpiderSchedulerService,
  SpiderService,
  SpiderStateKey,
  makeSpiderConfig,
} from '@jambudipa/spider';

const sessionKey = new SpiderStateKey({
  id: 'my-crawl-session',
  timestamp: new Date('2026-08-31T00:00:00Z'),
  name: 'Example crawl',
});

const resumabilityLayer = Layer.effect(
  ResumabilityService,
  ResumabilityService.fromConfig(
    ResumabilityConfigs.file('./spider-state', 'hybrid'),
  ),
);

const config = makeSpiderConfig({
  enableResumability: true,
  requestDelayMs: 1_000,
  userAgent: 'Resumable Spider 1.0',
});

const runtimeLayer = SpiderService.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      SpiderConfig.layerWith(config),
      SpiderSchedulerService.layer,
      resumabilityLayer,
    ),
  ),
);

const resumeProgram = Effect.gen(function* () {
  const spider = yield* SpiderService;
  const sink = Sink.forEach<CrawlResult>((result) =>
    Effect.sync(() => {
      if (CrawlResult.isOk(result)) {
        console.log(`Resumed: ${result.pageData.url}`);
      }
    }),
  );

  return yield* spider.resume(sessionKey, sink);
});

Effect.runPromise(
  resumeProgram.pipe(Effect.provide(runtimeLayer)),
);
```

Before the application runs `spider.resume`, restore the matching state into
`SpiderSchedulerService` with the application's `StatePersistence`
implementation. The scheduler owns the crawl queue. The resumability service
owns the configured backend and state strategies.

## Choose a persistence strategy

Use the strategy that matches the expected crawl size and storage backend.

| Strategy | Use it when | Trade-off |
| --- | --- | --- |
| `full-state` | The crawl is small or simple recovery matters most. | Each operation writes the complete state. |
| `delta` | The crawl has many small state changes. | Recovery replays saved deltas. |
| `hybrid` | The crawl needs both frequent updates and bounded recovery work. | Configure snapshot intervals for the workload. |
| `auto` | The backend capability should select the strategy. | Review the selected strategy through `getInfo()`. |

Keep each session ID unique. Remove completed sessions with `cleanup`. Test the
restore path with the exact backend and scheduler persistence implementation
that the production application uses.
