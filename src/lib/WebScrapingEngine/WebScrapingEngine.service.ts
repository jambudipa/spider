/**
 * Web Scraping Engine Service
 * Orchestrates all scraping capabilities including authentication, token management, and session handling
 */

import { Context, Effect, Layer } from 'effect';
import { ScraperService } from '../Scraper/Scraper.service.js';
import {
  EnhancedHttpClient,
  type HttpResponse,
} from '../HttpClient/EnhancedHttpClient.js';
import { CookieManager } from '../HttpClient/CookieManager.js';
import { SessionStore } from '../HttpClient/SessionStore.js';
import { TokenExtractor } from '../HttpClient/TokenExtractor.js';
import {
  StateManager,
  TokenType,
} from '../StateManager/StateManager.service.js';
import { SpiderLogger } from '../Logging/SpiderLogger.service.js';

export interface LoginCredentials {
  username: string;
  password: string;
  loginUrl: string;
  usernameField?: string;
  passwordField?: string;
  additionalFields?: Record<string, string>;
}

export interface ScrapingSession {
  id: string;
  authenticated: boolean;
  tokens: Map<TokenType, string>;
  startTime: Date;
}

export interface WebScrapingEngineService {
  /**
   * Perform login with form submission
   */
  login: (
    credentials: LoginCredentials
  ) => Effect.Effect<ScrapingSession, Error, never>;

  /**
   * Fetch authenticated content
   */
  fetchAuthenticated: (
    url: string
  ) => Effect.Effect<HttpResponse, Error, never>;

  /**
   * Submit form with CSRF protection
   */
  submitFormWithCSRF: (
    url: string,
    formData: Record<string, string>,
    csrfUrl?: string
  ) => Effect.Effect<HttpResponse, Error, never>;

  /**
   * Make API request with token
   */
  makeAPIRequest: (
    url: string,
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE',
    data?: any
  ) => Effect.Effect<HttpResponse, Error, never>;

  /**
   * Create and save a scraping session
   */
  createSession: (id?: string) => Effect.Effect<ScrapingSession, Error, never>;

  /**
   * Load existing session
   */
  loadSession: (id: string) => Effect.Effect<ScrapingSession, Error, never>;

  /**
   * Export session for persistence
   */
  exportSession: () => Effect.Effect<string, Error, never>;

  /**
   * Import session from persistence
   */
  importSession: (data: string) => Effect.Effect<void, Error, never>;

  /**
   * Clear all state and sessions
   */
  clearAll: () => Effect.Effect<void, never, never>;
}

export class WebScrapingEngine extends Context.Tag('WebScrapingEngine')<
  WebScrapingEngine,
  WebScrapingEngineService
>() {}

/**
 * Create a WebScrapingEngine service implementation
 */
