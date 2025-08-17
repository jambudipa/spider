import { Effect, Schema } from 'effect';
import {
  SpiderState,
  SpiderStateKey,
} from '../../Scheduler/SpiderScheduler.service.js';
import {
  PersistenceError,
  StateDelta,
  StorageBackend,
  StorageCapabilities,
} from '../types.js';

/**
 * Redis client interface for dependency injection.
 *
 * This allows users to provide their own Redis client implementation
 * (node_redis, ioredis, etc.) without tight coupling.
 *
 * @group Backends
 * @public
 */
export interface RedisClientInterface {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrangebyscore(
    key: string,
    min: number | string,
    max: number | string
  ): Promise<string[]>;
  zrem(key: string, member: string): Promise<void>;
  zremrangebyscore(
    key: string,
    min: number | string,
    max: number | string
  ): Promise<void>;
  keys(pattern: string): Promise<string[]>;
  pipeline?(): RedisPipeline;
  multi?(): RedisMulti;
}

/**
 * Redis pipeline interface for batch operations.
 */
export interface RedisPipeline {
  zadd(key: string, score: number, member: string): RedisPipeline;
  exec(): Promise<any[]>;
}

/**
 * Redis multi/transaction interface.
 */
export interface RedisMulti {
  zadd(key: string, score: number, member: string): RedisMulti;
  exec(): Promise<any[]>;
}

/**
 * Redis storage backend for spider state persistence.
 *
 * Uses Redis data structures for efficient storage:
 * - Hashes for full state and snapshots
 * - Sorted sets for deltas (ordered by sequence number)
 * - TTL support for automatic cleanup
 *
 * Redis key structure:
 * ```
 * spider:state:{sessionId}           # Hash: full state
 * spider:snapshot:{sessionId}        # Hash: latest snapshot + sequence
 * spider:deltas:{sessionId}          # Sorted set: sequence -> delta JSON
 * spider:sessions                    # Set: all session IDs
 * ```
 *
 * @group Backends
 * @public
 */
export class RedisStorageBackend implements StorageBackend {
  readonly capabilities: StorageCapabilities = {
    supportsDelta: true,
    supportsSnapshot: true,
    supportsStreaming: true,
    supportsConcurrency: true,
    latency: 'low',
  };

  readonly name = 'RedisStorageBackend';

  constructor(
    private readonly redis: RedisClientInterface,
    private readonly keyPrefix = 'spider'
  ) {}

  initialize = (): Effect.Effect<void, PersistenceError> =>
    Effect.succeed(undefined); // Redis doesn't need initialization

  cleanup = (): Effect.Effect<void, PersistenceError> =>
    Effect.succeed(undefined); // Redis client cleanup is handled externally

