// Export clean API facades for documentation
export type {
  ISpider,
  ISpiderScheduler,
  IMiddlewareManager,
  IRateLimitMiddleware,
  ILoggingMiddleware,
  IUserAgentMiddleware,
  IStatsMiddleware,
} from './lib/api-facades.js';

// Export actual implementations (keep existing exports for functionality)
export * from './lib/Spider/Spider.service.js';
export { SPIDER_DEFAULTS } from './lib/Spider/Spider.defaults.js';
export * from './lib/Robots/Robots.service.js';
export * from './lib/Scraper/Scraper.service.js';
export * from './lib/PageData/PageData.js';

// Export SpiderConfig types, class, and factory function
export type {
  SpiderConfigOptions,
  SpiderConfigService,
  DomainEquivalenceConfig,
  FetchRetryConfig,
  RetryableErrorKind,
  CrossDomainRedirectConfig,
  UserAgentStrategy,
  FileExtensionFilters,
  TechnicalFilters,
  StopMode,
  ResolvedStopMode,
  DomainRetryConfig,
  DomainRetryPredicate,
  DomainRetryPassOverrides,
  DomainCompleteReason,
} from './lib/Config/SpiderConfig.service.js';
export {
  SpiderConfig,
  makeSpiderConfig,
  buildFetchRetrySchedule,
  defaultDomainEquivalence,
  defaultFetchRetry,
  defaultCrossDomainRedirects,
  defaultDomainRetry,
  resolveUserAgent,
} from './lib/Config/SpiderConfig.service.js';

// Export UrlDeduplicator service
export type { IUrlDeduplicator } from './lib/UrlDeduplicator/UrlDeduplicator.service.js';
export { UrlDeduplicatorService } from './lib/UrlDeduplicator/UrlDeduplicator.service.js';

// Export Scheduler types and class
export type { StatePersistence } from './lib/Scheduler/SpiderScheduler.service.js';
export {
  SpiderSchedulerService,
  SpiderStateKey,
  PriorityRequest,
  SpiderState,
} from './lib/Scheduler/SpiderScheduler.service.js';

// Export Middleware types and classes
export type {
  SpiderMiddleware,
  SpiderRequest,
  SpiderResponse,
} from './lib/Middleware/SpiderMiddleware.js';
export {
  MiddlewareManager,
  RateLimitMiddleware,
  LoggingMiddleware,
  UserAgentMiddleware,
  StatsMiddleware,
} from './lib/Middleware/SpiderMiddleware.js';

// Export LinkExtractor types and services
export type {
  LinkExtractorConfig,
  LinkExtractionResult,
  LinkExtractorServiceInterface,
} from './lib/LinkExtractor/LinkExtractor.service.js';
export {
  LinkExtractorService,
  LinkExtractorServiceLayer,
  LinkExtractionError,
} from './lib/LinkExtractor/LinkExtractor.service.js';

// Re-export specific items that tests need
export type {
  CrawlResultOk,
  CrawlResultError,
  CrawlTask,
  SpiderLinkExtractionOptions,
  StartUrlEntry,
} from './lib/Spider/Spider.service.js';
export { CrawlResult } from './lib/Spider/Spider.service.js';
export type {
  PageFetchErrorKind,
  PageFetchError,
} from './lib/Spider/Spider.types.js';

// Export Resumability types and services
export type {
  PersistenceStrategy,
  StateOperation,
  StorageBackend,
  StorageCapabilities,
  HybridPersistenceConfig,
} from './lib/Resumability/types.js';
export type { ResumabilityConfig } from './lib/Resumability/Resumability.service.js';
export {
  StateDelta,
  PersistenceError as ResumabilityError,
  DEFAULT_HYBRID_CONFIG,
} from './lib/Resumability/types.js';
export {
  ResumabilityService,
  ResumabilityConfigs,
  createStateOperation,
} from './lib/Resumability/Resumability.service.js';
export {
  FullStatePersistence,
  DeltaPersistence,
  HybridPersistence,
} from './lib/Resumability/strategies.js';
export { FileStorageBackend } from './lib/Resumability/backends/FileStorageBackend.js';
export type {
  DatabaseClientInterface,
  PostgresStorageConfig,
} from './lib/Resumability/backends/PostgresStorageBackend.js';
export { PostgresStorageBackend } from './lib/Resumability/backends/PostgresStorageBackend.js';

// Export Error types
export {
  NetworkError,
  ResponseError,
  RobotsTxtError,
  ConfigurationError,
  MiddlewareError,
  FileSystemError,
  PersistenceError,
  ContentTypeError,
  RequestAbortError,
  AdapterNotInitialisedError,
  BrowserError,
  BrowserCleanupError,
  TimeoutError,
  ParseError,
  ValidationError,
  PageError,
  StateError,
  SessionError,
  CrawlError,
  QueueError,
  ConfigError,
  isSpiderError,
  isNetworkError,
  isBrowserError,
} from './lib/errors/effect-errors.js';
export type {
  SpiderError,
  AllSpiderErrors,
} from './lib/errors/effect-errors.js';

