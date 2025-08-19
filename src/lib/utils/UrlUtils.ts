/**
 * URL Utilities
 * Effect-based URL parsing and validation with proper error handling
 */

import { Effect, Data, Option } from 'effect';

// ============================================================================
// Error Types
// ============================================================================

export type UrlError = UrlParseError | UrlValidationError;

export class UrlParseError extends Data.TaggedError('UrlParseError')<{
  readonly input: string;
  readonly base?: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    const baseInfo = this.base ? ` (base: ${this.base})` : '';
    return `Invalid URL: "${this.input}"${baseInfo}. ${this.cause}`;
  }
}

export class UrlValidationError extends Data.TaggedError('UrlValidationError')<{
  readonly url: string;
  readonly reason: string;
}> {
  get message(): string {
    return `URL validation failed for "${this.url}": ${this.reason}`;
  }
}

// ============================================================================
// URL Operations
// ============================================================================

export const UrlUtils = {
  /**
   * Safely parse URL string
   * 
   * @example
   * ```ts
   * const url = yield* UrlUtils.parse('https://example.com/path');
   * // url: URL object
   * 
   * const relative = yield* UrlUtils.parse('/path', 'https://example.com');
   * // relative: URL object with base
   * ```
   */
  parse: (input: string, base?: string) =>
    Effect.try({
      try: () => new URL(input, base),
      catch: (cause) => new UrlParseError({ input, base, cause })
    }),

  /**
   * Try parse URL, return Option
   * 
   * @example
   * ```ts
   * const maybeUrl = yield* UrlUtils.tryParse('https://example.com');
   * if (Option.isSome(maybeUrl)) {
   *   console.log(maybeUrl.value.hostname);
   * }
   * ```
   */
  tryParse: (input: string, base?: string) =>
    UrlUtils.parse(input, base).pipe(
      Effect.map(Option.some),
      Effect.catchAll(() => Effect.succeed(Option.none()))
    ),

  /**
   * Validate URL format
   * 
   * @example
   * ```ts
   * const valid = yield* UrlUtils.isValid('https://example.com');
   * // valid: true
   * ```
   */
  isValid: (input: string) =>
    UrlUtils.tryParse(input).pipe(
      Effect.map(Option.isSome)
    ),

  /**
   * Normalise URL for consistent comparison
   * 
   * @example
   * ```ts
   * const normalised = yield* UrlUtils.normalise('https://example.com/path/');
   * // Removes trailing slash, sorts query params, etc.
   * ```
   */
  normalise: (input: string) =>
    Effect.gen(function* () {
      const url = yield* UrlUtils.parse(input);
      
      // Remove trailing slash except for root path
      if (url.pathname.endsWith('/') && url.pathname !== '/') {
        url.pathname = url.pathname.slice(0, -1);
      }
      
      // Sort query parameters alphabetically
      if (url.search) {
        const params = new URLSearchParams(url.search);
        const sorted = new URLSearchParams(
          [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
        );
        url.search = sorted.toString();
      }
      
      // Remove default ports
      if (
        (url.protocol === 'http:' && url.port === '80') ||
        (url.protocol === 'https:' && url.port === '443')
      ) {
        url.port = '';
      }
      
      // Lowercase hostname
      url.hostname = url.hostname.toLowerCase();
      
      // Remove fragment for comparison
      url.hash = '';
      
      return url.toString();
    }),

  /**
   * Extract domain from URL
   * 
   * @example
   * ```ts
   * const domain = yield* UrlUtils.getDomain('https://sub.example.com/path');
   * // domain: 'sub.example.com'
   * ```
   */
  getDomain: (input: string) =>
    UrlUtils.parse(input).pipe(
      Effect.map(url => url.hostname)
    ),

  /**
   * Extract origin from URL
   * 
   * @example
   * ```ts
   * const origin = yield* UrlUtils.getOrigin('https://example.com/path');
   * // origin: 'https://example.com'
   * ```
   */
  getOrigin: (input: string) =>
    UrlUtils.parse(input).pipe(
      Effect.map(url => url.origin)
    ),

  /**
   * Check if two URLs have the same origin
   * 
   * @example
   * ```ts
   * const same = yield* UrlUtils.isSameOrigin(
   *   'https://example.com/page1',
   *   'https://example.com/page2'
   * );
   * // same: true
   * ```
   */
  isSameOrigin: (url1: string, url2: string) =>
    Effect.gen(function* () {
      const parsed1 = yield* UrlUtils.parse(url1);
      const parsed2 = yield* UrlUtils.parse(url2);
      return parsed1.origin === parsed2.origin;
    }),

  /**
   * Check if URL is absolute
   * 
   * @example
   * ```ts
   * const absolute = yield* UrlUtils.isAbsolute('https://example.com');
   * // absolute: true
   * 
   * const relative = yield* UrlUtils.isAbsolute('/path');
   * // relative: false
   * ```
   */
  isAbsolute: (input: string) =>
    Effect.succeed(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)),

  /**
   * Join URL paths safely
   * 
   * @example
   * ```ts
   * const joined = yield* UrlUtils.join('https://example.com', 'api', 'users');
   * // joined: 'https://example.com/api/users'
   * ```
   */
  join: (base: string, ...paths: string[]) =>
    Effect.gen(function* () {
      let url = yield* UrlUtils.parse(base);
      
      for (const path of paths) {
        if (path.startsWith('/')) {
          // Absolute path replaces existing path
          url.pathname = path;
        } else {
          // Relative path appends
          const basePath = url.pathname.endsWith('/') 
            ? url.pathname 
            : url.pathname + '/';
          url.pathname = basePath + path;
        }
      }
      
      return url.toString();
    }),

  /**
   * Extract query parameters as object
   * 
   * @example
   * ```ts
   * const params = yield* UrlUtils.getQueryParams('https://example.com?a=1&b=2');
   * // params: { a: '1', b: '2' }
   * ```
   */
  getQueryParams: (input: string) =>
    Effect.gen(function* () {
      const url = yield* UrlUtils.parse(input);
      const params: Record<string, string> = {};
      
      url.searchParams.forEach((value, key) => {
        params[key] = value;
      });
      
      return params;
    }),

  /**
   * Add or update query parameters
   * 
   * @example
   * ```ts
   * const updated = yield* UrlUtils.setQueryParams(
   *   'https://example.com',
   *   { page: '2', limit: '10' }
   * );
   * // updated: 'https://example.com?page=2&limit=10'
   * ```
   */
  setQueryParams: (input: string, params: Record<string, string | number | boolean>) =>
    Effect.gen(function* () {
      const url = yield* UrlUtils.parse(input);
      
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, String(value));
      });
      
      return url.toString();
    }),

  /**
   * Remove query parameters
   * 
   * @example
   * ```ts
   * const cleaned = yield* UrlUtils.removeQueryParams(
   *   'https://example.com?a=1&b=2&c=3',
   *   ['b', 'c']
   * );
   * // cleaned: 'https://example.com?a=1'
   * ```
   */
  removeQueryParams: (input: string, keys: string[]) =>
    Effect.gen(function* () {
      const url = yield* UrlUtils.parse(input);
      
      keys.forEach(key => {
        url.searchParams.delete(key);
      });
      
      return url.toString();
    }),

  /**
   * Check if URL uses HTTPS
   * 
   * @example
   * ```ts
   * const secure = yield* UrlUtils.isSecure('https://example.com');
   * // secure: true
   * ```
   */
  isSecure: (input: string) =>
    UrlUtils.parse(input).pipe(
      Effect.map(url => url.protocol === 'https:')
    ),

  /**
   * Convert HTTP URL to HTTPS
   * 
   * @example
   * ```ts
   * const secure = yield* UrlUtils.toHttps('http://example.com');
   * // secure: 'https://example.com'
   * ```
   */
  toHttps: (input: string) =>
    Effect.gen(function* () {
      const url = yield* UrlUtils.parse(input);
      
      if (url.protocol === 'http:') {
        url.protocol = 'https:';
      }
      
      return url.toString();
    }),

  /**
   * Resolve a relative URL against a base
   * 
   * @example
   * ```ts
   * const resolved = yield* UrlUtils.resolve(
   *   'https://example.com/base/',
   *   '../other/page.html'
   * );
   * // resolved: 'https://example.com/other/page.html'
   * ```
   */
  resolve: (base: string, relative: string) =>
    UrlUtils.parse(relative, base).pipe(
      Effect.map(url => url.toString())
    ),

  /**
   * Extract file extension from URL path
   * 
   * @example
   * ```ts
   * const ext = yield* UrlUtils.getExtension('https://example.com/file.pdf');
   * // ext: Some('.pdf')
   * ```
   */
  getExtension: (input: string) =>
    Effect.gen(function* () {
      const url = yield* UrlUtils.parse(input);
      const path = url.pathname;
      const lastDot = path.lastIndexOf('.');
      const lastSlash = path.lastIndexOf('/');
      
      if (lastDot > lastSlash && lastDot > 0) {
        return Option.some(path.slice(lastDot));
      }
      
      return Option.none();
    }),

  /**
   * Check if URL matches a pattern
   * 
   * @example
   * ```ts
   * const matches = yield* UrlUtils.matchesPattern(
   *   'https://api.example.com/v1/users',
   *   'https://api.example.com/v1/*'
   * );
   * // matches: true
   * ```
   */
  matchesPattern: (url: string, pattern: string) =>
    Effect.gen(function* () {
      const urlParsed = yield* UrlUtils.parse(url);
      const patternParsed = yield* UrlUtils.parse(pattern);
      
      // Check origin match
      if (urlParsed.origin !== patternParsed.origin) {
        return false;
      }
      
      // Convert pattern to regex
      const pathPattern = patternParsed.pathname
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
        .replace(/\*/g, '.*'); // Convert * to .*
      
      const regex = new RegExp(`^${pathPattern}$`);
      return regex.test(urlParsed.pathname);
    })
};

// ============================================================================
// Re-exports for convenience
// ============================================================================

export const {
  parse,
  tryParse,
  isValid,
  normalise,
  getDomain,
  getOrigin,
  isSameOrigin,
  isAbsolute,
  join,
  getQueryParams,
  setQueryParams,
  removeQueryParams,
  isSecure,
  toHttps,
  resolve,
  getExtension,
  matchesPattern
} = UrlUtils;