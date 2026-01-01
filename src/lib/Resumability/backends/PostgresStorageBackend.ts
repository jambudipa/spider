import { Chunk, DateTime, Effect, Option, Schema } from 'effect';
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
 * JSON schemas for serialisation/deserialisation
 */
const SpiderStateJsonSchema = Schema.parseJson(SpiderState);
const StateDeltaJsonSchema = Schema.parseJson(StateDelta);

/**
 * Database client interface for dependency injection.
 *
 * This allows users to provide their own database client implementation
 * (pg, node-postgres, prisma, drizzle, etc.) without tight coupling.
 *
 * @group Backends
 * @public
 */
export interface DatabaseClientInterface {
  query<T = unknown>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<{ rows: readonly T[]; rowCount: number }>;
  transaction?<T>(
    callback: (client: DatabaseClientInterface) => Promise<T>
  ): Promise<T>;
}

/**
 * Configuration for PostgreSQL storage backend.
 */
export interface PostgresStorageConfig {
  /** Table prefix for spider tables */
  tablePrefix?: string;
  /** Schema name (defaults to 'public') */
  schema?: string;
  /** Whether to auto-create tables */
  autoCreateTables?: boolean;
}

/**
 * PostgreSQL storage backend for spider state persistence.
 *
 * Uses PostgreSQL for robust, ACID-compliant state persistence with
 * excellent support for concurrent access and complex queries.
 *
 * Database schema:
 * ```sql
 * CREATE TABLE spider_sessions (
 *   id VARCHAR(255) PRIMARY KEY,
 *   name VARCHAR(255) NOT NULL,
 *   created_at TIMESTAMP NOT NULL,
 *   state_data JSONB,
 *   updated_at TIMESTAMP DEFAULT NOW()
 * );
 *
 * CREATE TABLE spider_deltas (
 *   id SERIAL PRIMARY KEY,
 *   session_id VARCHAR(255) NOT NULL REFERENCES spider_sessions(id),
 *   sequence_number BIGINT NOT NULL,
 *   operation_type VARCHAR(50) NOT NULL,
 *   operation_data JSONB NOT NULL,
 *   created_at TIMESTAMP DEFAULT NOW(),
 *   UNIQUE(session_id, sequence_number)
 * );
 *
 * CREATE TABLE spider_snapshots (
 *   id SERIAL PRIMARY KEY,
 *   session_id VARCHAR(255) NOT NULL REFERENCES spider_sessions(id),
 *   sequence_number BIGINT NOT NULL,
 *   state_data JSONB NOT NULL,
 *   created_at TIMESTAMP DEFAULT NOW()
 * );
 * ```
 *
 * @group Backends
 * @public
 */
export class PostgresStorageBackend implements StorageBackend {
  readonly capabilities: StorageCapabilities = {
    supportsDelta: true,
    supportsSnapshot: true,
    supportsStreaming: true,
    supportsConcurrency: true,
    latency: 'medium',
  };

  readonly name = 'PostgresStorageBackend';

  private readonly tablePrefix: string;
  private readonly schema: string;
  private readonly autoCreateTables: boolean;

  constructor(
    readonly db: DatabaseClientInterface,
    config?: PostgresStorageConfig
  ) {
    this.tablePrefix = config?.tablePrefix || 'spider';
    this.schema = config?.schema || 'public';
    this.autoCreateTables = config?.autoCreateTables ?? true;
  }

