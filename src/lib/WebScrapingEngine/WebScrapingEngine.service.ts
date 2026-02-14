/**
 * Web Scraping Engine Service
 * Orchestrates all scraping capabilities including authentication, token management, and session handling
 */

import { Context, Data, DateTime, Effect, HashMap, Layer, Option } from 'effect';
import {
  EnhancedHttpClient,
  type HttpResponse,
} from '../HttpClient/EnhancedHttpClient.js';
import { CookieManager } from '../HttpClient/CookieManager.js';
import { SessionStore, SessionError } from '../HttpClient/SessionStore.js';
import { TokenExtractor } from '../HttpClient/TokenExtractor.js';
import {
  StateManager,
  TokenType,
} from '../StateManager/StateManager.service.js';
import { SpiderLogger } from '../Logging/SpiderLogger.service.js';
import { NetworkError, ParseError, TimeoutError } from '../errors/effect-errors.js';
import { JsonStringifyError } from '../utils/JsonUtils.js';

// ============================================================================
// Error Types
// ============================================================================

export class LoginError extends Data.TaggedError('LoginError')<{
  readonly status: number;
  readonly message: string;
}> {}

export class SessionNotValidError extends Data.TaggedError('SessionNotValidError')<{
  readonly message: string;
}> {}

export class SessionLoadError extends Data.TaggedError('SessionLoadError')<{
  readonly message: string;
}> {}

export type WebScrapingEngineError = LoginError | SessionNotValidError | SessionLoadError;

/**
 * Combined error types for HTTP operations
 */
export type HttpOperationError = NetworkError | ParseError | TimeoutError;

/**
 * Combined error types for POST operations
 */
export type HttpPostOperationError = HttpOperationError | JsonStringifyError;

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
  tokens: HashMap.HashMap<TokenType, string>;
  startTime: DateTime.Utc;
}

export interface WebScrapingEngineService {
  /**
   * Perform login with form submission
   */
  login: (
    _credentials: LoginCredentials
  ) => Effect.Effect<ScrapingSession, HttpOperationError | SessionError | LoginError>;

  /**
   * Fetch authenticated content
   */
  fetchAuthenticated: (
    _url: string
  ) => Effect.Effect<HttpResponse, HttpOperationError | SessionNotValidError>;

  /**
   * Submit form with CSRF protection
   */
  submitFormWithCSRF: (
    _url: string,
    _formData: Record<string, string>,
    _csrfUrl?: string
  ) => Effect.Effect<HttpResponse, HttpOperationError>;

  /**
   * Make API request with token
   */
  makeAPIRequest: (
    _url: string,
    _method?: 'GET' | 'POST' | 'PUT' | 'DELETE',
    _data?: Record<string, unknown>
  ) => Effect.Effect<HttpResponse, HttpPostOperationError>;

  /**
   * Create and save a scraping session
   */
  createSession: (_id?: string) => Effect.Effect<ScrapingSession>;

  /**
   * Load existing session
   */
  loadSession: (_id: string) => Effect.Effect<ScrapingSession, SessionError | SessionLoadError>;

  /**
   * Export session for persistence
   */
  exportSession: () => Effect.Effect<string, SessionError>;

  /**
   * Import session from persistence
   */
  importSession: (_data: string) => Effect.Effect<void, SessionError>;

  /**
   * Clear all state and sessions
   */
  clearAll: () => Effect.Effect<void>;
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
        const csrfTokenOption =
          yield* tokenExtractor.extractCSRFFromResponse(loginPageResponse);

        // Prepare form data
        const formData: Record<string, string> = {
          [credentials.usernameField || 'username']: credentials.username,
          [credentials.passwordField || 'password']: credentials.password,
          ...credentials.additionalFields,
        };

