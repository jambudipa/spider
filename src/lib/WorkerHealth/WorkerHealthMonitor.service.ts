import {
  Context,
  DateTime,
  Duration,
  Effect,
  HashMap,
  Layer,
  Option,
  Ref,
  Schedule,
} from 'effect';
import { SPIDER_DEFAULTS } from '../Spider/Spider.defaults.js';
import { ConfigError } from '../errors/effect-errors.js';

interface WorkerStatus {
  workerId: string;
  domain: string;
  currentUrl?: string;
  lastActivity: DateTime.Utc;
  fetchStartTime?: DateTime.Utc;
}

interface WorkerHealthMonitorService {
  readonly recordActivity: (
    workerId: string,
    domain: string,
    activity: { url?: string; fetchStart?: boolean }
  ) => Effect.Effect<void>;
  readonly removeWorker: (workerId: string) => Effect.Effect<void>;
  readonly getStuckWorkers: Effect.Effect<WorkerStatus[]>;
  readonly startMonitoring: Effect.Effect<void>;
}

const makeWorkerHealthMonitor = (stuckThresholdMs: number) =>
  Effect.gen(function* () {
    const workers = yield* Ref.make(HashMap.empty<string, WorkerStatus>());

    const collectStuck = Effect.gen(function* () {
      const now = DateTime.nowUnsafe();
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
          const now = DateTime.nowUnsafe();
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
            const nowMillis = DateTime.toEpochMillis(DateTime.nowUnsafe());
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
                fetchStartTime: Option.fromNullishOr(worker.fetchStartTime).pipe(
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
export class WorkerHealthMonitor extends Context.Service<
  WorkerHealthMonitor,
  WorkerHealthMonitorService
>()(
  '@jambudipa.io/WorkerHealthMonitor',
  {
    make: makeWorkerHealthMonitor(SPIDER_DEFAULTS.STALE_WORKER_THRESHOLD_MS),
  }
) {
  static readonly layer = Layer.effect(
    WorkerHealthMonitor,
    WorkerHealthMonitor.make
  );

  /**
   * Build a `WorkerHealthMonitor` layer with a custom stuck-worker
   * threshold in milliseconds. Useful when the consumer needs a stricter
   * or looser detection cadence than the default 300 s without forking
   * the service.
   *
   * Fails during layer construction when `stuckThresholdMs` is not a
   * positive integer within the documented bounds (1..2_147_483_647).
   */
  static WithThreshold = (stuckThresholdMs: number) =>
    Layer.effect(
      WorkerHealthMonitor,
      Effect.gen(function* () {
        if (
          typeof stuckThresholdMs !== 'number' ||
          !Number.isInteger(stuckThresholdMs) ||
          stuckThresholdMs < 1 ||
          stuckThresholdMs > 2_147_483_647
        ) {
          return yield* new ConfigError({
            field: 'WorkerHealthMonitor.WithThreshold.stuckThresholdMs',
            value: stuckThresholdMs,
            reason:
              'must be a positive integer between 1 and 2_147_483_647 (milliseconds)',
          });
        }
        return yield* makeWorkerHealthMonitor(stuckThresholdMs);
      })
    );
}
