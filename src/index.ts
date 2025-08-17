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
export * from './lib/Robots/Robots.service.js';
export * from './lib/Scraper/Scraper.service.js';
export * from './lib/PageData/PageData.js';

// Export SpiderConfig types, class, and factory function
export type {
  SpiderConfigOptions,
  SpiderConfigService,
} from './lib/Config/SpiderConfig.service.js';
export {
  SpiderConfig,
  makeSpiderConfig,
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
  CrawlResult,
  CrawlTask,
  SpiderLinkExtractionOptions,
} from './lib/Spider/Spider.service.js';

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

// Export Error types
export {
  NetworkError,
  ResponseError,
  RobotsTxtError,
  ConfigurationError,
  MiddlewareError,
  FileSystemError,
  PersistenceError,
} from './lib/errors.js';
export type { SpiderError } from './lib/errors.js';

// Export Logging types and service
export type {
  SpiderLogEvent,
  SpiderLogger,
} from './lib/Logging/SpiderLogger.service.js';
export {
  SpiderLogger as SpiderLoggerTag,
  makeSpiderLogger,
  SpiderLoggerLive,
} from './lib/Logging/SpiderLogger.service.js';

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
} from './lib/StateManager/index.js';

// Export Web Scraping Engine
export type {
  LoginCredentials,
  ScrapingSession,
  WebScrapingEngineService,
} from './lib/WebScrapingEngine/index.js';
export {
  WebScrapingEngine,
  makeWebScrapingEngine,
  WebScrapingEngineLive,
} from './lib/WebScrapingEngine/index.js';
