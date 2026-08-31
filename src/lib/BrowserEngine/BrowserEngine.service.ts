/**
 * Browser Engine Service
 * Provides browser automation capabilities using Playwright with Effect patterns
 */

import { Context, Effect, Layer, Ref, Option } from 'effect';
import type { Browser, BrowserContext, Page } from 'playwright';
import { BrowserError, PageError } from '../errors/effect-errors.js';

/** Describes a page element extracted by selector, text, and optional attributes. */
export interface PageElement {
  /** Records the CSS selector that identified the element. */
  selector: string;
  /** Holds the element text when the extractor read text content. */
  text?: string;
  /** Holds attributes that the extractor chose to retain. */
  attributes?: Record<string, string>;
}

/** Configures the browser and context that a BrowserEngine service creates. */
export interface BrowserEngineConfig {
  /** Runs Chromium without a visible window unless the caller sets false. */
  headless?: boolean;
  /** Applies this Playwright timeout in milliseconds to browser operations. */
  timeout?: number;
  /** Sets the viewport for pages that the engine creates. */
  viewport?: { width: number; height: number };
  /** Identifies requests from pages that the engine creates. */
  userAgent?: string;
  /** Sets the locale for pages that the engine creates. */
  locale?: string;
}

/** Defines the page lifecycle operations exposed through the BrowserEngine service key. */
export interface BrowserEngineServiceInterface {
  /**
   * Launch the browser
   */
  launch: () => Effect.Effect<void, BrowserError>;

  /**
   * Create a new browser page
   */
  createPage: () => Effect.Effect<Page, BrowserError>;

  /**
   * Navigate to a URL
   */
  navigateTo: (url: string) => Effect.Effect<void, PageError>;

  /**
   * Wait for a selector to appear
   */
  waitForSelector: (
    selector: string,
    timeout?: number
  ) => Effect.Effect<void, PageError>;

  /**
   * Click an element
   */
  click: (selector: string) => Effect.Effect<void, PageError>;

  /**
   * Fill a form field
   */
  fill: (selector: string, value: string) => Effect.Effect<void, PageError>;

  /**
   * Scroll the page
   */
  scroll: (distance: number) => Effect.Effect<void, PageError>;

  /**
   * Execute JavaScript in the page
   */
  evaluate: <T>(script: string | (() => T)) => Effect.Effect<T, PageError>;

  /**
   * Get page HTML
   */
  getHTML: () => Effect.Effect<string, PageError>;

  /**
   * Take a screenshot
   */
  screenshot: (path?: string) => Effect.Effect<Buffer, PageError>;

  /**
   * Close the current page
   */
  closePage: () => Effect.Effect<void>;

  /**
   * Close the browser
   */
  close: () => Effect.Effect<void>;
}

/**
 * Configuration applied when the caller supplies none.
 *
 * @group Configuration
 * @public
 */
export const DEFAULT_BROWSER_ENGINE_CONFIG: Required<BrowserEngineConfig> = {
  headless: true,
  timeout: 30000,
  viewport: { width: 1920, height: 1080 },
  userAgent: 'Mozilla/5.0 (compatible; Spider/1.0)',
  locale: 'en-GB'
};

/**
 * Builds a browser engine bound to `config`.
 *
 * Exported so a caller can construct an engine with settings that actually
 * take effect; {@link BrowserEngineWithConfig} wraps this in a Layer.
 *
 * @group Services
 * @public
 */
