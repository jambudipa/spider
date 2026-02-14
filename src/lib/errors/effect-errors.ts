/**
 * Consolidated Effect-based Error Types
 * Comprehensive error hierarchy using Data.TaggedError for type-safe error handling
 */

import { Chunk, Data, Option, pipe } from 'effect';

// ============================================================================
// Base Error Types
// ============================================================================

/**
 * Base error class for all Spider errors
 */
export class SpiderError extends Data.TaggedError('SpiderError')<{
  readonly operation: string;
  readonly details?: unknown;
  readonly cause?: unknown;
}> {
  get message(): string {
    const detailsStr = Option.fromNullable(this.details).pipe(
      Option.map((d) => `: ${String(d)}`),
      Option.getOrElse(() => '')
    );
    return `Spider operation '${this.operation}' failed${detailsStr}`;
  }
}

// ============================================================================
// Network Errors
// ============================================================================

/**
 * Network-related errors (fetch failures, timeouts, etc.)
 */
export class NetworkError extends Data.TaggedError('NetworkError')<{
  readonly url: string;
  readonly statusCode?: number;
  readonly method?: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    const parts = pipe(
      Chunk.make(`Network request to ${this.url} failed`),
      (chunk) => (this.statusCode ? Chunk.append(chunk, `with status ${this.statusCode}`) : chunk),
      (chunk) => (this.cause ? Chunk.append(chunk, `${this.cause}`) : chunk)
    );
    return Chunk.toArray(parts).join(' ');
  }

  static fromResponse(url: string, response: Response): NetworkError {
    return new NetworkError({
      url,
      statusCode: response.status,
      method: 'GET',
    });
  }

  static fromCause(url: string, cause: unknown): NetworkError {
    return new NetworkError({ url, cause });
  }
}

export class TimeoutError extends Data.TaggedError('TimeoutError')<{
  readonly url: string;
  readonly timeoutMs: number;
  readonly operation: string;
}> {
  get message(): string {
    return `Operation '${this.operation}' timed out after ${this.timeoutMs}ms for ${this.url}`;
  }
}

// ============================================================================
// Robots.txt Errors
// ============================================================================

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

// ============================================================================
// Response Errors
// ============================================================================

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

// ============================================================================
// Parsing Errors
// ============================================================================

export class ParseError extends Data.TaggedError('ParseError')<{
  readonly input?: string;
  readonly expected: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    return `Failed to parse ${this.expected}${
      this.input ? ` from input: ${this.input.substring(0, 100)}...` : ''
    }`;
  }

  static json(input: string, cause?: unknown): ParseError {
    return new ParseError({
      input,
      expected: 'JSON',
      cause,
    });
  }

  static html(input: string, cause?: unknown): ParseError {
    return new ParseError({
      input,
      expected: 'HTML',
      cause,
    });
  }
}

// ============================================================================
// Validation Errors
// ============================================================================

export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly field: string;
  readonly value?: unknown;
  readonly constraint: string;
}> {
  get message(): string {
    return `Validation failed for field '${this.field}': ${this.constraint}`;
  }

  static url(url: string): ValidationError {
    return new ValidationError({
      field: 'url',
      value: url,
      constraint: 'Invalid URL format',
    });
  }
}

// ============================================================================
// Configuration Errors
// ============================================================================

/**
 * Configuration errors (from original errors.ts)
 */
export class ConfigurationError extends Data.TaggedError('ConfigurationError')<{
  readonly message: string;
  readonly details?: unknown;
}> {}

/**
 * Configuration errors (field-level, from effect-errors.ts)
 */
export class ConfigError extends Data.TaggedError('ConfigError')<{
  readonly field: string;
  readonly value?: unknown;
  readonly reason: string;
}> {
  get message(): string {
    return `Configuration error for '${this.field}': ${this.reason}`;
  }

  static invalid(field: string, value: unknown, expected: string): ConfigError {
    return new ConfigError({
      field,
      value,
      reason: `Expected ${expected}, got ${typeof value}`,
    });
  }
}

// ============================================================================
// Middleware Errors
// ============================================================================

/**
 * Middleware processing errors
 */
export class MiddlewareError extends Data.TaggedError('MiddlewareError')<{
  readonly phase: 'transform' | 'error' | 'request' | 'response';
  readonly middlewareName: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    return `Middleware '${this.middlewareName}' failed during ${this.phase} phase`;
  }

  static transform(middlewareName: string, cause: unknown): MiddlewareError {
    return new MiddlewareError({
      phase: 'transform',
      middlewareName,
      cause,
    });
  }

  static error(middlewareName: string, cause: unknown): MiddlewareError {
    return new MiddlewareError({
      phase: 'error',
      middlewareName,
      cause,
    });
  }
}

// ============================================================================
// File System Errors
// ============================================================================

/**
 * File system errors
 */
export class FileSystemError extends Data.TaggedError('FileSystemError')<{
  readonly operation: 'read' | 'write' | 'create' | 'delete';
  readonly path: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    return `File system ${this.operation} operation failed for path: ${this.path}`;
  }

  static write(path: string, cause: unknown): FileSystemError {
    return new FileSystemError({
      operation: 'write',
      path,
      cause,
    });
  }

  static create(path: string, cause: unknown): FileSystemError {
    return new FileSystemError({
      operation: 'create',
      path,
      cause,
    });
  }
}