  // Full state operations
  saveState = (
    key: SpiderStateKey,
    state: SpiderState
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const encoded = yield* Effect.try({
        try: () => Schema.encodeSync(SpiderState)(state),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to encode state: ${error}`,
            cause: error,
            operation: 'saveState',
          }),
      });
      const serialized = JSON.stringify(encoded);
      const stateKey = self.getStateKey(key);

      yield* Effect.tryPromise({
        try: () => self.redis.set(stateKey, serialized),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to save state to Redis: ${error}`,
            cause: error,
            operation: 'saveState',
          }),
      });
      yield* self.addToSessionsList(key);
    });
  };

  loadState = (
    key: SpiderStateKey
  ): Effect.Effect<SpiderState | null, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const stateKey = self.getStateKey(key);
      const serialized = yield* Effect.tryPromise({
        try: () => self.redis.get(stateKey),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to load state from Redis: ${error}`,
            cause: error,
            operation: 'loadState',
          }),
      });

      if (!serialized) {
        return null;
      }

      const parsed = yield* Effect.try({
        try: () => JSON.parse(serialized),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to parse state JSON: ${error}`,
            cause: error,
            operation: 'loadState',
          }),
      });

      const decoded = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(SpiderState)(parsed),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to decode state: ${error}`,
            cause: error,
            operation: 'loadState',
          }),
      });

      return decoded;
    });
  };

  deleteState = (
    key: SpiderStateKey
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const stateKey = self.getStateKey(key);
      const snapshotKey = self.getSnapshotKey(key);
      const deltasKey = self.getDeltasKey(key);

      yield* Effect.tryPromise({
        try: () => self.redis.del(stateKey),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to delete state from Redis: ${error}`,
            cause: error,
            operation: 'deleteState',
          }),
      });
      yield* Effect.tryPromise({
        try: () => self.redis.del(snapshotKey),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to delete snapshot from Redis: ${error}`,
            cause: error,
            operation: 'deleteState',
          }),
      });
      yield* Effect.tryPromise({
        try: () => self.redis.del(deltasKey),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to delete deltas from Redis: ${error}`,
            cause: error,
            operation: 'deleteState',
          }),
      });
      yield* self.removeFromSessionsList(key);
    });
  };

  // Delta operations
  saveDelta = (delta: StateDelta): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const encoded = yield* Effect.try({
        try: () => Schema.encodeSync(StateDelta)(delta),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to encode delta: ${error}`,
            cause: error,
            operation: 'saveDelta',
          }),
      });
      const serialized = JSON.stringify(encoded);
      const deltasKey = `${self.keyPrefix}:deltas:${delta.stateKey}`;

      yield* Effect.tryPromise({
        try: () => self.redis.zadd(deltasKey, delta.sequence, serialized),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to save delta to Redis: ${error}`,
            cause: error,
            operation: 'saveDelta',
          }),
      });

      // Create a SpiderStateKey from the stateKey string for addToSessionsList
      const stateKey = { id: delta.stateKey } as SpiderStateKey;
      yield* self.addToSessionsList(stateKey);
    });
  };

  saveDeltas = (
    deltas: StateDelta[]
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (deltas.length === 0) return;

      // Group deltas by session key
      const deltasBySession = new Map<string, StateDelta[]>();
      for (const delta of deltas) {
        const sessionId = delta.stateKey; // stateKey is already a string
        if (!deltasBySession.has(sessionId)) {
          deltasBySession.set(sessionId, []);
        }
        deltasBySession.get(sessionId)!.push(delta);
      }

      // Use pipeline for batch operations if available
      if (self.redis.pipeline) {
        const pipeline = self.redis.pipeline();

        for (const [sessionId, sessionDeltas] of deltasBySession) {
          const deltasKey = `${self.keyPrefix}:deltas:${sessionId}`;
          for (const delta of sessionDeltas) {
            const encoded = yield* Effect.try({
              try: () => Schema.encodeSync(StateDelta)(delta),
              catch: (error) =>
                new PersistenceError({
                  message: `Failed to encode delta: ${error}`,
                  cause: error,
                  operation: 'saveDeltas',
                }),
            });
            const serialized = JSON.stringify(encoded);
            pipeline.zadd(deltasKey, delta.sequence, serialized);
          }
        }

        yield* Effect.tryPromise({
          try: () => pipeline.exec(),
          catch: (error) =>
            new PersistenceError({
              message: `Failed to execute pipeline for deltas: ${error}`,
              cause: error,
              operation: 'saveDeltas',
            }),
        });
      } else {
        // Fall back to individual operations
        for (const delta of deltas) {
          yield* self.saveDelta(delta);
        }
      }

      // Add sessions to list
      for (const [sessionId, _] of deltasBySession) {
        const stateKey = { id: sessionId } as SpiderStateKey;
        yield* self.addToSessionsList(stateKey);
      }
    });
  };

  loadDeltas = (
    key: SpiderStateKey,
    fromSequence = 0
  ): Effect.Effect<StateDelta[], PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const deltasKey = self.getDeltasKey(key);
      const serializedDeltas = yield* Effect.tryPromise({
        try: () => self.redis.zrangebyscore(deltasKey, fromSequence, '+inf'),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to load deltas from Redis: ${error}`,
            cause: error,
            operation: 'loadDeltas',
          }),
      });

      const deltas: StateDelta[] = [];
      for (const serialized of serializedDeltas) {
        const parsed = yield* Effect.try({
          try: () => JSON.parse(serialized),
          catch: (error) =>
            new PersistenceError({
              message: `Failed to parse delta JSON: ${error}`,
              cause: error,
              operation: 'loadDeltas',
            }),
        });

        const decoded = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(StateDelta)(parsed),
          catch: (error) =>
            new PersistenceError({
              message: `Failed to decode delta: ${error}`,
              cause: error,
              operation: 'loadDeltas',
            }),
        });

        deltas.push(decoded);
      }

      return deltas.sort((a, b) => a.sequence - b.sequence);
    });
  };

  // Snapshot operations
  saveSnapshot = (
    key: SpiderStateKey,
    state: SpiderState,
    sequence: number
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const encoded = yield* Effect.try({
        try: () => Schema.encodeSync(SpiderState)(state),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to encode state: ${error}`,
            cause: error,
            operation: 'saveSnapshot',
          }),
      });

      const snapshotData = {
        state: encoded,
        sequence,
        timestamp: new Date().toISOString(),
      };
      const serialized = JSON.stringify(snapshotData);
      const snapshotKey = self.getSnapshotKey(key);

      yield* Effect.tryPromise({
        try: () => self.redis.set(snapshotKey, serialized),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to save snapshot to Redis: ${error}`,
            cause: error,
            operation: 'saveSnapshot',
          }),
      });

      yield* self.addToSessionsList(key);
    });
  };

  loadLatestSnapshot = (
    key: SpiderStateKey
  ): Effect.Effect<
    { state: SpiderState; sequence: number } | null,
    PersistenceError
  > => {
    const self = this;
    return Effect.gen(function* () {
      const snapshotKey = self.getSnapshotKey(key);
      const serialized = yield* Effect.tryPromise({
        try: () => self.redis.get(snapshotKey),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to load snapshot from Redis: ${error}`,
            cause: error,
            operation: 'loadLatestSnapshot',
          }),
      });

      if (!serialized) {
        return null;
      }

      const parsed = yield* Effect.try({
        try: () => JSON.parse(serialized),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to parse snapshot JSON: ${error}`,
            cause: error,
            operation: 'loadLatestSnapshot',
          }),
      });

      const state = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(SpiderState)(parsed.state),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to decode snapshot state: ${error}`,
            cause: error,
            operation: 'loadLatestSnapshot',
          }),
      });

      return {
        state,
        sequence: parsed.sequence,
      };
    });
  };

  // Cleanup operations
  compactDeltas = (
    key: SpiderStateKey,
    beforeSequence: number
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const deltasKey = self.getDeltasKey(key);
      yield* Effect.tryPromise({
        try: () =>
          self.redis.zremrangebyscore(deltasKey, '-inf', beforeSequence - 1),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to compact deltas in Redis: ${error}`,
            cause: error,
            operation: 'compactDeltas',
          }),
      });
    });
  };

  listSessions = (): Effect.Effect<SpiderStateKey[], PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const pattern = `${self.keyPrefix}:state:*`;
      const keys = yield* Effect.tryPromise({
        try: () => self.redis.keys(pattern),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to list session keys from Redis: ${error}`,
            cause: error,
            operation: 'listSessions',
          }),
      });

      const sessions: SpiderStateKey[] = [];
      for (const key of keys) {
        const serialized = yield* Effect.tryPromise({
          try: () => self.redis.get(key),
          catch: (error) =>
            new PersistenceError({
              message: `Failed to get session data from Redis: ${error}`,
              cause: error,
              operation: 'listSessions',
            }),
        });

        if (serialized) {
          try {
            const parsed = JSON.parse(serialized);
            const state = Schema.decodeUnknownSync(SpiderState)(parsed);
            sessions.push(state.key);
          } catch {
            // Skip invalid sessions
            continue;
          }
        }
      }

      return sessions;
    });
  };

  // Private helper methods
  private getStateKey = (key: SpiderStateKey): string =>
    `${this.keyPrefix}:state:${key.id}`;

  private getSnapshotKey = (key: SpiderStateKey): string =>
    `${this.keyPrefix}:snapshot:${key.id}`;

  private getDeltasKey = (key: SpiderStateKey): string =>
    `${this.keyPrefix}:deltas:${key.id}`;

  private getSessionsKey = (): string => `${this.keyPrefix}:sessions`;

  private addToSessionsList = (
    key: SpiderStateKey
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const sessionsKey = self.getSessionsKey();
      yield* Effect.tryPromise({
        try: () => self.redis.zadd(sessionsKey, Date.now(), key.id),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to add session to list: ${error}`,
            cause: error,
            operation: 'addToSessionsList',
          }),
      });
    });
  };

  private removeFromSessionsList = (
    key: SpiderStateKey
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const sessionsKey = self.getSessionsKey();
      yield* Effect.tryPromise({
        try: () => self.redis.zrem(sessionsKey, key.id),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to remove session from list: ${error}`,
            cause: error,
            operation: 'removeFromSessionsList',
          }),
      });
    });
  };
}
