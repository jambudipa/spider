import { Chunk, DateTime, Effect, HashMap, Option, Schema } from 'effect';
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
 * Schema for snapshot data stored in Redis.
 */
const SnapshotDataSchema = Schema.Struct({
  state: SpiderState,
  sequence: Schema.Number,
  timestamp: Schema.String,
});

type SnapshotData = typeof SnapshotDataSchema.Type;

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
  get(_key: string): Promise<string | null>;
  set(_key: string, _value: string): Promise<void>;
  del(_key: string): Promise<void>;
  exists(_key: string): Promise<boolean>;
  hget(_key: string, _field: string): Promise<string | null>;
  hset(_key: string, _field: string, _value: string): Promise<void>;
  hdel(_key: string, _field: string): Promise<void>;
  hgetall(_key: string): Promise<Record<string, string>>;
  zadd(_key: string, _score: number, _member: string): Promise<void>;
  zrange(_key: string, _start: number, _stop: number): Promise<string[]>;
  zrangebyscore(
    _key: string,
    _min: number | string,
    _max: number | string
  ): Promise<string[]>;
  zrem(_key: string, _member: string): Promise<void>;
  zremrangebyscore(
    _key: string,
    _min: number | string,
    _max: number | string
  ): Promise<void>;
  keys(_pattern: string): Promise<string[]>;
  pipeline?(): RedisPipeline;
  multi?(): RedisMulti;
}

/**
 * Redis pipeline interface for batch operations.
 */
export interface RedisPipeline {
  zadd(_key: string, _score: number, _member: string): RedisPipeline;
  exec(): Promise<unknown[]>;
}

/**
 * Redis multi/transaction interface.
 */
export interface RedisMulti {
  zadd(_key: string, _score: number, _member: string): RedisMulti;
  exec(): Promise<unknown[]>;
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

  private readonly redis: RedisClientInterface;
  private readonly keyPrefix: string;

