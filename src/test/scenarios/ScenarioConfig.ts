/**
 * Scenario Configuration Types
 * Configuration types for different test scenarios
 */

import { Duration } from 'effect';

/**
 * Base scenario configuration
 */
export interface BaseScenarioConfig {
  readonly name: string;
  readonly description: string;
  readonly baseUrl: string;
  readonly timeout?: Duration.Duration;
  readonly retryAttempts?: number;
  readonly rateLimit?: number; // requests per second
}

/**
 * Static content scenario configuration
 */
export interface StaticContentConfig extends BaseScenarioConfig {
  readonly type: 'static';
  readonly pagePath: string;
  readonly selectors: {
    readonly content?: string;
    readonly pagination?: string;
    readonly nextLink?: string;
  };
  readonly expectedElements?: {
    readonly selector: string;
    readonly minCount?: number;
    readonly maxCount?: number;
  }[];
}

/**
 * Dynamic content scenario configuration
 */
export interface DynamicContentConfig extends BaseScenarioConfig {
  readonly type: 'dynamic';
  readonly pagePath: string;
  readonly scrollStrategy?: {
    readonly type: 'smooth' | 'instant' | 'incremental';
    readonly maxScrolls?: number;
    readonly scrollDelay?: Duration.Duration;
  };
  readonly waitStrategies?: {
    readonly type: 'selector' | 'network' | 'timeout';
    readonly target?: string;
    readonly timeout?: Duration.Duration;
  }[];
}

/**
 * Authentication scenario configuration
 */
export interface AuthenticationConfig extends BaseScenarioConfig {
  readonly type: 'auth';
  readonly loginPath: string;
  readonly authType: 'cookie' | 'token' | 'csrf';
  readonly credentials?: {
    readonly username?: string;
    readonly password?: string;
  };
  readonly tokenExtraction?: {
    readonly selector?: string;
    readonly header?: string;
    readonly cookie?: string;
  };
}

/**
 * API interaction scenario configuration
 */
export interface APIScenarioConfig extends BaseScenarioConfig {
  readonly type: 'api';
  readonly apiPath: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly headers?: Record<string, string>;
  readonly body?: any;
  readonly responseValidation?: {
    readonly statusCode?: number;
    readonly contentType?: string;
    readonly schema?: any;
  };
}

/**
 * File download scenario configuration
 */
export interface FileDownloadConfig extends BaseScenarioConfig {
  readonly type: 'download';
  readonly downloadPath: string;
  readonly fileType: string;
  readonly triggerType: 'link' | 'button' | 'javascript';
  readonly triggerSelector?: string;
  readonly validateFile?: {
    readonly minSize?: number;
    readonly maxSize?: number;
    readonly mimeType?: string;
  };
}

/**
 * Error handling scenario configuration
 */
export interface ErrorScenarioConfig extends BaseScenarioConfig {
  readonly type: 'error';
  readonly errorType: 'network' | 'timeout' | '404' | '500' | 'blocked';
  readonly expectedBehavior: {
    readonly shouldRetry?: boolean;
    readonly maxRetries?: number;
    readonly backoffStrategy?: 'linear' | 'exponential';
    readonly fallbackAction?: 'skip' | 'fail' | 'default';
  };
}

/**
 * Union type for all scenario configurations
 */
export type ScenarioConfig =
  | StaticContentConfig
  | DynamicContentConfig
  | AuthenticationConfig
  | APIScenarioConfig
  | FileDownloadConfig
  | ErrorScenarioConfig;

/**
 * Scenario registry for web-scraping.dev scenarios
 */
export const ScenarioRegistry = {
  staticPaging: {
    name: 'static-paging',
    description: 'Test static HTML pagination on products page',
    type: 'static',
    baseUrl: 'https://web-scraping.dev',
    pagePath: '/products',
    selectors: {
      content: '.product',
      pagination: '.pagination',
      nextLink: 'a.next, a[rel="next"]',
    },
    expectedElements: [
      { selector: '.product', minCount: 1 },
      { selector: '.pagination', minCount: 0, maxCount: 1 },
    ],
  } as StaticContentConfig,

  endlessScroll: {
    name: 'endless-scroll',
    description: 'Test infinite scroll on testimonials page',
    type: 'dynamic',
    baseUrl: 'https://web-scraping.dev',
    pagePath: '/testimonials',
    scrollStrategy: {
      type: 'incremental',
      maxScrolls: 5,
      scrollDelay: Duration.seconds(2),
    },
    waitStrategies: [
      { type: 'network', timeout: Duration.seconds(5) },
      {
        type: 'selector',
        target: '.testimonial',
        timeout: Duration.seconds(10),
      },
    ],
  } as DynamicContentConfig,

  apiToken: {
    name: 'api-token',
    description: 'Test X-Secret-Token authentication',
    type: 'auth',
    baseUrl: 'https://web-scraping.dev',
    loginPath: '/testimonials',
    authType: 'token',
    tokenExtraction: {
      header: 'X-Secret-Token',
    },
  } as AuthenticationConfig,

  cookieAuth: {
    name: 'cookie-auth',
    description: 'Test cookie-based authentication',
    type: 'auth',
    baseUrl: 'https://web-scraping.dev',
    loginPath: '/login',
    authType: 'cookie',
    credentials: {
      username: 'test',
      password: 'test',
    },
  } as AuthenticationConfig,

  productData: {
    name: 'product-data',
    description: 'Test product data extraction with hidden JSON',
    type: 'static',
    baseUrl: 'https://web-scraping.dev',
    pagePath: '/product/1',
    selectors: {
      content: '.product-detail',
    },
    expectedElements: [
      { selector: '.product-detail', minCount: 1, maxCount: 1 },
      { selector: 'script[type="application/json"]', minCount: 0 },
    ],
  } as StaticContentConfig,

  graphqlApi: {
    name: 'graphql-api',
    description: 'Test GraphQL API interactions',
    type: 'api',
    baseUrl: 'https://web-scraping.dev',
    apiPath: '/graphql',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    responseValidation: {
      statusCode: 200,
      contentType: 'application/json',
    },
  } as APIScenarioConfig,

  pdfDownload: {
    name: 'pdf-download',
    description: 'Test PDF file download',
    type: 'download',
    baseUrl: 'https://web-scraping.dev',
    downloadPath: '/download/sample.pdf',
    fileType: 'pdf',
    triggerType: 'link',
    validateFile: {
      minSize: 1024, // 1KB minimum
      mimeType: 'application/pdf',
    },
  } as FileDownloadConfig,

  blockedPage: {
    name: 'blocked-page',
    description: 'Test blocked page detection and handling',
    type: 'error',
    baseUrl: 'https://web-scraping.dev',
    errorType: 'blocked',
    expectedBehavior: {
      shouldRetry: true,
      maxRetries: 3,
      backoffStrategy: 'exponential',
      fallbackAction: 'skip',
    },
  } as ErrorScenarioConfig,
};