export const makeBrowserEngine = (config: BrowserEngineConfig = {}) =>
  Effect.gen(function* () {
      const resolved: Required<BrowserEngineConfig> = {
        ...DEFAULT_BROWSER_ENGINE_CONFIG,
        ...config
      };

      // Browser state management
      const browserRef = yield* Ref.make<Option.Option<Browser>>(Option.none());
      const contextRef = yield* Ref.make<Option.Option<BrowserContext>>(Option.none());
      const pageRef = yield* Ref.make<Option.Option<Page>>(Option.none());

      /**
       * Get or create browser instance
       */
      const ensureBrowser = () => Effect.gen(function* () {
        const browserOpt = yield* Ref.get(browserRef);

        if (Option.isSome(browserOpt)) {
          return browserOpt.value;
        }

        // Lazy import playwright to avoid issues if not installed
        const { chromium } = yield* Effect.tryPromise({
          try: () => import('playwright'),
          catch: () => BrowserError.launchFailed('Playwright not installed')
        });

        const browser = yield* Effect.tryPromise({
          try: () => chromium.launch({
            headless: resolved.headless,
            timeout: resolved.timeout
          }),
          catch: (error) => BrowserError.launchFailed(error)
        });

        yield* Ref.set(browserRef, Option.some(browser));
        return browser;
      });

      /**
       * Get or create browser context
       */
      const ensureContext = () => Effect.gen(function* () {
        const contextOpt = yield* Ref.get(contextRef);

        if (Option.isSome(contextOpt)) {
          return contextOpt.value;
        }

        const browser = yield* ensureBrowser();

        const context = yield* Effect.tryPromise({
          try: () => browser.newContext({
            viewport: resolved.viewport,
            userAgent: resolved.userAgent,
            locale: resolved.locale
          }),
          catch: (error) => new BrowserError({
            operation: 'newContext',
            cause: error
          })
        });
        
        yield* Ref.set(contextRef, Option.some(context));
        return context;
      });

      /**
       * Get current page or fail
       */
      const getCurrentPage = () => Effect.gen(function* () {
        const pageOpt = yield* Ref.get(pageRef);
        
        return yield* Option.match(pageOpt, {
          onNone: () => Effect.fail(new PageError({
            url: 'unknown',
            operation: 'getCurrentPage',
            cause: 'No active page'
          })),
          onSome: (page) => Effect.succeed(page)
        });
      });

      return {
        launch: () => Effect.gen(function* () {
          yield* ensureBrowser();
          yield* Effect.log('Browser launched successfully');
        }),

        createPage: () => Effect.gen(function* () {
          const context = yield* ensureContext();
          
          const page = yield* Effect.tryPromise({
            try: () => context.newPage(),
            catch: (error) => new BrowserError({
              operation: 'newPage',
              cause: error
            })
          });
          
          yield* Ref.set(pageRef, Option.some(page));
          yield* Effect.log('New page created');
          
          return page;
        }),

        navigateTo: (url: string) => Effect.gen(function* () {
          const page = yield* getCurrentPage();
          
          yield* Effect.tryPromise({
            try: () => page.goto(url, { waitUntil: 'networkidle' }),
            catch: (error) => new PageError({
              url,
              operation: 'navigate',
              cause: error
            })
          });
          
          yield* Effect.logDebug(`Navigated to ${url}`);
        }),

        waitForSelector: (selector: string, timeout?: number) =>
          Effect.gen(function* () {
            const page = yield* getCurrentPage();

            yield* Effect.tryPromise({
              try: () => page.waitForSelector(selector, {
                timeout: timeout ?? resolved.timeout
              }),
              catch: (error) => new PageError({
                url: page.url(),
                operation: 'waitForSelector',
                selector,
                cause: error
              })
            });
          }),

        click: (selector: string) => Effect.gen(function* () {
          const page = yield* getCurrentPage();
          
          yield* Effect.tryPromise({
            try: () => page.click(selector),
            catch: (error) => new PageError({
              url: page.url(),
              operation: 'click',
              selector,
              cause: error
            })
          });
          
          yield* Effect.logDebug(`Clicked element: ${selector}`);
        }),

        fill: (selector: string, value: string) => Effect.gen(function* () {
          const page = yield* getCurrentPage();
          
          yield* Effect.tryPromise({
            try: () => page.fill(selector, value),
            catch: (error) => new PageError({
              url: page.url(),
              operation: 'fill',
              selector,
              cause: error
            })
          });
          
          yield* Effect.logDebug(`Filled ${selector} with value`);
        }),

        scroll: (distance: number) => Effect.gen(function* () {
          const page = yield* getCurrentPage();

          yield* Effect.ignore(
            Effect.tryPromise({
              try: () => page.evaluate((d) => {
                window.scrollBy(0, d);
              }, distance),
              catch: (error) =>
                new PageError({
                  url: page.url(),
                  operation: 'scroll',
                  cause: error,
                })
            })
          );

          yield* Effect.logDebug(`Scrolled ${distance}px`);
        }),

        evaluate: <T>(script: string | (() => T)) => Effect.gen(function* () {
          const page = yield* getCurrentPage();

          return yield* Effect.tryPromise({
            try: () => page.evaluate(script),
            catch: (error) => new PageError({
              url: page.url(),
              operation: 'evaluate',
              cause: error
            })
          });
        }),

        getHTML: () => Effect.gen(function* () {
          const page = yield* getCurrentPage();
          
          return yield* Effect.tryPromise({
            try: () => page.content(),
            catch: (error) => new PageError({
              url: page.url(),
              operation: 'getHTML',
              cause: error
            })
          });
        }),

        screenshot: (path?: string) => Effect.gen(function* () {
          const page = yield* getCurrentPage();
          
          const buffer = yield* Effect.tryPromise({
            try: () => page.screenshot({ path, fullPage: true }),
            catch: (error) => new PageError({
              url: page.url(),
              operation: 'screenshot',
              cause: error
            })
          });
          
          yield* Effect.log(`Screenshot taken${path ? ` and saved to ${path}` : ''}`);
          return buffer;
        }),

        closePage: () => Effect.gen(function* () {
          const pageOpt = yield* Ref.get(pageRef);

          if (Option.isSome(pageOpt)) {
            yield* Effect.ignore(
              Effect.tryPromise({
                try: () => pageOpt.value.close(),
                catch: (error) =>
                  new PageError({
                    url: pageOpt.value.url(),
                    operation: 'closePage',
                    cause: error,
                  })
              })
            );

            yield* Ref.set(pageRef, Option.none());
            yield* Effect.log('Page closed');
          }
        }),

        close: () => Effect.gen(function* () {
          // Close page first
          const pageOpt = yield* Ref.get(pageRef);
          if (Option.isSome(pageOpt)) {
            yield* Effect.ignore(
              Effect.tryPromise({
                try: () => pageOpt.value.close(),
                catch: (error) =>
                  new PageError({
                    url: pageOpt.value.url(),
                    operation: 'closePage',
                    cause: error,
                  })
              })
            );
          }

          // Close context
          const contextOpt = yield* Ref.get(contextRef);
          if (Option.isSome(contextOpt)) {
            yield* Effect.ignore(
              Effect.tryPromise({
                try: () => contextOpt.value.close(),
                catch: (error) => BrowserError.closeContext(error)
              })
            );
          }

          // Close browser
          const browserOpt = yield* Ref.get(browserRef);
          if (Option.isSome(browserOpt)) {
            yield* Effect.ignore(
              Effect.tryPromise({
                try: () => browserOpt.value.close(),
                catch: (error) =>
                  new BrowserError({ operation: 'close', cause: error })
              })
            );
          }

          // Clear references
          yield* Ref.set(pageRef, Option.none());
          yield* Ref.set(contextRef, Option.none());
          yield* Ref.set(browserRef, Option.none());

          yield* Effect.log('Browser engine closed');
        })
      };
  });

