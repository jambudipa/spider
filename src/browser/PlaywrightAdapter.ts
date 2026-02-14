/**
 * Playwright Adapter for Spider Integration
 * Provides high-level browser automation capabilities
 */

import { Chunk, Data, Effect, Option, Stream } from 'effect';
import type { Readable } from 'node:stream';
import { Page, Response as PlaywrightResponse, Route, Cookie, Request as PlaywrightRequest } from 'playwright';
import { BrowserManager } from './BrowserManager';
import { AdapterNotInitialisedError } from '../lib/errors/effect-errors.js';

export type RequestHandler = (request: PlaywrightRequest) => void;
export type ResponseHandler = (response: PlaywrightResponse) => void;

export interface WaitOptions {
  timeout?: number;
  state?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface ScrollOptions {
  delay?: number;
  maxScrolls?: number;
  scrollDistance?: number;
}

/**
 * Error thrown when page is closed during an operation
 */
export class PageClosedError extends Data.TaggedError('PageClosedError')<{
  readonly operation: string;
  readonly message: string;
}> {
  static create(operation: string): PageClosedError {
    return new PageClosedError({
      operation,
      message: `Page was closed during ${operation}`
    });
  }
}

/**
 * Error thrown when stream reading fails
 */
export class StreamReadError extends Data.TaggedError('StreamReadError')<{
  readonly cause: unknown;
  readonly message: string;
}> {
  static fromCause(cause: unknown): StreamReadError {
    return new StreamReadError({
      cause,
      message: `Stream read failed: ${cause}`
    });
  }
}

export class PlaywrightAdapter {
  private browserManager: BrowserManager;
  private page: Option.Option<Page> = Option.none();
  private contextId: string;
  private requestHandlers: Chunk.Chunk<RequestHandler> = Chunk.empty();
  private responseHandlers: Chunk.Chunk<ResponseHandler> = Chunk.empty();

  constructor(browserManager: BrowserManager, contextId: string) {
    this.browserManager = browserManager;
    this.contextId = contextId;
  }

  /**
   * Initialise the adapter with a new page
   */
  initialise(): Effect.Effect<Page, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.browserManager.createPage(self.contextId).pipe(
        Effect.mapError((error) => AdapterNotInitialisedError.create(
          self.contextId,
          `Failed to create page: ${String(error)}`
        ))
      );

      self.page = Option.some(page);

      // Setup request/response interception
      page.on('request', (request: PlaywrightRequest) => {
        Chunk.forEach(self.requestHandlers, (handler) => handler(request));
      });

      page.on('response', (response: PlaywrightResponse) => {
        Chunk.forEach(self.responseHandlers, (handler) => handler(response));
      });

