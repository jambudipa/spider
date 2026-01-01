/**
 * File System Utilities
 * Effect-based file operations with proper error handling
 */

import { Effect, Data, Option, Chunk, Random, DateTime, Config } from 'effect';
import * as fs from 'fs/promises';
import * as path from 'path';
import { JsonUtils } from './JsonUtils.js';

// ============================================================================
// Type Definitions
// ============================================================================

type FileEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'hex';

interface NodeError extends Error {
  code?: string;
}

function isNodeError(error: unknown): error is NodeError {
  return error instanceof Error && 'code' in error;
}

function getErrorCode(error: unknown): Option.Option<string> {
  if (isNodeError(error)) {
    return Option.fromNullable(error.code);
  }
  return Option.none();
}

// ============================================================================
// Error Types
// ============================================================================

export type FileError = FileReadError | FileWriteError | DirectoryError;
export type FileErrorType = 'FileReadError' | 'FileWriteError' | 'DirectoryError';

export class FileReadError extends Data.TaggedError('FileReadError')<{
  readonly path: string;
  readonly code: Option.Option<string>;
  readonly cause?: unknown;
}> {
  get message(): string {
    if (Option.isSome(this.code) && this.code.value === 'ENOENT') {
      return `File not found: ${this.path}`;
    }
    if (Option.isSome(this.code) && this.code.value === 'EACCES') {
      return `Permission denied reading file: ${this.path}`;
    }
    return `Failed to read file ${this.path}: ${this.cause}`;
  }
}

export class FileWriteError extends Data.TaggedError('FileWriteError')<{
  readonly path: string;
  readonly code: Option.Option<string>;
  readonly cause?: unknown;
}> {
  get message(): string {
    if (Option.isSome(this.code) && this.code.value === 'EACCES') {
      return `Permission denied writing file: ${this.path}`;
    }
    if (Option.isSome(this.code) && this.code.value === 'ENOSPC') {
      return `No space left on device for file: ${this.path}`;
    }
    return `Failed to write file ${this.path}: ${this.cause}`;
  }
}

export class DirectoryError extends Data.TaggedError('DirectoryError')<{
  readonly path: string;
  readonly operation: 'create' | 'read' | 'delete';
  readonly code: Option.Option<string>;
  readonly cause?: unknown;
}> {
  get message(): string {
    return `Failed to ${this.operation} directory ${this.path}: ${this.cause}`;
  }
}

// ============================================================================
// File Operations
// ============================================================================

