/**
 * Test Context Service - Final Fixed Version
 * Provides a managed test environment with Spider instance for real site testing
 */

import { Context, Effect, Layer, pipe } from 'effect';
import { SpiderService } from '../../lib/Spider/Spider.service.js';
import {
  makeSpiderConfig,
  SpiderConfig,
} from '../../lib/Config/SpiderConfig.service.js';
import { SpiderLoggerLive } from '../../lib/Logging/SpiderLogger.service.js';
import { makeTestRateLimiter, RateLimiterService } from './RateLimiter.js';
import { EffectAssertions } from '../assertions/EffectAssertions.js';

export interface TestContext {
  readonly spider: SpiderService;
  readonly baseUrl: string;
  readonly rateLimiter: RateLimiterService;
  readonly assertions: EffectAssertions;
  readonly cleanup: () => Effect.Effect<void, never, never>;
}

export class TestContext extends Context.Tag('TestContext')<
  TestContext,
  TestContext
>() {}

export interface TestContextConfig {
  readonly baseUrl?: string;
  readonly spiderConfig?: any;
  readonly requestsPerSecond?: number;
  readonly scenarioPath?: string;
}

/**
 * Create a test context for running tests
 */
export const createTestContext = (
  config: TestContextConfig = {}
): Effect.Effect<TestContext, never, SpiderService> =>
  Effect.gen(function* () {
    const baseUrl = config.baseUrl ?? 'https://web-scraping.dev';

    // Create rate limiter
    const rateLimiter = yield* makeTestRateLimiter();

    // Get Spider service from context
    const spider = yield* SpiderService;

    // Create assertions helper
    const assertions = EffectAssertions.make();

    // Create cleanup function
    const cleanup = () => Effect.void;

    return {
      spider,
      baseUrl,
      rateLimiter,
      assertions,
      cleanup,
    } as TestContext;
  }) as Effect.Effect<TestContext, never, SpiderService>;

export class TestContextService {
  static make = (
    config: TestContextConfig = {}
  ): Effect.Effect<TestContext, never, SpiderService> =>
    createTestContext(config);

  static withRateLimit = (
    requestsPerSecond: number
  ): Effect.Effect<TestContext, never, SpiderService> =>
    TestContextService.make({ requestsPerSecond });

  static withScenario = (
    scenarioPath: string
  ): Effect.Effect<TestContext, never, SpiderService> =>
    TestContextService.make({
      scenarioPath,
      requestsPerSecond: 0.5,
    });

  /**
   * Create a test context with Spider service provided
   */
  static makeWithSpider = (
    config: TestContextConfig = {}
  ): Effect.Effect<TestContext, never, never> => {
    const spiderConfig = makeSpiderConfig({
      maxPages: 10,
      maxDepth: 2,
      requestDelayMs: 2000,
      userAgent: 'Spider Test Suite',
      ...config.spiderConfig,
    });

    return pipe(
      createTestContext(config),
      Effect.provide(SpiderService.Default),
      Effect.provide(SpiderConfig.Live(spiderConfig)),
      Effect.provide(SpiderLoggerLive)
    );
  };
}

// Scenario paths on web-scraping.dev
export const ScenarioPaths = {
  staticPaging: '/products',
  productMarkup: '/product/1',
  hiddenData: '/hidden',
  endlessScroll: '/scroll',
  buttonLoading: '/load-more',
  graphql: '/graphql',
  apiToken: '/api-auth',
  cookieAuth: '/cookie-auth',
  csrf: '/csrf',
  fileDownload: '/downloads',
  modalPopup: '/modal',
  cookiePopup: '/cookies',
  pdfDownload: '/pdf',
} as const;

// Default test configuration
export const defaultTestConfig: TestContextConfig = {
  baseUrl: 'https://web-scraping.dev',
  requestsPerSecond: 0.5,
};

// Layer for providing TestContext
export const TestContextLive = Layer.effect(
  TestContext,
  TestContextService.make(defaultTestConfig)
);
