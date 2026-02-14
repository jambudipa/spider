/**
 * PageData Tests
 * Tests for PageData schema validation and structure
 */

import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import { PageDataSchema, type PageData } from '../../../lib/PageData/PageData.js';

const validPageData: PageData = {
  url: 'https://example.com/page',
  html: '<html><body>Hello</body></html>',
  title: 'Test Page',
  metadata: { description: 'A test page' },
  commonMetadata: {
    description: 'A test page',
    keywords: 'test, page',
  },
  statusCode: 200,
  headers: { 'content-type': 'text/html' },
  fetchedAt: new Date(),
  scrapeDurationMs: 150,
  depth: 0,
};

describe('PageData', () => {
  it('should create a valid PageData object from schema', () => {
    const result = Schema.decodeUnknownSync(PageDataSchema)(validPageData);
    expect(result.url).toBe('https://example.com/page');
    expect(result.title).toBe('Test Page');
    expect(result.statusCode).toBe(200);
    expect(result.depth).toBe(0);
  });

  it('should handle optional metadata fields', () => {
    const minimal: PageData = {
      url: 'https://example.com',
      html: '<html></html>',
      metadata: {},
      statusCode: 200,
      headers: {},
      fetchedAt: new Date(),
      scrapeDurationMs: 50,
      depth: 0,
    };
    const result = Schema.decodeUnknownSync(PageDataSchema)(minimal);
    expect(result.title).toBeUndefined();
    expect(result.commonMetadata).toBeUndefined();
    expect(result.extractedData).toBeUndefined();
  });

  it('should reject invalid URLs', () => {
    const invalid = { ...validPageData, url: 'not-a-url' };
    expect(() => Schema.decodeUnknownSync(PageDataSchema)(invalid)).toThrow();
  });
});