export const makeWebScrapingEngine = Effect.gen(function* () {
  const httpClient = yield* EnhancedHttpClient;
  const cookieManager = yield* CookieManager;
  const sessionStore = yield* SessionStore;
  const tokenExtractor = yield* TokenExtractor;
  const stateManager = yield* StateManager;
  const logger = yield* SpiderLogger;
  const scraper = yield* ScraperService;

  const service: WebScrapingEngineService = {
    login: (credentials: LoginCredentials) =>
      Effect.gen(function* () {
        const domain = new URL(credentials.loginUrl).hostname;

        // First, get the login page to extract CSRF token
        yield* logger.logEdgeCase(domain, 'login_start', {
          url: credentials.loginUrl,
          username: credentials.username,
        });

        const loginPageResponse = yield* httpClient.get(credentials.loginUrl);

        // Extract CSRF token from login page
        const csrfToken =
          yield* tokenExtractor.extractCSRFFromResponse(loginPageResponse);

        // Prepare form data
        const formData: Record<string, string> = {
          [credentials.usernameField || 'username']: credentials.username,
          [credentials.passwordField || 'password']: credentials.password,
          ...credentials.additionalFields,
        };

        // Add CSRF token if found
        if (csrfToken) {
          // Common CSRF field names
          const csrfFieldNames = [
            'csrf_token',
            '_csrf',
            'authenticity_token',
            '__RequestVerificationToken',
          ];
          const csrfFieldName =
            csrfFieldNames.find((name) =>
              loginPageResponse.body.includes(`name="${name}"`)
            ) || 'csrf_token';

          formData[csrfFieldName] = csrfToken;
          yield* logger.logEdgeCase(domain, 'csrf_token_added', {
            field: csrfFieldName,
          });
        }

        // Submit login form
        const loginResponse = yield* httpClient.submitForm(
          credentials.loginUrl,
          formData
        );

        // Check if login was successful
        const isAuthenticated =
          loginResponse.status === 200 ||
          loginResponse.status === 302 ||
          loginResponse.headers['location'] !== undefined;

        if (!isAuthenticated) {
          return yield* Effect.fail(
            new Error(`Login failed with status ${loginResponse.status}`)
          );
        }

        // Extract any new tokens from the response
        yield* tokenExtractor.extractTokensFromResponse(loginResponse);

        // Create a session
        const session = yield* sessionStore.createSession();
        yield* sessionStore.updateSessionData({
          authenticated: true,
          username: credentials.username,
          loginTime: new Date(),
        });

        // Get all stored tokens
        const tokens = new Map<TokenType, string>();
        for (const type of [TokenType.CSRF, TokenType.API, TokenType.AUTH]) {
          const token = yield* stateManager
            .getToken(type)
            .pipe(Effect.catchAll(() => Effect.succeed(null)));
          if (token) {
            tokens.set(type, token);
          }
        }

        yield* logger.logEdgeCase(domain, 'login_success', {
          sessionId: session.id,
          tokensFound: Array.from(tokens.keys()),
        });

        return {
          id: session.id,
          authenticated: true,
          tokens,
          startTime: new Date(),
        };
      }),

    fetchAuthenticated: (url: string) =>
      Effect.gen(function* () {
        // Check if we have a valid session
        const isValid = yield* sessionStore.isSessionValid();

        if (!isValid) {
          return yield* Effect.fail(
            new Error('No valid session. Please login first.')
          );
        }

        // Make authenticated request with cookies
        return yield* httpClient.get(url);
      }),

    submitFormWithCSRF: (
      url: string,
      formData: Record<string, string>,
      csrfUrl?: string
    ) =>
      Effect.gen(function* () {
        const domain = new URL(url).hostname;

        // Get CSRF token
        let csrfToken: string | null = null;

        // Try to get stored CSRF token
        const isValid = yield* stateManager.isTokenValid(TokenType.CSRF);

        if (!isValid && csrfUrl) {
          // Fetch new CSRF token from provided URL
          const csrfResponse = yield* httpClient.get(csrfUrl);
          csrfToken =
            yield* tokenExtractor.extractCSRFFromResponse(csrfResponse);
        } else if (isValid) {
          csrfToken = yield* stateManager
            .getToken(TokenType.CSRF)
            .pipe(Effect.catchAll(() => Effect.succeed(null)));
        }

        if (!csrfToken && !csrfUrl) {
          // Try to get CSRF from the form page itself
          const formPageResponse = yield* httpClient.get(url);
          csrfToken =
            yield* tokenExtractor.extractCSRFFromResponse(formPageResponse);
        }

        // Add CSRF token to form data if found
        const enhancedFormData = { ...formData };
        if (csrfToken) {
          // Detect CSRF field name from common patterns
          const csrfFieldNames = [
            'csrf_token',
            '_csrf',
            'authenticity_token',
            '__RequestVerificationToken',
          ];
          const csrfFieldName = csrfFieldNames[0]; // Default to first option
          enhancedFormData[csrfFieldName] = csrfToken;

          yield* logger.logEdgeCase(domain, 'csrf_protected_form', {
            url,
            csrfField: csrfFieldName,
          });
        }

        // Submit the form
        const response = yield* httpClient.submitForm(url, enhancedFormData);

        // Check for token rotation
        if (csrfToken) {
          yield* tokenExtractor.detectTokenRotation(
            csrfToken,
            response,
            TokenType.CSRF
          );
        }

        return response;
      }),

    makeAPIRequest: (url: string, method = 'GET', data?: any) =>
      Effect.gen(function* () {
        // Use authenticated request with API token
        const response = yield* tokenExtractor
          .authenticatedRequest(url, {
            requireAPI: true,
            customHeaders: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          })
          .pipe(
            Effect.catchAll((error) => {
              // If API token is not available, try without it
              if (method === 'GET') {
                return httpClient.get(url);
              } else {
                return httpClient.post(url, data);
              }
            })
          );

        return response;
      }),

    createSession: (id?: string) =>
      Effect.gen(function* () {
        const session = yield* sessionStore.createSession(id);

        // Get all stored tokens
        const tokens = new Map<TokenType, string>();
        for (const type of [TokenType.CSRF, TokenType.API, TokenType.AUTH]) {
          const token = yield* stateManager
            .getToken(type)
            .pipe(Effect.catchAll(() => Effect.succeed(null)));
          if (token) {
            tokens.set(type, token);
          }
        }

        return {
          id: session.id,
          authenticated: false,
          tokens,
          startTime: session.createdAt,
        };
      }),

    loadSession: (id: string) =>
      Effect.gen(function* () {
        yield* sessionStore.loadSession(id);
        const session = yield* sessionStore.getCurrentSession();

        if (session._tag === 'None') {
          return yield* Effect.fail(new Error('Failed to load session'));
        }

        // Get all stored tokens
        const tokens = new Map<TokenType, string>();
        for (const type of [TokenType.CSRF, TokenType.API, TokenType.AUTH]) {
          const token = yield* stateManager
            .getToken(type)
            .pipe(Effect.catchAll(() => Effect.succeed(null)));
          if (token) {
            tokens.set(type, token);
          }
        }

        return {
          id: session.value.id,
          authenticated: session.value.userData?.authenticated || false,
          tokens,
          startTime: session.value.createdAt,
        };
      }),

    exportSession: () => sessionStore.exportSession(),

    importSession: (data: string) => sessionStore.importSession(data),

    clearAll: () =>
      Effect.gen(function* () {
        yield* sessionStore.clearSession();
        yield* cookieManager.clearCookies();
        yield* stateManager.clearState();
      }),
  };

  return service;
});

/**
 * WebScrapingEngine Layer with all dependencies
 */
export const WebScrapingEngineLive = Layer.effect(
  WebScrapingEngine,
  makeWebScrapingEngine
);
