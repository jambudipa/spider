/**
 * Base Scenario Test Classes
 * Abstract base classes for different scenario types
 */

import { expect } from 'vitest';
import { Page, Cookie } from 'playwright';
import { Data, Effect, HashMap, Option, Random, Exit } from 'effect';
import { TestHelper, TestContext, TestSetupError, TestCleanupError, ScreenshotError } from './TestHelper';
import { DataExtractor } from './DataExtractor';
import { AdapterNotInitialisedError } from '../../lib/errors';

/**
 * Run an Effect and return a Promise for use in vitest async tests
 */
export const runEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.catchAll((e) => Effect.die(e))));

/**
 * Error for page initialisation failures
 */
export class PageInitError extends Data.TaggedError('PageInitError')<{
  readonly message: string;
}> {
  static create(message: string): PageInitError {
    return new PageInitError({ message });
  }
}

/**
 * Error for navigation failures
 */
export class NavigationError extends Data.TaggedError('NavigationError')<{
  readonly url: string;
  readonly status: Option.Option<number>;
  readonly message: string;
}> {
  static create(url: string, status: Option.Option<number>): NavigationError {
    const statusText = Option.isSome(status) ? String(status.value) : 'unknown';
    return new NavigationError({
      url,
      status,
      message: `Failed to navigate to ${url}: ${statusText}`
    });
  }
}

/**
 * Error for element not found
 */
export class ElementNotFoundError extends Data.TaggedError('ElementNotFoundError')<{
  readonly selector: string;
  readonly message: string;
}> {
  static create(selector: string): ElementNotFoundError {
    return new ElementNotFoundError({
      selector,
      message: `Element not found: ${selector}`
    });
  }
}

export abstract class BaseScenarioTest {
  protected context!: TestContext;
  protected page!: Page;
  protected scenarioName: string;
  protected baseUrl = 'https://web-scraping.dev';

  constructor(scenarioName: string) {
    this.scenarioName = scenarioName;
  }

  /**
   * Get the current page instance
   */
  getPage(): Page {
    return this.page;
  }

  /**
   * Get the test context
   */
  getContext(): TestContext {
    return this.context;
  }

  /**
   * Get the base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Setup test context (Effect version - for internal use)
   */
  protected _setup(): Effect.Effect<void, PageInitError | TestSetupError> {
    const self = this;
    return Effect.gen(function* () {
      self.context = yield* TestHelper.createTestContext(self.scenarioName);
      const pageOption = self.context.adapter.getPage();
      if (Option.isNone(pageOption)) {
        return yield* Effect.fail(PageInitError.create('Failed to get page from adapter'));
      }
      self.page = pageOption.value;
    });
  }

  /**
   * Setup test context (Promise version for vitest)
   */
  setup(): Promise<void> {
    return runEffect(this._setup());
  }

  /**
   * Cleanup test context (Effect version - for internal use)
   */
  protected _cleanup(): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      if (self.context) {
        yield* TestHelper.cleanupTestContext(self.context);
      }
    });
  }

  /**
   * Cleanup test context (Promise version for vitest)
   */
  cleanup(): Promise<void> {
    return runEffect(this._cleanup());
  }

  /**
   * Handle test failure
   */
  handleFailure<E extends Error>(testName: string, error: E): Effect.Effect<never, E | ScreenshotError> {
    const self = this;
    return Effect.gen(function* () {
      if (self.page) {
        yield* TestHelper.captureFailureScreenshot(self.page, testName, error);
      }
      return yield* Effect.fail(error);
    });
  }

  /**
   * Navigate to scenario URL (Effect version - for internal use)
   */
  protected _navigateToScenario(path: string): Effect.Effect<void, NavigationError> {
    const self = this;
    return Effect.gen(function* () {
      const url = `${self.baseUrl}${path}`;
      const responseOption = yield* self.context.adapter.goto(url).pipe(
        Effect.mapError(() => NavigationError.create(url, Option.none()))
      );

      if (Option.isNone(responseOption)) {
        return yield* Effect.fail(NavigationError.create(url, Option.none()));
      }
      const response = responseOption.value;
      if (response.status() >= 400) {
        return yield* Effect.fail(NavigationError.create(url, Option.some(response.status())));
      }
    });
  }

  /**
   * Navigate to scenario URL (Promise version for vitest)
   */
  navigateToScenario(path: string): Promise<void> {
    return runEffect(this._navigateToScenario(path));
  }

  /**
   * Abstract method for scenario-specific validation
   */
  abstract validateScenario(): Effect.Effect<void, PageInitError | NavigationError | ElementNotFoundError>;
}

export class StaticScenarioBase extends BaseScenarioTest {
  /**
   * Extract HTML content
   */
  getHtmlContent(): Effect.Effect<string, PageInitError> {
    return this.context.adapter.content().pipe(
      Effect.mapError(() => PageInitError.create('Failed to get page content'))
    );
  }

  /**
   * Parse HTML with Cheerio
   */
  parseHtml(html: string) {
    return TestHelper.parseHtml(html);
  }

