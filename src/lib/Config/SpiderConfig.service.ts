import { Chunk, Effect, Layer, Option } from 'effect';

/**
 * File extension filter categories based on Scrapy's IGNORED_EXTENSIONS.
 * Each category can be individually enabled/disabled for flexible filtering.
 *
 * @group Configuration
 * @public
 */
export interface FileExtensionFilters {
  /** Archive files: 7z, 7zip, bz2, rar, tar, tar.gz, xz, zip (default: true) */
  readonly filterArchives: boolean;
  /** Image files: jpg, png, gif, svg, webp, etc. (default: true) */
  readonly filterImages: boolean;
  /** Audio files: mp3, wav, ogg, aac, etc. (default: true) */
  readonly filterAudio: boolean;
  /** Video files: mp4, avi, mov, webm, etc. (default: true) */
  readonly filterVideo: boolean;
  /** Office documents: pdf, doc, xls, ppt, odt, etc. (default: true) */
  readonly filterOfficeDocuments: boolean;
  /** Other files: css, js, exe, bin, rss, etc. (default: true) */
  readonly filterOther: boolean;
}

/**
 * Technical URL filtering options based on Scrapy's validation rules.
 * These filters help ensure only valid, crawlable URLs are processed.
 *
 * @group Configuration
 * @public
 */
export interface TechnicalFilters {
  /** Filter URLs with unsupported schemes (default: true - only http/https/file/ftp allowed) */
  readonly filterUnsupportedSchemes: boolean;
  /** Filter URLs exceeding maximum length (default: true - 2083 chars like Scrapy) */
  readonly filterLongUrls: boolean;
  /** Maximum URL length in characters (default: 2083) */
  readonly maxUrlLength: number;
  /** Filter malformed/invalid URLs (default: true) */
  readonly filterMalformedUrls: boolean;
}

/**
 * Configuration options for spider behavior and limits.
 *
 * Controls all aspects of crawling including rate limits, filtering rules,
 * and behavioral settings. All options have sensible defaults based on Scrapy.
 *
 * @group Configuration
 * @public
 */
