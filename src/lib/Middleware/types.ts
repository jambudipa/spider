/**
 * Data type definitions for Spider Middleware
 * Using Effect's Data.Class for immutability and built-in equality
 */

import { Data, Option } from 'effect';
import { PageData } from '../PageData/PageData.js';

/**
 * Represents a single crawling task with URL and depth information.
 * Used internally by the Spider service for task management.
 */
export interface CrawlTask {
  /** The URL to be crawled */
  url: string;
  /** The depth level of this URL relative to the starting URL */
  depth: number;
  /** The URL from which this URL was discovered (optional) */
  fromUrl?: string;
  /** Optional metadata to be passed through to the result */
  metadata?: Record<string, unknown>;
  /** Optional data extraction configuration */
  extractData?: Record<string, any>;
}

/**
 * Request object used in the middleware pipeline.
 * 
 * Contains the crawl task along with optional headers and metadata
 * that can be modified by middleware during processing.
 * 
 * Uses Data.Class for:
 * - Built-in equality checking
 * - Immutability by default
 * - Better pattern matching support
 * 
 * @group Data Types
 * @public
 */
export class SpiderRequest extends Data.Class<{
  /** The crawl task containing URL and depth information */
  readonly task: CrawlTask;
  /** HTTP headers to include with the request */
  readonly headers: Option.Option<Record<string, string>>;
  /** Additional metadata that can be used by middleware */
  readonly meta: Option.Option<Record<string, unknown>>;
}> {
  /**
   * Create a SpiderRequest from a CrawlTask
   */
  static fromTask(
    task: CrawlTask,
    headers?: Record<string, string>,
    meta?: Record<string, unknown>
  ): SpiderRequest {
    return new SpiderRequest({
      task,
      headers: Option.fromNullable(headers),
      meta: Option.fromNullable(meta),
    });
  }

  /**
   * Add or update headers
   */
  withHeaders(headers: Record<string, string>): SpiderRequest {
    const existingHeaders = Option.getOrElse(this.headers, () => ({}));
    return new SpiderRequest({
      ...this,
      headers: Option.some({ ...existingHeaders, ...headers }),
    });
  }

  /**
   * Add or update metadata
   */
  withMeta(meta: Record<string, unknown>): SpiderRequest {
    const existingMeta = Option.getOrElse(this.meta, () => ({}));
    return new SpiderRequest({
      ...this,
      meta: Option.some({ ...existingMeta, ...meta }),
    });
  }
}

/**
 * Response object used in the middleware pipeline.
 * 
 * Contains the extracted page data along with optional HTTP response
 * information and metadata from middleware processing.
 * 
 * Uses Data.Class for:
 * - Built-in equality checking
 * - Immutability by default
 * - Better pattern matching support
 * 
 * @group Data Types
 * @public
 */
export class SpiderResponse extends Data.Class<{
  /** The extracted page data including content, links, and metadata */
  readonly pageData: PageData;
  /** HTTP status code of the response */
  readonly statusCode: Option.Option<number>;
  /** HTTP response headers */
  readonly headers: Option.Option<Record<string, string>>;
  /** Additional metadata from middleware processing */
  readonly meta: Option.Option<Record<string, unknown>>;
}> {
  /**
   * Create a SpiderResponse from PageData
   */
  static fromPageData(
    pageData: PageData,
    statusCode?: number,
    headers?: Record<string, string>,
    meta?: Record<string, unknown>
  ): SpiderResponse {
    return new SpiderResponse({
      pageData,
      statusCode: Option.fromNullable(statusCode),
      headers: Option.fromNullable(headers),
      meta: Option.fromNullable(meta),
    });
  }

  /**
   * Update the page data
   */
  withPageData(pageData: PageData): SpiderResponse {
    return new SpiderResponse({
      ...this,
      pageData,
    });
  }

  /**
   * Add or update metadata
   */
  withMeta(meta: Record<string, unknown>): SpiderResponse {
    const existingMeta = Option.getOrElse(this.meta, () => ({}));
    return new SpiderResponse({
      ...this,
      meta: Option.some({ ...existingMeta, ...meta }),
    });
  }

  /**
   * Check if the response was successful (2xx status code)
   */
  isSuccessful(): boolean {
    return Option.match(this.statusCode, {
      onNone: () => true, // Assume success if no status code
      onSome: (code) => code >= 200 && code < 300,
    });
  }
}