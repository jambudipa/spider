import { Effect } from 'effect';
import {
  SpiderState,
  SpiderStateKey,
} from '../Scheduler/SpiderScheduler.service.js';
import {
  DEFAULT_HYBRID_CONFIG,
  HybridPersistenceConfig,
  PersistenceError,
  PersistenceStrategy,
  StateOperation,
  StorageBackend,
} from './types.js';

/**
 * Full state persistence strategy.
 *
 * Saves the complete spider state on every operation. Simple and reliable,
 * but can be inefficient for large crawls with many URLs.
 *
 * @group Strategies
 * @public
 */
export class FullStatePersistence implements PersistenceStrategy {
  constructor(private readonly backend: StorageBackend) {}

  persist = (
    operation: StateOperation
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (!self.backend.saveState) {
        return yield* Effect.fail(
          new PersistenceError({
            message: `Backend ${self.backend.name} does not support full state persistence`,
            operation: 'persist',
          })
        );
      }

      yield* self.backend.saveState(
        operation.resultingState.key,
        operation.resultingState
      );
    });
  };

  restore = (
    key: SpiderStateKey
  ): Effect.Effect<SpiderState | null, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (!self.backend.loadState) {
        return yield* Effect.fail(
          new PersistenceError({
            message: `Backend ${self.backend.name} does not support state loading`,
            operation: 'restore',
          })
        );
      }

      return yield* self.backend.loadState(key);
    });
  };

  cleanup = (key: SpiderStateKey): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (!self.backend.deleteState) {
        return yield* Effect.fail(
          new PersistenceError({
            message: `Backend ${self.backend.name} does not support state deletion`,
            operation: 'cleanup',
          })
        );
      }

      yield* self.backend.deleteState(key);
    });
  };

  getInfo = () => ({
    name: 'FullStatePersistence',
    description:
      'Saves complete state on every operation. Simple but potentially inefficient for large crawls.',
    capabilities: ['full-state-save', 'full-state-restore', 'simple-cleanup'],
  });
}

/**
 * Delta persistence strategy.
 *
 * Saves only incremental changes (deltas) instead of the full state.
 * Much more efficient for large crawls, but requires delta replay for restoration.
 *
 * @group Strategies
 * @public
 */
export class DeltaPersistence implements PersistenceStrategy {
  constructor(private readonly backend: StorageBackend) {}

  persist = (
    operation: StateOperation
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (!self.backend.saveDelta) {
        return yield* Effect.fail(
          new PersistenceError({
            message: `Backend ${self.backend.name} does not support delta persistence`,
            operation: 'persist',
          })
        );
      }

      yield* self.backend.saveDelta(operation.delta);
    });
  };

  restore = (
    key: SpiderStateKey
  ): Effect.Effect<SpiderState | null, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (!self.backend.loadDeltas) {
        return yield* Effect.fail(
          new PersistenceError({
            message: `Backend ${self.backend.name} does not support delta loading`,
            operation: 'restore',
          })
        );
      }

      const deltas = yield* self.backend.loadDeltas(key);
      if (deltas.length === 0) {
        return null;
      }

      // Reconstruct state by replaying deltas in sequence order
      return yield* self.reconstructStateFromDeltas(key, deltas);
    });
  };

  cleanup = (key: SpiderStateKey): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (!self.backend.loadDeltas || !self.backend.compactDeltas) {
        return yield* Effect.fail(
          new PersistenceError({
            message: `Backend ${self.backend.name} does not support delta cleanup`,
            operation: 'cleanup',
          })
        );
      }

      // Remove all deltas for this session
      const deltas = yield* self.backend.loadDeltas(key);
      if (deltas.length > 0) {
        const maxSequence = Math.max(...deltas.map((d) => d.sequence));
        yield* self.backend.compactDeltas(key, maxSequence + 1);
      }
    });
  };

  reconstructStateFromDeltas = (
    key: SpiderStateKey,
    deltas: ReadonlyArray<import('./types.js').StateDelta>
  ): Effect.Effect<SpiderState, PersistenceError> =>
    Effect.gen(function* () {
      // Sort deltas by sequence number to ensure correct order
      const sortedDeltas = [...deltas].sort((a, b) => a.sequence - b.sequence);

      // Start with empty state
      const pendingRequests: import('../Scheduler/SpiderScheduler.service.js').PriorityRequest[] =
        [];
      const visitedFingerprints: string[] = [];
      let totalProcessed = 0;

      // Replay each delta
      for (const delta of sortedDeltas) {
        switch (delta.operation.type) {
          case 'enqueue':
            pendingRequests.push(delta.operation.request);
            break;

          case 'dequeue': {
            const operation = delta.operation;
            if (operation.type === 'dequeue') {
              const dequeueIndex = pendingRequests.findIndex(
                (req) => req.fingerprint === operation.fingerprint
              );
              if (dequeueIndex >= 0) {
                pendingRequests.splice(dequeueIndex, 1);
                totalProcessed++;
              }
            }
            break;
          }

          case 'mark_visited': {
            const operation = delta.operation;
            if (operation.type === 'mark_visited') {
              if (!visitedFingerprints.includes(operation.fingerprint)) {
                visitedFingerprints.push(operation.fingerprint);
              }
            }
            break;
          }
        }
      }

      return yield* Effect.tryPromise({
        try: async () => {
          const { SpiderState } = await import(
            '../Scheduler/SpiderScheduler.service.js'
          );
          return new SpiderState({
            key,
            pendingRequests,
            visitedFingerprints,
            totalProcessed,
          });
        },
        catch: (error) =>
          new PersistenceError({
            message: 'Failed to import SpiderState',
            cause: error,
            operation: 'reconstructStateFromDeltas',
          }),
      });
    });

  getInfo = () => ({
    name: 'DeltaPersistence',
    description:
      'Saves only incremental changes. Efficient for large crawls but requires delta replay.',
    capabilities: ['delta-save', 'delta-restore', 'state-reconstruction'],
  });
}

