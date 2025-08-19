/**
 * Browser Manager for Playwright Integration
 * Handles browser lifecycle, pooling, and resource management
 */

import { Effect, Either } from 'effect';
import { Browser, BrowserContext, Page, chromium, BrowserContextOptions } from 'playwright';
import { BrowserCleanupError } from '../lib/errors';

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
  private contexts: Map<string, BrowserContext> = new Map();
  private config: Required<BrowserConfig>;
  private isInitialised = false;

  constructor(config: BrowserConfig = {}) {
    this.config = {
      headless: config.headless ?? process.env.PLAYWRIGHT_HEADLESS === 'true',
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
  async initialise(): Promise<void> {
    if (this.isInitialised) return;

    for (let i = 0; i < this.config.poolSize; i++) {
      const browser = await this.launchBrowser();
      this.browsers.push(browser);
    }

    this.isInitialised = true;
  }

  /**
   * Launch a new browser instance
   */
  private async launchBrowser(): Promise<Browser> {
    return await chromium.launch({
      headless: this.config.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });
  }

  /**
   * Get or create a browser context
   */
  async getContext(id: string, options?: BrowserContextOptions): Promise<BrowserContext> {
    if (!this.isInitialised) {
      await this.initialise();
    }

    if (this.contexts.has(id)) {
      return this.contexts.get(id)!;
    }

    const browser = this.getLeastLoadedBrowser();
    const context = await browser.newContext({
      viewport: this.config.viewport,
      userAgent: this.config.userAgent,
      locale: this.config.locale,
      extraHTTPHeaders: this.config.extraHTTPHeaders,
      ...options
    });

    context.setDefaultTimeout(this.config.timeout);
    this.contexts.set(id, context);

    return context;
  }

  /**
   * Create a new page in a context
   */
  async createPage(contextId: string): Promise<Page> {
    const context = await this.getContext(contextId);
    const page = await context.newPage();
    
    // Setup error handlers
    page.on('pageerror', error => {
      console.error(`Page error in context ${contextId}:`, error);
    });

    page.on('crash', () => {
      console.error(`Page crashed in context ${contextId}`);
    });

    return page;
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
  async closeContext(id: string): Promise<void> {
    const context = this.contexts.get(id);
    if (context) {
      await context.close();
      this.contexts.delete(id);
    }
  }

  /**
   * Close all resources
   */
  close(): Effect.Effect<void, never, never> {
    const self = this;
    return Effect.gen(function* () {
      // Close all contexts in parallel, collecting errors
      const contextEntries = Array.from(self.contexts.entries());
      const contextEffects = contextEntries.map(([id, context]) =>
        Effect.tryPromise({
          try: () => context.close(),
          catch: (error) => BrowserCleanupError.context(id, error)
        })
      );
      
      const contextResults = yield* Effect.all(contextEffects, { mode: "either" });

      // Log any context cleanup errors
      contextResults.forEach((result, index) => {
        if (Either.isLeft(result)) {
          const [id] = contextEntries[index];
          console.warn(`Error closing context ${id}:`, result.left);
        }
      });

      self.contexts.clear();

      // Close all browsers in parallel, collecting errors
      const browserEffects = self.browsers.map((browser, index) =>
        Effect.tryPromise({
          try: () => browser.close(),
          catch: (error) => BrowserCleanupError.browser(`browser-${index}`, error)
        })
      );
      
      const browserResults = yield* Effect.all(browserEffects, { mode: "either" });

      // Log any browser cleanup errors
      browserResults.forEach((result, index) => {
        if (Either.isLeft(result)) {
          console.warn(`Error closing browser ${index}:`, result.left);
        }
      });

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
    for (const context of this.contexts.values()) {
      totalPages += context.pages().length;
    }

    return {
      browsers: this.browsers.length,
      contexts: this.contexts.size,
      pages: totalPages
    };
  }
}