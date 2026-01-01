/**
 * Test Helper Utilities
 * Common operations for web-scraping.dev scenarios
 */

import { Page, ElementHandle } from 'playwright';
import * as cheerio from 'cheerio';
import { Effect, Config, DateTime, Option, Schedule, Data, Schema } from 'effect';
import { BrowserManager } from '../../browser/BrowserManager';
import { PlaywrightAdapter } from '../../browser/PlaywrightAdapter';

export interface ExtractedData {
  [key: string]: string | number | boolean | ExtractedData | ExtractedData[];
}

export interface TestContext {
  browserManager: BrowserManager;
  adapter: PlaywrightAdapter;
  baseUrl: string;
  screenshotDir?: string;
}

/** Error types for test operations */
export class TestSetupError extends Data.TaggedError('TestSetupError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class TestCleanupError extends Data.TaggedError('TestCleanupError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ScreenshotError extends Data.TaggedError('ScreenshotError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ContentNotFoundError extends Data.TaggedError('ContentNotFoundError')<{
  readonly selector: string;
  readonly retries: number;
  readonly cause?: unknown;
}> {}

export class OperationError extends Data.TaggedError('OperationError')<{
  readonly message: string;
  readonly retries: number;
  readonly cause?: unknown;
}> {}

// Schema for parsing JSON-LD content
const JsonLdContentSchema = Schema.parseJson(Schema.Unknown);

export class TestHelper {
  private static BASE_URL = 'https://web-scraping.dev';

  /**
   * Create a test context with browser setup
   */
  static createTestContext(scenarioName: string): Effect.Effect<TestContext, TestSetupError> {
    return Effect.gen(function* () {
      const ciConfig = yield* Config.string('CI').pipe(
        Config.withDefault('false'),
        Effect.catchAll(() => Effect.succeed('false'))
      );
      const headlessConfig = yield* Config.string('HEADLESS').pipe(
        Config.withDefault('false'),
        Effect.catchAll(() => Effect.succeed('false'))
      );

      const headless = ciConfig === 'true' || headlessConfig === 'true';

      const browserManager = new BrowserManager({
        headless,
        timeout: 30000,
        poolSize: 1
      });

      yield* browserManager.initialise().pipe(
        Effect.mapError((error) => new TestSetupError({
          message: 'Failed to initialise browser manager',
          cause: error
        }))
      );

      const adapter = new PlaywrightAdapter(browserManager, scenarioName);

      yield* adapter.initialise().pipe(
        Effect.mapError((error) => new TestSetupError({
          message: 'Failed to initialise adapter',
          cause: error
        }))
      );

      return {
        browserManager,
        adapter,
        baseUrl: TestHelper.BASE_URL,
        screenshotDir: `screenshots/${scenarioName}`
      };
    });
  }

  /**
   * Clean up test context
   */
  static cleanupTestContext(context: TestContext): Effect.Effect<void> {
    const closeAdapter = context.adapter.close().pipe(
      Effect.tapError((error) => Effect.logWarning('Error closing adapter:', error)),
      Effect.catchAll(() => Effect.void)
    );

    const closeBrowserManager = context.browserManager.close().pipe(
      Effect.tapError((error) => Effect.logWarning('Error closing browser manager:', error)),
      Effect.catchAll(() => Effect.void)
    );

    return Effect.all([closeAdapter, closeBrowserManager]).pipe(
      Effect.asVoid
    );
  }

  /**
   * Take screenshot on failure
   */
  static captureFailureScreenshot(
    page: Page,
    testName: string,
    error?: Error
  ): Effect.Effect<string, ScreenshotError> {
    return Effect.gen(function* () {
      const now = yield* DateTime.now;
      const timestamp = DateTime.formatIso(now).replace(/[:.]/g, '-');
      const filename = `failure-${testName}-${timestamp}.png`;
      const path = `screenshots/${filename}`;

      yield* Effect.tryPromise({
        try: () => page.screenshot({ path, fullPage: true }),
        catch: (screenshotError) => new ScreenshotError({
          message: 'Failed to capture screenshot',
          cause: screenshotError
        })
      });

      yield* Effect.logError(`Screenshot saved: ${path}`);

      if (error) {
        yield* Effect.logError(`Error: ${error.message}`);
      }

      return path;
    });
  }

  /**
   * Wait for content with retry
   */
  static waitForContentWithRetry(
    page: Page,
    selector: string,
    retries: number = 3,
    delay: number = 1000
  ): Effect.Effect<boolean, ContentNotFoundError> {
    const attempt = Effect.tryPromise({
      try: () => page.waitForSelector(selector, { state: 'visible', timeout: 5000 }),
      catch: (error) => new ContentNotFoundError({
        selector,
        retries,
        cause: error
      })
    }).pipe(Effect.as(true));

    const policy = Schedule.recurs(retries - 1).pipe(
      Schedule.addDelay(() => `${delay} millis`)
    );

    return attempt.pipe(
      Effect.retry(policy),
      Effect.catchAll((error) => Effect.fail(error))
    );
  }

  /**
   * Extract text content from selector
   */
  static extractText(page: Page, selector: string): Effect.Effect<string> {
    return Effect.tryPromise({
      try: () => page.textContent(selector),
      catch: () => Option.none<string>()
    }).pipe(
      Effect.map((text) => text ?? ''),
      Effect.catchAll(() => Effect.succeed(''))
    );
  }

  /**
   * Extract all text content from multiple elements
   */
  static extractAllText(page: Page, selector: string): Effect.Effect<string[]> {
    const emptyStringArray: string[] = [];
    return Effect.tryPromise({
      try: () => page.$$eval(selector, elements =>
        elements.map(el => el.textContent?.trim() ?? '')
      ),
      catch: () => emptyStringArray
    }).pipe(
      Effect.catchAll(() => Effect.succeed(emptyStringArray))
    );
  }

  /**
   * Extract attributes from elements
   */
  static extractAttributes(
    page: Page,
    selector: string,
    attribute: string
  ): Effect.Effect<string[]> {
    const emptyStringArray: string[] = [];
    return Effect.tryPromise({
      try: () => page.$$eval(
        selector,
        (elements, attr) => elements.map(el => el.getAttribute(attr) ?? ''),
        attribute
      ),
      catch: () => emptyStringArray
    }).pipe(
      Effect.catchAll(() => Effect.succeed(emptyStringArray))
    );
  }

  /**
   * Parse HTML with Cheerio
   */
  static parseHtml(html: string): cheerio.CheerioAPI {
    return cheerio.load(html);
  }

  /**
   * Extract structured data from JSON-LD
   * Returns an array of parsed JSON-LD objects
   */
  static extractJsonLd(page: Page): Effect.Effect<readonly unknown[]> {
    const emptyStringArray: string[] = [];
    return Effect.gen(function* () {
      // First, get the raw text content from all JSON-LD scripts
      const rawContents = yield* Effect.tryPromise({
        try: () => page.$$eval('script[type="application/ld+json"]', scripts =>
          scripts.map(script => script.textContent).filter((content): content is string => Option.isSome(Option.fromNullable(content)))
        ),
        catch: () => emptyStringArray
      }).pipe(
        Effect.catchAll(() => Effect.succeed(emptyStringArray))
      );

      // Parse each JSON-LD content using Schema
      const parseResults = yield* Effect.forEach(rawContents, (content) =>
        Schema.decodeUnknown(JsonLdContentSchema)(content).pipe(
          Effect.option
        )
      );

      // Filter out None values and extract the parsed data
      return parseResults
        .filter((opt): opt is Option.Some<unknown> => Option.isSome(opt))
        .map((opt) => opt.value);
    });
  }

  /**
   * Extract data attributes
   */
  static extractDataAttributes(page: Page, selector: string): Effect.Effect<Record<string, string>[]> {
    const emptyRecordArray: Record<string, string>[] = [];
    return Effect.tryPromise({
      try: () => page.$$eval(selector, elements =>
        elements.map(el => {
          const data: Record<string, string> = {};
          for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            if (attr.name.startsWith('data-')) {
              data[attr.name] = attr.value;
            }
          }
          return data;
        })
      ),
      catch: () => emptyRecordArray
    }).pipe(
      Effect.catchAll(() => Effect.succeed(emptyRecordArray))
    );
  }

  /**
   * Validate extracted data structure
   */
  static validateDataStructure(
    data: Record<string, unknown>,
    requiredFields: readonly string[]
  ): { valid: boolean; missing: readonly string[] } {
    const missing: string[] = [];

    for (const field of requiredFields) {
      const value = data[field];
      if (Option.isNone(Option.fromNullable(value))) {
        missing.push(field);
      }
    }

    return {
      valid: missing.length === 0,
      missing
    };
  }

  /**
   * Retry operation with exponential backoff
   */
  static retryWithBackoff<T, E>(
    operation: Effect.Effect<T, E>,
    maxRetries: number = 3,
    initialDelay: number = 1000
  ): Effect.Effect<T, E | OperationError> {
    const policy = Schedule.exponential(`${initialDelay} millis`).pipe(
      Schedule.compose(Schedule.recurs(maxRetries - 1)),
      Schedule.tapOutput((duration) =>
        Effect.logWarning(`Retrying after ${duration}`)
      )
    );

    return operation.pipe(
      Effect.retry(policy),
      Effect.mapError((error) => {
        if (error instanceof OperationError) return error;
        return new OperationError({
          message: 'Operation failed after retries',
          retries: maxRetries,
          cause: error
        });
      })
    );
  }

  /**
   * Check if element is visible
   */
  static isVisible(page: Page, selector: string): Effect.Effect<boolean> {
    type PlaywrightElement = ElementHandle<SVGElement | HTMLElement>;
    return Effect.gen(function* () {
      const elementOption = yield* Effect.tryPromise({
        try: () => page.$(selector),
        catch: (cause) => new ContentNotFoundError({ selector, retries: 0, cause })
      }).pipe(
        Effect.map((el) => Option.fromNullable(el)),
        Effect.catchAll(() => Effect.succeed(Option.none<PlaywrightElement>()))
      );

      return yield* Option.match(elementOption, {
        onNone: () => Effect.succeed(false),
        onSome: (element) => Effect.tryPromise({
          try: () => element.isVisible(),
          catch: (cause) => new OperationError({ message: 'Failed to check visibility', retries: 0, cause })
        }).pipe(Effect.catchAll(() => Effect.succeed(false)))
      });
    });
  }

  /**
   * Scroll element into view
   */
  static scrollIntoView(page: Page, selector: string): Effect.Effect<void> {
    return Effect.tryPromise({
      try: () => page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, selector),
      catch: (cause) => new ContentNotFoundError({ selector, retries: 0, cause })
    }).pipe(
      Effect.asVoid,
      Effect.catchAll(() => Effect.void)
    );
  }

  /**
   * Get computed style
   */
  static getComputedStyle(
    page: Page,
    selector: string,
    property: string
  ): Effect.Effect<string> {
    return Effect.tryPromise({
      try: () => page.evaluate((args: { sel: string; prop: string }) => {
        const element = document.querySelector(args.sel);
        if (!element) return '';
        return window.getComputedStyle(element).getPropertyValue(args.prop);
      }, { sel: selector, prop: property }),
      catch: () => ''
    }).pipe(
      Effect.catchAll(() => Effect.succeed(''))
    );
  }
}
