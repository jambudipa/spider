import { Data } from 'effect';

/**
 * Network-related errors (fetch failures, timeouts, etc.)
 */
export class NetworkError extends Data.TaggedError('NetworkError')<{
  readonly url: string;
  readonly cause?: unknown;
  readonly message: string;
}> {
  static fromCause(url: string, cause: unknown): NetworkError {
    return new NetworkError({
      url,
      cause,
      message: `Failed to fetch ${url}: ${cause}`,
    });
  }
}

/**
 * Response processing errors (invalid content, parsing failures)
 */
export class ResponseError extends Data.TaggedError('ResponseError')<{
  readonly url: string;
  readonly cause?: unknown;
  readonly message: string;
}> {
  static fromCause(url: string, cause: unknown): ResponseError {
    return new ResponseError({
      url,
      cause,
      message: `Failed to read response from ${url}: ${cause}`,
    });
  }
}

/**
 * Robots.txt fetching errors
 */
export class RobotsTxtError extends Data.TaggedError('RobotsTxtError')<{
  readonly url: string;
  readonly cause?: unknown;
  readonly message: string;
}> {
  static fromCause(url: string, cause: unknown): RobotsTxtError {
    return new RobotsTxtError({
      url,
      cause,
      message: `Failed to fetch robots.txt: ${cause}`,
    });
  }
}

/**
 * Configuration errors
 */
export class ConfigurationError extends Data.TaggedError('ConfigurationError')<{
  readonly message: string;
  readonly details?: unknown;
}> {}

/**
 * Middleware processing errors
 */
export class MiddlewareError extends Data.TaggedError('MiddlewareError')<{
  readonly phase: 'transform' | 'error';
  readonly middlewareName: string;
  readonly cause?: unknown;
  readonly message: string;
}> {
  static transform(middlewareName: string, cause: unknown): MiddlewareError {
    return new MiddlewareError({
      phase: 'transform',
      middlewareName,
      cause,
      message: `Middleware '${middlewareName}' failed during transform: ${cause}`,
    });
  }

  static error(middlewareName: string, cause: unknown): MiddlewareError {
    return new MiddlewareError({
      phase: 'error',
      middlewareName,
      cause,
      message: `Middleware '${middlewareName}' failed during error handling: ${cause}`,
    });
  }
}

/**
 * File system errors
 */
export class FileSystemError extends Data.TaggedError('FileSystemError')<{
  readonly operation: 'read' | 'write' | 'create' | 'delete';
  readonly path: string;
  readonly cause?: unknown;
  readonly message: string;
}> {
  static write(path: string, cause: unknown): FileSystemError {
    return new FileSystemError({
      operation: 'write',
      path,
      cause,
      message: `Failed to write file ${path}: ${cause}`,
    });
  }

  static create(path: string, cause: unknown): FileSystemError {
    return new FileSystemError({
      operation: 'create',
      path,
      cause,
      message: `Failed to create directory ${path}: ${cause}`,
    });
  }
}

/**
 * Persistence layer errors
 */
export class PersistenceError extends Data.TaggedError('PersistenceError')<{
  readonly operation: 'save' | 'load' | 'delete';
  readonly key?: string;
  readonly cause?: unknown;
  readonly message: string;
}> {
  static save(cause: unknown, key?: string): PersistenceError {
    return new PersistenceError({
      operation: 'save',
      key,
      cause,
      message: key
        ? `Failed to save state for key ${key}: ${cause}`
        : `Failed to save state: ${cause}`,
    });
  }

  static load(cause: unknown, key?: string): PersistenceError {
    return new PersistenceError({
      operation: 'load',
      key,
      cause,
      message: key
        ? `Failed to load state for key ${key}: ${cause}`
        : `Failed to load state: ${cause}`,
    });
  }

  static delete(cause: unknown, key?: string): PersistenceError {
    return new PersistenceError({
      operation: 'delete',
      key,
      cause,
      message: key
        ? `Failed to delete state for key ${key}: ${cause}`
        : `Failed to delete state: ${cause}`,
    });
  }
}

/**
 * Content type validation errors
 */
export class ContentTypeError extends Data.TaggedError('ContentTypeError')<{
  readonly url: string;
  readonly contentType: string;
  readonly expectedTypes: readonly string[];
  readonly message: string;
}> {
  static create(
    url: string,
    contentType: string,
    expectedTypes: readonly string[]
  ): ContentTypeError {
    return new ContentTypeError({
      url,
      contentType,
      expectedTypes,
      message: `Invalid content type '${contentType}' for ${url}. Expected one of: ${expectedTypes.join(', ')}`,
    });
  }
}

/**
 * Request abort errors
 */
export class RequestAbortError extends Data.TaggedError('RequestAbortError')<{
  readonly url: string;
  readonly duration: number;
  readonly reason: 'timeout' | 'cancelled';
  readonly message: string;
}> {
  static timeout(url: string, duration: number): RequestAbortError {
    return new RequestAbortError({
      url,
      duration,
      reason: 'timeout',
      message: `Request to ${url} aborted after ${duration}ms due to timeout`,
    });
  }

  static cancelled(url: string, duration: number): RequestAbortError {
    return new RequestAbortError({
      url,
      duration,
      reason: 'cancelled',
      message: `Request to ${url} cancelled after ${duration}ms`,
    });
  }
}

/**
 * Adapter initialisation errors
 */
export class AdapterNotInitialisedError extends Data.TaggedError('AdapterNotInitialisedError')<{
  readonly adapterId: string;
  readonly operation: string;
  readonly message: string;
}> {
  static create(adapterId: string, operation: string): AdapterNotInitialisedError {
    return new AdapterNotInitialisedError({
      adapterId,
      operation,
      message: `Adapter '${adapterId}' not initialised. Cannot perform operation: ${operation}`,
    });
  }
}

/**
 * Browser cleanup errors
 */
export class BrowserCleanupError extends Data.TaggedError('BrowserCleanupError')<{
  readonly resourceType: 'context' | 'browser';
  readonly resourceId: string;
  readonly cause: unknown;
  readonly message: string;
}> {
  static context(id: string, cause: unknown): BrowserCleanupError {
    return new BrowserCleanupError({
      resourceType: 'context',
      resourceId: id,
      cause,
      message: `Failed to close browser context '${id}': ${cause}`,
    });
  }

  static browser(id: string, cause: unknown): BrowserCleanupError {
    return new BrowserCleanupError({
      resourceType: 'browser',
      resourceId: id,
      cause,
      message: `Failed to close browser '${id}': ${cause}`,
    });
  }
}

// Re-export all error types
export type SpiderError =
  | NetworkError
  | ResponseError
  | RobotsTxtError
  | ConfigurationError
  | MiddlewareError
  | FileSystemError
  | PersistenceError
  | ContentTypeError
  | RequestAbortError
  | AdapterNotInitialisedError
  | BrowserCleanupError;
