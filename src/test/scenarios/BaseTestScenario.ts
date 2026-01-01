/**
 * Base Test Scenario - Fixed Version
 * Abstract base class for all test scenarios
 */

import { Data, DateTime, Effect, Option } from 'effect';
import { TestContext, type TestContextShape } from '../infrastructure/TestContext.js';
import type { ScenarioConfig } from './ScenarioConfig.js';

/**
 * Simple scenario result type
 */
export interface SimpleScenarioResult<T = unknown> {
  readonly scenario: string;
  readonly success: boolean;
  readonly data?: T;
  readonly error?: Error;
  readonly duration: number;
  readonly requestCount: number;
  readonly validationResults?: string;
}

/**
 * Base error type for test scenarios using Effect's TaggedError pattern
 */
export class TestError extends Data.TaggedError('TestError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  override get name(): string {
    return 'TestError';
  }
}

/**
 * Scenario-specific error
 */
export class ScenarioError extends Data.TaggedError('ScenarioError')<{
  readonly scenario: string;
  readonly message: string;
  readonly cause?: unknown;
}> {
  override get name(): string {
    return 'ScenarioError';
  }

  get formattedMessage(): string {
    return `[${this.scenario}] ${this.message}`;
  }
}

/**
 * Abstract base class for test scenarios
 */
export abstract class BaseTestScenario<TResult = unknown> {
  protected startTime: Option.Option<number> = Option.none();
  protected requestCount: number = 0;

  constructor(
    protected readonly scenarioName: string,
    protected readonly config: ScenarioConfig
  ) {}

  /**
   * Setup the test scenario
   */
  setup(): Effect.Effect<TestContextShape, TestError, TestContext> {
    const self = this;
    return Effect.gen(function* () {
      yield* Effect.logInfo(`Setting up scenario: ${self.scenarioName}`);
      const now = yield* DateTime.now;
      self.startTime = Option.some(DateTime.toEpochMillis(now));
      self.requestCount = 0;

      // Get test context from dependency
      const context = yield* TestContext;

      // Apply rate limiting if specified
      const rateLimit = Option.fromNullable(self.config.rateLimit);
      if (Option.isSome(rateLimit)) {
        yield* context.rateLimiter.setRate(rateLimit.value);
      }

      return context;
    });
  }

  /**
   * Execute the test scenario
   */
  abstract execute(
    context: TestContextShape
  ): Effect.Effect<TResult, TestError, TestContext>;

  /**
   * Validate the results
   */
  abstract validate(
    result: TResult
  ): Effect.Effect<boolean, TestError, TestContext>;

  /**
   * Cleanup after the test
   */
  cleanup(): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      yield* Effect.logInfo(`Cleaning up scenario: ${self.scenarioName}`);
      const now = yield* DateTime.now;
      const currentMs = DateTime.toEpochMillis(now);
      const startMs = Option.getOrElse(self.startTime, () => currentMs);
      const duration = currentMs - startMs;
      yield* Effect.logInfo(
        `Scenario completed in ${duration}ms with ${self.requestCount} requests`
      );

      // Reset state
      self.startTime = Option.none();
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
      const result = yield* self.execute(context);
      const isValid = yield* self.validate(result);

      const now = yield* DateTime.now;
      const currentMs = DateTime.toEpochMillis(now);
      const startMs = Option.getOrElse(self.startTime, () => currentMs);

      const scenarioResult: SimpleScenarioResult<TResult> = {
        scenario: self.scenarioName,
        success: isValid,
        data: result,
        duration: currentMs - startMs,
        requestCount: self.requestCount,
        validationResults: isValid
          ? 'All validations passed'
          : 'Some validations failed',
      };

      return scenarioResult;
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const now = yield* DateTime.now;
          const currentMs = DateTime.toEpochMillis(now);
          const startMs = Option.getOrElse(self.startTime, () => currentMs);

          const failedResult: SimpleScenarioResult<TResult> = {
            scenario: self.scenarioName,
            success: false,
            error:
              error instanceof Error
                ? error
                : new TestError({ message: String(error) }),
            duration: currentMs - startMs,
            requestCount: self.requestCount,
          };

          return failedResult;
        })
      ),
      Effect.ensuring(self.cleanup())
    );
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
    return new ScenarioError({
      scenario: this.scenarioName,
      message,
      cause,
    });
  }
}
