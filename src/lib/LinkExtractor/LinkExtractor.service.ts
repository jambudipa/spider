import { Data, Effect } from 'effect';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

/**
 * Configuration for link extraction behavior.
 *
 * Focuses purely on HOW to extract links from HTML documents,
 * not on processing or validating the extracted URLs.
 *
 * @example
 * ```typescript
 * // Extract from specific CSS selectors
 * const config: LinkExtractorConfig = {
 *   restrictCss: ['a.product-link', 'form[action]'],
 *   tags: ['a', 'form'],
 *   attrs: ['href', 'action']
 * };
 *
 * // Extract from all standard elements
 * const config: LinkExtractorConfig = {
 *   tags: ['a', 'area', 'form', 'frame', 'iframe'],
 *   attrs: ['href', 'action', 'src']
 * };
 * ```
 *
 * @group LinkExtractor
 * @public
 */
export interface LinkExtractorConfig {
  /**
   * CSS selectors to restrict extraction to specific elements.
   * If specified, only elements matching these selectors will be processed.
   *
   * @example
   * ```typescript
   * restrictCss: [
   *   'a.product-link',     // Only product links
   *   '.content a',         // Links within content area
   *   'form[method="post"]' // POST forms only
   * ]
   * ```
   */
  readonly restrictCss?: string[];

  /**
   * HTML tag names to extract links from.
   * Defaults to common link-containing elements.
   *
   * @example ['a', 'area', 'form', 'frame', 'iframe', 'link']
   */
  readonly tags?: string[];

  /**
   * HTML attributes to extract URLs from.
   * Defaults to common URL-containing attributes.
   *
   * @example ['href', 'action', 'src', 'data-url']
   */
  readonly attrs?: string[];

  /**
   * Whether to extract URLs from form input elements.
   * Looks for hidden inputs with URL-like names/values.
   *
   * @default false
   */
  readonly extractFromInputs?: boolean;
}

/**
 * Result of link extraction from an HTML document.
 *
 * Contains the raw extracted URLs without any processing or validation.
 *
 * @group LinkExtractor
 * @public
 */
export interface LinkExtractionResult {
  /**
   * Raw URLs extracted from the HTML document.
   * These are unprocessed and may be relative URLs, fragments, etc.
   */
  readonly links: string[];

  /**
   * Total number of potential URL-containing elements found.
   * Includes elements that didn't yield valid URLs.
   */
  readonly totalElementsProcessed: number;

  /**
   * Breakdown of extraction by element type.
   * Maps element types to the number of URLs extracted from them.
   */
  readonly extractionBreakdown: Record<string, number>;
}

/**
 * Error that can occur during link extraction.
 *
 * @group Errors
 * @public
 */