      return page;
    });
  }

  /**
   * Get the current page instance (Effect)
   */
  getPageEffect(): Effect.Effect<Page, AdapterNotInitialisedError> {
    if (Option.isNone(this.page)) {
      return Effect.fail(
        AdapterNotInitialisedError.create(this.contextId, 'getPage')
      );
    }
    return Effect.succeed(this.page.value);
  }

  /**
   * Get the current page instance (direct)
   * Returns Option for type-safe handling
   */
  getPage(): Option.Option<Page> {
    return this.page;
  }

  /**
   * Internal helper to get page or fail
   */
  private requirePage(operation: string): Effect.Effect<Page, AdapterNotInitialisedError> {
    if (Option.isNone(this.page)) {
      return Effect.fail(AdapterNotInitialisedError.create(this.contextId, operation));
    }
    return Effect.succeed(this.page.value);
  }

  /**
   * Navigate to a URL
   */
  goto(url: string, options?: WaitOptions): Effect.Effect<Option.Option<PlaywrightResponse>, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('goto');
      const response = yield* Effect.tryPromise({
        try: () => page.goto(url, {
          waitUntil: options?.state ?? 'networkidle',
          timeout: options?.timeout
        }),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `goto failed: ${error}`)
      });
      return Option.fromNullable(response);
    });
  }

  /**
   * Wait for dynamic content to load
   */
  waitForDynamicContent(selector: string, options?: WaitOptions): Effect.Effect<void, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('waitForDynamicContent');
      yield* Effect.tryPromise({
        try: () => page.waitForSelector(selector, {
          state: 'visible',
          timeout: options?.timeout ?? 10000
        }),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `waitForDynamicContent failed: ${error}`)
      });
    });
  }

  /**
   * Scroll to bottom progressively
   */
  scrollToBottom(options?: ScrollOptions): Effect.Effect<void, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('scrollToBottom');
      const delay = options?.delay ?? 500;
      const maxScrolls = options?.maxScrolls ?? 50;
      const scrollDistance = options?.scrollDistance ?? 500;

      let previousHeight = 0;
      let currentHeight = yield* Effect.tryPromise({
        try: () => page.evaluate(() => document.body.scrollHeight),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `scrollToBottom failed: ${error}`)
      });
      let scrollCount = 0;

      while (previousHeight !== currentHeight && scrollCount < maxScrolls) {
        previousHeight = currentHeight;

        yield* Effect.tryPromise({
          try: () => page.evaluate((distance) => {
            window.scrollBy(0, distance);
          }, scrollDistance),
          catch: (error) => AdapterNotInitialisedError.create(self.contextId, `scrollToBottom failed: ${error}`)
        });

        yield* Effect.tryPromise({
          try: () => page.waitForTimeout(delay),
          catch: (error) => AdapterNotInitialisedError.create(self.contextId, `scrollToBottom failed: ${error}`)
        });

        currentHeight = yield* Effect.tryPromise({
          try: () => page.evaluate(() => document.body.scrollHeight),
          catch: (error) => AdapterNotInitialisedError.create(self.contextId, `scrollToBottom failed: ${error}`)
        });
        scrollCount++;
      }

      // Final scroll to absolute bottom
      yield* Effect.tryPromise({
        try: () => page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        }),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `scrollToBottom failed: ${error}`)
      });
    });
  }

  /**
   * Click an element and wait for navigation or content
   */
  clickAndWait(selector: string, waitFor?: string | WaitOptions): Effect.Effect<void, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('clickAndWait');

      // Use force click to bypass event delegation issues
      const clickOptions = { force: true };

      if (typeof waitFor === 'string') {
        // Wait for specific selector after click
        yield* Effect.tryPromise({
          try: () => page.click(selector, clickOptions),
          catch: (error) => AdapterNotInitialisedError.create(self.contextId, `clickAndWait failed: ${error}`)
        });
        yield* Effect.tryPromise({
          try: () => page.waitForSelector(waitFor, { state: 'visible' }),
          catch: (error) => AdapterNotInitialisedError.create(self.contextId, `clickAndWait failed: ${error}`)
        });
      } else {
        // Click and wait for network/DOM changes
        yield* Effect.tryPromise({
          try: () => page.click(selector, clickOptions),
          catch: (error) => AdapterNotInitialisedError.create(self.contextId, `clickAndWait failed: ${error}`)
        });
        yield* Effect.tryPromise({
          try: () => page.waitForTimeout(1000), // Allow time for dynamic content
          catch: (error) => AdapterNotInitialisedError.create(self.contextId, `clickAndWait failed: ${error}`)
        });

        // Wait for network idle if specified
        if (waitFor?.state === 'networkidle') {
          yield* Effect.tryPromise({
            try: () => page.waitForLoadState('networkidle', {
              timeout: waitFor?.timeout ?? 5000
            }),
            catch: (error) => AdapterNotInitialisedError.create(self.contextId, `clickAndWait failed: ${error}`)
          });
        }
      }
    });
  }

  /**
   * Intercept requests
   */
  interceptRequests(handler: RequestHandler): Effect.Effect<void> {
    return Effect.sync(() => {
      this.requestHandlers = Chunk.append(this.requestHandlers, handler);
    });
  }

  /**
   * Intercept responses
   */
  interceptResponses(handler: ResponseHandler): Effect.Effect<void> {
    return Effect.sync(() => {
      this.responseHandlers = Chunk.append(this.responseHandlers, handler);
    });
  }

  /**
   * Route specific URLs
   */
  route(pattern: string | RegExp, handler: (route: Route) => void): Effect.Effect<void, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('route');
      yield* Effect.tryPromise({
        try: () => page.route(pattern, handler),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `route failed: ${error}`)
      });
    });
  }

  /**
   * Execute JavaScript in page context
   */
  evaluate<T>(fn: () => T): Effect.Effect<T, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('evaluate');
      return yield* Effect.tryPromise({
        try: () => page.evaluate(fn),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `evaluate failed: ${error}`)
      });
    });
  }

  /**
   * Take a screenshot
   */
  screenshot(path: string): Effect.Effect<void, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('screenshot');
      yield* Effect.tryPromise({
        try: () => page.screenshot({ path, fullPage: true }),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `screenshot failed: ${error}`)
      });
    });
  }

  /**
   * Get page content
   */
  content(): Effect.Effect<string, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('content');
      return yield* Effect.tryPromise({
        try: () => page.content(),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `content failed: ${error}`)
      });
    });
  }

  /**
   * Fill a form field
   */
  fill(selector: string, value: string): Effect.Effect<void, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('fill');
      yield* Effect.tryPromise({
        try: () => page.fill(selector, value),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `fill failed: ${error}`)
      });
    });
  }

  /**
   * Select an option
   */
  select(selector: string, value: string): Effect.Effect<void, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('select');
      yield* Effect.tryPromise({
        try: () => page.selectOption(selector, value),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `select failed: ${error}`)
      });
    });
  }

  /**
   * Check if element exists
   */
  exists(selector: string): Effect.Effect<boolean, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('exists');
      const count = yield* Effect.tryPromise({
        try: () => page.locator(selector).count(),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `exists failed: ${error}`)
      });
      return count > 0;
    });
  }

  /**
   * Wait for network idle
   */
  waitForNetworkIdle(options?: WaitOptions): Effect.Effect<void, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('waitForNetworkIdle');
      yield* Effect.tryPromise({
        try: () => page.waitForLoadState('networkidle', {
          timeout: options?.timeout
        }),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `waitForNetworkIdle failed: ${error}`)
      });
    });
  }

  /**
   * Handle new tabs/windows
   */
  handleNewTab(callback: (page: Page) => Effect.Effect<void>): Effect.Effect<void, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('handleNewTab');
      const context = page.context();

      const newPage = yield* Effect.tryPromise({
        try: () => context.waitForEvent('page'),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `handleNewTab failed: ${error}`)
      });

      yield* callback(newPage);
      yield* Effect.tryPromise({
        try: () => newPage.close(),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `handleNewTab close failed: ${error}`)
      });
    });
  }

  /**
   * Get cookies
   */
  getCookies(): Effect.Effect<readonly Cookie[], AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('getCookies');
      return yield* Effect.tryPromise({
        try: () => page.context().cookies(),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `getCookies failed: ${error}`)
      });
    });
  }

  /**
   * Set cookies
   */
  setCookies(cookies: readonly Cookie[]): Effect.Effect<void, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('setCookies');
      yield* Effect.tryPromise({
        try: () => page.context().addCookies([...cookies]),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `setCookies failed: ${error}`)
      });
    });
  }

  /**
   * Clear cookies
   */
  clearCookies(): Effect.Effect<void, AdapterNotInitialisedError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('clearCookies');
      yield* Effect.tryPromise({
        try: () => page.context().clearCookies(),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `clearCookies failed: ${error}`)
      });
    });
  }

  /**
   * Helper to read a Node stream as a Buffer using Effect Stream
   */
  private readStreamAsBuffer(nodeStream: Readable): Effect.Effect<Buffer, StreamReadError> {
    return Effect.gen(function* () {
      const chunks = yield* Stream.fromAsyncIterable<Buffer, StreamReadError>(
        nodeStream,
        (error) => StreamReadError.fromCause(error)
      ).pipe(
        Stream.runCollect
      );
      return Buffer.concat(Chunk.toReadonlyArray(chunks));
    });
  }

  /**
   * Download file from URL
   */
  downloadFile(url: string, filename?: string): Effect.Effect<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
  }, AdapterNotInitialisedError | PageClosedError | StreamReadError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('downloadFile');

      // Check if page is closed before proceeding
      if (page.isClosed()) {
        return yield* Effect.fail(PageClosedError.create('downloadFile'));
      }

      // Start waiting for download before navigating
      const downloadPromise = page.waitForEvent('download', { timeout: 15000 });

      // If URL provided, navigate to it, otherwise expect it to be triggered
      if (url.startsWith('http')) {
        yield* Effect.tryPromise({
          try: () => page.goto(url, { timeout: 10000 }),
          catch: (error) => {
            if (error instanceof Error && (
              error.message.includes('closed') ||
              error.message.includes('Target page') ||
              error.message.includes('browser has been closed')
            )) {
              return PageClosedError.create('downloadFile');
            }
            return AdapterNotInitialisedError.create(self.contextId, `downloadFile navigation failed: ${error}`);
          }
        });
      }

      const download = yield* Effect.tryPromise({
        try: () => downloadPromise,
        catch: (error) => {
          if (error instanceof Error && (
            error.message.includes('closed') ||
            error.message.includes('Target page') ||
            error.message.includes('browser has been closed')
          )) {
            return PageClosedError.create('downloadFile');
          }
          return AdapterNotInitialisedError.create(self.contextId, `downloadFile failed: ${error}`);
        }
      });

      // Get download info
      const suggestedFilename = download.suggestedFilename();
      const finalFilename = filename ?? suggestedFilename;

      // Get the download stream
      const readableStream = yield* Effect.tryPromise({
        try: () => download.createReadStream(),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `downloadFile stream failed: ${error}`)
      });

      // Read the stream as buffer
      const buffer = yield* self.readStreamAsBuffer(readableStream);

      return {
        buffer,
        filename: finalFilename,
        mimeType: 'application/octet-stream' // Default, could be detected
      };
    });
  }

  /**
   * Trigger download by clicking element
   */
  downloadFromClick(selector: string): Effect.Effect<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
  }, AdapterNotInitialisedError | PageClosedError | StreamReadError> {
    const self = this;
    return Effect.gen(function* () {
      const page = yield* self.requirePage('downloadFromClick');

      // Check if page is closed before proceeding
      if (page.isClosed()) {
        return yield* Effect.fail(PageClosedError.create('downloadFromClick'));
      }

      // Start waiting for download before clicking
      const downloadPromise = page.waitForEvent('download', { timeout: 15000 });

      // Click the download trigger
      yield* Effect.tryPromise({
        try: () => page.click(selector),
        catch: (error) => {
          if (error instanceof Error && (
            error.message.includes('closed') ||
            error.message.includes('Target page') ||
            error.message.includes('browser has been closed')
          )) {
            return PageClosedError.create('downloadFromClick');
          }
          return AdapterNotInitialisedError.create(self.contextId, `downloadFromClick click failed: ${error}`);
        }
      });

      const download = yield* Effect.tryPromise({
        try: () => downloadPromise,
        catch: (error) => {
          if (error instanceof Error && (
            error.message.includes('closed') ||
            error.message.includes('Target page') ||
            error.message.includes('browser has been closed')
          )) {
            return PageClosedError.create('downloadFromClick');
          }
          return AdapterNotInitialisedError.create(self.contextId, `downloadFromClick failed: ${error}`);
        }
      });

      // Get the download stream
      const readableStream = yield* Effect.tryPromise({
        try: () => download.createReadStream(),
        catch: (error) => AdapterNotInitialisedError.create(self.contextId, `downloadFromClick stream failed: ${error}`)
      });

      // Read the stream as buffer
      const buffer = yield* self.readStreamAsBuffer(readableStream);

      return {
        buffer,
        filename: download.suggestedFilename(),
        mimeType: 'application/octet-stream'
      };
    });
  }

  /**
   * Close the page
   */
  close(): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      if (Option.isSome(self.page)) {
        const currentPage = self.page.value;
        yield* Effect.tryPromise({
          try: () => {
            if (!currentPage.isClosed()) {
              return currentPage.close();
            }
            return Effect.runPromise(Effect.void);
          },
          catch: (error) => error
        }).pipe(
          Effect.catchAll((error) =>
            Effect.logWarning('Error closing page:', error)
          )
        );
        self.page = Option.none();
      }
    });
  }
}
