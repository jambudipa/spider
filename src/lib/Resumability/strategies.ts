import { Chunk, Effect, Option } from 'effect';
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
  /** Uses this backend for every complete-state write and read. */
  constructor(private readonly backend: StorageBackend) {}

  /** Saves the complete resulting state for each scheduler operation. */
  persist = (
    operation: StateOperation
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (!self.backend.saveState) {
        return yield* new PersistenceError({
          message: `Backend ${self.backend.name} does not support full state persistence`,
          operation: 'persist',
        });
      }

      yield* self.backend.saveState(
        operation.resultingState.key,
        operation.resultingState
      );
    });
  };

  /** Restores a saved complete state, or none when the backend has no state. */
  restore = (
    key: SpiderStateKey
  ): Effect.Effect<Option.Option<SpiderState>, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (!self.backend.loadState) {
        return yield* new PersistenceError({
          message: `Backend ${self.backend.name} does not support state loading`,
          operation: 'restore',
        });
      }

      return yield* self.backend.loadState(key);
    });
  };

  /** Deletes the complete state that belongs to the selected session. */
  cleanup = (key: SpiderStateKey): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (!self.backend.deleteState) {
        return yield* new PersistenceError({
          message: `Backend ${self.backend.name} does not support state deletion`,
          operation: 'cleanup',
        });
      }

      yield* self.backend.deleteState(key);
    });
  };

  /** Describes the capacity and trade-off of full-state persistence. */
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
  /** Uses this backend for ordered delta storage and replay. */
  constructor(private readonly backend: StorageBackend) {}

  /** Saves only the incremental delta from one scheduler operation. */
  persist = (
    operation: StateOperation
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (!self.backend.saveDelta) {
        return yield* new PersistenceError({
          message: `Backend ${self.backend.name} does not support delta persistence`,
          operation: 'persist',
        });
      }

      yield* self.backend.saveDelta(operation.delta);
    });
  };

  /** Rebuilds a state by loading and replaying its ordered deltas. */
  restore = (
    key: SpiderStateKey
  ): Effect.Effect<Option.Option<SpiderState>, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (!self.backend.loadDeltas) {
        return yield* new PersistenceError({
          message: `Backend ${self.backend.name} does not support delta loading`,
          operation: 'restore',
        });
      }

      const deltas = yield* self.backend.loadDeltas(key);
      if (deltas.length === 0) {
        return Option.none<SpiderState>();
      }

      // Reconstruct state by replaying deltas in sequence order
      const state = yield* self.reconstructStateFromDeltas(key, deltas);
      return Option.some(state);
    });
  };

  /** Removes all session deltas by compacting past their highest sequence. */
  cleanup = (key: SpiderStateKey): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (!self.backend.loadDeltas || !self.backend.compactDeltas) {
        return yield* new PersistenceError({
          message: `Backend ${self.backend.name} does not support delta cleanup`,
          operation: 'cleanup',
        });
      }

      // Remove all deltas for this session
      const deltas = yield* self.backend.loadDeltas(key);
      if (deltas.length > 0) {
        const maxSequence = Math.max(...deltas.map((d) => d.sequence));
        yield* self.backend.compactDeltas(key, maxSequence + 1);
      }
    });
  };

  /** Replays deltas in sequence order to rebuild a state from no base snapshot. */
  reconstructStateFromDeltas = (
    key: SpiderStateKey,
    deltas: ReadonlyArray<import('./types.js').StateDelta>
  ): Effect.Effect<SpiderState, PersistenceError> =>
    Effect.sync(() => {
      // Sort deltas by sequence number to ensure correct order
      const sortedDeltas = [...deltas].sort((a, b) => a.sequence - b.sequence);

      // Start with empty state using Chunk for immutable operations
      let pendingRequests: Chunk.Chunk<import('../Scheduler/SpiderScheduler.service.js').PriorityRequest> =
        Chunk.empty();
      let visitedFingerprints: Chunk.Chunk<string> = Chunk.empty();
      let totalProcessed = 0;

      // Replay each delta
      for (const delta of sortedDeltas) {
        switch (delta.operation.type) {
          case 'enqueue':
            pendingRequests = Chunk.append(
              pendingRequests,
              delta.operation.request
            );
            break;

          case 'dequeue': {
            const operation = delta.operation;
            if (operation.type === 'dequeue') {
              const pendingArray = Chunk.toReadonlyArray(pendingRequests);
              const dequeueIndex = pendingArray.findIndex(
                (req) => req.fingerprint === operation.fingerprint
              );
              if (dequeueIndex >= 0) {
                pendingRequests = Chunk.fromIterable(
                  pendingArray.filter((_, idx) => idx !== dequeueIndex)
                );
                totalProcessed++;
              }
            }
            break;
          }

          case 'mark_visited': {
            const operation = delta.operation;
            if (operation.type === 'mark_visited') {
              const visitedArray = Chunk.toReadonlyArray(visitedFingerprints);
              if (!visitedArray.includes(operation.fingerprint)) {
                visitedFingerprints = Chunk.append(
                  visitedFingerprints,
                  operation.fingerprint
                );
              }
            }
            break;
          }
        }
      }

      return new SpiderState({
        key,
        pendingRequests: [...Chunk.toReadonlyArray(pendingRequests)],
        visitedFingerprints: [...Chunk.toReadonlyArray(visitedFingerprints)],
        totalProcessed,
      });
    });

  /** Describes the capacity and replay cost of delta persistence. */
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
  /** Counts operations since this strategy instance began. */
  private operationCount = 0;
  /** Records the sequence included in the most recent saved snapshot. */
  private lastSnapshotSequence = 0;
  /** Holds deltas that await a batch write or snapshot. */
  private pendingDeltas: import('./types.js').StateDelta[] = [];

  /** Combines this backend with snapshot and delta batching policy. */
  constructor(
    private readonly backend: StorageBackend,
    private readonly config: HybridPersistenceConfig = DEFAULT_HYBRID_CONFIG
  ) {}

  /** Saves a delta or snapshot and flushes full delta batches when required. */
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

  /** Stores a recovery snapshot and clears deltas that it makes redundant. */
  private saveSnapshot = (
    operation: StateOperation
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (!self.backend.saveSnapshot) {
        return yield* new PersistenceError({
          message: `Backend ${self.backend.name} does not support snapshots`,
          operation: 'saveSnapshot',
        });
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

  /** Persists a delta immediately when batching is disabled. */
  private saveDelta = (
    operation: StateOperation
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (!self.config.batchDeltas) {
        // Save immediately if not batching
        if (!self.backend.saveDelta) {
          return yield* new PersistenceError({
            message: `Backend ${self.backend.name} does not support delta persistence`,
            operation: 'saveDelta',
          });
        }
        yield* self.backend.saveDelta(operation.delta);
      }
      // If batching, delta is already added to pendingDeltas
    });
  };

  /** Writes every queued delta through a batch operation or individual fallback. */
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
        return yield* new PersistenceError({
          message: `Backend ${self.backend.name} does not support delta persistence`,
          operation: 'flushPendingDeltas',
        });
      }

      self.pendingDeltas = [];
    });
  };

  /** Restores from the latest snapshot, then applies later deltas in order. */
  restore = (
    key: SpiderStateKey
  ): Effect.Effect<Option.Option<SpiderState>, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      // Try to load latest snapshot first
      let baseState: Option.Option<SpiderState> = Option.none();
      let fromSequence = 0;

      if (self.backend.loadLatestSnapshot) {
        const snapshot = yield* self.backend.loadLatestSnapshot(key);
        if (Option.isSome(snapshot)) {
          baseState = Option.some(snapshot.value.state);
          fromSequence = snapshot.value.sequence + 1;
        }
      }

      // Load deltas since snapshot (or all deltas if no snapshot)
      if (!self.backend.loadDeltas) {
        if (Option.isSome(baseState)) {
          return baseState; // Return snapshot if no delta support
        }
        return yield* new PersistenceError({
          message: `Backend ${self.backend.name} does not support delta loading`,
          operation: 'restore',
        });
      }

      const deltas = yield* self.backend.loadDeltas(key, fromSequence);

      if (Option.isNone(baseState) && deltas.length === 0) {
        return Option.none<SpiderState>(); // No state found
      }

      if (deltas.length === 0) {
        return baseState; // No deltas to apply
      }

      // Apply deltas to base state (or reconstruct from scratch if no base)
      const reconstructed = yield* self.applyDeltasToState(key, baseState, deltas);
      return Option.some(reconstructed);
    });
  };

  /** Applies ordered deltas to a snapshot, or rebuilds state when none exists. */
  private applyDeltasToState = (
    key: SpiderStateKey,
    baseState: Option.Option<SpiderState>,
    deltas: ReadonlyArray<import('./types.js').StateDelta>
  ): Effect.Effect<SpiderState, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      // Use delta strategy to reconstruct if no base state
      if (Option.isNone(baseState)) {
        const deltaStrategy = new DeltaPersistence(self.backend);
        return yield* deltaStrategy.reconstructStateFromDeltas(key, deltas);
      }

      const state = baseState.value;

      // Apply deltas to base state
      const sortedDeltas = [...deltas].sort((a, b) => a.sequence - b.sequence);

      let pendingRequests: Chunk.Chunk<import('../Scheduler/SpiderScheduler.service.js').PriorityRequest> =
        Chunk.fromIterable(state.pendingRequests);
      let visitedFingerprints: Chunk.Chunk<string> = Chunk.fromIterable(
        state.visitedFingerprints
      );
      let totalProcessed = state.totalProcessed;

      for (const delta of sortedDeltas) {
        switch (delta.operation.type) {
          case 'enqueue':
            pendingRequests = Chunk.append(
              pendingRequests,
              delta.operation.request
            );
            break;

          case 'dequeue': {
            const operation = delta.operation;
            if (operation.type === 'dequeue') {
              const pendingArray = Chunk.toReadonlyArray(pendingRequests);
              const dequeueIndex = pendingArray.findIndex(
                (req) => req.fingerprint === operation.fingerprint
              );
              if (dequeueIndex >= 0) {
                pendingRequests = Chunk.fromIterable(
                  pendingArray.filter((_, idx) => idx !== dequeueIndex)
                );
                totalProcessed++;
              }
            }
            break;
          }

          case 'mark_visited': {
            const operation = delta.operation;
            if (operation.type === 'mark_visited') {
              const visitedArray = Chunk.toReadonlyArray(visitedFingerprints);
              if (!visitedArray.includes(operation.fingerprint)) {
                visitedFingerprints = Chunk.append(
                  visitedFingerprints,
                  operation.fingerprint
                );
              }
            }
            break;
          }
        }
      }

      return new SpiderState({
        key,
        pendingRequests: [...Chunk.toReadonlyArray(pendingRequests)],
        visitedFingerprints: [...Chunk.toReadonlyArray(visitedFingerprints)],
        totalProcessed,
      });
    });
  };

  /** Flushes queued deltas, then removes the session's snapshots and deltas. */
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

  /** Describes hybrid recovery speed and batch persistence features. */
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