  initialize = (): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (self.autoCreateTables) {
        yield* self.createTables();
      }
    });
  };

  cleanup = (): Effect.Effect<void, PersistenceError> => Effect.void; // Database client cleanup is handled externally

  // Full state operations
  saveState = (
    key: SpiderStateKey,
    state: SpiderState
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const jsonContent = yield* Schema.encode(SpiderStateJsonSchema)(
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

      const sql = `
        INSERT INTO ${self.getTableName('sessions')} (id, name, created_at, state_data, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          state_data = EXCLUDED.state_data,
          updated_at = NOW()
      `;

      yield* Effect.tryPromise({
        try: () =>
          self.db.query(sql, [
            key.id,
            key.name,
            key.timestamp.toISOString(),
            jsonContent,
          ]),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to save state to PostgreSQL: ${error}`,
            cause: error,
            operation: 'saveState',
          }),
      });
    });
  };

  loadState = (
    key: SpiderStateKey
  ): Effect.Effect<Option.Option<SpiderState>, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const sql = `
        SELECT state_data
        FROM ${self.getTableName('sessions')}
        WHERE id = $1
      `;

      const result = yield* Effect.tryPromise({
        try: () => self.db.query<{ state_data: unknown }>(sql, [key.id]),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to load state from PostgreSQL: ${error}`,
            cause: error,
            operation: 'loadState',
          }),
      });

      if (result.rows.length === 0) {
        return Option.none<SpiderState>();
      }

      const decoded = yield* Effect.try({
        try: () =>
          Schema.decodeUnknownSync(SpiderState)(result.rows[0].state_data),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to decode state data: ${error}`,
            cause: error,
            operation: 'loadState',
          }),
      });

      return Option.some(decoded);
    });
  };

  deleteState = (
    key: SpiderStateKey
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      // Use transaction if available for consistency
      if (self.db.transaction) {
        yield* Effect.tryPromise({
          try: () =>
            self.db.transaction!((tx) =>
              // Delete in correct order due to foreign key constraints
              // Use Effect.runPromise to execute Effect chain within the Promise callback
              Effect.runPromise(
                Effect.gen(function* () {
                  yield* Effect.promise(() =>
                    tx.query(
                      `DELETE FROM ${self.getTableName('snapshots')} WHERE session_id = $1`,
                      [key.id]
                    )
                  );
                  yield* Effect.promise(() =>
                    tx.query(
                      `DELETE FROM ${self.getTableName('deltas')} WHERE session_id = $1`,
                      [key.id]
                    )
                  );
                  yield* Effect.promise(() =>
                    tx.query(
                      `DELETE FROM ${self.getTableName('sessions')} WHERE id = $1`,
                      [key.id]
                    )
                  );
                })
              )
            ),
          catch: (error) =>
            new PersistenceError({
              message: `Failed to delete state from PostgreSQL: ${error}`,
              cause: error,
              operation: 'deleteState',
            }),
        });
      } else {
        // Fall back to individual queries
        yield* Effect.tryPromise({
          try: () =>
            self.db.query(
              `DELETE FROM ${self.getTableName('snapshots')} WHERE session_id = $1`,
              [key.id]
            ),
          catch: (error) =>
            new PersistenceError({
              message: `Failed to delete snapshots from PostgreSQL: ${error}`,
              cause: error,
              operation: 'deleteState',
            }),
        });
        yield* Effect.tryPromise({
          try: () =>
            self.db.query(
              `DELETE FROM ${self.getTableName('deltas')} WHERE session_id = $1`,
              [key.id]
            ),
          catch: (error) =>
            new PersistenceError({
              message: `Failed to delete deltas from PostgreSQL: ${error}`,
              cause: error,
              operation: 'deleteState',
            }),
        });
        yield* Effect.tryPromise({
          try: () =>
            self.db.query(
              `DELETE FROM ${self.getTableName('sessions')} WHERE id = $1`,
              [key.id]
            ),
          catch: (error) =>
            new PersistenceError({
              message: `Failed to delete session from PostgreSQL: ${error}`,
              cause: error,
              operation: 'deleteState',
            }),
        });
      }
    });
  };

  // Delta operations
  saveDelta = (delta: StateDelta): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const jsonContent = yield* Schema.encode(StateDeltaJsonSchema)(delta).pipe(
        Effect.mapError(
          (error) =>
            new PersistenceError({
              message: `Failed to encode delta: ${error}`,
              cause: error,
              operation: 'saveDelta',
            })
        )
      );

      const sql = `
        INSERT INTO ${self.getTableName('deltas')} (session_id, sequence_number, operation_type, operation_data)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (session_id, sequence_number) DO NOTHING
      `;

      yield* Effect.tryPromise({
        try: () =>
          self.db.query(sql, [
            delta.stateKey,
            delta.sequence,
            delta.operation.type,
            jsonContent,
          ]),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to save delta to PostgreSQL: ${error}`,
            cause: error,
            operation: 'saveDelta',
          }),
      });
    });
  };

  saveDeltas = (
    deltas: readonly StateDelta[]
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (deltas.length === 0) return;

      // Use batch insert with VALUES clause
      // Build up values and params using immutable Chunk operations
      const { values, params } = yield* Effect.reduce(
        deltas,
        {
          values: Chunk.empty<string>(),
          params: Chunk.empty<unknown>(),
          paramIndex: 1,
        },
        (acc, delta) =>
          Effect.gen(function* () {
            const jsonContent = yield* Schema.encode(StateDeltaJsonSchema)(
              delta
            ).pipe(
              Effect.mapError(
                (error) =>
                  new PersistenceError({
                    message: `Failed to encode delta: ${error}`,
                    cause: error,
                    operation: 'saveDeltas',
                  })
              )
            );

            const valueTemplate = `($${acc.paramIndex}, $${acc.paramIndex + 1}, $${acc.paramIndex + 2}, $${acc.paramIndex + 3})`;

            return {
              values: Chunk.append(acc.values, valueTemplate),
              params: Chunk.appendAll(
                acc.params,
                Chunk.make(
                  delta.stateKey,
                  delta.sequence,
                  delta.operation.type,
                  jsonContent
                )
              ),
              paramIndex: acc.paramIndex + 4,
            };
          })
      );

      const sql = `
        INSERT INTO ${self.getTableName('deltas')} (session_id, sequence_number, operation_type, operation_data)
        VALUES ${Chunk.toReadonlyArray(values).join(', ')}
        ON CONFLICT (session_id, sequence_number) DO NOTHING
      `;

      yield* Effect.tryPromise({
        try: () => self.db.query(sql, Chunk.toReadonlyArray(params)),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to save deltas to PostgreSQL: ${error}`,
            cause: error,
            operation: 'saveDeltas',
          }),
      });
    });
  };

  loadDeltas = (
    key: SpiderStateKey,
    fromSequence = 0
  ): Effect.Effect<StateDelta[], PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const sql = `
        SELECT operation_data
        FROM ${self.getTableName('deltas')}
        WHERE session_id = $1 AND sequence_number >= $2
        ORDER BY sequence_number ASC
      `;

      const result = yield* Effect.tryPromise({
        try: () =>
          self.db.query<{ operation_data: unknown }>(sql, [
            key.id,
            fromSequence,
          ]),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to load deltas from PostgreSQL: ${error}`,
            cause: error,
            operation: 'loadDeltas',
          }),
      });

      const deltasChunk = yield* Effect.reduce(
        result.rows,
        Chunk.empty<StateDelta>(),
        (acc, row) =>
          Effect.gen(function* () {
            const decoded = yield* Effect.try({
              try: () =>
                Schema.decodeUnknownSync(StateDelta)(row.operation_data),
              catch: (error) =>
                new PersistenceError({
                  message: `Failed to decode delta data: ${error}`,
                  cause: error,
                  operation: 'loadDeltas',
                }),
            });
            return Chunk.append(acc, decoded);
          })
      );

      return [...Chunk.toReadonlyArray(deltasChunk)];
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
      const jsonContent = yield* Schema.encode(SpiderStateJsonSchema)(
        state
      ).pipe(
        Effect.mapError(
          (error) =>
            new PersistenceError({
              message: `Failed to encode snapshot state: ${error}`,
              cause: error,
              operation: 'saveSnapshot',
            })
        )
      );

      const sql = `
        INSERT INTO ${self.getTableName('snapshots')} (session_id, sequence_number, state_data)
        VALUES ($1, $2, $3)
      `;

      yield* Effect.tryPromise({
        try: () => self.db.query(sql, [key.id, sequence, jsonContent]),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to save snapshot to PostgreSQL: ${error}`,
            cause: error,
            operation: 'saveSnapshot',
          }),
      });
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
      const sql = `
        SELECT state_data, sequence_number
        FROM ${self.getTableName('snapshots')}
        WHERE session_id = $1
        ORDER BY sequence_number DESC
        LIMIT 1
      `;

      const result = yield* Effect.tryPromise({
        try: () =>
          self.db.query<{ state_data: unknown; sequence_number: number }>(sql, [
            key.id,
          ]),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to load snapshot from PostgreSQL: ${error}`,
            cause: error,
            operation: 'loadLatestSnapshot',
          }),
      });

      if (result.rows.length === 0) {
        return Option.none<{ state: SpiderState; sequence: number }>();
      }

      const row = result.rows[0];
      const state = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(SpiderState)(row.state_data),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to decode snapshot state: ${error}`,
            cause: error,
            operation: 'loadLatestSnapshot',
          }),
      });

      return Option.some({
        state,
        sequence: row.sequence_number,
      });
    });
  };

  // Cleanup operations
  compactDeltas = (
    key: SpiderStateKey,
    beforeSequence: number
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const sql = `
        DELETE FROM ${self.getTableName('deltas')}
        WHERE session_id = $1 AND sequence_number < $2
      `;

      yield* Effect.tryPromise({
        try: () => self.db.query(sql, [key.id, beforeSequence]),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to compact deltas in PostgreSQL: ${error}`,
            cause: error,
            operation: 'compactDeltas',
          }),
      });
    });
  };

  listSessions = (): Effect.Effect<SpiderStateKey[], PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const sql = `
        SELECT id, name, created_at
        FROM ${self.getTableName('sessions')}
        ORDER BY created_at DESC
      `;

      const result = yield* Effect.tryPromise({
        try: () =>
          self.db.query<{ id: string; name: string; created_at: string }>(sql),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to list sessions from PostgreSQL: ${error}`,
            cause: error,
            operation: 'listSessions',
          }),
      });

      const sessionsChunk = Chunk.map(
        Chunk.fromIterable(result.rows),
        (row) =>
          new SpiderStateKey({
            id: row.id,
            name: row.name,
            timestamp: DateTime.toDate(DateTime.unsafeMake(row.created_at)),
          })
      );

      return [...Chunk.toReadonlyArray(sessionsChunk)];
    });
  };

  // Private helper methods
  private createTables = (): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const createSessionsTable = `
        CREATE TABLE IF NOT EXISTS ${self.getTableName('sessions')} (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          created_at TIMESTAMP NOT NULL,
          state_data JSONB,
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `;

      const createDeltasTable = `
        CREATE TABLE IF NOT EXISTS ${self.getTableName('deltas')} (
          id SERIAL PRIMARY KEY,
          session_id VARCHAR(255) NOT NULL,
          sequence_number BIGINT NOT NULL,
          operation_type VARCHAR(50) NOT NULL,
          operation_data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(session_id, sequence_number)
        )
      `;

      const createSnapshotsTable = `
        CREATE TABLE IF NOT EXISTS ${self.getTableName('snapshots')} (
          id SERIAL PRIMARY KEY,
          session_id VARCHAR(255) NOT NULL,
          sequence_number BIGINT NOT NULL,
          state_data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `;

      // Create indexes for better performance
      const createIndexes = [
        `CREATE INDEX IF NOT EXISTS idx_${self.tablePrefix}_deltas_session_seq ON ${self.getTableName('deltas')} (session_id, sequence_number)`,
        `CREATE INDEX IF NOT EXISTS idx_${self.tablePrefix}_snapshots_session ON ${self.getTableName('snapshots')} (session_id, sequence_number DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_${self.tablePrefix}_sessions_updated ON ${self.getTableName('sessions')} (updated_at DESC)`,
      ];

      yield* Effect.tryPromise({
        try: () => self.db.query(createSessionsTable),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to create sessions table: ${error}`,
            cause: error,
            operation: 'createTables',
          }),
      });

      yield* Effect.tryPromise({
        try: () => self.db.query(createDeltasTable),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to create deltas table: ${error}`,
            cause: error,
            operation: 'createTables',
          }),
      });

      yield* Effect.tryPromise({
        try: () => self.db.query(createSnapshotsTable),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to create snapshots table: ${error}`,
            cause: error,
            operation: 'createTables',
          }),
      });

      for (const indexSql of createIndexes) {
        yield* Effect.tryPromise({
          try: () => self.db.query(indexSql),
          catch: (error) =>
            new PersistenceError({
              message: `Failed to create index: ${error}`,
              cause: error,
              operation: 'createTables',
            }),
        });
      }
    });
  };

  private getTableName = (table: string): string => {
    return `${this.schema}.${this.tablePrefix}_${table}`;
  };
}