export const FileUtils = {
  /**
   * Read file as text
   * 
   * @example
   * ```ts
   * const content = yield* FileUtils.readText('/path/to/file.txt');
   * ```
   */
  readText: (filePath: string, encoding: FileEncoding = 'utf-8') =>
    Effect.tryPromise({
      try: () => fs.readFile(filePath, encoding),
      catch: (error: unknown) =>
        new FileReadError({
          path: filePath,
          code: getErrorCode(error),
          cause: error
        })
    }),

  /**
   * Write text to file
   * 
   * @example
   * ```ts
   * yield* FileUtils.writeText('/path/to/file.txt', 'Hello, World!');
   * ```
   */
  writeText: (filePath: string, content: string, encoding: FileEncoding = 'utf-8') =>
    Effect.tryPromise({
      try: () => fs.writeFile(filePath, content, encoding),
      catch: (error: unknown) =>
        new FileWriteError({
          path: filePath,
          code: getErrorCode(error),
          cause: error
        })
    }),

  /**
   * Read file as buffer
   * 
   * @example
   * ```ts
   * const buffer = yield* FileUtils.readBuffer('/path/to/image.png');
   * ```
   */
  readBuffer: (filePath: string) =>
    Effect.tryPromise({
      try: () => fs.readFile(filePath),
      catch: (error: unknown) =>
        new FileReadError({
          path: filePath,
          code: getErrorCode(error),
          cause: error
        })
    }),

  /**
   * Write buffer to file
   * 
   * @example
   * ```ts
   * yield* FileUtils.writeBuffer('/path/to/image.png', imageBuffer);
   * ```
   */
  writeBuffer: (filePath: string, buffer: Buffer) =>
    Effect.tryPromise({
      try: () => fs.writeFile(filePath, buffer),
      catch: (error: unknown) =>
        new FileWriteError({
          path: filePath,
          code: getErrorCode(error),
          cause: error
        })
    }),

  /**
   * Read JSON file
   * 
   * @example
   * ```ts
   * const config = yield* FileUtils.readJson<Config>('/path/to/config.json');
   * ```
   */
  readJson: <T = unknown>(filePath: string) =>
    Effect.gen(function* () {
      const content = yield* FileUtils.readText(filePath);
      return yield* JsonUtils.parse<T>(content);
    }),

  /**
   * Write JSON file
   * 
   * @example
   * ```ts
   * yield* FileUtils.writeJson('/path/to/config.json', configData, 2);
   * ```
   */
  writeJson: (filePath: string, data: unknown, space?: number) =>
    Effect.gen(function* () {
      const json = yield* JsonUtils.stringify(data, space);
      yield* FileUtils.writeText(filePath, json);
    }),

  /**
   * Check if file exists
   * 
   * @example
   * ```ts
   * const exists = yield* FileUtils.exists('/path/to/file.txt');
   * if (exists) {
   *   // File exists
   * }
   * ```
   */
  exists: (filePath: string) =>
    Effect.tryPromise({
      try: () => fs.access(filePath),
      catch: () => new FileReadError({ path: filePath, code: Option.none(), cause: 'Access check failed' })
    }).pipe(
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false))
    ),

  /**
   * Get file stats
   * 
   * @example
   * ```ts
   * const stats = yield* FileUtils.stat('/path/to/file.txt');
   * console.log(`File size: ${stats.size} bytes`);
   * ```
   */
  stat: (filePath: string) =>
    Effect.tryPromise({
      try: () => fs.stat(filePath),
      catch: (error: unknown) =>
        new FileReadError({
          path: filePath,
          code: getErrorCode(error),
          cause: error
        })
    }),

  /**
   * Delete file
   * 
   * @example
   * ```ts
   * yield* FileUtils.delete('/path/to/file.txt');
   * ```
   */
  delete: (filePath: string) =>
    Effect.tryPromise({
      try: () => fs.unlink(filePath),
      catch: (error: unknown) =>
        new FileWriteError({
          path: filePath,
          code: getErrorCode(error),
          cause: error
        })
    }),

  /**
   * Copy file
   * 
   * @example
   * ```ts
   * yield* FileUtils.copy('/src/file.txt', '/dest/file.txt');
   * ```
   */
  copy: (src: string, dest: string) =>
    Effect.tryPromise({
      try: () => fs.copyFile(src, dest),
      catch: (error: unknown) =>
        new FileWriteError({
          path: dest,
          code: getErrorCode(error),
          cause: error
        })
    }),

  /**
   * Move/rename file
   * 
   * @example
   * ```ts
   * yield* FileUtils.move('/old/path.txt', '/new/path.txt');
   * ```
   */
  move: (src: string, dest: string) =>
    Effect.tryPromise({
      try: () => fs.rename(src, dest),
      catch: (error: unknown) =>
        new FileWriteError({
          path: dest,
          code: getErrorCode(error),
          cause: error
        })
    }),

  /**
   * Ensure directory exists (create if not)
   * 
   * @example
   * ```ts
   * yield* FileUtils.ensureDir('/path/to/directory');
   * ```
   */
  ensureDir: (dirPath: string) =>
    Effect.tryPromise({
      try: () => fs.mkdir(dirPath, { recursive: true }),
      catch: (error: unknown) =>
        new DirectoryError({
          path: dirPath,
          operation: 'create',
          code: getErrorCode(error),
          cause: error
        })
    }),

  /**
   * Read directory contents
   * 
   * @example
   * ```ts
   * const files = yield* FileUtils.readDir('/path/to/directory');
   * ```
   */
  readDir: (dirPath: string) =>
    Effect.tryPromise({
      try: () => fs.readdir(dirPath),
      catch: (error: unknown) =>
        new DirectoryError({
          path: dirPath,
          operation: 'read',
          code: getErrorCode(error),
          cause: error
        })
    }),

  /**
   * Read directory with file stats
   * 
   * @example
   * ```ts
   * const entries = yield* FileUtils.readDirWithStats('/path/to/directory');
   * for (const entry of entries) {
   *   if (entry.isFile()) {
   *     console.log(`File: ${entry.name}`);
   *   }
   * }
   * ```
   */
  readDirWithStats: (dirPath: string) =>
    Effect.tryPromise({
      try: () => fs.readdir(dirPath, { withFileTypes: true }),
      catch: (error: unknown) =>
        new DirectoryError({
          path: dirPath,
          operation: 'read',
          code: getErrorCode(error),
          cause: error
        })
    }),

  /**
   * Delete directory (recursive)
   * 
   * @example
   * ```ts
   * yield* FileUtils.deleteDir('/path/to/directory');
   * ```
   */
  deleteDir: (dirPath: string) =>
    Effect.tryPromise({
      try: () => fs.rm(dirPath, { recursive: true, force: true }),
      catch: (error: unknown) =>
        new DirectoryError({
          path: dirPath,
          operation: 'delete',
          code: getErrorCode(error),
          cause: error
        })
    }),

  /**
   * Read file or return default value
   * 
   * @example
   * ```ts
   * const content = yield* FileUtils.readTextOrDefault(
   *   '/path/to/config.txt',
   *   'default config'
   * );
   * ```
   */
  readTextOrDefault: (filePath: string, defaultContent: string) =>
    FileUtils.readText(filePath).pipe(
      Effect.catchAll(() => Effect.succeed(defaultContent))
    ),

  /**
   * Read JSON or return default value
   * 
   * @example
   * ```ts
   * const config = yield* FileUtils.readJsonOrDefault(
   *   '/path/to/config.json',
   *   { debug: false }
   * );
   * ```
   */
  readJsonOrDefault: <T>(filePath: string, defaultValue: T) =>
    FileUtils.readJson<T>(filePath).pipe(
      Effect.catchAll(() => Effect.succeed(defaultValue))
    ),

  /**
   * Try read file and return Option
   * 
   * @example
   * ```ts
   * const maybeContent = yield* FileUtils.tryReadText('/path/to/file.txt');
   * if (Option.isSome(maybeContent)) {
   *   console.log(maybeContent.value);
   * }
   * ```
   */
  tryReadText: (filePath: string) =>
    FileUtils.readText(filePath).pipe(
      Effect.map(Option.some),
      Effect.catchAll(() => Effect.succeed(Option.none()))
    ),

  /**
   * Append text to file
   * 
   * @example
   * ```ts
   * yield* FileUtils.append('/path/to/log.txt', 'New log entry\n');
   * ```
   */
  append: (filePath: string, content: string) =>
    Effect.tryPromise({
      try: () => fs.appendFile(filePath, content),
      catch: (error: unknown) =>
        new FileWriteError({
          path: filePath,
          code: getErrorCode(error),
          cause: error
        })
    }),

  /**
   * Create temporary file
   * 
   * @example
   * ```ts
   * const tempPath = yield* FileUtils.createTempFile('data', '.json');
   * // Use temp file...
   * yield* FileUtils.delete(tempPath);
   * ```
   */
  createTempFile: (prefix: string = 'tmp', suffix: string = '') =>
    Effect.gen(function* () {
      const tmpDirEnv = yield* Config.string('TMPDIR').pipe(
        Config.orElse(() => Config.string('TEMP')),
        Config.withDefault('/tmp')
      );
      const now = yield* DateTime.now;
      const millis = DateTime.toEpochMillis(now);
      const random = yield* Random.nextIntBetween(0, 2147483647);
      const randomStr = random.toString(36).substring(0, 9);
      const randomName = `${prefix}-${millis}-${randomStr}${suffix}`;
      const tempPath = path.join(tmpDirEnv, randomName);
      yield* FileUtils.writeText(tempPath, '');
      return tempPath;
    }),

  /**
   * Get file size
   * 
   * @example
   * ```ts
   * const size = yield* FileUtils.getSize('/path/to/file.txt');
   * console.log(`File is ${size} bytes`);
   * ```
   */
  getSize: (filePath: string) =>
    FileUtils.stat(filePath).pipe(
      Effect.map(stats => stats.size)
    ),

  /**
   * Check if path is a file
   * 
   * @example
   * ```ts
   * const isFile = yield* FileUtils.isFile('/path/to/something');
   * ```
   */
  isFile: (filePath: string) =>
    FileUtils.stat(filePath).pipe(
      Effect.map(stats => stats.isFile()),
      Effect.catchAll(() => Effect.succeed(false))
    ),

  /**
   * Check if path is a directory
   * 
   * @example
   * ```ts
   * const isDir = yield* FileUtils.isDirectory('/path/to/something');
   * ```
   */
  isDirectory: (dirPath: string) =>
    FileUtils.stat(dirPath).pipe(
      Effect.map(stats => stats.isDirectory()),
      Effect.catchAll(() => Effect.succeed(false))
    ),

  /**
   * Walk directory tree recursively
   * 
   * @example
   * ```ts
   * const allFiles = yield* FileUtils.walk('/path/to/root');
   * ```
   */
  walk: (dirPath: string): Effect.Effect<string[], DirectoryError> =>
    Effect.gen(function* () {
      const entries = yield* FileUtils.readDirWithStats(dirPath);

      const processedEntries = yield* Effect.forEach(entries, (entry) => {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          return FileUtils.walk(fullPath).pipe(
            Effect.map(subFiles => Chunk.fromIterable(subFiles))
          );
        } else {
          return Effect.succeed(Chunk.of(fullPath));
        }
      });

      const combined = Chunk.fromIterable(processedEntries).pipe(Chunk.flatten);
      return Chunk.toArray(combined);
    })
};

// ============================================================================
// Re-exports for convenience
// ============================================================================

export const {
  readText,
  writeText,
  readBuffer,
  writeBuffer,
  readJson,
  writeJson,
  exists,
  stat,
  delete: deleteFile,
  copy,
  move,
  ensureDir,
  readDir,
  readDirWithStats,
  deleteDir,
  readTextOrDefault,
  readJsonOrDefault,
  tryReadText,
  append,
  createTempFile,
  getSize,
  isFile,
  isDirectory,
  walk
} = FileUtils;