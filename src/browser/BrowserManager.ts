/**
 * Browser Manager for Playwright Integration
 * Handles browser lifecycle, pooling, and resource management
 */

import { Effect, Either, MutableHashMap, Option } from 'effect';
import { Browser, BrowserContext, Page, chromium, BrowserContextOptions } from 'playwright';
import { BrowserCleanupError, BrowserError } from '../lib/errors/effect-errors.js';

export interface BrowserConfig {
  headless?: boolean;
  timeout?: number;
  poolSize?: number;
  viewport?: { width: number; height: number };
  userAgent?: string;
  locale?: string;
  extraHTTPHeaders?: Record<string, string>;
}

export class BrowserManager {
  private browsers: Browser[] = [];
  private contexts: MutableHashMap.MutableHashMap<string, BrowserContext> = MutableHashMap.empty();
  private config: Required<BrowserConfig>;
  private isInitialised = false;

  constructor(config: BrowserConfig = {}) {
    this.config = {
      headless: config.headless ?? true,
      timeout: config.timeout ?? 30000,
      poolSize: config.poolSize ?? 3,
      viewport: config.viewport ?? { width: 1920, height: 1080 },
      userAgent: config.userAgent ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      locale: config.locale ?? 'en-GB',
      extraHTTPHeaders: config.extraHTTPHeaders ?? {}
    };
  }

  /**
   * Initialise browser pool
   */
  initialise(): Effect.Effect<void, BrowserError> {
    const self = this;
    return Effect.gen(function* () {
      if (self.isInitialised) return;

      for (let i = 0; i < self.config.poolSize; i++) {
        const browser = yield* self.launchBrowser();
        self.browsers.push(browser);
      }

      self.isInitialised = true;
    });
  }

  /**
   * Launch a new browser instance
   */
  private launchBrowser(): Effect.Effect<Browser, BrowserError> {
    const self = this;
    return Effect.tryPromise({
      try: () => chromium.launch({
        headless: self.config.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      }),
      catch: (error: unknown): BrowserError => BrowserError.launch(error)
    });
  }

  /**
   * Get or create a browser context
   */
  getContext(id: string, options?: BrowserContextOptions): Effect.Effect<BrowserContext, BrowserError> {
    const self = this;
    return Effect.gen(function* () {
      if (!self.isInitialised) {
        yield* self.initialise();
      }

      const existing = MutableHashMap.get(self.contexts, id);
      if (Option.isSome(existing)) {
        return existing.value;
      }

      const browser = self.getLeastLoadedBrowser();
      const context = yield* Effect.tryPromise({
        try: () => browser.newContext({
          viewport: self.config.viewport,
          userAgent: self.config.userAgent,
          locale: self.config.locale,
          extraHTTPHeaders: self.config.extraHTTPHeaders,
          ...options
        }),
        catch: (error: unknown): BrowserError => BrowserError.createContext(error)
      });

      context.setDefaultTimeout(self.config.timeout);
      MutableHashMap.set(self.contexts, id, context);

      return context;
    });
  }

  /**
   * Create a new page in a context
   */
  createPage(contextId: string): Effect.Effect<Page, BrowserError> {
    const self = this;
    return Effect.gen(function* () {
      const context = yield* self.getContext(contextId);
      const page = yield* Effect.tryPromise({
        try: () => context.newPage(),
        catch: (error: unknown): BrowserError => BrowserError.createPage(error)
      });

      return page;
    });
  }

  /**
   * Get the browser with least contexts
   */
  private getLeastLoadedBrowser(): Browser {
    let minContexts = Infinity;
    let selectedBrowser = this.browsers[0];

    for (const browser of this.browsers) {
      const contextCount = browser.contexts().length;
      if (contextCount < minContexts) {
        minContexts = contextCount;
        selectedBrowser = browser;
      }
    }

    return selectedBrowser;
  }

  /**
   * Close a specific context
   */
  closeContext(id: string): Effect.Effect<void, BrowserError> {
    const self = this;
    return Effect.gen(function* () {
      const existing = MutableHashMap.get(self.contexts, id);
      if (Option.isSome(existing)) {
        yield* Effect.tryPromise({
          try: () => existing.value.close(),
          catch: (error: unknown): BrowserError => BrowserError.closeContext(error)
        });
        MutableHashMap.remove(self.contexts, id);
      }
    });
  }

  /**
   * Close all resources
   */
  close(): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      // Close all contexts in parallel, collecting errors
      const contextEntries: Array<[string, BrowserContext]> = Array.from(self.contexts);

      const contextEffects = contextEntries.map(([id, context]) =>
        Effect.tryPromise({
          try: () => context.close(),
          catch: (error) => BrowserCleanupError.context(id, error)
        })
      );

      const contextResults = yield* Effect.all(contextEffects, { mode: 'either' });

      // Log any context cleanup errors
      for (let index = 0; index < contextResults.length; index++) {
        const result = contextResults[index];
        if (Either.isLeft(result)) {
          const [id] = contextEntries[index];
          yield* Effect.logWarning(`Error closing context ${id}:`, result.left);
        }
      }

      MutableHashMap.clear(self.contexts);

      // Close all browsers in parallel, collecting errors
      const browserEffects = self.browsers.map((browser, index) =>
        Effect.tryPromise({
          try: () => browser.close(),
          catch: (error) => BrowserCleanupError.browser(`browser-${index}`, error)
        })
      );

      const browserResults = yield* Effect.all(browserEffects, { mode: 'either' });

      // Log any browser cleanup errors
      for (let index = 0; index < browserResults.length; index++) {
        const result = browserResults[index];
        if (Either.isLeft(result)) {
          yield* Effect.logWarning(`Error closing browser ${index}:`, result.left);
        }
      }

      self.browsers = [];
      self.isInitialised = false;
    });
  }

  /**
   * Get statistics about browser pool
   */
  getStats(): {
    browsers: number;
    contexts: number;
    pages: number;
  } {
    let totalPages = 0;
    for (const [, context] of this.contexts) {
      totalPages += context.pages().length;
    }

    return {
      browsers: this.browsers.length,
      contexts: MutableHashMap.size(this.contexts),
      pages: totalPages
    };
  }
}
