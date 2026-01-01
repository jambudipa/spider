/**
 * Scenario Result Types
 * Result types for test scenario execution
 */

import { Duration, HashSet } from 'effect';

/**
 * Base result for all scenarios
 */
export interface BaseScenarioResult {
  readonly scenario: string;
  readonly success: boolean;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly duration: Duration.Duration;
  readonly requestCount: number;
  readonly errors?: ScenarioError[];
  readonly warnings?: string[];
  readonly metadata?: Record<string, unknown>;
}

/**
 * Scenario error information
 */
export interface ScenarioError {
  readonly type: string;
  readonly message: string;
  readonly timestamp: Date;
  readonly details?: unknown;
  readonly stack?: string;
}

/**
 * Extracted data result
 */
export interface ExtractedData<T = unknown> {
  readonly url: string;
  readonly timestamp: Date;
  readonly data: T;
  readonly validationStatus?: 'valid' | 'invalid' | 'partial';
  readonly validationErrors?: string[];
}

/**
 * Static content scenario result
 */
export interface StaticContentResult extends BaseScenarioResult {
  readonly type: 'static';
  readonly pagesVisited: string[];
  readonly extractedData: ExtractedData[];
  readonly elementsFound: {
    readonly selector: string;
    readonly count: number;
  }[];
}

/**
 * Dynamic content scenario result
 */
export interface DynamicContentResult extends BaseScenarioResult {
  readonly type: 'dynamic';
  readonly scrollsPerformed: number;
  readonly contentLoaded: {
    readonly timestamp: Date;
    readonly itemsCount: number;
  }[];
  readonly extractedData: ExtractedData[];
  readonly networkActivity: {
    readonly requests: number;
    readonly responses: number;
    readonly avgResponseTime: number;
  };
}

/**
 * Authentication scenario result
 */
export interface AuthenticationResult extends BaseScenarioResult {
  readonly type: 'auth';
  readonly authSuccess: boolean;
  readonly authMethod: 'cookie' | 'token' | 'csrf';
  readonly tokenData?: {
    readonly token: string;
    readonly expiresAt?: Date;
    readonly scope?: string[];
  };
  readonly sessionData?: {
    readonly sessionId: string;
    readonly cookies: Record<string, string>;
  };
  readonly protectedResourceAccess: boolean;
}

/**
 * API scenario result
 */
export interface APIScenarioResult extends BaseScenarioResult {
  readonly type: 'api';
  readonly requests: {
    readonly url: string;
    readonly method: string;
    readonly statusCode: number;
    readonly responseTime: number;
    readonly headers: Record<string, string>;
    readonly body?: unknown;
  }[];
  readonly graphqlQueries?: {
    readonly query: string;
    readonly variables?: Record<string, unknown>;
    readonly response: unknown;
  }[];
}

/**
 * File download scenario result
 */
export interface FileDownloadResult extends BaseScenarioResult {
  readonly type: 'download';
  readonly downloadSuccess: boolean;
  readonly fileInfo?: {
    readonly name: string;
    readonly size: number;
    readonly mimeType: string;
    readonly path?: string;
  };
  readonly downloadTime: Duration.Duration;
  readonly downloadSpeed?: number; // bytes per second
}

/**
 * Error scenario result
 */
export interface ErrorScenarioResult extends BaseScenarioResult {
  readonly type: 'error';
  readonly errorType: string;
  readonly errorHandled: boolean;
  readonly retryAttempts: number;
  readonly recoveryStrategy?: string;
  readonly finalOutcome: 'recovered' | 'failed' | 'skipped';
}

/**
 * Union type for all scenario results
 */
export type ScenarioResult =
  | StaticContentResult
  | DynamicContentResult
  | AuthenticationResult
  | APIScenarioResult
  | FileDownloadResult
  | ErrorScenarioResult;

/**
 * Test suite summary
 */
export interface TestSuiteSummary {
  readonly totalScenarios: number;
  readonly passedScenarios: number;
  readonly failedScenarios: number;
  readonly skippedScenarios: number;
  readonly totalDuration: Duration.Duration;
  readonly totalRequests: number;
  readonly averageRequestTime: number;
  readonly scenarioResults: ScenarioResult[];
  readonly coverage: {
    readonly scenarios: string[];
    readonly coverage: number; // percentage
  };
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  readonly avgResponseTime: number;
  readonly minResponseTime: number;
  readonly maxResponseTime: number;
  readonly p50ResponseTime: number;
  readonly p95ResponseTime: number;
  readonly p99ResponseTime: number;
  readonly requestsPerSecond: number;
  readonly bytesTransferred: number;
  readonly errorRate: number;
}

/**
 * Validation summary
 */
export interface ValidationSummary {
  readonly totalFields: number;
  readonly validFields: number;
  readonly invalidFields: number;
  readonly validationRate: number; // percentage
  readonly failedValidations: {
    readonly field: string;
    readonly reason: string;
    readonly occurrences: number;
  }[];
}

/**
 * Create a result summary from individual results
 */
export const createTestSummary = (
  results: ScenarioResult[]
): TestSuiteSummary => {
  const totalScenarios = results.length;
  const passedScenarios = results.filter((r) => r.success).length;
  const failedScenarios = results.filter(
    (r) => !r.success && r.errors?.length
  ).length;
  const skippedScenarios = totalScenarios - passedScenarios - failedScenarios;

  const totalDuration = results.reduce(
    (sum, r) => Duration.sum(sum, r.duration),
    Duration.zero
  );

  const totalRequests = results.reduce((sum, r) => sum + r.requestCount, 0);

  const averageRequestTime =
    totalRequests > 0 ? Duration.toMillis(totalDuration) / totalRequests : 0;

  const scenarios = HashSet.toValues(
    HashSet.fromIterable(results.map((r) => r.scenario))
  );
  const coverage = (passedScenarios / totalScenarios) * 100;

  return {
    totalScenarios,
    passedScenarios,
    failedScenarios,
    skippedScenarios,
    totalDuration,
    totalRequests,
    averageRequestTime,
    scenarioResults: results,
    coverage: {
      scenarios,
      coverage,
    },
  };
};
