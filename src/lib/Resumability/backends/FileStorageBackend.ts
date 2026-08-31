import { Chunk, DateTime, Effect, Option, Schema } from 'effect';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  PersistenceError,
  SpiderState,
  SpiderStateKey,
  StateDelta,
  StorageBackend,
  StorageCapabilities,
} from '../types.js';

/**
 * Type guard for NodeJS error with code property
 */
interface NodeJSError extends Error {
  /** Carries the Node.js file-system code used to identify missing data. */
  readonly code?: string;
}

/** Distinguishes expected file-system absence from persistence failures. */
const isNodeJSError = (error: unknown): error is NodeJSError =>
  error instanceof Error && 'code' in error;

/**
 * Schema for snapshot data stored on disk
 */
const SnapshotData = Schema.Struct({
  state: SpiderState,
  sequence: Schema.Number,
  timestamp: Schema.String,
});

/**
 * JSON schemas for serialisation/deserialisation
 */
const SpiderStateJsonSchema = Schema.fromJsonString(SpiderState, { space: 2 });
/** Serialises a delta as readable JSON for ordered on-disk replay. */
const StateDeltaJsonSchema = Schema.fromJsonString(StateDelta, { space: 2 });
/** Serialises the snapshot envelope, including its replay sequence. */
const SnapshotDataJsonSchema = Schema.fromJsonString(SnapshotData, { space: 2 });

/**
 * File system storage backend for spider state persistence.
 *
 * Stores state and deltas as JSON files in a directory structure.
 * Good for development, testing, and single-machine deployments.
 *
 * Directory structure:
 * ```
 * baseDir/
 *   sessions/
 *     sessionId/
 *       state.json        # Full state
 *       snapshot.json     # Latest snapshot
 *       deltas/
 *         0001.json       # Delta files
 *         0002.json
 *         ...
 * ```
 *
 * @group Backends
 * @public
 */
export class FileStorageBackend implements StorageBackend {
  /** Describes the local storage features that strategy selection can use. */
  readonly capabilities: StorageCapabilities = {
    supportsDelta: true,
    supportsSnapshot: true,
    supportsStreaming: false,
    supportsConcurrency: false, // File system isn't great for concurrent access
    latency: 'low',
  };

  /** Identifies this backend in strategy information and errors. */
  readonly name = 'FileStorageBackend';

  /** Holds the root directory that owns every persisted session. */
  private readonly storageDir: string;

  /** Keeps every session below the caller-selected base directory. */
  constructor(baseDir: string) {
    this.storageDir = baseDir;
  }