// Export observability types and service
//
// Spider has two observability surfaces, both overridable by client code:
//
// 1. Logs (debug/info/warn/error messages with structured annotations):
//    flow through Effect's standard `Logger` system. Override with
//    `Logger.replace(Logger.defaultLogger, myLogger)`.
//
// 2. Domain events (`PageScraped`, `DomainComplete`, etc.): emitted to a
//    `SpiderEventSink` service. Override by providing a `Layer.succeed`
//    layer with a custom implementation. Defaults to a no-op sink.
export type {
  SpiderEvent,
  SpiderEventSinkService,
} from './lib/Logging/SpiderEventSink.js';
export {
  SpiderStartEvent,
  SpiderCompleteEvent,
  SpiderErrorEvent,
  DomainStartEvent,
  DomainCompleteEvent,
  DomainRetryScheduledEvent,
  PageScrapedEvent,
  RobotsBlockedEvent,
  SpiderEventSink,
  SpiderEventSinkNoop,
  StartUrlChosenEvent,
  StartUrlRedirectedEvent,
  WorkerInterruptedEvent,
  DomainStoppedEvent,
  SpiderStoppedEvent,
} from './lib/Logging/SpiderEventSink.js';

// Export HTTP Adapter slot (pluggable fetcher). `resolveAdapter` is
// deliberately kept internal — only the contract types and the default
// adapter are public surface.
export type {
  HttpAdapter,
  HttpAdapterRequest,
  HttpAdapterResponse,
  HttpAdapterError,
  HttpAdapterSelector,
} from './lib/HttpAdapter/HttpAdapter.types.js';
export { defaultUndiciAdapter } from './lib/HttpAdapter/defaultUndiciAdapter.js';

// Export HTTP Client components
export type {
  CookieManagerService,
  EnhancedHttpClientService,
  HttpRequestOptions,
  HttpResponse,
  Session,
  Credentials,
  SessionStoreService,
  TokenInfo,
  TokenExtractorService,
} from './lib/HttpClient/index.js';
export {
  CookieManager,
  makeCookieManager,
  CookieManagerLive,
  EnhancedHttpClient,
  makeEnhancedHttpClient,
  EnhancedHttpClientLive,
  SessionStore,
  makeSessionStore,
  SessionStoreLive,
  TokenExtractor,
  makeTokenExtractor,
  TokenExtractorLive,
} from './lib/HttpClient/index.js';

// Export State Manager
export type { Token, StateManagerService } from './lib/StateManager/index.js';
export {
  TokenType,
  StateManager,
  makeStateManager,
  StateManagerLive,
  CSRFTokenNotFoundError,
  APITokenNotFoundError,
  TokenNotFoundError,
  TokenExpiredError,
  StorageKeyNotFoundError,
} from './lib/StateManager/index.js';

// Export Browser Engine
export type {
  BrowserEngineConfig,
  BrowserEngineServiceInterface,
  PageElement,
} from './lib/BrowserEngine/BrowserEngine.service.js';
export {
  BrowserEngineService,
  BrowserEngineLive,
  BrowserEngineWithConfig,
  DEFAULT_BROWSER_ENGINE_CONFIG,
  makeBrowserEngine,
  withBrowser,
} from './lib/BrowserEngine/BrowserEngine.service.js';

// Export Interaction Discovery — the second extraction source alongside
// LinkExtractorService. Where LinkExtractor reads identities out of delivered
// markup, this one drives declared controls and records what they reveal.
export type {
  InteractionControl,
  InteractionDiscoveryServiceInterface,
  InteractionSweepError,
  InteractionSweepOptions,
  InteractionSweepResult,
  RevealedRequest,
  SkippedControl,
} from './lib/InteractionDiscovery/InteractionDiscovery.service.js';
export {
  InteractionDiscoveryService,
  InteractionDiscoveryServiceLayer,
  NoControlsDrivenError,
  NoOracleDeclaredError,
  NothingRevealedError,
  SweepNavigatedAwayError,
  SweepNavigationFailedError,
} from './lib/InteractionDiscovery/InteractionDiscovery.service.js';

// Export Session Validation — proves a session by declared evidence rather
// than by redirect, which reads every route of a client-rendered application
// as public.
export type {
  ContextEvidence,
  SessionValidationReason,
  SessionValidationRequest,
  SessionValidationResult,
  SessionValidationServiceInterface,
  SignedInMarker,
} from './lib/SessionValidation/SessionValidation.service.js';
export {
  SessionValidationService,
  SessionValidationServiceLayer,
  ValidationRouteUnreachableError,
} from './lib/SessionValidation/SessionValidation.service.js';

// Export Web Scraping Engine
export type {
  LoginCredentials,
  ScrapingSession,
  WebScrapingEngineService,
  WebScrapingEngineError,
  HttpOperationError,
  HttpPostOperationError,
} from './lib/WebScrapingEngine/index.js';
export {
  WebScrapingEngine,
  makeWebScrapingEngine,
  WebScrapingEngineLive,
  LoginError,
  SessionNotValidError,
  SessionLoadError,
} from './lib/WebScrapingEngine/index.js';

// Export Worker Health Monitor
export { WorkerHealthMonitor } from './lib/WorkerHealth/WorkerHealthMonitor.service.js';

// Export URL deduplication utilities
export type {
  DeduplicationStrategy,
  UrlWithMetadata,
  NormalizedUrl,
} from './lib/utils/url-deduplication.js';
export {
  DEFAULT_DEDUPLICATION_STRATEGY,
  parseUrl,
  normalizeUrl,
  deduplicateUrls,
  createUrlDeduplicator,
} from './lib/utils/url-deduplication.js';

// Export Effect migration utilities
export {
  safeJsonParse,
  toOption,
  fromPromise,
  cleanupResources,
  matchOption,
} from './lib/utils/effect-migration.js';