export interface SpiderConfigOptions {
  /** Whether to ignore robots.txt files (default: false) */
  readonly ignoreRobotsTxt: boolean;
  /** Maximum number of concurrent worker fibers (default: 5) */
  readonly maxConcurrentWorkers: number;
  /** Concurrency level for crawling multiple starting URLs (default: 4) */
  readonly concurrency: number | 'unbounded' | 'inherit';
  /** Base delay between requests in milliseconds (default: 1000) */
  readonly requestDelayMs: number;
  /** Maximum crawl delay from robots.txt in milliseconds (default: 10000 - 10 seconds) */
  readonly maxRobotsCrawlDelayMs: number;
  /** User agent string to send with requests (default: 'JambudipaSpider/1.0') */
  readonly userAgent: string;
  /** Maximum crawl depth, undefined for unlimited (default: undefined) */
  readonly maxDepth?: number;
  /** Maximum pages to crawl, undefined for unlimited (default: undefined) */
  readonly maxPages?: number;
  /** Domains to restrict crawling to (default: undefined - all domains) */
  readonly allowedDomains?: string[];
  /** Domains to exclude from crawling (default: undefined - no blocks) */
  readonly blockedDomains?: string[];
  /** Allowed URL protocols (default: ['http:', 'https:']) */
  readonly allowedProtocols: string[];
  /** Whether to follow HTTP redirects (default: true) */
  readonly followRedirects: boolean;
  /** Whether to respect rel="nofollow" attributes (default: true) */
  readonly respectNoFollow: boolean;
  /**
   * File extension filtering configuration.
   * When undefined, uses default Scrapy-equivalent filtering (all categories enabled).
   * Set to override default behavior for each category.
   *
   * @example
   * ```typescript
   * // Allow images but filter everything else
   * fileExtensionFilters: {
   *   filterArchives: true,
   *   filterImages: false,  // Allow images
   *   filterAudio: true,
   *   filterVideo: true,
   *   filterOfficeDocuments: true,
   *   filterOther: true
   * }
   * ```
   */
  readonly fileExtensionFilters?: FileExtensionFilters;
  /**
   * Technical URL filtering configuration.
   * When undefined, uses default Scrapy-equivalent filtering (all enabled).
   *
   * @example
   * ```typescript
   * // Disable URL length filtering for special cases
   * technicalFilters: {
   *   filterUnsupportedSchemes: true,
   *   filterLongUrls: false,  // Allow long URLs
   *   maxUrlLength: 2083,
   *   filterMalformedUrls: true
   * }
   * ```
   */
  readonly technicalFilters?: TechnicalFilters;
  /**
   * Custom file extensions to skip (legacy support).
   * When specified, overrides fileExtensionFilters completely.
   * Use fileExtensionFilters for more granular control.
   */
  readonly skipFileExtensions?: string[];
  /** Maximum concurrent requests across all domains (default: 10) */
  readonly maxConcurrentRequests: number;
  /** Maximum requests per second per domain (default: 2) */
  readonly maxRequestsPerSecondPerDomain: number;
  /**
   * Whether to normalize URLs for deduplication (default: true).
   * When enabled, URLs are normalized before checking for duplicates:
   * - Trailing slashes are removed (example.com/path/ becomes example.com/path)
   * - Fragment identifiers are removed (example.com#section becomes example.com)
   * - Default ports are removed (http://example.com:80 becomes http://example.com)
   * - Query parameters are sorted alphabetically
   *
   * This prevents crawling the same content multiple times when URLs differ only
   * in formatting. Set to false if you need to treat these variations as distinct URLs.
   *
   * @default true
   */
  readonly normalizeUrlsForDeduplication: boolean;
  /**
   * Custom URL filter patterns to exclude from crawling.
   * Provides regex patterns that will be tested against URLs to determine if they should be skipped.
   * This is useful for filtering out admin areas, utility pages, or other unwanted URL patterns.
   *
   * @example
   * ```typescript
   * customUrlFilters: [
   *   /\/wp-admin\//i,
   *   /\/wp-content\/uploads\//i,
   *   /\/api\//i
   * ]
   * ```
   *
   * @default undefined
   */
  readonly customUrlFilters?: RegExp[];
  /**
   * Whether to enable resumable crawling support (default: false).
   * When enabled, the spider can save its state and resume interrupted crawls.
   * Requires configuring a StatePersistence implementation.
   *
   * @default false
   */
  readonly enableResumability: boolean;
}

/**
 * Service interface for accessing spider configuration.
 *
 * Provides Effect-wrapped access to all configuration options with
 * validation and computed properties. Used throughout the framework
 * to access settings in a composable way.
 *
 * @group Configuration
 * @public
 */
export interface SpiderConfigService {
  /** Get the complete configuration options */
  getOptions: () => Effect.Effect<SpiderConfigOptions>;
  /** Check if a URL should be followed based on configured rules */
  shouldFollowUrl: (
    _urlString: string,
    _fromUrl?: string,
    _restrictToStartingDomain?: string
  ) => Effect.Effect<{ follow: boolean; reason?: string }>;
  /** Get the configured user agent string */
  getUserAgent: () => Effect.Effect<string>;
  /** Get the request delay in milliseconds */
  getRequestDelay: () => Effect.Effect<number>;
  /** Get the maximum crawl delay from robots.txt in milliseconds */
  getMaxRobotsCrawlDelay: () => Effect.Effect<number>;
  /** Check if robots.txt should be ignored */
  shouldIgnoreRobotsTxt: () => Effect.Effect<boolean>;
  /** Get maximum concurrent workers */
  getMaxConcurrentWorkers: () => Effect.Effect<number>;
  /**
   * Get maximum crawl depth (undefined if unlimited).
   *
   * Crawl depth refers to the number of link hops from the starting URL(s).
   * For example:
   * - Depth 0: Only the initial URL(s) are crawled
   * - Depth 1: Initial URLs + all links found on those pages
   * - Depth 2: Initial URLs + links from depth 1 + links found on depth 1 pages
   *
   * Cross-domain behavior: Depth counting applies only within allowed domains.
   * If `allowedDomains` is configured, links to external domains are not followed
   * regardless of depth. If no domain restrictions are set, depth applies across
   * all domains encountered.
   */
  getMaxDepth: () => Effect.Effect<number | undefined>;
  /** Get maximum pages to crawl (undefined if unlimited) */
  getMaxPages: () => Effect.Effect<number | undefined>;
  /** Check if redirects should be followed */
  shouldFollowRedirects: () => Effect.Effect<boolean>;
  /** Check if nofollow attributes should be respected */
  shouldRespectNoFollow: () => Effect.Effect<boolean>;
  /** Get file extensions to skip */
  getSkipFileExtensions: () => Effect.Effect<string[]>;
  /** Get maximum concurrent requests across all domains */
  getMaxConcurrentRequests: () => Effect.Effect<number>;
  /** Get maximum requests per second per domain */
  getMaxRequestsPerSecondPerDomain: () => Effect.Effect<number>;
  /** Check if URLs should be normalized for deduplication */
  shouldNormalizeUrlsForDeduplication: () => Effect.Effect<boolean>;
  /** Get the concurrency level for crawling multiple starting URLs */
  getConcurrency: () => Effect.Effect<number | 'unbounded' | 'inherit'>;
  /** Check if resumable crawling is enabled */
  isResumabilityEnabled: () => Effect.Effect<boolean>;
}