  constructor(redis: RedisClientInterface, keyPrefix = 'spider') {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  initialize = (): Effect.Effect<void, PersistenceError> =>
    Effect.void; // Redis doesn't need initialization

  cleanup = (): Effect.Effect<void, PersistenceError> =>
    Effect.void; // Redis client cleanup is handled externally

  // Full state operations
  saveState = (
    key: SpiderStateKey,
    state: SpiderState
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const serialized = yield* Schema.encode(Schema.parseJson(SpiderState))(
        state
      ).pipe(
        Effect.mapError(
          (error) =>
            new PersistenceError({
              message: `Failed to encode state: ${error}`,
              cause: error,
              operation: 'saveState',
            })
        )
      );
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
  ): Effect.Effect<Option.Option<SpiderState>, PersistenceError> => {
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

      return yield* Option.fromNullable(serialized).pipe(
        Option.match({
          onNone: () => Effect.succeed(Option.none<SpiderState>()),
          onSome: (value) =>
            Schema.decode(Schema.parseJson(SpiderState))(value).pipe(
              Effect.map(Option.some),
              Effect.mapError(
                (error) =>
                  new PersistenceError({
                    message: `Failed to decode state: ${error}`,
                    cause: error,
                    operation: 'loadState',
                  })
              )
            ),
        })
      );
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
      const serialized = yield* Schema.encode(Schema.parseJson(StateDelta))(
        delta
      ).pipe(
        Effect.mapError(
          (error) =>
            new PersistenceError({
              message: `Failed to encode delta: ${error}`,
              cause: error,
              operation: 'saveDelta',
            })
        )
      );
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
      const now = yield* DateTime.now;
      const stateKey = new SpiderStateKey({
        id: delta.stateKey,
        timestamp: DateTime.toDateUtc(now),
        name: delta.stateKey,
      });
      yield* self.addToSessionsList(stateKey);
    });
  };

  saveDeltas = (
    deltas: StateDelta[]
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (deltas.length === 0) return;

      // Group deltas by session key using HashMap
      let deltasBySession = HashMap.empty<string, Chunk.Chunk<StateDelta>>();
      for (const delta of deltas) {
        const sessionId = delta.stateKey; // stateKey is already a string
        const existing = HashMap.get(deltasBySession, sessionId).pipe(
          Option.getOrElse(() => Chunk.empty<StateDelta>())
        );
        deltasBySession = HashMap.set(
          deltasBySession,
          sessionId,
          Chunk.append(existing, delta)
        );
      }

      // Use pipeline for batch operations if available
      if (self.redis.pipeline) {
        const pipeline = self.redis.pipeline();

        for (const [sessionId, sessionDeltas] of deltasBySession) {
          const deltasKey = `${self.keyPrefix}:deltas:${sessionId}`;
          for (const delta of sessionDeltas) {
            const serialized = yield* Schema.encode(
              Schema.parseJson(StateDelta)
            )(delta).pipe(
              Effect.mapError(
                (error) =>
                  new PersistenceError({
                    message: `Failed to encode delta: ${error}`,
                    cause: error,
                    operation: 'saveDeltas',
                  })
              )
            );
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
      const currentTime = yield* DateTime.now;
      for (const [sessionId] of deltasBySession) {
        const stateKey = new SpiderStateKey({
          id: sessionId,
          timestamp: DateTime.toDateUtc(currentTime),
          name: sessionId,
        });
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

      let deltas = Chunk.empty<StateDelta>();
      for (const serialized of serializedDeltas) {
        const decoded = yield* Schema.decode(Schema.parseJson(StateDelta))(
          serialized
        ).pipe(
          Effect.mapError(
            (error) =>
              new PersistenceError({
                message: `Failed to decode delta: ${error}`,
                cause: error,
                operation: 'loadDeltas',
              })
          )
        );

        deltas = Chunk.append(deltas, decoded);
      }

      return Chunk.toArray(deltas).sort((a, b) => a.sequence - b.sequence);
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
      const now = yield* DateTime.now;
      const snapshotData: SnapshotData = {
        state,
        sequence,
        timestamp: DateTime.formatIso(now),
      };
      const serialized = yield* Schema.encode(
        Schema.parseJson(SnapshotDataSchema)
      )(snapshotData).pipe(
        Effect.mapError(
          (error) =>
            new PersistenceError({
              message: `Failed to encode snapshot: ${error}`,
              cause: error,
              operation: 'saveSnapshot',
            })
        )
      );
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
    Option.Option<{ state: SpiderState; sequence: number }>,
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

      return yield* Option.fromNullable(serialized).pipe(
        Option.match({
          onNone: () =>
            Effect.succeed(
              Option.none<{ state: SpiderState; sequence: number }>()
            ),
          onSome: (value) =>
            Schema.decode(Schema.parseJson(SnapshotDataSchema))(value).pipe(
              Effect.map((snapshotData) =>
                Option.some({
                  state: snapshotData.state,
                  sequence: snapshotData.sequence,
                })
              ),
              Effect.mapError(
                (error) =>
                  new PersistenceError({
                    message: `Failed to decode snapshot: ${error}`,
                    cause: error,
                    operation: 'loadLatestSnapshot',
                  })
              )
            ),
        })
      );
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
      const redisKeys = yield* Effect.tryPromise({
        try: () => self.redis.keys(pattern),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to list session keys from Redis: ${error}`,
            cause: error,
            operation: 'listSessions',
          }),
      });

      let sessions = Chunk.empty<SpiderStateKey>();
      for (const redisKey of redisKeys) {
        const serialized = yield* Effect.tryPromise({
          try: () => self.redis.get(redisKey),
          catch: (error) =>
            new PersistenceError({
              message: `Failed to get session data from Redis: ${error}`,
              cause: error,
              operation: 'listSessions',
            }),
        });

        yield* Option.fromNullable(serialized).pipe(
          Option.match({
            onNone: () => Effect.void,
            onSome: (value) =>
              Schema.decode(Schema.parseJson(SpiderState))(value).pipe(
                Effect.tap((state) => {
                  sessions = Chunk.append(sessions, state.key);
                }),
                // Skip invalid sessions silently
                Effect.catchAll(() => Effect.void)
              ),
          })
        );
      }

      return Chunk.toArray(sessions);
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
      const now = yield* DateTime.now;
      const timestamp = DateTime.toEpochMillis(now);
      yield* Effect.tryPromise({
        try: () => self.redis.zadd(sessionsKey, timestamp, key.id),
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