/**
 * Hybrid persistence strategy.
 *
 * Combines delta and full state approaches for optimal performance.
 * Saves deltas for efficiency, with periodic snapshots for fast recovery.
 *
 * @group Strategies
 * @public
 */
export class HybridPersistence implements PersistenceStrategy {
  private operationCount = 0;
  private lastSnapshotSequence = 0;
  private pendingDeltas: import('./types.js').StateDelta[] = [];

  constructor(
    private readonly backend: StorageBackend,
    private readonly config: HybridPersistenceConfig = DEFAULT_HYBRID_CONFIG
  ) {}

  persist = (
    operation: StateOperation
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      self.operationCount++;

      // Add to pending deltas if batching is enabled
      if (self.config.batchDeltas) {
        self.pendingDeltas.push(operation.delta);
      }

      // Check if we should take a snapshot
      const shouldSnapshot =
        operation.shouldSnapshot ||
        self.operationCount % self.config.snapshotInterval === 0 ||
        self.operationCount - self.lastSnapshotSequence >=
          self.config.maxDeltasBeforeSnapshot;

      if (shouldSnapshot) {
        yield* self.saveSnapshot(operation);
      } else {
        yield* self.saveDelta(operation);
      }

      // Flush pending deltas if batch is full
      if (
        self.config.batchDeltas &&
        self.pendingDeltas.length >= self.config.deltaBatchSize
      ) {
        yield* self.flushPendingDeltas();
      }
    });
  };

  private saveSnapshot = (
    operation: StateOperation
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (!self.backend.saveSnapshot) {
        return yield* Effect.fail(
          new PersistenceError({
            message: `Backend ${self.backend.name} does not support snapshots`,
            operation: 'saveSnapshot',
          })
        );
      }

      // Save snapshot
      yield* self.backend.saveSnapshot(
        operation.resultingState.key,
        operation.resultingState,
        operation.delta.sequence
      );

      self.lastSnapshotSequence = operation.delta.sequence;

      // Compact old deltas if enabled
      if (self.config.compactionEnabled && self.backend.compactDeltas) {
        yield* self.backend.compactDeltas(
          operation.resultingState.key,
          operation.delta.sequence
        );
      }

      // Clear pending deltas since we just took a snapshot
      self.pendingDeltas = [];
    });
  };

  private saveDelta = (
    operation: StateOperation
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (!self.config.batchDeltas) {
        // Save immediately if not batching
        if (!self.backend.saveDelta) {
          return yield* Effect.fail(
            new PersistenceError({
              message: `Backend ${self.backend.name} does not support delta persistence`,
              operation: 'saveDelta',
            })
          );
        }
        yield* self.backend.saveDelta(operation.delta);
      }
      // If batching, delta is already added to pendingDeltas
    });
  };

  private flushPendingDeltas = (): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (self.pendingDeltas.length === 0) return;

      if (self.backend.saveDeltas) {
        // Use batch save if available
        yield* self.backend.saveDeltas([...self.pendingDeltas]);
      } else if (self.backend.saveDelta) {
        // Fall back to individual saves
        for (const delta of self.pendingDeltas) {
          yield* self.backend.saveDelta(delta);
        }
      } else {
        return yield* Effect.fail(
          new PersistenceError({
            message: `Backend ${self.backend.name} does not support delta persistence`,
            operation: 'flushPendingDeltas',
          })
        );
      }

      self.pendingDeltas = [];
    });
  };

  restore = (
    key: SpiderStateKey
  ): Effect.Effect<SpiderState | null, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      // Try to load latest snapshot first
      let baseState: SpiderState | null = null;
      let fromSequence = 0;

      if (self.backend.loadLatestSnapshot) {
        const snapshot = yield* self.backend.loadLatestSnapshot(key);
        if (snapshot) {
          baseState = snapshot.state;
          fromSequence = snapshot.sequence + 1;
        }
      }

      // Load deltas since snapshot (or all deltas if no snapshot)
      if (!self.backend.loadDeltas) {
        if (baseState) {
          return baseState; // Return snapshot if no delta support
        }
        return yield* Effect.fail(
          new PersistenceError({
            message: `Backend ${self.backend.name} does not support delta loading`,
            operation: 'restore',
          })
        );
      }

      const deltas = yield* self.backend.loadDeltas(key, fromSequence);

      if (!baseState && deltas.length === 0) {
        return null; // No state found
      }

      if (deltas.length === 0) {
        return baseState; // No deltas to apply
      }

      // Apply deltas to base state (or reconstruct from scratch if no base)
      return yield* self.applyDeltasToState(key, baseState, deltas);
    });
  };

  private applyDeltasToState = (
    key: SpiderStateKey,
    baseState: SpiderState | null,
    deltas: ReadonlyArray<import('./types.js').StateDelta>
  ): Effect.Effect<SpiderState, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      // Use delta strategy to reconstruct if no base state
      if (!baseState) {
        const deltaStrategy = new DeltaPersistence(self.backend);
        return yield* deltaStrategy.reconstructStateFromDeltas(key, deltas);
      }

      // Apply deltas to base state
      const sortedDeltas = [...deltas].sort((a, b) => a.sequence - b.sequence);

      const pendingRequests = [...baseState.pendingRequests];
      const visitedFingerprints = [...baseState.visitedFingerprints];
      let totalProcessed = baseState.totalProcessed;

      for (const delta of sortedDeltas) {
        switch (delta.operation.type) {
          case 'enqueue':
            pendingRequests.push(delta.operation.request);
            break;

          case 'dequeue': {
            const operation = delta.operation;
            if (operation.type === 'dequeue') {
              const dequeueIndex = pendingRequests.findIndex(
                (req) => req.fingerprint === operation.fingerprint
              );
              if (dequeueIndex >= 0) {
                pendingRequests.splice(dequeueIndex, 1);
                totalProcessed++;
              }
            }
            break;
          }

          case 'mark_visited': {
            const operation = delta.operation;
            if (operation.type === 'mark_visited') {
              if (!visitedFingerprints.includes(operation.fingerprint)) {
                visitedFingerprints.push(operation.fingerprint);
              }
            }
            break;
          }
        }
      }

      return yield* Effect.tryPromise({
        try: async () => {
          const { SpiderState } = await import(
            '../Scheduler/SpiderScheduler.service.js'
          );
          return new SpiderState({
            key,
            pendingRequests,
            visitedFingerprints,
            totalProcessed,
          });
        },
        catch: (error) =>
          new PersistenceError({
            message: 'Failed to import SpiderState',
            cause: error,
            operation: 'applyDeltasToState',
          }),
      });
    });
  };

  cleanup = (key: SpiderStateKey): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      // Flush any pending deltas first
      yield* self.flushPendingDeltas();

      // Clean up snapshots and deltas
      if (self.backend.deleteState) {
        yield* self.backend.deleteState(key);
      }

      if (self.backend.compactDeltas) {
        yield* self.backend.compactDeltas(key, Number.MAX_SAFE_INTEGER);
      }
    });
  };

  getInfo = () => ({
    name: 'HybridPersistence',
    description:
      'Combines deltas and snapshots for optimal performance and recovery speed.',
    capabilities: [
      'delta-save',
      'snapshot-save',
      'batch-deltas',
      'fast-recovery',
      'automatic-compaction',
    ],
  });
}