// ============================================================================
// Persistence Errors
// ============================================================================

/**
 * Persistence layer errors
 */
export class PersistenceError extends Data.TaggedError('PersistenceError')<{
  readonly operation: string;
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

// ============================================================================
// Content Type Errors
// ============================================================================

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

// ============================================================================
// Request Abort Errors
// ============================================================================

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

// ============================================================================
// Adapter Errors
// ============================================================================

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

// ============================================================================
// Browser Errors
// ============================================================================

/**
 * Browser operation errors
 */
export class BrowserError extends Data.TaggedError('BrowserError')<{
  readonly operation: string;
  readonly browserId?: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    return `Browser operation '${this.operation}' failed${
      this.browserId ? ` for browser ${this.browserId}` : ''
    }${this.cause ? `: ${this.cause}` : ''}`;
  }

  static launch(cause: unknown): BrowserError {
    return new BrowserError({ operation: 'launch', cause });
  }

  static createContext(cause: unknown): BrowserError {
    return new BrowserError({ operation: 'createContext', cause });
  }

  static createPage(cause: unknown): BrowserError {
    return new BrowserError({ operation: 'createPage', cause });
  }

  static closeContext(cause: unknown): BrowserError {
    return new BrowserError({ operation: 'closeContext', cause });
  }

  static notLaunched(): BrowserError {
    return new BrowserError({
      operation: 'access',
      cause: 'Browser not launched',
    });
  }

  static launchFailed(cause: unknown): BrowserError {
    return new BrowserError({ operation: 'launch', cause });
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

export class PageError extends Data.TaggedError('PageError')<{
  readonly url: string;
  readonly operation: string;
  readonly selector?: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    return `Page operation '${this.operation}' failed for ${this.url}${
      this.selector ? ` with selector '${this.selector}'` : ''
    }`;
  }
}

// ============================================================================
// State Management Errors
// ============================================================================

export class StateError extends Data.TaggedError('StateError')<{
  readonly operation: 'save' | 'load' | 'delete' | 'update';
  readonly stateKey?: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    return `State ${this.operation} operation failed${
      this.stateKey ? ` for key '${this.stateKey}'` : ''
    }`;
  }
}

export class SessionError extends Data.TaggedError('SessionError')<{
  readonly sessionId?: string;
  readonly operation: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    return `Session operation '${this.operation}' failed${
      this.sessionId ? ` for session ${this.sessionId}` : ''
    }`;
  }

  static noActiveSession(): SessionError {
    return new SessionError({
      operation: 'access',
      cause: 'No active session',
    });
  }
}

// ============================================================================
// Crawler-specific Errors
// ============================================================================

export class CrawlError extends Data.TaggedError('CrawlError')<{
  readonly url: string;
  readonly depth: number;
  readonly reason: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    return `Failed to crawl ${this.url} at depth ${this.depth}: ${this.reason}`;
  }

  static maxDepthReached(url: string, depth: number): CrawlError {
    return new CrawlError({
      url,
      depth,
      reason: 'Maximum depth reached',
    });
  }

  static robotsBlocked(url: string): CrawlError {
    return new CrawlError({
      url,
      depth: 0,
      reason: 'Blocked by robots.txt',
    });
  }
}

export class QueueError extends Data.TaggedError('QueueError')<{
  readonly operation: 'enqueue' | 'dequeue' | 'peek';
  readonly queueSize?: number;
  readonly cause?: unknown;
}> {
  get message(): string {
    const sizeStr = Option.fromNullable(this.queueSize).pipe(
      Option.map((size) => ` (queue size: ${size})`),
      Option.getOrElse(() => '')
    );
    return `Queue ${this.operation} operation failed${sizeStr}`;
  }
}

// ============================================================================
// Error Utilities
// ============================================================================

/**
 * Type guard for Spider errors
 */
export const isSpiderError = (error: unknown): error is SpiderError => {
  return error instanceof SpiderError;
};

/**
 * Type guard for network-related errors
 */
export const isNetworkError = (error: unknown): error is NetworkError | TimeoutError => {
  return error instanceof NetworkError || error instanceof TimeoutError;
};

/**
 * Type guard for browser-related errors
 */
export const isBrowserError = (error: unknown): error is BrowserError | PageError => {
  return error instanceof BrowserError || error instanceof PageError;
};

/**
 * Union type of all Spider errors (public API)
 */
export type AllSpiderErrors =
  | SpiderError
  | NetworkError
  | TimeoutError
  | ResponseError
  | ParseError
  | ValidationError
  | ConfigurationError
  | ConfigError
  | MiddlewareError
  | FileSystemError
  | PersistenceError
  | ContentTypeError
  | RequestAbortError
  | AdapterNotInitialisedError
  | BrowserError
  | BrowserCleanupError
  | PageError
  | StateError
  | SessionError
  | CrawlError
  | QueueError;