/**
 * Browser Engine Service implementation using Effect patterns
 */
export class BrowserEngineService extends Context.Service<
  BrowserEngineService,
  BrowserEngineServiceInterface
>()(
  '@jambudipa.io/BrowserEngine',
  {
    make: makeBrowserEngine()
  }
) {
  /** Provides the default engine through the service key with the default browser configuration. */
  static readonly layer = Layer.effect(
    BrowserEngineService,
    BrowserEngineService.make
  );
}

/**
 * Default BrowserEngine layer
 */
export const BrowserEngineLive = BrowserEngineService.layer;

/**
 * Create BrowserEngine with custom configuration.
 *
 * The supplied config is applied to the launched browser and its context —
 * pass `{ headless: false }` and you get a headed browser.
 */
export const BrowserEngineWithConfig = (config: BrowserEngineConfig) =>
  Layer.effect(BrowserEngineService, makeBrowserEngine(config));

/**
 * Helper to run browser operations with automatic cleanup
 */
export const withBrowser = <A, E, R>(
  operation: (_engine: BrowserEngineServiceInterface) => Effect.Effect<A, E, R>
) => Effect.gen(function* () {
  const engine = yield* BrowserEngineService;
  
  return yield* Effect.acquireUseRelease(
    Effect.succeed(engine),
    operation,
    (engine) => engine.close()
  );
});