  /**
   * Extract links from page
   */
  extractLinks(selector: string = 'a'): Effect.Effect<string[]> {
    const self = this;
    return Effect.promise(() =>
      self.page.$$eval(selector, links =>
        links
          .filter((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement)
          .map(anchor => anchor.href)
      )
    );
  }

  /**
   * Default validation for static scenarios
   */
  validateScenario(): Effect.Effect<void, PageInitError | NavigationError | ElementNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const html = yield* self.getHtmlContent();
      expect(html).toBeTruthy();
      expect(html.length).toBeGreaterThan(100);
    });
  }
}

export class DynamicScenarioBase extends BaseScenarioTest {
  /**
   * Wait for dynamic content
   */
  waitForContent(selector: string, timeout: number = 10000): Effect.Effect<void> {
    const self = this;
    return Effect.promise(() =>
      self.page.waitForSelector(selector, {
        state: 'visible',
        timeout
      })
    ).pipe(Effect.asVoid);
  }

  /**
   * Scroll to load content
   */
  scrollToLoadContent(options?: {
    maxScrolls?: number;
    delay?: number;
  }): Effect.Effect<void, AdapterNotInitialisedError> {
    return this.context.adapter.scrollToBottom({
      maxScrolls: options?.maxScrolls ?? 10,
      delay: options?.delay ?? 500
    }).pipe(Effect.asVoid);
  }

  /**
   * Click to load more content
   */
  clickLoadMore(buttonSelector: string): Effect.Effect<void, ElementNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const hasButton = yield* self.context.adapter.exists(buttonSelector).pipe(
        Effect.mapError(() => ElementNotFoundError.create(buttonSelector))
      );
      if (!hasButton) {
        return yield* Effect.fail(ElementNotFoundError.create(buttonSelector));
      }

      yield* self.context.adapter.clickAndWait(buttonSelector).pipe(
        Effect.mapError(() => ElementNotFoundError.create(buttonSelector))
      );
    });
  }

  /**
   * Intercept network requests
   */
  interceptRequests(
    pattern: string | RegExp,
    handler: (url: string, body: unknown) => void
  ): Effect.Effect<void> {
    const self = this;
    return self.context.adapter.interceptResponses((response) => {
      const url = response.url();
      if (
        (typeof pattern === 'string' && url.includes(pattern)) ||
        (pattern instanceof RegExp && pattern.test(url))
      ) {
        // Fire-and-forget: Run Effect to parse JSON and call handler
        // This uses Effect.runPromise because we're in a synchronous callback context
        void Effect.runPromise(
          Effect.gen(function* () {
            const bodyOption = yield* Effect.tryPromise({
              try: () => response.json(),
              catch: (): Option.Option<never> => Option.none() // Not JSON response - ignore
            }).pipe(Effect.map(Option.some));
            if (Option.isSome(bodyOption)) {
              handler(url, bodyOption.value);
            }
          })
        );
      }
    });
  }

  /**
   * Default validation for dynamic scenarios
   */
  validateScenario(): Effect.Effect<void, PageInitError | NavigationError | ElementNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      // Check page loaded
      yield* self.waitForContent('body');

      // Check JavaScript is running
      const jsEnabled = yield* Effect.promise(() => self.page.evaluate(() => true));
      expect(jsEnabled).toBe(true);
    });
  }
}

export class AuthScenarioBase extends BaseScenarioTest {
  protected cookies: readonly Cookie[] = [];
  protected tokens: HashMap.HashMap<string, string> = HashMap.empty<string, string>();

  /**
   * Perform login (Effect version - for internal use)
   */
  protected _login(username: string, password: string): Effect.Effect<void, NavigationError> {
    const self = this;
    return Effect.gen(function* () {
      // Navigate to login page
      yield* self._navigateToScenario('/login');

      // Fill login form
      yield* self.context.adapter.fill('input[name="username"], #username', username).pipe(
        Effect.mapError(() => NavigationError.create('/login', Option.none()))
      );
      yield* self.context.adapter.fill('input[name="password"], #password', password).pipe(
        Effect.mapError(() => NavigationError.create('/login', Option.none()))
      );

      // Submit form
      yield* self.context.adapter.clickAndWait(
        'button[type="submit"], input[type="submit"]'
      ).pipe(
        Effect.mapError(() => NavigationError.create('/login', Option.none()))
      );

      // Store cookies
      self.cookies = yield* self.context.adapter.getCookies().pipe(
        Effect.mapError(() => NavigationError.create('/login', Option.none()))
      );
    });
  }

  /**
   * Perform login (Promise version for vitest)
   */
  login(username: string, password: string): Promise<void> {
    return runEffect(this._login(username, password));
  }

  /**
   * Check if authenticated (Effect version)
   */
  protected _isAuthenticated(): Effect.Effect<boolean> {
    const self = this;
    return Effect.sync(() => {
      // Check for auth cookie
      const authCookie = self.cookies.find(c =>
        c.name.includes('session') ||
        c.name.includes('auth') ||
        c.name.includes('token')
      );

      return !!authCookie;
    });
  }

  /**
   * Check if authenticated (Promise version for vitest)
   */
  isAuthenticated(): Promise<boolean> {
    return runEffect(this._isAuthenticated());
  }