  /** Creates the stable directory layout before the first write. */
  initialize = (): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => fs.mkdir(self.storageDir, { recursive: true }),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to initialize file storage: ${error}`,
            cause: error,
            operation: 'initialize',
          }),
      });
      yield* Effect.tryPromise({
        try: () =>
          fs.mkdir(path.join(self.storageDir, 'sessions'), { recursive: true }),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to initialize file storage: ${error}`,
            cause: error,
            operation: 'initialize',
          }),
      });
    });
  };

  /** Leaves files intact because this backend owns no live connection. */
  cleanup = (): Effect.Effect<void, PersistenceError> => Effect.void;

  // Full state operations
  /** Replaces a session's complete state document with the supplied state. */
  saveState = (
    key: SpiderStateKey,
    state: SpiderState
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const sessionDir = self.getSessionDir(key);
      const statePath = path.join(sessionDir, 'state.json');

      yield* Effect.tryPromise({
        try: () => fs.mkdir(sessionDir, { recursive: true }),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to create session directory: ${error}`,
            cause: error,
            operation: 'saveState',
          }),
      });
      const jsonContent = yield* Schema.encodeEffect(SpiderStateJsonSchema)(
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
      yield* Effect.tryPromise({
        try: () => fs.writeFile(statePath, jsonContent, 'utf8'),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to save state: ${error}`,
            cause: error,
            operation: 'saveState',
          }),
      });
    });
  };

  /** Loads a complete state, and returns none when the session has no state file. */
  loadState = (
    key: SpiderStateKey
  ): Effect.Effect<Option.Option<SpiderState>, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const sessionDir = self.getSessionDir(key);
      const statePath = path.join(sessionDir, 'state.json');

      const result = yield* Effect.tryPromise(() =>
        fs.readFile(statePath, 'utf8')
      ).pipe(
        Effect.map(Option.some),
        Effect.catch((error: unknown) => {
          if (isNodeJSError(error) && error.code === 'ENOENT') {
            return Effect.succeed(Option.none<string>());
          }
          return Effect.fail(
            new PersistenceError({
              message: `Failed to load state: ${error}`,
              cause: error,
              operation: 'loadState',
            })
          );
        })
      );

      if (Option.isNone(result)) {
        return Option.none<SpiderState>();
      }

      const decoded = yield* Schema.decodeEffect(SpiderStateJsonSchema)(
        result.value
      ).pipe(
        Effect.mapError(
          (error) =>
            new PersistenceError({
              message: `Failed to parse state: ${error}`,
              cause: error,
              operation: 'loadState',
            })
        )
      );
      return Option.some(decoded);
    });
  };

  /** Removes every persisted file for the selected session. */
  deleteState = (
    key: SpiderStateKey
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const sessionDir = self.getSessionDir(key);

      yield* Effect.tryPromise({
        try: () => fs.rm(sessionDir, { recursive: true, force: true }),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to delete state: ${error}`,
            cause: error,
            operation: 'deleteState',
          }),
      });
    });
  };

  // Delta operations
  /** Stores one delta under its zero-padded sequence number. */
  saveDelta = (delta: StateDelta): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const sessionDir = path.join(
        self.storageDir,
        'sessions',
        delta.stateKey
      );
      const deltasDir = path.join(sessionDir, 'deltas');
      const deltaPath = path.join(
        deltasDir,
        `${delta.sequence.toString().padStart(6, '0')}.json`
      );

      yield* Effect.tryPromise({
        try: () => fs.mkdir(deltasDir, { recursive: true }),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to create deltas directory: ${error}`,
            cause: error,
            operation: 'saveDelta',
          }),
      });
      const jsonContent = yield* Schema.encodeEffect(StateDeltaJsonSchema)(
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
      yield* Effect.tryPromise({
        try: () => fs.writeFile(deltaPath, jsonContent, 'utf8'),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to save delta: ${error}`,
            cause: error,
            operation: 'saveDelta',
          }),
      });
    });
  };

  /** Stores each supplied delta in order because files have no batch primitive. */
  saveDeltas = (
    deltas: StateDelta[]
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      // Save each delta individually
      for (const delta of deltas) {
        yield* self.saveDelta(delta);
      }
    });
  };

  /** Loads ordered deltas at or after the requested sequence. */
  loadDeltas = (
    key: SpiderStateKey,
    fromSequence = 0
  ): Effect.Effect<StateDelta[], PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const deltasDir = path.join(self.getSessionDir(key), 'deltas');

      const files = yield* Effect.tryPromise(() => fs.readdir(deltasDir)).pipe(
        Effect.catch((error: unknown) => {
          if (isNodeJSError(error) && error.code === 'ENOENT') {
            return Effect.succeed([]);
          }
          return Effect.fail(
            new PersistenceError({
              message: `Failed to read deltas directory: ${error}`,
              cause: error,
              operation: 'loadDeltas',
            })
          );
        })
      );

      if (files.length === 0) {
        return [];
      }

      const deltaFiles = files
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({
          file: f,
          sequence: parseInt(f.replace('.json', ''), 10),
        }))
        .filter(({ sequence }) => sequence >= fromSequence)
        .sort((a, b) => a.sequence - b.sequence);

      let deltas = Chunk.empty<StateDelta>();

      for (const { file } of deltaFiles) {
        const content = yield* Effect.tryPromise({
          try: () => fs.readFile(path.join(deltasDir, file), 'utf8'),
          catch: (error) =>
            new PersistenceError({
              message: `Failed to read delta file ${file}: ${error}`,
              cause: error,
              operation: 'loadDeltas',
            }),
        });

        const decoded = yield* Schema.decodeEffect(StateDeltaJsonSchema)(content).pipe(
          Effect.mapError(
            (error) =>
              new PersistenceError({
                message: `Failed to parse delta file ${file}: ${error}`,
                cause: error,
                operation: 'loadDeltas',
              })
          )
        );
        deltas = Chunk.append(deltas, decoded);
      }

      return [...Chunk.toReadonlyArray(deltas)];
    });
  };

  // Snapshot operations
  /** Stores a recoverable state snapshot with its last included sequence. */
  saveSnapshot = (
    key: SpiderStateKey,
    state: SpiderState,
    sequence: number
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const sessionDir = self.getSessionDir(key);
      const snapshotPath = path.join(sessionDir, 'snapshot.json');

      yield* Effect.tryPromise({
        try: () => fs.mkdir(sessionDir, { recursive: true }),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to create session directory: ${error}`,
            cause: error,
            operation: 'saveSnapshot',
          }),
      });
      const snapshotData = {
        state,
        sequence,
        timestamp: DateTime.formatIso(DateTime.nowUnsafe()),
      };
      const jsonContent = yield* Schema.encodeEffect(SnapshotDataJsonSchema)(
        snapshotData
      ).pipe(
        Effect.mapError(
          (error) =>
            new PersistenceError({
              message: `Failed to encode snapshot: ${error}`,
              cause: error,
              operation: 'saveSnapshot',
            })
        )
      );
      yield* Effect.tryPromise({
        try: () => fs.writeFile(snapshotPath, jsonContent, 'utf8'),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to save snapshot: ${error}`,
            cause: error,
            operation: 'saveSnapshot',
          }),
      });
    });
  };

  /** Loads the latest snapshot, or none when no snapshot exists. */
  loadLatestSnapshot = (
    key: SpiderStateKey
  ): Effect.Effect<
    Option.Option<{ state: SpiderState; sequence: number }>,
    PersistenceError
  > => {
    const self = this;
    return Effect.gen(function* () {
      const sessionDir = self.getSessionDir(key);
      const snapshotPath = path.join(sessionDir, 'snapshot.json');

      const content = yield* Effect.tryPromise(() =>
        fs.readFile(snapshotPath, 'utf8')
      ).pipe(
        Effect.map(Option.some),
        Effect.catch((error: unknown) => {
          if (isNodeJSError(error) && error.code === 'ENOENT') {
            return Effect.succeed(Option.none<string>());
          }
          return Effect.fail(
            new PersistenceError({
              message: `Failed to load snapshot: ${error}`,
              cause: error,
              operation: 'loadLatestSnapshot',
            })
          );
        })
      );

      if (Option.isNone(content)) {
        return Option.none<{ state: SpiderState; sequence: number }>();
      }

      const parsed = yield* Schema.decodeEffect(SnapshotDataJsonSchema)(
        content.value
      ).pipe(
        Effect.mapError(
          (error) =>
            new PersistenceError({
              message: `Failed to parse snapshot: ${error}`,
              cause: error,
              operation: 'loadLatestSnapshot',
            })
        )
      );
      return Option.some({
        state: parsed.state,
        sequence: parsed.sequence,
      });
    });
  };

  // Cleanup operations
  /** Deletes deltas older than the caller's exclusive replay boundary. */
  compactDeltas = (
    key: SpiderStateKey,
    beforeSequence: number
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const deltasDir = path.join(self.getSessionDir(key), 'deltas');

      const files = yield* Effect.tryPromise(() => fs.readdir(deltasDir)).pipe(
        Effect.catch((error: unknown) => {
          if (isNodeJSError(error) && error.code === 'ENOENT') {
            return Effect.succeed([]);
          }
          return Effect.fail(
            new PersistenceError({
              message: `Failed to read deltas directory: ${error}`,
              cause: error,
              operation: 'compactDeltas',
            })
          );
        })
      );

      if (files.length === 0) {
        return; // Nothing to compact
      }

      const deltaFiles = files
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({
          file: f,
          sequence: parseInt(f.replace('.json', ''), 10),
        }))
        .filter(({ sequence }) => sequence < beforeSequence);

      // Delete old delta files
      for (const { file } of deltaFiles) {
        yield* Effect.tryPromise({
          try: () => fs.unlink(path.join(deltasDir, file)),
          catch: (error) =>
            new PersistenceError({
              message: `Failed to delete delta file ${file}: ${error}`,
              cause: error,
              operation: 'compactDeltas',
            }),
        });
      }
    });
  };

  /** Returns only directories that contain a valid complete state document. */
  listSessions = (): Effect.Effect<SpiderStateKey[], PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const sessionsDir = path.join(self.storageDir, 'sessions');

      const dirs = yield* Effect.tryPromise(() => fs.readdir(sessionsDir)).pipe(
        Effect.catch((error: unknown) => {
          if (isNodeJSError(error) && error.code === 'ENOENT') {
            return Effect.succeed([]);
          }
          return Effect.fail(
            new PersistenceError({
              message: `Failed to read sessions directory: ${error}`,
              cause: error,
              operation: 'listSessions',
            })
          );
        })
      );

      if (dirs.length === 0) {
        return [];
      }

      let sessions = Chunk.empty<SpiderStateKey>();

      for (const dir of dirs) {
        const sessionDir = path.join(sessionsDir, dir);
        const statePath = path.join(sessionDir, 'state.json');

        const content = yield* Effect.tryPromise(() =>
          fs.readFile(statePath, 'utf8')
        ).pipe(
          Effect.map(Option.some),
          Effect.catch(() => Effect.succeed(Option.none<string>()))
        );

        if (Option.isNone(content)) {
          continue; // Skip invalid session directories
        }

        const validationResult = yield* Schema.decodeEffect(SpiderStateJsonSchema)(
          content.value
        ).pipe(
          Effect.map(Option.some),
          Effect.catch(() => Effect.succeed(Option.none<SpiderState>()))
        );

        if (Option.isSome(validationResult)) {
          // Use the directory name as the key - this needs proper SpiderStateKey construction
          const stateKey = new SpiderStateKey({
            id: dir,
            name: dir,
            timestamp: DateTime.toDate(DateTime.nowUnsafe()),
          });
          sessions = Chunk.append(sessions, stateKey);
        }
      }

      return [...Chunk.toReadonlyArray(sessions)];
    });
  };

  /** Derives the directory shared by one session's state, snapshot, and deltas. */
  private getSessionDir = (key: SpiderStateKey): string => {
    return path.join(this.storageDir, 'sessions', key.id);
  };
}
