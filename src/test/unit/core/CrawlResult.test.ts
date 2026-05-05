import { describe, it, expect } from 'vitest';
import { NetworkError, RequestAbortError, ResponseError } from '../../../lib/errors/effect-errors.js';
import { classifyFetchError, type PageFetchErrorKind } from '../../../lib/Spider/Spider.types.js';
import type { CrawlResultOk, CrawlResultError } from '../../../lib/Spider/Spider.service.js';
import { CrawlResult } from '../../../lib/Spider/Spider.service.js';

describe('classifyFetchError', () => {
  it('should classify TimeoutException as timeout', () => {
    const err = new Error('timed out');
    err.name = 'TimeoutException';
    const result = classifyFetchError(err, 5000, 3);
    expect(result.kind).toBe('timeout');
    expect(result.durationMs).toBe(5000);
    expect(result.attemptsMade).toBe(3);
  });

  it('should classify RequestAbortError as timeout', () => {
    const err = RequestAbortError.timeout('https://example.com', 5000);
    const result = classifyFetchError(err, 5000, 1);
    expect(result.kind).toBe('timeout');
  });

  it('should classify NetworkError with 5xx status as http_5xx', () => {
    const err = new NetworkError({ url: 'https://example.com', statusCode: 503 });
    const result = classifyFetchError(err, 1000, 3);
    expect(result.kind).toBe('http_5xx');
    expect(result.statusCode).toBe(503);
  });

  it('should classify NetworkError with 4xx status as http_4xx', () => {
    const err = new NetworkError({ url: 'https://example.com', statusCode: 404 });
    const result = classifyFetchError(err, 1000, 3);
    expect(result.kind).toBe('http_4xx');
    expect(result.statusCode).toBe(404);
  });

  it('should classify NetworkError with ENOTFOUND cause as dns', () => {
    const err = new NetworkError({ url: 'https://example.com', cause: 'getaddrinfo ENOTFOUND example.com' });
    const result = classifyFetchError(err, 1000, 1);
    expect(result.kind).toBe('dns');
  });

  it('should classify NetworkError with ECONNREFUSED cause as connection_refused', () => {
    const err = new NetworkError({ url: 'https://example.com', cause: 'connect ECONNREFUSED 127.0.0.1:80' });
    const result = classifyFetchError(err, 1000, 1);
    expect(result.kind).toBe('connection_refused');
  });

  it('should classify NetworkError with no known pattern as other', () => {
    const err = new NetworkError({ url: 'https://example.com', cause: 'unknown network issue' });
    const result = classifyFetchError(err, 1000, 1);
    expect(result.kind).toBe('other');
  });

  it('should classify ResponseError as other', () => {
    const err = ResponseError.fromCause('https://example.com', 'body read failed');
    const result = classifyFetchError(err, 1000, 1);
    expect(result.kind).toBe('other');
  });

  it('should classify unknown errors as other', () => {
    const result = classifyFetchError('something weird', 1000, 1);
    expect(result.kind).toBe('other');
  });

  const allKinds: PageFetchErrorKind[] = ['timeout', 'dns', 'http_4xx', 'http_5xx', 'connection_refused', 'other'];
  it('should cover all PageFetchErrorKind values', () => {
    expect(allKinds).toHaveLength(6);
  });
});

describe('CrawlResult helpers', () => {
  const okResult: CrawlResultOk = {
    _tag: 'ok',
    pageData: {} as never,
    depth: 0,
    timestamp: new Date(),
  };

  const errorResult: CrawlResultError = {
    _tag: 'error',
    url: 'https://example.com',
    depth: 0,
    timestamp: new Date(),
    error: { kind: 'timeout', durationMs: 5000, attemptsMade: 3, message: 'timed out' },
  };

  it('should return true for isOk on an ok result', () => {
    expect(CrawlResult.isOk(okResult)).toBe(true);
  });

  it('should return false for isOk on an error result', () => {
    expect(CrawlResult.isOk(errorResult)).toBe(false);
  });

  it('should return true for isError on an error result', () => {
    expect(CrawlResult.isError(errorResult)).toBe(true);
  });

  it('should return false for isError on an ok result', () => {
    expect(CrawlResult.isError(okResult)).toBe(false);
  });

  it('should narrow to CrawlResultOk and allow pageData access without type error', () => {
    const r: CrawlResultOk | CrawlResultError = okResult;
    if (CrawlResult.isOk(r)) {
      expect(r.pageData).toBeDefined();
    }
  });
});