  /**
   * Extract and store CSRF token (Effect version - for internal use)
   */
  protected _extractCSRFToken(): Effect.Effect<string> {
    const self = this;
    return Effect.gen(function* () {
      const token = yield* DataExtractor.extractCSRFToken(self.page);
      if (token) {
        self.tokens = HashMap.set(self.tokens, 'csrf', token);
      }
      return token;
    });
  }

  /**
   * Extract and store CSRF token (Promise version for vitest)
   */
  extractCSRFToken(): Promise<string> {
    return runEffect(this._extractCSRFToken());
  }

  /**
   * Extract and store API token (Effect version - for internal use)
   */
  protected _extractAPIToken(): Effect.Effect<string> {
    const self = this;
    return Effect.gen(function* () {
      const token = yield* DataExtractor.extractAPIToken(self.page);
      if (token) {
        self.tokens = HashMap.set(self.tokens, 'api', token);
      }
      return token;
    });
  }

  /**
   * Extract and store API token (Promise version for vitest)
   */
  extractAPIToken(): Promise<string> {
    return runEffect(this._extractAPIToken());
  }

  /**
   * Set authentication headers (Effect version - for internal use)
   */
  protected _setAuthHeaders(headers: Record<string, string>): Effect.Effect<void> {
    const self = this;
    return Effect.promise(() => self.page.setExtraHTTPHeaders(headers));
  }

  /**
   * Set authentication headers (Promise version for vitest)
   */
  setAuthHeaders(headers: Record<string, string>): Promise<void> {
    return runEffect(this._setAuthHeaders(headers));
  }

  /**
   * Default validation for auth scenarios
   */
  validateScenario(): Effect.Effect<void, PageInitError | NavigationError | ElementNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const authenticated = yield* self._isAuthenticated();
      expect(authenticated).toBe(true);
    });
  }
}

export class AntiBlockScenarioBase extends BaseScenarioTest {
  /**
   * Apply stealth techniques (Effect version)
   */
  protected _applyStealthMode(): Effect.Effect<void> {
    const self = this;
    return Effect.promise(() =>
      self.page.addInitScript(() => {
        // These run in browser context where navigator is defined
        Object.defineProperty(window.navigator, 'webdriver', {
          get: () => false
        });

        // @ts-expect-error - chrome is not defined in standard Window type but exists in Chrome browser
        window.chrome = {
          runtime: {}
        };

        // Override plugins property for stealth mode
        Object.defineProperty(window.navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5]
        });

        // Override languages property for stealth mode
        Object.defineProperty(window.navigator, 'languages', {
          get: () => ['en-US', 'en']
        });
      })
    );
  }

  /**
   * Apply stealth techniques (Promise version for vitest)
   */
  applyStealthMode(): Promise<void> {
    return runEffect(this._applyStealthMode());
  }

  /**
   * Set custom headers (Effect version)
   */
  protected _setCustomHeaders(headers: Record<string, string>): Effect.Effect<void> {
    const self = this;
    return Effect.promise(() => self.page.setExtraHTTPHeaders(headers));
  }

  /**
   * Set custom headers (Promise version for vitest)
   */
  setCustomHeaders(headers: Record<string, string>): Promise<void> {
    return runEffect(this._setCustomHeaders(headers));
  }

  /**
   * Rotate user agent (Effect version)
   */
  protected _rotateUserAgent(): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
      ];

      const index = yield* Random.nextIntBetween(0, userAgents.length);
      const randomUA = userAgents[index];
      yield* Effect.promise(() =>
        self.page.setExtraHTTPHeaders({
          'User-Agent': randomUA ?? userAgents[0]
        })
      );
    });
  }

  /**
   * Rotate user agent (Promise version for vitest)
   */
  rotateUserAgent(): Promise<void> {
    return runEffect(this._rotateUserAgent());
  }

  /**
   * Check if blocked (Effect version)
   */
  protected _isBlocked(): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const url = self.page.url();
      const content = yield* Effect.promise(() => self.page.content());

      return url.includes('/blocked') ||
             content.includes('Access Denied') ||
             content.includes('403 Forbidden') ||
             content.includes('You have been blocked');
    });
  }

  /**
   * Check if blocked (Promise version for vitest)
   */
  isBlocked(): Promise<boolean> {
    return runEffect(this._isBlocked());
  }

  /**
   * Bypass block attempt (Effect version)
   */
  protected _bypassBlock(): Effect.Effect<void, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      yield* self._applyStealthMode();
      yield* self._rotateUserAgent();

      // Clear cookies that might flag us
      yield* self.context.adapter.clearCookies().pipe(Effect.asVoid);

      // Add legitimate-looking headers
      yield* self._setCustomHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      });
    });
  }

  /**
   * Bypass block attempt (Promise version for vitest)
   */
  bypassBlock(): Promise<void> {
    return runEffect(this._bypassBlock());
  }

  /**
   * Default validation for anti-block scenarios
   */
  validateScenario(): Effect.Effect<void, PageInitError | NavigationError | ElementNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const blocked = yield* self._isBlocked();
      expect(blocked).toBe(false);
    });
  }
}