/**
 * The main SpiderConfig service for dependency injection.
 *
 * Provides default configuration that can be overridden using layers.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const config = yield* SpiderConfig;
 *   const userAgent = yield* config.getUserAgent();
 *   console.log(`Using: ${userAgent}`);
 * });
 *
 * await Effect.runPromise(
 *   program.pipe(Effect.provide(SpiderConfig.Default))
 * );
 * ```
 *
 * @group Configuration
 * @public
 */
export class SpiderConfig extends Effect.Service<SpiderConfigService>()(
  '@jambudipa/spiderConfig',
  {
    effect: Effect.sync(() => makeSpiderConfig({})),
  }
) {
  /**
   * Creates a Layer that provides SpiderConfig with custom options
   * @param config - The configuration options or a pre-made SpiderConfigService
   */
  static Live = (config: Partial<SpiderConfigOptions> | SpiderConfigService) =>
    Layer.effect(
      SpiderConfig,
      Effect.succeed('getOptions' in config ? config : makeSpiderConfig(config))
    );
}

/**
 * Creates a SpiderConfigService implementation with custom options.
 *
 * This is the factory function that creates the actual service implementation.
 * Options are merged with defaults, providing a complete configuration.
 *
 * @param options - Partial configuration options to merge with defaults
 * @returns Complete SpiderConfigService implementation
 *
 * @group Configuration
 * @public
 */
/**
 * Common file extension categories for filtering.
 * Based on commonly ignored file types in web scraping (86 total extensions).
 *
 * @internal
 */
const FILE_EXTENSION_CATEGORIES = {
  /** Archive files (8 extensions) */
  archives: ['.7z', '.7zip', '.bz2', '.rar', '.tar', '.tar.gz', '.xz', '.zip'],

  /** Image files (19 extensions) */
  images: [
    '.mng',
    '.pct',
    '.bmp',
    '.gif',
    '.jpg',
    '.jpeg',
    '.png',
    '.pst',
    '.psp',
    '.tif',
    '.tiff',
    '.ai',
    '.drw',
    '.dxf',
    '.eps',
    '.ps',
    '.svg',
    '.cdr',
    '.ico',
    '.webp',
  ],

  /** Audio files (9 extensions) */
  audio: [
    '.mp3',
    '.wma',
    '.ogg',
    '.wav',
    '.ra',
    '.aac',
    '.mid',
    '.au',
    '.aiff',
  ],

  /** Video files (14 extensions) */
  video: [
    '.3gp',
    '.asf',
    '.asx',
    '.avi',
    '.mov',
    '.mp4',
    '.mpg',
    '.qt',
    '.rm',
    '.swf',
    '.wmv',
    '.m4a',
    '.m4v',
    '.flv',
    '.webm',
  ],

  /** Office documents (21 extensions) */
  officeDocuments: [
    '.xls',
    '.xlsm',
    '.xlsx',
    '.xltm',
    '.xltx',
    '.potm',
    '.potx',
    '.ppt',
    '.pptm',
    '.pptx',
    '.pps',
    '.doc',
    '.docb',
    '.docm',
    '.docx',
    '.dotm',
    '.dotx',
    '.odt',
    '.ods',
    '.odg',
    '.odp',
  ],

  /** Other files (16 extensions) */
  other: [
    '.css',
    '.pdf',
    '.exe',
    '.bin',
    '.rss',
    '.dmg',
    '.iso',
    '.apk',
    '.jar',
    '.sh',
    '.rb',
    '.js',
    '.hta',
    '.bat',
    '.cpl',
    '.msi',
    '.msp',
    '.py',
  ],
} as const;

