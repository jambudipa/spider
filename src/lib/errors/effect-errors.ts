/**
 * Effect-based Error Types
 * Comprehensive error hierarchy using Data.TaggedError for type-safe error handling
 */

import { Data } from 'effect';

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
    return `Spider operation '${this.operation}' failed${
      this.details ? `: ${JSON.stringify(this.details)}` : ''
    }`;
  }
}

// ============================================================================
// Network Errors
// ============================================================================

export class NetworkError extends Data.TaggedError('NetworkError')<{
  readonly url: string;
  readonly statusCode?: number;
  readonly method?: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    return `Network request to ${this.url} failed${
      this.statusCode ? ` with status ${this.statusCode}` : ''
    }`;
  }
  
  static fromResponse(url: string, response: Response): NetworkError {
    return new NetworkError({
      url,
      statusCode: response.status,
      method: 'GET'
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
      cause
    });
  }
  
  static html(input: string, cause?: unknown): ParseError {
    return new ParseError({
      input,
      expected: 'HTML',
      cause
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
      constraint: 'Invalid URL format'
    });
  }
}

// ============================================================================
// Browser Errors
// ============================================================================

export class BrowserError extends Data.TaggedError('BrowserError')<{
  readonly operation: string;
  readonly browserId?: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    return `Browser operation '${this.operation}' failed${
      this.browserId ? ` for browser ${this.browserId}` : ''
    }`;
  }
  
  static notLaunched(): BrowserError {
    return new BrowserError({
      operation: 'access',
      cause: 'Browser not launched'
    });
  }
  
  static launchFailed(cause: unknown): BrowserError {
    return new BrowserError({
      operation: 'launch',
      cause
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
      cause: 'No active session'
    });
  }
}

// ============================================================================
// File System Errors
// ============================================================================

export class FileSystemError extends Data.TaggedError('FileSystemError')<{
  readonly path: string;
  readonly operation: 'read' | 'write' | 'delete' | 'create';
  readonly cause?: unknown;
}> {
  get message(): string {
    return `File system ${this.operation} operation failed for path: ${this.path}`;
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
      reason: 'Maximum depth reached'
    });
  }
  
  static robotsBlocked(url: string): CrawlError {
    return new CrawlError({
      url,
      depth: 0,
      reason: 'Blocked by robots.txt'
    });
  }
}

export class QueueError extends Data.TaggedError('QueueError')<{
  readonly operation: 'enqueue' | 'dequeue' | 'peek';
  readonly queueSize?: number;
  readonly cause?: unknown;
}> {
  get message(): string {
    return `Queue ${this.operation} operation failed${
      this.queueSize !== undefined ? ` (queue size: ${this.queueSize})` : ''
    }`;
  }
}

// ============================================================================
// Configuration Errors
// ============================================================================

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
      reason: `Expected ${expected}, got ${typeof value}`
    });
  }
}

// ============================================================================
// Middleware Errors
// ============================================================================

export class MiddlewareError extends Data.TaggedError('MiddlewareError')<{
  readonly middlewareName: string;
  readonly phase: 'request' | 'response' | 'error';
  readonly cause?: unknown;
}> {
  get message(): string {
    return `Middleware '${this.middlewareName}' failed during ${this.phase} phase`;
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
 * Union type of all Spider errors
 */
export type AllSpiderErrors =
  | SpiderError
  | NetworkError
  | TimeoutError
  | ParseError
  | ValidationError
  | BrowserError
  | PageError
  | StateError
  | SessionError
  | FileSystemError
  | CrawlError
  | QueueError
  | ConfigError
  | MiddlewareError;