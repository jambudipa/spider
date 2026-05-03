import { DateTime, Duration, Effect, HashMap, Option, Ref, Schedule } from 'effect';

interface WorkerStatus {
  workerId: string;
  domain: string;
  currentUrl?: string;
  lastActivity: DateTime.Utc;
  fetchStartTime?: DateTime.Utc;
}

/**
 * Monitors worker health and kills stuck workers
 */
export class WorkerHealthMonitor extends Effect.Service<WorkerHealthMonitor>()(
  '@jambudipa.io/WorkerHealthMonitor',
  {
    effect: Effect.gen(function* () {
      const workers = yield* Ref.make(HashMap.empty<string, WorkerStatus>());
      const stuckThresholdMs = 60000; // 1 minute without activity = stuck

      return {
        /**
         * Register a worker's activity
         */
        recordActivity: (
          workerId: string,
          domain: string,
          activity: { url?: string; fetchStart?: boolean }
        ) =>
          Effect.gen(function* () {
            const now = DateTime.unsafeNow();
            yield* Ref.update(workers, (map) => {
              const current = HashMap.get(map, workerId).pipe(
                (opt) =>
                  opt._tag === 'Some'
                    ? opt.value
                    : {
                        workerId,
                        domain,
                        lastActivity: now,
                      }
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
         * Remove a worker from monitoring
         */
        removeWorker: (workerId: string) =>
          Ref.update(workers, (map) => HashMap.remove(map, workerId)),

        /**
         * Get stuck workers
         */
        getStuckWorkers: Effect.gen(function* () {
          const now = DateTime.unsafeNow();
          const workerMap = yield* Ref.get(workers);
          const stuck: WorkerStatus[] = [];

          for (const [, status] of workerMap) {
            const inactiveMs = DateTime.toEpochMillis(now) - DateTime.toEpochMillis(status.lastActivity);
            if (inactiveMs > stuckThresholdMs) {
              stuck.push(status);
            }
          }

          return stuck;
        }),

        /**
         * Monitor workers and log stuck ones
         */
        startMonitoring: Effect.gen(function* () {
          const self = {
            getStuckWorkers: Effect.gen(function* () {
              const now = DateTime.unsafeNow();
              const workerMap = yield* Ref.get(workers);
              const stuck: WorkerStatus[] = [];

              for (const [, status] of workerMap) {
                const inactiveMs =
                  DateTime.toEpochMillis(now) - DateTime.toEpochMillis(status.lastActivity);
                if (inactiveMs > stuckThresholdMs) {
                  stuck.push(status);
                }
              }

              return stuck;
            }),
          };

          yield* Effect.repeat(
            Effect.gen(function* () {
              const stuck = yield* self.getStuckWorkers;

              if (stuck.length > 0) {
                for (const worker of stuck) {
                  const nowMillis = DateTime.toEpochMillis(DateTime.unsafeNow());
                  const inactiveMs = nowMillis - DateTime.toEpochMillis(worker.lastActivity);
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
              }
            }),
            Schedule.fixed(Duration.seconds(30))
          );
        }),
      };
    }),
  }
) {}
