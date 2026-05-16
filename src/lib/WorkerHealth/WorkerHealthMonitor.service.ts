import { DateTime, Duration, Effect, HashMap, Layer, Option, Ref, Schedule } from 'effect';
import { SPIDER_DEFAULTS } from '../Spider/Spider.defaults.js';
import { ConfigError } from '../errors/effect-errors.js';

interface WorkerStatus {
  workerId: string;
  domain: string;
  currentUrl?: string;
  lastActivity: DateTime.Utc;
  fetchStartTime?: DateTime.Utc;
}

const makeWorkerHealthMonitor = (stuckThresholdMs: number) =>
  Effect.gen(function* () {
    const workers = yield* Ref.make(HashMap.empty<string, WorkerStatus>());

    const collectStuck = Effect.gen(function* () {
      const now = DateTime.unsafeNow();
      const workerMap = yield* Ref.get(workers);
      const stuck: WorkerStatus[] = [];
      for (const [, status] of workerMap) {
        const inactiveMs =
          DateTime.toEpochMillis(now) -
          DateTime.toEpochMillis(status.lastActivity);
        // Clock-rewind guard: skip negative elapsed; next tick will see
        // a sensible positive value.
        if (inactiveMs < 0) continue;
        if (inactiveMs > stuckThresholdMs) {
          stuck.push(status);
        }
      }
      return stuck;
    });

    return {
      /**
       * Register a worker's activity.
       */
      recordActivity: (
        workerId: string,
        domain: string,
        activity: { url?: string; fetchStart?: boolean }
      ) =>
        Effect.gen(function* () {
          const now = DateTime.unsafeNow();
          yield* Ref.update(workers, (map) => {
            const current = HashMap.get(map, workerId).pipe((opt) =>
              opt._tag === 'Some'
                ? opt.value
                : { workerId, domain, lastActivity: now }
            );
            const updated: WorkerStatus = {
              ...current,
              domain,
              lastActivity: now,
              currentUrl: activity.url ?? current.currentUrl,
              fetchStartTime: activity.fetchStart
                ? now
                : current.fetchStartTime,
            };
            return HashMap.set(map, workerId, updated);
          });
        }),

      /**
       * Remove a worker from monitoring.
       */
      removeWorker: (workerId: string) =>
        Ref.update(workers, (map) => HashMap.remove(map, workerId)),

      /**
       * Get stuck workers (single read; does not modify state).
       */
      getStuckWorkers: collectStuck,

      /**
       * Run the monitor loop: every 30 s, log a warning for each stuck
       * worker.
       */
      startMonitoring: Effect.repeat(
        Effect.gen(function* () {
          const stuck = yield* collectStuck;
          if (stuck.length === 0) return;
          for (const worker of stuck) {
            const nowMillis = DateTime.toEpochMillis(DateTime.unsafeNow());
            const inactiveMs =
              nowMillis - DateTime.toEpochMillis(worker.lastActivity);
            yield* Effect.logWarning('worker stuck detected').pipe(
              Effect.annotateLogs({
                event: 'worker_stuck_detected',
                domain: worker.domain,
                workerId: worker.workerId,
                currentUrl: worker.currentUrl,
                lastActivity: DateTime.formatIso(worker.lastActivity),
                inactiveMs,
                fetchStartTime: Option.fromNullable(
                  worker.fetchStartTime
                ).pipe(
                  Option.map(DateTime.formatIso),
                  Option.getOrElse(() => 'N/A')
                ),
              })
            );
          }
        }),
        Schedule.fixed(Duration.seconds(30))
      ),
    };
  });

/**
 * Monitors worker health and reports stuck workers.
 *
 * The staleness threshold defaults to {@link SPIDER_DEFAULTS.STALE_WORKER_THRESHOLD_MS}
 * (300 s) — synced with the spider's inline worker-health checks so the two
 * surfaces share one default. This service is intentionally independent of
 * `SpiderConfig` so direct consumers don't have to provide the full spider
 * configuration layer. Per-spider override of the spider's own inline checks
 * is available via `SpiderConfig.staleWorkerThresholdMs`.
 *
 * To use a different threshold for this service specifically, provide a
 * custom layer via {@link WorkerHealthMonitor.WithThreshold}:
 *
 * ```ts
 * Effect.provide(WorkerHealthMonitor.WithThreshold(120_000));
 * ```
 */
export class WorkerHealthMonitor extends Effect.Service<WorkerHealthMonitor>()(
  '@jambudipa.io/WorkerHealthMonitor',
  {
    effect: makeWorkerHealthMonitor(SPIDER_DEFAULTS.STALE_WORKER_THRESHOLD_MS),
  }
) {
  /**
   * Build a `WorkerHealthMonitor` layer with a custom stuck-worker
   * threshold in milliseconds. Useful when the consumer needs a stricter
   * or looser detection cadence than the default 300 s without forking
   * the service.
   *
   * Throws synchronously when `stuckThresholdMs` is not a positive
   * integer within the documented bounds (1..2_147_483_647).
   */
  static WithThreshold = (stuckThresholdMs: number) => {
    if (
      typeof stuckThresholdMs !== 'number' ||
      !Number.isInteger(stuckThresholdMs) ||
      stuckThresholdMs < 1 ||
      stuckThresholdMs > 2_147_483_647
    ) {
      // eslint-disable-next-line effect/no-throw-use-effect -- sync factory, programmer error at construction; surfaced as ConfigError for consistency with makeSpiderConfig
      throw new ConfigError({
        field: 'WorkerHealthMonitor.WithThreshold.stuckThresholdMs',
        value: stuckThresholdMs,
        reason:
          'must be a positive integer between 1 and 2_147_483_647 (milliseconds)',
      });
    }
    // The factory returns the service shape; Effect.Service injects the
    // `_tag` at construction time. The Effect type produced by the inner
    // generator (which composes `Effect.gen` with multiple `Ref.make`
    // yields) is wider than the public `Effect<WorkerHealthMonitor>` the
    // Layer constructor wants; the disable below is for the bridging
    // assertion only.
    /* eslint-disable-next-line custom-rules/no-type-assertion -- Effect.Service auto-injects the _tag at runtime; this assertion narrows the inner factory's structural-shape Effect to the class-tagged Effect that Layer.effect expects. */
    const layerEffect = makeWorkerHealthMonitor(
      stuckThresholdMs
    ) as unknown as Effect.Effect<WorkerHealthMonitor>;
    return Layer.effect(WorkerHealthMonitor, layerEffect);
  };
}
