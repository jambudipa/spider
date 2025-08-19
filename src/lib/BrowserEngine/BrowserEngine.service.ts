/**
 * Browser Engine Service
 * Provides browser automation capabilities using Playwright with Effect patterns
 */

import { Effect, Layer, Ref, Option, pipe } from 'effect';
import type { Browser, BrowserContext, Page } from 'playwright';
import { BrowserError, PageError } from '../errors/effect-errors.js';

export interface PageElement {
  selector: string;
  text?: string;
  attributes?: Record<string, string>;
}

export interface BrowserEngineConfig {
  headless?: boolean;
  timeout?: number;
  viewport?: { width: number; height: number };
  userAgent?: string;
  locale?: string;
}

export interface BrowserEngineService {
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
  scroll: (distance: number) => Effect.Effect<void, never>;

  /**
   * Execute JavaScript in the page
   */
  evaluate: <T>(script: string | Function) => Effect.Effect<T, PageError>;

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
  closePage: () => Effect.Effect<void, never>;

  /**
   * Close the browser
   */
  close: () => Effect.Effect<void, never>;
}

/**
 * Browser Engine Service implementation using Effect patterns
 */
export class BrowserEngineService extends Effect.Service<BrowserEngineService>()(
  '@jambudipa.io/BrowserEngine',
  {
    effect: Effect.gen(function* () {
      // Browser state management
      const browserRef = yield* Ref.make<Option.Option<Browser>>(Option.none());
      const contextRef = yield* Ref.make<Option.Option<BrowserContext>>(Option.none());
      const pageRef = yield* Ref.make<Option.Option<Page>>(Option.none());
      const configRef = yield* Ref.make<BrowserEngineConfig>({
        headless: true,
        timeout: 30000,
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (compatible; Spider/1.0)',
        locale: 'en-GB'
      });

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
        
        const config = yield* Ref.get(configRef);
        
        const browser = yield* Effect.tryPromise({
          try: () => chromium.launch({
            headless: config.headless,
            timeout: config.timeout
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
        const config = yield* Ref.get(configRef);
        
        const context = yield* Effect.tryPromise({
          try: () => browser.newContext({
            viewport: config.viewport,
            userAgent: config.userAgent,
            locale: config.locale
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
            const config = yield* Ref.get(configRef);
            
            yield* Effect.tryPromise({
              try: () => page.waitForSelector(selector, {
                timeout: timeout ?? config.timeout
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
          
          yield* Effect.tryPromise({
            try: () => page.evaluate((d) => {
              window.scrollBy(0, d);
            }, distance),
            catch: () => Effect.void
          });
          
          yield* Effect.logDebug(`Scrolled ${distance}px`);
        }),

        evaluate: <T>(script: string | ((...args: any[]) => any)) => Effect.gen(function* () {
          const page = yield* getCurrentPage();
          
          return yield* Effect.tryPromise({
            try: () => page.evaluate(script as any) as Promise<T>,
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
            yield* Effect.tryPromise({
              try: () => pageOpt.value.close(),
              catch: () => Effect.void
            });
            
            yield* Ref.set(pageRef, Option.none());
            yield* Effect.log('Page closed');
          }
        }),

        close: () => Effect.gen(function* () {
          // Close page first
          yield* Effect.gen(function* () {
            const pageOpt = yield* Ref.get(pageRef);
            if (Option.isSome(pageOpt)) {
              yield* Effect.tryPromise({
                try: () => pageOpt.value.close(),
                catch: () => Effect.void
              });
            }
          });
          
          // Close context
          yield* Effect.gen(function* () {
            const contextOpt = yield* Ref.get(contextRef);
            if (Option.isSome(contextOpt)) {
              yield* Effect.tryPromise({
                try: () => contextOpt.value.close(),
                catch: () => Effect.void
              });
            }
          });
          
          // Close browser
          yield* Effect.gen(function* () {
            const browserOpt = yield* Ref.get(browserRef);
            if (Option.isSome(browserOpt)) {
              yield* Effect.tryPromise({
                try: () => browserOpt.value.close(),
                catch: () => Effect.void
              });
            }
          });
          
          // Clear references
          yield* Ref.set(pageRef, Option.none());
          yield* Ref.set(contextRef, Option.none());
          yield* Ref.set(browserRef, Option.none());
          
          yield* Effect.log('Browser engine closed');
        })
      };
    })
  }
) {}

/**
 * Default BrowserEngine layer
 */
export const BrowserEngineLive = BrowserEngineService.Default;

/**
 * Create BrowserEngine with custom configuration
 */
export const BrowserEngineWithConfig = (config: BrowserEngineConfig) =>
  BrowserEngineService.Default;

/**
 * Helper to run browser operations with automatic cleanup
 */
export const withBrowser = <A, E, R>(
  operation: (engine: BrowserEngineService) => Effect.Effect<A, E, R>
) => Effect.gen(function* () {
  const engine = yield* BrowserEngineService;
  
  return yield* Effect.acquireUseRelease(
    Effect.succeed(engine),
    operation,
    (engine) => engine.close()
  );
});