/**
 * Generates file extensions to skip based on filter configuration.
 *
 * @param filters - File extension filter configuration
 * @returns Array of file extensions to skip
 * @internal
 */
const generateSkipExtensions = (filters: FileExtensionFilters): string[] => {
  const categoryChunks = [
    filters.filterArchives
      ? Chunk.fromIterable(FILE_EXTENSION_CATEGORIES.archives)
      : Chunk.empty<string>(),
    filters.filterImages
      ? Chunk.fromIterable(FILE_EXTENSION_CATEGORIES.images)
      : Chunk.empty<string>(),
    filters.filterAudio
      ? Chunk.fromIterable(FILE_EXTENSION_CATEGORIES.audio)
      : Chunk.empty<string>(),
    filters.filterVideo
      ? Chunk.fromIterable(FILE_EXTENSION_CATEGORIES.video)
      : Chunk.empty<string>(),
    filters.filterOfficeDocuments
      ? Chunk.fromIterable(FILE_EXTENSION_CATEGORIES.officeDocuments)
      : Chunk.empty<string>(),
    filters.filterOther
      ? Chunk.fromIterable(FILE_EXTENSION_CATEGORIES.other)
      : Chunk.empty<string>(),
  ] as const;

  return Chunk.toArray(Chunk.flatten(Chunk.fromIterable(categoryChunks)));
};

/**
 * Safely parse a URL string, returning Option.none if invalid.
 *
 * @param urlString - The URL string to parse
 * @returns Option containing the parsed URL or Option.none if invalid
 * @internal
 */
const safeParseUrl: (urlString: string) => Option.Option<URL> =
  Option.liftThrowable((urlString: string) => new URL(urlString));

