/**
 * Test Context Service - Fixed for TypeScript
 * Provides a managed test environment with Spider instance for real site testing
 */

import { Context, Effect, Layer } from 'effect';
import type { SpiderService } from '../../lib/Spider/Spider.service.js';
import type { RateLimiterServiceInterface } from './RateLimiter.js';
import type { IEffectAssertions } from '../assertions/EffectAssertions.js';
import type { SpiderConfigOptions } from '../../lib/Config/SpiderConfig.service.js';

export interface TestContextShape {
  readonly spider: SpiderService;
  readonly baseUrl: string;
  readonly rateLimiter: RateLimiterServiceInterface;
  readonly assertions: IEffectAssertions;
  readonly cleanup: () => Effect.Effect<void>;
}

export class TestContext extends Context.Tag('TestContext')<
  TestContext,
  TestContextShape
>() {}

export interface TestContextConfig {
  readonly baseUrl?: string;
  readonly spiderConfig?: Partial<SpiderConfigOptions>;
  readonly requestsPerSecond?: number;
  readonly scenarioPath?: string;
}

export class TestContextService {
  static make = (
    config: TestContextConfig = {}
  ): Effect.Effect<TestContextShape, never, SpiderService> =>
    Effect.gen(function* () {
      // Import dependencies dynamically
      const SpiderModule = yield* Effect.promise(
        () => import('../../lib/Spider/Spider.service.js')
      );
      const RateLimiterModule = yield* Effect.promise(
        () => import('./RateLimiter.js')
      );
      const AssertionsModule = yield* Effect.promise(
        () => import('../assertions/EffectAssertions.js')
      );

      // Use real web-scraping.dev URL
      const baseUrl = config.baseUrl ?? 'https://web-scraping.dev';

      // Create rate limiter for respectful testing
      const rateLimiter = yield* RateLimiterModule.RateLimiterService.make({
        requestsPerSecond: config.requestsPerSecond ?? 0.5,
        burstSize: 2,
      });

      // Get Spider service from context
      const spider = yield* SpiderModule.SpiderService;

      // Create assertions helper
      const assertions = AssertionsModule.EffectAssertions.make();

      // Create cleanup function
      const cleanup = (): Effect.Effect<void> =>
        Effect.logInfo('Test cleanup complete');

      const result: TestContextShape = {
        spider,
        baseUrl,
        rateLimiter,
        assertions,
        cleanup,
      };
      return result;
    });

  static withRateLimit = (requestsPerSecond: number) =>
    TestContextService.make({ requestsPerSecond });

  static withScenario = (scenarioPath: string) =>
    TestContextService.make({
      scenarioPath,
      requestsPerSecond: 0.5,
    });
}

// Scenario paths on web-scraping.dev
export const ScenarioPaths = {
  // Static content
  staticPaging: '/products',
  productMarkup: '/product/1',
  hiddenData: '/hidden',

  // Dynamic content
  endlessScroll: '/scroll',
  buttonLoading: '/load-more',
  graphql: '/graphql',

  // Authentication
  apiToken: '/api-auth',
  cookieAuth: '/cookie-auth',
  csrf: '/csrf',

  // Special scenarios
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

// Layer for providing TestContext in tests
export const TestContextLive = Layer.effect(
  TestContext,
  TestContextService.make(defaultTestConfig)
);
