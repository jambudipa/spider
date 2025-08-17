import { Effect, Schema } from 'effect';
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
  readonly capabilities: StorageCapabilities = {
    supportsDelta: true,
    supportsSnapshot: true,
    supportsStreaming: false,
    supportsConcurrency: false, // File system isn't great for concurrent access
    latency: 'low',
  };

  readonly name = 'FileStorageBackend';

  constructor(private readonly baseDir: string) {}

  initialize = (): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => fs.mkdir(self.baseDir, { recursive: true }),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to initialize file storage: ${error}`,
            cause: error,
            operation: 'initialize',
          }),
      });
      yield* Effect.tryPromise({
        try: () =>
          fs.mkdir(path.join(self.baseDir, 'sessions'), { recursive: true }),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to initialize file storage: ${error}`,
            cause: error,
            operation: 'initialize',
          }),
      });
    });
  };

  cleanup = (): Effect.Effect<void, PersistenceError> =>
    Effect.succeed(undefined); // No cleanup needed for file backend

  // Full state operations
  saveState = (
    key: SpiderStateKey,
    state: SpiderState
  ): Effect.Effect<void, PersistenceError, never> => {
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
      const encoded = Schema.encodeSync(SpiderState)(state);
      yield* Effect.tryPromise({
        try: () =>
          fs.writeFile(statePath, JSON.stringify(encoded, null, 2), 'utf8'),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to save state: ${error}`,
            cause: error,
            operation: 'saveState',
          }),
      });
    });
  };

  loadState = (
    key: SpiderStateKey
  ): Effect.Effect<SpiderState | null, PersistenceError, never> => {
    const self = this;
    return Effect.gen(function* () {
      const sessionDir = self.getSessionDir(key);
      const statePath = path.join(sessionDir, 'state.json');

      const result = yield* Effect.tryPromise(() =>
        fs.readFile(statePath, 'utf8')
      ).pipe(
        Effect.catchAll((error: any) => {
          if (error.code === 'ENOENT') {
            return Effect.succeed(null);
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

      if (result === null) {
        return null;
      }

      try {
        const parsed = JSON.parse(result);
        const decoded = Schema.decodeUnknownSync(SpiderState)(parsed);
        return decoded;
      } catch (error) {
        return yield* Effect.fail(
          new PersistenceError({
            message: `Failed to parse state: ${error}`,
            cause: error,
            operation: 'loadState',
          })
        );
      }
    });
  };

  deleteState = (
    key: SpiderStateKey
  ): Effect.Effect<void, PersistenceError, never> => {
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
  saveDelta = (delta: StateDelta): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const sessionDir = path.join(self.baseDir, 'sessions', delta.stateKey);
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
      const encoded = Schema.encodeSync(StateDelta)(delta);
      yield* Effect.tryPromise({
        try: () =>
          fs.writeFile(deltaPath, JSON.stringify(encoded, null, 2), 'utf8'),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to save delta: ${error}`,
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
      // Save each delta individually
      for (const delta of deltas) {
        yield* self.saveDelta(delta);
      }
    });
  };

  loadDeltas = (
    key: SpiderStateKey,
    fromSequence = 0
  ): Effect.Effect<StateDelta[], PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const deltasDir = path.join(self.getSessionDir(key), 'deltas');

      const files = yield* Effect.tryPromise(() => fs.readdir(deltasDir)).pipe(
        Effect.catchAll((error: any) => {
          if (error.code === 'ENOENT') {
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

      const deltas: StateDelta[] = [];

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

        try {
          const parsed = JSON.parse(content);
          const decoded = Schema.decodeUnknownSync(StateDelta)(parsed);
          deltas.push(decoded);
        } catch (error) {
          return yield* Effect.fail(
            new PersistenceError({
              message: `Failed to parse delta file ${file}: ${error}`,
              cause: error,
              operation: 'loadDeltas',
            })
          );
        }
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
        state: Schema.encodeSync(SpiderState)(state),
        sequence,
        timestamp: new Date().toISOString(),
      };
      yield* Effect.tryPromise({
        try: () =>
          fs.writeFile(
            snapshotPath,
            JSON.stringify(snapshotData, null, 2),
            'utf8'
          ),
        catch: (error) =>
          new PersistenceError({
            message: `Failed to save snapshot: ${error}`,
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
      const sessionDir = self.getSessionDir(key);
      const snapshotPath = path.join(sessionDir, 'snapshot.json');

      const content = yield* Effect.tryPromise(() =>
        fs.readFile(snapshotPath, 'utf8')
      ).pipe(
        Effect.catchAll((error: any) => {
          if (error.code === 'ENOENT') {
            return Effect.succeed(null);
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

      if (content === null) {
        return null;
      }

      try {
        const parsed = JSON.parse(content);
        const state = Schema.decodeUnknownSync(SpiderState)(parsed.state);
        return {
          state,
          sequence: Number(parsed.sequence),
        };
      } catch (error) {
        return yield* Effect.fail(
          new PersistenceError({
            message: `Failed to parse snapshot: ${error}`,
            cause: error,
            operation: 'loadLatestSnapshot',
          })
        );
      }
    });
  };

  // Cleanup operations
  compactDeltas = (
    key: SpiderStateKey,
    beforeSequence: number
  ): Effect.Effect<void, PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const deltasDir = path.join(self.getSessionDir(key), 'deltas');

      const files = yield* Effect.tryPromise(() => fs.readdir(deltasDir)).pipe(
        Effect.catchAll((error: any) => {
          if (error.code === 'ENOENT') {
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

  listSessions = (): Effect.Effect<SpiderStateKey[], PersistenceError> => {
    const self = this;
    return Effect.gen(function* () {
      const sessionsDir = path.join(self.baseDir, 'sessions');

      const dirs = yield* Effect.tryPromise(() => fs.readdir(sessionsDir)).pipe(
        Effect.catchAll((error: any) => {
          if (error.code === 'ENOENT') {
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

      const sessions: SpiderStateKey[] = [];

      for (const dir of dirs) {
        const sessionDir = path.join(sessionsDir, dir);
        const statePath = path.join(sessionDir, 'state.json');

        const content = yield* Effect.tryPromise(() =>
          fs.readFile(statePath, 'utf8')
        ).pipe(Effect.catchAll(() => Effect.succeed(null)));

        if (content === null) {
          continue; // Skip invalid session directories
        }

        try {
          const parsed = JSON.parse(content);
          Schema.decodeUnknownSync(SpiderState)(parsed); // Validate the state
          // Use the directory name as the key - this needs proper SpiderStateKey construction
          sessions.push({ id: dir, name: dir, timestamp: new Date() });
        } catch {
          // Skip invalid session directories
          continue;
        }
      }

      return sessions;
    });
  };

  private getSessionDir = (key: SpiderStateKey): string => {
    return path.join(this.baseDir, 'sessions', key.id);
  };
}
