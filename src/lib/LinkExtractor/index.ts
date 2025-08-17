/**
 * Advanced link extraction functionality for the Spider framework.
 *
 * This module provides Scrapy-equivalent link extraction capabilities with support for:
 * - CSS selector-based extraction
 * - Pattern-based filtering (allow/deny regex patterns)
 * - Domain-based filtering
 * - URL canonicalization
 * - Duplicate removal
 * - Comprehensive extraction statistics
 *
 * @example
 * ```typescript
 * import { LinkExtractorService, type LinkExtractorConfig } from '@jambudipa.io/spider/LinkExtractor';
 *
 * const program = Effect.gen(function* () {
 *   const extractor = yield* LinkExtractorService;
 *
 *   const result = yield* extractor.extractLinks(
 *     htmlContent,
 *     'https://example.com',
 *     {
 *       allowPatterns: [/\/articles\/\d+/],
 *       restrictCss: ['.content a'],
 *       canonicalize: true
 *     }
 *   );
 *
 *   console.log(`Extracted ${result.links.length} links`);
 * });
 * ```
 *
 * @group LinkExtractor
 * @public
 */

export {
  LinkExtractorService,
  LinkExtractorServiceLayer,
  type LinkExtractorConfig,
  type LinkExtractionResult,
  type LinkExtractorServiceInterface,
  LinkExtractionError,
} from './LinkExtractor.service.js';
