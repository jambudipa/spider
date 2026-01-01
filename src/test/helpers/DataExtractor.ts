/**
 * Data Extractor Utilities
 * Specialised extraction methods for web-scraping.dev scenarios
 */

import { Chunk, Effect, Option, Schema } from 'effect';
import { Page } from 'playwright';

export interface Product {
  id?: string;
  title: string;
  price: number;
  description?: string;
  image?: string;
  url?: string;
  inStock?: boolean;
  rating?: number;
  reviews?: number;
}

export interface Testimonial {
  id?: string;
  author: string;
  content: string;
  rating?: number;
  date?: string;
  verified?: boolean;
}

export interface Review {
  id?: string;
  author: string;
  title?: string;
  content: string;
  rating: number;
  date?: string;
  helpful?: number;
  verified?: boolean;
}

// Schema for structured product data from JSON-LD
const StructuredProductDataSchema = Schema.Struct({
  '@id': Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  image: Schema.optional(Schema.String),
  offers: Schema.optional(Schema.Struct({
    price: Schema.optional(Schema.Union(Schema.Number, Schema.String)),
    availability: Schema.optional(Schema.String)
  })),
  aggregateRating: Schema.optional(Schema.Struct({
    ratingValue: Schema.optional(Schema.Union(Schema.Number, Schema.String)),
    reviewCount: Schema.optional(Schema.Union(Schema.Number, Schema.String))
  }))
});

type StructuredProductData = Schema.Schema.Type<typeof StructuredProductDataSchema>;

// Schema for GraphQL response data
const GraphQLResponseSchema = Schema.Struct({
  data: Schema.optional(Schema.Unknown)
});

export class DataExtractor {
  /**
   * Extract products from listing page
   */
  static extractProducts(page: Page): Effect.Effect<Product[]> {
    return Effect.promise(() =>
      page.$$eval('.product', elements =>
        elements.map(el => {
          const getText = (selector: string) =>
            el.querySelector(selector)?.textContent?.trim() || '';

          const getAttr = (selector: string, attr: string) =>
            el.querySelector(selector)?.getAttribute(attr) || '';

          // Extract from web-scraping.dev structure
          const titleElement = el.querySelector('h3 a, .description h3 a');
          const title = titleElement?.textContent?.trim() || '';
          // Access href attribute directly to avoid type assertion
          const url = titleElement?.getAttribute('href') || '';

          // Extract price from the price element
          const priceText = getText('.price');
          const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;

          // Extract description
          const description = getText('.short-description');

          // Extract image
          const image = getAttr('img', 'src');

          // Extract ID from URL if present
          const idMatch = url.match(/\/product\/(\d+)/);
          const id = idMatch ? idMatch[1] : '';

          return {
            id,
            title,
            price,
            description,
            image,
            url,
            inStock: true, // Assume in stock unless marked otherwise
            rating: 0,
            reviews: 0
          };
        })
      )
    );
  }
  
