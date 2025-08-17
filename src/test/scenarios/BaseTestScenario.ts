/**
 * Base Test Scenario - Fixed Version
 * Abstract base class for all test scenarios
 */

import { Effect } from 'effect';
import { TestContext } from '../infrastructure/TestContext.js';
import type { ScenarioConfig } from './ScenarioConfig.js';

/**
 * Simple scenario result type
 */
export interface SimpleScenarioResult<T = any> {
  readonly scenario: string;
  readonly success: boolean;
  readonly data?: T;
  readonly error?: Error;
  readonly duration: number;
  readonly requestCount: number;
  readonly validationResults?: string;
}

/**
 * Base error type for test scenarios
 */
export class TestError extends Error {
  readonly _tag: string = 'TestError';
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'TestError';
  }
}

/**
 * Scenario-specific error
 */
export class ScenarioError extends TestError {
  override readonly _tag: string = 'ScenarioError';
  constructor(
    readonly scenario: string,
    message: string,
    cause?: unknown
  ) {
    super(`[${scenario}] ${message}`, cause);
    this.name = 'ScenarioError';
  }
}

/**
 * Abstract base class for test scenarios
 */
export abstract class BaseTestScenario<TResult = any> {
  protected startTime?: number;
  protected requestCount: number = 0;

  constructor(
    protected readonly scenarioName: string,
    protected readonly config: ScenarioConfig
  ) {}

  /**
   * Setup the test scenario
   */
  setup(): Effect.Effect<TestContext, TestError, TestContext> {
    const self = this;
    return Effect.gen(function* () {
      console.log(`Setting up scenario: ${self.scenarioName}`);
      self.startTime = Date.now();
      self.requestCount = 0;

      // Get test context from dependency
      const context = yield* TestContext;

      // Apply rate limiting if specified
      if (self.config.rateLimit) {
        yield* context.rateLimiter.setRate(self.config.rateLimit);
      }

      return context;
    });
  }

  /**
   * Execute the test scenario
   */
  abstract execute(
    context: TestContext
  ): Effect.Effect<TResult, TestError, any>;

  /**
   * Validate the results
   */
  abstract validate(result: TResult): Effect.Effect<boolean, TestError, any>;

  /**
   * Cleanup after the test
   */
  cleanup(): Effect.Effect<void, never, never> {
    const self = this;
    return Effect.sync(() => {
      console.log(`Cleaning up scenario: ${self.scenarioName}`);
      const duration = Date.now() - (self.startTime || 0);
      console.log(
        `Scenario completed in ${duration}ms with ${self.requestCount} requests`
      );

      // Reset state
      self.startTime = undefined;
      self.requestCount = 0;
    });
  }

  /**
   * Run the complete scenario
   */
  run(): Effect.Effect<SimpleScenarioResult<TResult>, TestError, TestContext> {
    const self = this;
    return Effect.gen(function* () {
      const context = yield* self.setup();

      try {
        const result = yield* self.execute(context);
        const isValid = yield* self.validate(result);

        return {
          scenario: self.scenarioName,
          success: isValid,
          data: result,
          duration: Date.now() - (self.startTime || 0),
          requestCount: self.requestCount,
          validationResults: isValid
            ? 'All validations passed'
            : 'Some validations failed',
        } as SimpleScenarioResult<TResult>;
      } catch (error) {
        return {
          scenario: self.scenarioName,
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          duration: Date.now() - (self.startTime || 0),
          requestCount: self.requestCount,
        } as SimpleScenarioResult<TResult>;
      } finally {
        yield* self.cleanup();
      }
    });
  }

  /**
   * Helper to track requests
   */
  protected trackRequest(): void {
    this.requestCount++;
  }

  /**
   * Helper to create scenario-specific errors
   */
  protected error(message: string, cause?: unknown): ScenarioError {
    return new ScenarioError(this.scenarioName, message, cause);
  }
}
