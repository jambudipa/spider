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
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number }>;
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
    private readonly db: DatabaseClientInterface,
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

  cleanup = (): Effect.Effect<void, PersistenceError> =>
    Effect.succeed(undefined); // Database client cleanup is handled externally

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
            JSON.stringify(encoded),
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
  ): Effect.Effect<SpiderState | null, PersistenceError> => {
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
        return null;
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

      return decoded;
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
            self.db.transaction!(async (tx) => {
              // Delete in correct order due to foreign key constraints
              await tx.query(
                `DELETE FROM ${self.getTableName('snapshots')} WHERE session_id = $1`,
                [key.id]
              );
              await tx.query(
                `DELETE FROM ${self.getTableName('deltas')} WHERE session_id = $1`,
                [key.id]
              );
              await tx.query(
                `DELETE FROM ${self.getTableName('sessions')} WHERE id = $1`,
                [key.id]
              );
            }),
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
      const encoded = yield* Effect.try({
        try: () => Schema.encodeSync(StateDelta)(delta),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to encode delta: ${error}`,
            cause: error,
            operation: 'saveDelta',
          }),
      });

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
            JSON.stringify(encoded),
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
    deltas: StateDelta[]
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      if (deltas.length === 0) return;

      // Use batch insert with VALUES clause
      const values: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      for (const delta of deltas) {
        const encoded = yield* Effect.try({
          try: () => Schema.encodeSync(StateDelta)(delta),
          catch: (error) =>
            new PersistenceError({
              message: `Failed to encode delta: ${error}`,
              cause: error,
              operation: 'saveDeltas',
            }),
        });

        values.push(
          `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3})`
        );
        params.push(
          delta.stateKey,
          delta.sequence,
          delta.operation.type,
          JSON.stringify(encoded)
        );
        paramIndex += 4;
      }

      const sql = `
        INSERT INTO ${self.getTableName('deltas')} (session_id, sequence_number, operation_type, operation_data)
        VALUES ${values.join(', ')}
        ON CONFLICT (session_id, sequence_number) DO NOTHING
      `;

      yield* Effect.tryPromise({
        try: () => self.db.query(sql, params),
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

      const deltas: StateDelta[] = [];
      for (const row of result.rows) {
        const decoded = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(StateDelta)(row.operation_data),
          catch: (error) =>
            new PersistenceError({
              message: `Failed to decode delta data: ${error}`,
              cause: error,
              operation: 'loadDeltas',
            }),
        });
        deltas.push(decoded);
      }

      return deltas;
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
            message: `Failed to encode snapshot state: ${error}`,
            cause: error,
            operation: 'saveSnapshot',
          }),
      });

      const sql = `
        INSERT INTO ${self.getTableName('snapshots')} (session_id, sequence_number, state_data)
        VALUES ($1, $2, $3)
      `;

      yield* Effect.tryPromise({
        try: () =>
          self.db.query(sql, [key.id, sequence, JSON.stringify(encoded)]),
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
    { state: SpiderState; sequence: number } | null,
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
        return null;
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

      return {
        state,
        sequence: row.sequence_number,
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

      const sessions: SpiderStateKey[] = result.rows.map(
        (row) =>
          new SpiderStateKey({
            id: row.id,
            name: row.name,
            timestamp: new Date(row.created_at),
          })
      );

      return sessions;
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