  /**
   * Extract product details from single product page
   */
  static extractProductDetails(page: Page): Effect.Effect<Product> {
    // Interface for raw browser data
    interface RawProductData {
      id: string;
      title: string;
      priceText: string;
      price: number;
      description: string;
      image: string;
      url: string;
      hasOutOfStock: boolean;
      ratingAttr: string;
      reviewsAttr: string;
      jsonLdText: string;
    }

    return Effect.gen(function* () {
      // Extract raw data from browser
      const rawData = yield* Effect.promise(() =>
        page.evaluate((): RawProductData => {
          const getText = (selector: string) =>
            document.querySelector(selector)?.textContent?.trim() || '';

          const getAttr = (selector: string, attr: string) =>
            document.querySelector(selector)?.getAttribute(attr) || '';

          const priceText = getText('.price, .product-price, [data-price], .Price');
          const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;

          // Get JSON-LD text for processing in Node.js
          const jsonLd = document.querySelector('script[type="application/ld+json"]');
          const jsonLdText = jsonLd?.textContent || '{}';

          return {
            id: getAttr('[data-product-id]', 'data-product-id'),
            title: getText('h1, .product-title, [data-title]'),
            priceText,
            price,
            description: getText('.description, .product-description, [data-description]'),
            image: getAttr('.product-image img, img.main-image', 'src'),
            url: window.location.href,
            hasOutOfStock: document.querySelector('.out-of-stock') instanceof Element,
            ratingAttr: getAttr('[data-rating]', 'data-rating'),
            reviewsAttr: getAttr('[data-reviews]', 'data-reviews'),
            jsonLdText
          };
        })
      );

      // Parse structured data in Node.js using Effect Schema
      const structuredData = yield* Schema.decodeUnknown(
        Schema.parseJson(StructuredProductDataSchema)
      )(rawData.jsonLdText).pipe(
        Effect.catchAll(() => Effect.succeed<StructuredProductData>({}))
      );

      // Merge browser data with structured data
      const offersPrice = structuredData.offers?.price;
      const structuredPrice = typeof offersPrice === 'string'
        ? parseFloat(offersPrice)
        : offersPrice;

      const ratingValue = structuredData.aggregateRating?.ratingValue;
      const structuredRating = typeof ratingValue === 'string'
        ? parseFloat(ratingValue)
        : ratingValue;

      const reviewCount = structuredData.aggregateRating?.reviewCount;
      const structuredReviews = typeof reviewCount === 'string'
        ? parseInt(reviewCount, 10)
        : reviewCount;

      return {
        id: rawData.id || structuredData['@id'] || '',
        title: rawData.title || structuredData.name || '',
        price: rawData.price ?? structuredPrice ?? 0,
        description: rawData.description || structuredData.description || '',
        image: rawData.image || structuredData.image || '',
        url: rawData.url,
        inStock: !rawData.hasOutOfStock &&
                 structuredData.offers?.availability !== 'OutOfStock',
        rating: parseFloat(rawData.ratingAttr || '0') ?? structuredRating ?? 0,
        reviews: parseInt(rawData.reviewsAttr || '0', 10) ?? structuredReviews ?? 0
      };
    });
  }
  
  /**
   * Extract testimonials (for endless scroll)
   */
  static extractTestimonials(page: Page): Effect.Effect<Testimonial[]> {
    return Effect.promise(() =>
      page.$$eval('.testimonial', elements =>
        elements.map((el, index) => {
          const getText = (selector: string) =>
            el.querySelector(selector)?.textContent?.trim() || '';

          // Extract star rating from svg elements
          const ratingEl = el.querySelector('.rating');
          let rating = 0;
          if (ratingEl) {
            // Count filled stars (svg elements in rating span)
            const stars = ratingEl.querySelectorAll('svg');
            rating = stars.length || 0;
          }

          // Extract testimonial text from p.text element
          const content = getText('.text, p');

          // Generate synthetic author name since the site uses identicons
          const iconElement = el.querySelector('identicon-svg');
          const username = iconElement?.getAttribute('username') || `User ${index}`;
          const author = username.replace('testimonial-', 'User ').replace('-', ' ');

          return {
            id: username || `testimonial-${index}`,
            author: author,
            content: content,
            rating,
            date: '', // No dates on this site
            verified: false // No verification badges on this site
          };
        })
      )
    );
  }
  
  /**
   * Extract reviews (for button loading)
   */
  static extractReviews(page: Page): Effect.Effect<Review[]> {
    return Effect.promise(() =>
      page.$$eval('.review[data-testid="review"]', elements =>
        elements.map(el => {
          const getText = (selector: string) =>
            el.querySelector(selector)?.textContent?.trim() || '';

          // Extract rating from SVG stars in [data-testid="review-stars"]
          const starsEl = el.querySelector('[data-testid="review-stars"]');
          let rating = 0;
          if (starsEl) {
            // Count filled/active stars or look for data attributes
            const filledStars = starsEl.querySelectorAll('.filled, .active, [fill="#ffc107"]');
            rating = filledStars.length;

            // Fallback: try to extract from attributes or text
            if (rating === 0) {
              const ratingText = starsEl.getAttribute('data-rating') || starsEl.textContent || '';
              rating = parseFloat(ratingText) || 0;
            }
          }

          // Generate author name from review ID (based on web-scraping.dev pattern)
          const reviewId = el.getAttribute('data-review-id') || '';
          // Fix: reviewId is already a string, so the template literal is always truthy
          const author = reviewId ? `Reviewer ${reviewId}` : 'Anonymous';

          return {
            id: reviewId,
            author,
            title: '', // No titles in this review structure
            content: getText('[data-testid="review-text"]'),
            rating,
            date: getText('[data-testid="review-date"]'),
            helpful: 0, // No helpful counts in this structure
            verified: false // No verification system
          };
        })
      )
    );
  }
  