        // Add CSRF token if found
        if (Option.isSome(csrfTokenOption)) {
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

          formData[csrfFieldName] = csrfTokenOption.value;
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
        const hasLocation = 'location' in loginResponse.headers;
        const isAuthenticated =
          loginResponse.status === 200 ||
          loginResponse.status === 302 ||
          hasLocation;

        if (!isAuthenticated) {
          return yield* Effect.fail(
            new LoginError({
              status: loginResponse.status,
              message: `Login failed with status ${loginResponse.status}`,
            })
          );
        }

        // Extract any new tokens from the response
        yield* tokenExtractor.extractTokensFromResponse(loginResponse);

        // Create a session
        const session = yield* sessionStore.createSession();
        const now = yield* DateTime.now;
        yield* sessionStore.updateSessionData({
          authenticated: true,
          username: credentials.username,
          loginTime: DateTime.formatIso(now),
        });

        // Get all stored tokens
        let tokens = HashMap.empty<TokenType, string>();
        for (const type of [TokenType.CSRF, TokenType.API, TokenType.AUTH]) {
          const tokenOption = yield* stateManager
            .getToken(type)
            .pipe(Effect.map(Option.some), Effect.catchAll(() => Effect.succeed(Option.none())));
          if (Option.isSome(tokenOption)) {
            tokens = HashMap.set(tokens, type, tokenOption.value);
          }
        }

        yield* logger.logEdgeCase(domain, 'login_success', {
          sessionId: session.id,
          tokensFound: Array.from(HashMap.keys(tokens)),
        });

        return {
          id: session.id,
          authenticated: true,
          tokens,
          startTime: now,
        };
      }),

    fetchAuthenticated: (url: string) =>
      Effect.gen(function* () {
        // Check if we have a valid session
        const isValid = yield* sessionStore.isSessionValid();

        if (!isValid) {
          return yield* Effect.fail(
            new SessionNotValidError({
              message: 'No valid session. Please login first.',
            })
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
        let csrfToken: Option.Option<string> = Option.none();

        // Try to get stored CSRF token
        const isValid = yield* stateManager.isTokenValid(TokenType.CSRF);

        if (!isValid && csrfUrl) {
          // Fetch new CSRF token from provided URL
          const csrfResponse = yield* httpClient.get(csrfUrl);
          csrfToken = yield* tokenExtractor.extractCSRFFromResponse(csrfResponse);
        } else if (isValid) {
          csrfToken = yield* stateManager
            .getToken(TokenType.CSRF)
            .pipe(Effect.map(Option.some), Effect.catchAll(() => Effect.succeed(Option.none())));
        }

        if (Option.isNone(csrfToken) && !csrfUrl) {
          // Try to get CSRF from the form page itself
          const formPageResponse = yield* httpClient.get(url);
          csrfToken = yield* tokenExtractor.extractCSRFFromResponse(formPageResponse);
        }

        // Add CSRF token to form data if found
        const enhancedFormData = { ...formData };
        if (Option.isSome(csrfToken)) {
          // Detect CSRF field name from common patterns
          const csrfFieldNames = [
            'csrf_token',
            '_csrf',
            'authenticity_token',
            '__RequestVerificationToken',
          ];
          const csrfFieldName = csrfFieldNames[0]; // Default to first option
          enhancedFormData[csrfFieldName] = csrfToken.value;

          yield* logger.logEdgeCase(domain, 'csrf_protected_form', {
            url,
            csrfField: csrfFieldName,
          });
        }

        // Submit the form
        const response = yield* httpClient.submitForm(url, enhancedFormData);

        // Check for token rotation
        if (Option.isSome(csrfToken)) {
          yield* tokenExtractor.detectTokenRotation(
            csrfToken.value,
            response,
            TokenType.CSRF
          );
        }

        return response;
      }),

    makeAPIRequest: (url: string, method = 'GET', data?: Record<string, unknown>) =>
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
            Effect.catchAll((_error) => {
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
        let tokens = HashMap.empty<TokenType, string>();
        for (const type of [TokenType.CSRF, TokenType.API, TokenType.AUTH]) {
          const tokenOption = yield* stateManager
            .getToken(type)
            .pipe(Effect.map(Option.some), Effect.catchAll(() => Effect.succeed(Option.none())));
          if (Option.isSome(tokenOption)) {
            tokens = HashMap.set(tokens, type, tokenOption.value);
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

        if (Option.isNone(session)) {
          return yield* Effect.fail(
            new SessionLoadError({
              message: 'Failed to load session',
            })
          );
        }

        // Get all stored tokens
        let tokens = HashMap.empty<TokenType, string>();
        for (const type of [TokenType.CSRF, TokenType.API, TokenType.AUTH]) {
          const tokenOption = yield* stateManager
            .getToken(type)
            .pipe(Effect.map(Option.some), Effect.catchAll(() => Effect.succeed(Option.none())));
          if (Option.isSome(tokenOption)) {
            tokens = HashMap.set(tokens, type, tokenOption.value);
          }
        }

        const userData = Option.getOrElse(session.value.userData, () => ({}));
        const authenticated = 'authenticated' in userData && userData.authenticated === true;

        return {
          id: session.value.id,
          authenticated,
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