export class LinkExtractionError extends Data.TaggedError(
  'LinkExtractionError'
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Service interface for extracting links from HTML documents.
 *
 * This service focuses purely on extraction - it does not process,
 * validate, or filter the extracted URLs in any way.
 *
 * @group Services
 * @public
 */
export interface LinkExtractorServiceInterface {
  /**
   * Extracts all URLs from an HTML document based on configuration.
   *
   * This method only extracts URLs from the HTML - it does not:
   * - Validate URLs
   * - Resolve relative URLs to absolute URLs
   * - Apply domain or pattern filtering
   * - Canonicalize URLs
   *
   * URL processing should be handled separately by the consumer.
   *
   * @param html - The HTML content to extract links from
   * @param config - Configuration for extraction behavior
   * @returns Effect containing the extraction result
   *
   * @example
   * ```typescript
   * const extractor = yield* LinkExtractorService;
   * const result = yield* extractor.extractLinks(htmlContent, {
   *   tags: ['a', 'form'],
   *   attrs: ['href', 'action'],
   *   restrictCss: ['.content a']
   * });
   *
   * console.log(`Found ${result.links.length} raw URLs`);
   * // URLs may be relative, absolute, fragments, etc.
   * ```
   */
  extractLinks(
    html: string,
    config?: LinkExtractorConfig
  ): Effect.Effect<LinkExtractionResult, LinkExtractionError>;
}

/**
 * Default configuration for link extraction.
 * Covers the most common HTML elements and attributes that contain URLs.
 */
const DEFAULT_CONFIG: Required<LinkExtractorConfig> = {
  restrictCss: [],
  tags: ['a', 'area', 'form', 'frame', 'iframe', 'link'],
  attrs: ['href', 'action', 'src'],
  extractFromInputs: false,
};

/**
 * Implementation of the LinkExtractorService.
 *
 * Provides pure HTML link extraction without any URL processing.
 *
 * @group Services
 * @public
 */
export class LinkExtractorService extends Effect.Service<LinkExtractorService>()(
  '@jambudipa.io/LinkExtractorService',
  {
    effect: Effect.succeed({
      extractLinks: (html: string, config?: LinkExtractorConfig) =>
        Effect.gen(function* () {
          const finalConfig = { ...DEFAULT_CONFIG, ...config };

          try {
            const result = extractRawLinks(html, finalConfig);
            return result;
          } catch (error) {
            return yield* Effect.fail(
              new LinkExtractionError({
                message: `Failed to extract links from HTML: ${error instanceof Error ? error.message : String(error)}`,
                cause: error,
              })
            );
          }
        }),
    }),
  }
) {}

/**
 * Default layer for LinkExtractorService.
 *
 * @group Layers
 * @public
 */
export const LinkExtractorServiceLayer = LinkExtractorService.Default;

/**
 * Pure function that extracts URLs from HTML without any processing.
 *
 * This function only extracts raw URL strings from HTML elements.
 * It does not validate, resolve, or process the URLs in any way.
 */
const extractRawLinks = (
  html: string,
  config: Required<LinkExtractorConfig>
): LinkExtractionResult => {
  const $ = cheerio.load(html);
  const foundUrls: string[] = [];
  const extractionBreakdown: Record<string, number> = {};
  let totalElementsProcessed = 0;

  // Helper to extract URL from element attribute
  const extractUrlFromAttribute = (
    element: Element,
    attr: string
  ): string | null => {
    const value = $(element).attr(attr);
    if (!value || !value.trim()) return null;
    return value.trim(); // Return raw URL without any processing
  };

  // Helper to track extraction
  const trackExtraction = (elementType: string, url: string | null) => {
    totalElementsProcessed++;
    if (url) {
      foundUrls.push(url);
      extractionBreakdown[elementType] =
        (extractionBreakdown[elementType] || 0) + 1;
    }
  };

  if (config.restrictCss.length > 0) {
    // Use restricted CSS selectors
    config.restrictCss.forEach((cssSelector) => {
      $(cssSelector).each((_, element) => {
        const tagName = (element as Element).name?.toLowerCase() || 'unknown';

        // Extract from all configured attributes
        config.attrs.forEach((attr) => {
          const url = extractUrlFromAttribute(element as Element, attr);
          if (url) trackExtraction(tagName, url);
        });
      });
    });
  } else {
    // Extract from all configured tag/attribute combinations
    config.tags.forEach((tag) => {
      config.attrs.forEach((attr) => {
        $(`${tag}[${attr}]`).each((_, element) => {
          const url = extractUrlFromAttribute(element as Element, attr);
          trackExtraction(tag, url);
        });
      });
    });
  }

  // Extract from form inputs if configured
  if (config.extractFromInputs) {
    $('input[type="hidden"]').each((_, element) => {
      const name = $(element).attr('name')?.toLowerCase() || '';
      const value = $(element).attr('value');

      // Look for URL-like names or values
      if (
        (name.includes('url') ||
          name.includes('redirect') ||
          name.includes('next')) &&
        value?.trim()
      ) {
        trackExtraction('input', value.trim());
      }
    });
  }

  return {
    links: foundUrls,
    totalElementsProcessed,
    extractionBreakdown,
  };
};

// LinkExtractionError is already exported above via export class