export const makeSpiderConfig = (
  options: Partial<SpiderConfigOptions> = {}
): SpiderConfigService => {
  // Default file extension filters (all enabled like Scrapy)
  const defaultFileExtensionFilters: FileExtensionFilters = {
    filterArchives: true,
    filterImages: true,
    filterAudio: true,
    filterVideo: true,
    filterOfficeDocuments: true,
    filterOther: true,
  };

  // Default technical filters (all enabled like Scrapy)
  const defaultTechnicalFilters: TechnicalFilters = {
    filterUnsupportedSchemes: true,
    filterLongUrls: true,
    maxUrlLength: 2083, // Scrapy's default
    filterMalformedUrls: true,
  };

  const defaultOptions: SpiderConfigOptions = {
    ignoreRobotsTxt: false,
    maxConcurrentWorkers: 5,
    concurrency: 4,
    requestDelayMs: 1000,
    maxRobotsCrawlDelayMs: 2000, // Maximum 1 second for robots.txt crawl delay
    userAgent: 'JambudipaSpider/1.0',
    allowedProtocols: ['http:', 'https:', 'file:', 'ftp:'], // Scrapy's allowed schemes
    followRedirects: true,
    respectNoFollow: true,
    fileExtensionFilters: defaultFileExtensionFilters,
    technicalFilters: defaultTechnicalFilters,
    maxConcurrentRequests: 10,
    maxRequestsPerSecondPerDomain: 2,
    normalizeUrlsForDeduplication: true,
    enableResumability: false,
  };

  const config: SpiderConfigOptions = {
    ...defaultOptions,
    ...options,
    // Merge nested objects properly
    fileExtensionFilters: options.fileExtensionFilters
      ? {
          ...defaultOptions.fileExtensionFilters,
          ...options.fileExtensionFilters,
        }
      : defaultOptions.fileExtensionFilters,
    technicalFilters: options.technicalFilters
      ? {
          ...defaultOptions.technicalFilters,
          ...options.technicalFilters,
        }
      : defaultOptions.technicalFilters,
  };

  // Determine which extensions to skip
  const skipExtensions =
    config.skipFileExtensions ??
    generateSkipExtensions(
      config.fileExtensionFilters ?? defaultFileExtensionFilters
    );

  return {
    getOptions: () => Effect.succeed(config),

    shouldFollowUrl: (
      urlString: string,
      fromUrl?: string,
      restrictToStartingDomain?: string
    ) =>
      Effect.try({
        try: () => new URL(urlString),
        catch: (error) =>
          error instanceof Error ? error.message : 'Unknown parsing error',
      }).pipe(
        Effect.flatMap((url) =>
          Effect.sync(() => {
            const fromUrlParsed = Option.fromNullable(fromUrl).pipe(
              Option.flatMap((u) => safeParseUrl(u))
            );
            const techFilters =
              config.technicalFilters ?? defaultTechnicalFilters;

            // Domain restriction override for multiple starting URLs
            if (restrictToStartingDomain) {
              const startingDomainUrlOpt = safeParseUrl(restrictToStartingDomain);
              if (Option.isSome(startingDomainUrlOpt)) {
                const startingDomain = startingDomainUrlOpt.value.hostname;
                const isAllowedDomain =
                  url.hostname === startingDomain ||
                  url.hostname.endsWith(`.${startingDomain}`);
                if (!isAllowedDomain) {
                  return {
                    follow: false,
                    reason: `Domain ${url.hostname} restricted to starting domain ${startingDomain}`,
                  };
                }
              }
            }

            // Technical filter: URL length check (Scrapy equivalent)
            if (
              techFilters.filterLongUrls &&
              urlString.length > techFilters.maxUrlLength
            ) {
              return {
                follow: false,
                reason: `URL length ${urlString.length} exceeds maximum ${techFilters.maxUrlLength}`,
              };
            }

            // Technical filter: Protocol/scheme check (Scrapy equivalent)
            if (
              techFilters.filterUnsupportedSchemes &&
              !config.allowedProtocols.includes(url.protocol)
            ) {
              return {
                follow: false,
                reason: `Protocol ${url.protocol} not in allowed schemes: ${config.allowedProtocols.join(', ')}`,
              };
            }

            // Domain allowlist check
            if (config.allowedDomains && config.allowedDomains.length > 0) {
              const isDomainAllowed = config.allowedDomains.some(
                (domain) =>
                  url.hostname === domain || url.hostname.endsWith(`.${domain}`)
              );
              if (!isDomainAllowed) {
                return {
                  follow: false,
                  reason: `Domain ${url.hostname} not in allowlist`,
                };
              }
            }

            // Domain blocklist check
            if (config.blockedDomains && config.blockedDomains.length > 0) {
              const isDomainBlocked = config.blockedDomains.some(
                (domain) =>
                  url.hostname === domain || url.hostname.endsWith(`.${domain}`)
              );
              if (isDomainBlocked) {
                return {
                  follow: false,
                  reason: `Domain ${url.hostname} is blocked`,
                };
              }
            }

            // Custom URL filter check
            if (config.customUrlFilters && config.customUrlFilters.length > 0) {
              for (const pattern of config.customUrlFilters) {
                if (pattern.test(urlString)) {
                  return {
                    follow: false,
                    reason: `URL matches custom filter pattern: ${pattern}`,
                  };
                }
              }
            }

            // Fragment check (skip anchor links to same page)
            if (
              Option.isSome(fromUrlParsed) &&
              url.hostname === fromUrlParsed.value.hostname &&
              url.pathname === fromUrlParsed.value.pathname &&
              url.search === fromUrlParsed.value.search &&
              url.hash
            ) {
              return {
                follow: false,
                reason: 'Fragment-only link to same page',
              };
            }

            // File extension check (Scrapy IGNORED_EXTENSIONS equivalent)
            const pathname = url.pathname.toLowerCase();
            if (
              skipExtensions.some((ext) => pathname.endsWith(ext.toLowerCase()))
            ) {
              // Determine which category was filtered for better error reporting
              const filterReasonChunks = [
                config.fileExtensionFilters?.filterArchives &&
                FILE_EXTENSION_CATEGORIES.archives.some((ext) =>
                  pathname.endsWith(ext.toLowerCase())
                )
                  ? Chunk.of('archive')
                  : Chunk.empty<string>(),
                config.fileExtensionFilters?.filterImages &&
                FILE_EXTENSION_CATEGORIES.images.some((ext) =>
                  pathname.endsWith(ext.toLowerCase())
                )
                  ? Chunk.of('image')
                  : Chunk.empty<string>(),
                config.fileExtensionFilters?.filterAudio &&
                FILE_EXTENSION_CATEGORIES.audio.some((ext) =>
                  pathname.endsWith(ext.toLowerCase())
                )
                  ? Chunk.of('audio')
                  : Chunk.empty<string>(),
                config.fileExtensionFilters?.filterVideo &&
                FILE_EXTENSION_CATEGORIES.video.some((ext) =>
                  pathname.endsWith(ext.toLowerCase())
                )
                  ? Chunk.of('video')
                  : Chunk.empty<string>(),
                config.fileExtensionFilters?.filterOfficeDocuments &&
                FILE_EXTENSION_CATEGORIES.officeDocuments.some((ext) =>
                  pathname.endsWith(ext.toLowerCase())
                )
                  ? Chunk.of('office document')
                  : Chunk.empty<string>(),
                config.fileExtensionFilters?.filterOther &&
                FILE_EXTENSION_CATEGORIES.other.some((ext) =>
                  pathname.endsWith(ext.toLowerCase())
                )
                  ? Chunk.of('other file type')
                  : Chunk.empty<string>(),
              ] as const;

              const filterReasons = Chunk.toArray(
                Chunk.flatten(Chunk.fromIterable(filterReasonChunks))
              );

              const reason =
                filterReasons.length > 0
                  ? `Filtered ${filterReasons.join('/')} file extension`
                  : 'File extension not suitable for crawling';

              return {
                follow: false,
                reason,
              };
            }

            return { follow: true };
          })
        ),
        Effect.catchAll((errorMessage) =>
          Effect.succeed(
            // Technical filter: Malformed URL check (Scrapy equivalent)
            config.technicalFilters?.filterMalformedUrls
              ? {
                  follow: false,
                  reason: `Malformed URL: ${errorMessage}`,
                }
              : // If malformed URL filtering is disabled, silently allow
                { follow: true }
          )
        )
      ),

    getUserAgent: () => Effect.succeed(config.userAgent),
    getRequestDelay: () => Effect.succeed(config.requestDelayMs),
    getMaxRobotsCrawlDelay: () => Effect.succeed(config.maxRobotsCrawlDelayMs),
    shouldIgnoreRobotsTxt: () => Effect.succeed(config.ignoreRobotsTxt),
    getMaxConcurrentWorkers: () => Effect.succeed(config.maxConcurrentWorkers),
    getMaxDepth: () => Effect.succeed(config.maxDepth),
    getMaxPages: () => Effect.succeed(config.maxPages),
    shouldFollowRedirects: () => Effect.succeed(config.followRedirects),
    shouldRespectNoFollow: () => Effect.succeed(config.respectNoFollow),
    getSkipFileExtensions: () =>
      Effect.succeed(config.skipFileExtensions ?? []),
    getMaxConcurrentRequests: () =>
      Effect.succeed(config.maxConcurrentRequests),
    getMaxRequestsPerSecondPerDomain: () =>
      Effect.succeed(config.maxRequestsPerSecondPerDomain),
    shouldNormalizeUrlsForDeduplication: () =>
      Effect.succeed(config.normalizeUrlsForDeduplication),
    getConcurrency: () => Effect.succeed(config.concurrency),
    isResumabilityEnabled: () => Effect.succeed(config.enableResumability),
  };
};