  /**
   * Extract pagination links
   */
  static extractPaginationLinks(page: Page): Effect.Effect<string[]> {
    return Effect.promise(() =>
      page.$$eval('a[href*="page"], .pagination a, .pager a', links =>
        links
          .map(link => link.getAttribute('href') || '')
          .filter(href => href && !href.includes('#') && href.includes('/products'))
      )
    );
  }
  
  /**
   * Extract hidden data from page
   */
  static extractHiddenData(page: Page): Effect.Effect<Record<string, string | string[]>> {
    // Interface for raw browser extraction
    interface RawHiddenData {
      dataAttributes: Record<string, string>;
      hiddenInputs: Record<string, string>;
      metaTags: Record<string, string>;
      scriptTexts: string[];
    }

    return Effect.gen(function* () {
      // Extract raw string data from browser
      const rawData = yield* Effect.promise(() =>
        page.evaluate((): RawHiddenData => {
          const dataAttributes: Record<string, string> = {};
          const hiddenInputs: Record<string, string> = {};
          const metaTags: Record<string, string> = {};
          let scriptTexts: string[] = [];

          // Extract from data attributes
          document.querySelectorAll('[data-hidden], [data-secret], [data-info]').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
              if (attr.name.startsWith('data-')) {
                dataAttributes[attr.name] = attr.value;
              }
            });
          });

          // Extract from hidden inputs - use getAttribute for type-safe access
          document.querySelectorAll('input[type="hidden"]').forEach(input => {
            const name = input.getAttribute('name');
            const value = input.getAttribute('value');
            if (name) hiddenInputs[`hidden_${name}`] = value || '';
          });

          // Extract from meta tags
          document.querySelectorAll('meta[property], meta[name]').forEach(meta => {
            const name = meta.getAttribute('property') || meta.getAttribute('name');
            const content = meta.getAttribute('content');
            if (name && content) metaTags[`meta_${name}`] = content;
          });

          // Extract raw script text for JSON processing in Node.js
          const extractedScripts = Array.from(document.querySelectorAll('script:not([src])'))
            .map(script => script.textContent?.match(/window\.__DATA__ = ({.*?});/))
            .filter((match): match is RegExpMatchArray => Boolean(match))
            .map(match => match[1]);
          scriptTexts = extractedScripts;

          return { dataAttributes, hiddenInputs, metaTags, scriptTexts };
        })
      );

      // Parse script data in Node.js using Effect
      let parsedScriptData = Chunk.empty<unknown>();
      for (const scriptText of rawData.scriptTexts) {
        const parseResult = yield* Schema.decodeUnknown(
          Schema.parseJson(Schema.Unknown)
        )(scriptText).pipe(
          Effect.map(Option.some),
          Effect.catchAll(() => Effect.succeed(Option.none()))
        );
        if (Option.isSome(parseResult)) {
          parsedScriptData = Chunk.append(parsedScriptData, parseResult.value);
        }
      }

      // Merge all data
      const result: Record<string, string | string[]> = {
        ...rawData.dataAttributes,
        ...rawData.hiddenInputs,
        ...rawData.metaTags
      };

      if (!Chunk.isEmpty(parsedScriptData)) {
        // Convert to string for storage (since we need string values)
        const stringified = yield* Schema.encode(
          Schema.parseJson(Schema.Unknown)
        )(Chunk.toReadonlyArray(parsedScriptData)).pipe(
          Effect.catchAll(() => Effect.succeed('[]'))
        );
        result.scriptData = stringified;
      }

      return result;
    });
  }
  
  /**
   * Extract GraphQL data from network requests
   */
  static extractGraphQLData(responseBody: string): Effect.Effect<Option.Option<unknown>> {
    return Schema.decodeUnknown(
      Schema.parseJson(GraphQLResponseSchema)
    )(responseBody).pipe(
      Effect.map(parsed => Option.some(parsed.data ?? parsed)),
      Effect.catchAll(() => Effect.succeed(Option.none()))
    );
  }
  
  /**
   * Extract CSRF token
   */
  static extractCSRFToken(page: Page): Effect.Effect<string> {
    // Interface for raw browser extraction - return individual values instead of JSON
    interface RawCSRFData {
      metaToken: string;
      inputToken: string;
      windowCsrfToken: string;
      windowCsrf: string;
      windowCSRF_TOKEN: string;
    }

    return Effect.gen(function* () {
      const rawData = yield* Effect.promise(() =>
        page.evaluate((): RawCSRFData => {
          // Meta tag
          const metaToken = document.querySelector('meta[name="csrf-token"], meta[name="_csrf"]');
          const metaValue = metaToken?.getAttribute('content') || '';

          // Hidden input - use getAttribute for type-safe access
          const inputToken = document.querySelector('input[name="csrf_token"], input[name="_csrf"], input[name="csrfToken"]');
          const inputValue = inputToken?.getAttribute('value') || '';

          // Extract window config values individually for type-safe access
          let windowCsrfToken = '';
          let windowCsrf = '';
          let windowCSRF_TOKEN = '';

          const configEntries: Array<[string, (val: string) => void]> = [
            ['csrfToken', (val) => { windowCsrfToken = val; }],
            ['_csrf', (val) => { windowCsrf = val; }],
            ['CSRF_TOKEN', (val) => { windowCSRF_TOKEN = val; }]
          ];

          for (const [key, setter] of configEntries) {
            if (Object.prototype.hasOwnProperty.call(window, key)) {
              const descriptor = Object.getOwnPropertyDescriptor(window, key);
              if (descriptor && typeof descriptor.value === 'string') {
                setter(descriptor.value);
              }
            }
          }

          return {
            metaToken: metaValue,
            inputToken: inputValue,
            windowCsrfToken,
            windowCsrf,
            windowCSRF_TOKEN
          };
        })
      );

      if (rawData.metaToken) return rawData.metaToken;
      if (rawData.inputToken) return rawData.inputToken;

      // Check window config values directly
      return rawData.windowCsrfToken || rawData.windowCsrf || rawData.windowCSRF_TOKEN || '';
    });
  }

  /**
   * Extract API token from page
   */
  static extractAPIToken(page: Page): Effect.Effect<string> {
    // Interface for raw browser extraction - return individual values instead of JSON
    interface RawAPITokenData {
      windowApiToken: string;
      windowAPI_TOKEN: string;
      windowApi_key: string;
      windowAPI_KEY: string;
      localStorageToken: string;
      dataAttributeToken: string;
      scriptToken: string;
    }

    return Effect.gen(function* () {
      const rawData = yield* Effect.promise(() =>
        page.evaluate((): RawAPITokenData => {
          // Extract window config values individually for type-safe access
          let windowApiToken = '';
          let windowAPI_TOKEN = '';
          let windowApi_key = '';
          let windowAPI_KEY = '';

          const configEntries: Array<[string, (val: string) => void]> = [
            ['apiToken', (val) => { windowApiToken = val; }],
            ['API_TOKEN', (val) => { windowAPI_TOKEN = val; }],
            ['api_key', (val) => { windowApi_key = val; }],
            ['API_KEY', (val) => { windowAPI_KEY = val; }]
          ];

          for (const [key, setter] of configEntries) {
            if (Object.prototype.hasOwnProperty.call(window, key)) {
              const descriptor = Object.getOwnPropertyDescriptor(window, key);
              if (descriptor && typeof descriptor.value === 'string') {
                setter(descriptor.value);
              }
            }
          }

          // Check localStorage (browser context has access)
          let localStorageToken = '';
          if (typeof window.localStorage !== 'undefined') {
            localStorageToken = window.localStorage.getItem('apiToken') ||
                               window.localStorage.getItem('api_token') ||
                               window.localStorage.getItem('token') || '';
          }

          // Check data attributes
          const dataToken = document.querySelector('[data-api-token], [data-api-key]');
          const dataAttributeToken = dataToken?.getAttribute('data-api-token') ||
                                     dataToken?.getAttribute('data-api-key') || '';

          // Check inline scripts for token patterns
          let scriptToken = '';
          const scripts = Array.from(document.querySelectorAll('script:not([src])'));
          for (const script of scripts) {
            const match = script.textContent?.match(/["']?(?:api[_-]?token|api[_-]?key)["']?\s*[:=]\s*["']([^"']+)["']/i);
            if (match) {
              scriptToken = match[1];
              break;
            }
          }

          return {
            windowApiToken,
            windowAPI_TOKEN,
            windowApi_key,
            windowAPI_KEY,
            localStorageToken,
            dataAttributeToken,
            scriptToken
          };
        })
      );

      // Check window config values directly
      const windowToken = rawData.windowApiToken || rawData.windowAPI_TOKEN ||
                         rawData.windowApi_key || rawData.windowAPI_KEY;
      if (windowToken) return windowToken;

      // Then localStorage
      if (rawData.localStorageToken) return rawData.localStorageToken;

      // Then data attributes
      if (rawData.dataAttributeToken) return rawData.dataAttributeToken;

      // Finally script tokens
      return rawData.scriptToken;
    });
  }
}