import { Duration, Effect, Ref, Schedule } from 'effect';
import { SpiderLogger } from '../Logging/SpiderLogger.service.js';

interface WorkerStatus {
  workerId: string;
  domain: string;
  currentUrl?: string;
  lastActivity: Date;
  fetchStartTime?: Date;
}

/**
 * Monitors worker health and kills stuck workers
 */
export class WorkerHealthMonitor extends Effect.Service<WorkerHealthMonitor>()(
  '@jambudipa.io/WorkerHealthMonitor',
  {
    effect: Effect.gen(function* () {
      const logger = yield* SpiderLogger;
      const workers = yield* Ref.make(new Map<string, WorkerStatus>());
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
            const now = new Date();
            yield* Ref.update(workers, (map) => {
              const current = map.get(workerId) || {
                workerId,
                domain,
                lastActivity: now,
              };
              const updated: WorkerStatus = {
                ...current,
                domain,
                lastActivity: now,
                currentUrl: activity.url || current.currentUrl,
                fetchStartTime: activity.fetchStart
                  ? now
                  : current.fetchStartTime,
              };
              return new Map(map).set(workerId, updated);
            });
          }),

        /**
         * Remove a worker from monitoring
         */
        removeWorker: (workerId: string) =>
          Ref.update(workers, (map) => {
            const newMap = new Map(map);
            newMap.delete(workerId);
            return newMap;
          }),

        /**
         * Get stuck workers
         */
        getStuckWorkers: Effect.gen(function* () {
          const now = new Date();
          const workerMap = yield* Ref.get(workers);
          const stuck: WorkerStatus[] = [];

          for (const [, status] of workerMap) {
            const inactiveMs = now.getTime() - status.lastActivity.getTime();
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
              const now = new Date();
              const workerMap = yield* Ref.get(workers);
              const stuck: WorkerStatus[] = [];

              for (const [, status] of workerMap) {
                const inactiveMs =
                  now.getTime() - status.lastActivity.getTime();
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
                  const inactiveMs = Date.now() - worker.lastActivity.getTime();
                  yield* logger.logEdgeCase(
                    worker.domain,
                    'worker_stuck_detected',
                    {
                      workerId: worker.workerId,
                      currentUrl: worker.currentUrl,
                      lastActivity: worker.lastActivity.toISOString(),
                      inactiveMs,
                      fetchStartTime: worker.fetchStartTime?.toISOString(),
                    }
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
