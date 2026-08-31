/**
 * Browser Manager for Playwright Integration
 * Handles browser lifecycle, pooling, and resource management
 */

import { Effect, MutableHashMap, Option, Result } from 'effect';
import { Browser, BrowserContext, Page, chromium, BrowserContextOptions } from 'playwright';
import { BrowserCleanupError, BrowserError } from '../lib/errors/effect-errors.js';

/** Configures the browser pool and the default settings for its new contexts. */
export interface BrowserConfig {
  /** Run Chromium without a visible window unless the caller opts out. */
  headless?: boolean;
  /** Apply this Playwright timeout to every context that this manager creates. */
  timeout?: number;
  /** Keep this many launched browsers available for context allocation. */
  poolSize?: number;
  /** Set the default viewport for new contexts. */
  viewport?: { width: number; height: number };
  /** Identify requests from every context that this manager creates. */
  userAgent?: string;
  /** Set the locale for every context that this manager creates. */
  locale?: string;
  /** Send these additional HTTP headers from every context that this manager creates. */
  extraHTTPHeaders?: Record<string, string>;
}

/**
 * Owns a reusable pool of Playwright browsers and their named contexts.
 *
 * Call {@link close} after the crawl so the manager releases every browser it launched.
 */
export class BrowserManager {
  /** Holds the browser pool after {@link initialise} launches it. */
  private browsers: Browser[] = [];
  /** Maps caller context identifiers to their live Playwright contexts. */
  private contexts: MutableHashMap.MutableHashMap<string, BrowserContext> = MutableHashMap.empty();
  /** Stores the resolved defaults that each new browser context receives. */
  private config: Required<BrowserConfig>;
  /** Prevents a second pool launch after the first successful initialisation. */
  private isInitialised = false;

  /** Resolves optional settings once so all later contexts share the same browser policy. */
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

      const contextResults = yield* Effect.all(contextEffects, { mode: 'result' });

      // Log any context cleanup errors
      for (let index = 0; index < contextResults.length; index++) {
        const result = contextResults[index];
        if (Result.isFailure(result)) {
          const [id] = contextEntries[index];
          yield* Effect.logWarning(`Error closing context ${id}:`, result.failure);
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

      const browserResults = yield* Effect.all(browserEffects, { mode: 'result' });

      // Log any browser cleanup errors
      for (let index = 0; index < browserResults.length; index++) {
        const result = browserResults[index];
        if (Result.isFailure(result)) {
          yield* Effect.logWarning(`Error closing browser ${index}:`, result.failure);
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
