import { Data, Effect, Option, Schema } from 'effect';
import {
  PriorityRequest,
  SpiderState,
  SpiderStateKey,
} from '../Scheduler/SpiderScheduler.service.js';

// Re-export scheduler types for consistency
export { SpiderStateKey, PriorityRequest, SpiderState };

/**
 * Delta operation that represents a single state change.
 *
 * Used for incremental persistence instead of saving the entire state
 * on every operation, which is much more efficient for large crawls.
 *
 * @group Delta Updates
 * @public
 */
export class StateDelta extends Schema.Class<StateDelta>('StateDelta')({
  /** Session this delta applies to */
  stateKey: Schema.String,
  /** Sequence number for ordering deltas */
  sequence: Schema.Number,
  /** When this delta was created */
  timestamp: Schema.Date,
  /** The operation that created this delta */
  operation: Schema.Union(
    Schema.Struct({
      type: Schema.Literal('enqueue'),
      request: PriorityRequest,
    }),
    Schema.Struct({
      type: Schema.Literal('dequeue'),
      fingerprint: Schema.String,
    }),
    Schema.Struct({
      type: Schema.Literal('mark_visited'),
      fingerprint: Schema.String,
    })
  ),
}) {}

/**
 * Represents a state change operation with both the delta and resulting state.
 *
 * This allows persistence strategies to choose whether to save deltas,
 * full state, or both depending on their optimization needs.
 *
 * @group Operations
 * @public
 */
export interface StateOperation {
  /** The incremental change */
  readonly delta: StateDelta;
  /** The complete state after applying this operation */
  readonly resultingState: SpiderState;
  /** Whether this operation should trigger a snapshot */
  readonly shouldSnapshot: boolean;
}

/**
 * Error that can occur during persistence operations.
 *
 * @group Errors
 * @public
 */
export class PersistenceError extends Data.TaggedError('PersistenceError')<{
  readonly message: string;
  readonly cause?: unknown;
  readonly operation?: string;
}> {}

/**
 * Storage backend capabilities that determine optimal persistence strategy.
 *
 * Backends advertise their capabilities so the ResumabilityService can
 * choose the best strategy automatically.
 *
 * @group Storage
 * @public
 */
export interface StorageCapabilities {
  /** Can efficiently store and retrieve delta operations */
  readonly supportsDelta: boolean;
  /** Can efficiently store full state snapshots */
  readonly supportsSnapshot: boolean;
  /** Can handle streaming/batch operations */
  readonly supportsStreaming: boolean;
  /** Can handle concurrent access safely */
  readonly supportsConcurrency: boolean;
  /** Estimated latency category */
  readonly latency: 'low' | 'medium' | 'high';
}

/**
 * Generic storage backend interface that persistence strategies use.
 *
 * Backends implement the storage operations they support best.
 * Not all methods need to be implemented - strategies will adapt.
 *
 * @group Storage
 * @public
 */
export interface StorageBackend {
  /** Backend capabilities for strategy selection */
  readonly capabilities: StorageCapabilities;

  /** Storage backend identifier */
  readonly name: string;

  /** Initialize the backend (create tables, connections, etc.) */
  initialize(): Effect.Effect<void, PersistenceError>;

  /** Cleanup backend resources */
  cleanup(): Effect.Effect<void, PersistenceError>;

  // Full state operations
  saveState?(
    key: SpiderStateKey,
    state: SpiderState
  ): Effect.Effect<void, PersistenceError>;
  loadState?(
    key: SpiderStateKey
  ): Effect.Effect<Option.Option<SpiderState>, PersistenceError>;
  deleteState?(
    key: SpiderStateKey
  ): Effect.Effect<void, PersistenceError>;

  // Delta operations
  saveDelta?(delta: StateDelta): Effect.Effect<void, PersistenceError>;
  saveDeltas?(
    deltas: readonly StateDelta[]
  ): Effect.Effect<void, PersistenceError>;
  loadDeltas?(
    key: SpiderStateKey,
    fromSequence?: number
  ): Effect.Effect<readonly StateDelta[], PersistenceError>;

  // Snapshot operations for hybrid strategies
  saveSnapshot?(
    key: SpiderStateKey,
    state: SpiderState,
    sequence: number
  ): Effect.Effect<void, PersistenceError>;
  loadLatestSnapshot?(
    key: SpiderStateKey
  ): Effect.Effect<
    Option.Option<{ state: SpiderState; sequence: number }>,
    PersistenceError
  >;

  // Cleanup operations
  compactDeltas?(
    key: SpiderStateKey,
    beforeSequence: number
  ): Effect.Effect<void, PersistenceError>;
  listSessions?(): Effect.Effect<readonly SpiderStateKey[], PersistenceError>;
}

/**
 * Core strategy interface for different persistence approaches.
 *
 * Strategies implement the logic for when and how to persist state,
 * using the storage backend for actual I/O operations.
 *
 * @group Strategies
 * @public
 */
export interface PersistenceStrategy {
  /** Persist a state operation */
  persist(
    operation: StateOperation
  ): Effect.Effect<void, PersistenceError>;

  /** Restore state from storage */
  restore(
    key: SpiderStateKey
  ): Effect.Effect<Option.Option<SpiderState>, PersistenceError>;

  /** Clean up old data */
  cleanup(key: SpiderStateKey): Effect.Effect<void, PersistenceError>;

  /** Get strategy information */
  getInfo(): {
    readonly name: string;
    readonly description: string;
    readonly capabilities: string[];
  };
}

/**
 * Configuration for hybrid persistence strategy.
 *
 * Controls when to save snapshots vs deltas for optimal performance.
 *
 * @group Configuration
 * @public
 */
export interface HybridPersistenceConfig {
  /** Save a full snapshot every N operations */
  readonly snapshotInterval: number;
  /** Maximum deltas to accumulate before forcing a snapshot */
  readonly maxDeltasBeforeSnapshot: number;
  /** Whether to compact old deltas after snapshots */
  readonly compactionEnabled: boolean;
  /** Batch multiple deltas together for efficiency */
  readonly batchDeltas: boolean;
  /** Batch size for delta operations */
  readonly deltaBatchSize: number;
}

/**
 * Default hybrid persistence configuration.
 */
export const DEFAULT_HYBRID_CONFIG: HybridPersistenceConfig = {
  snapshotInterval: 1000,
  maxDeltasBeforeSnapshot: 500,
  compactionEnabled: true,
  batchDeltas: true,
  deltaBatchSize: 10,
};
