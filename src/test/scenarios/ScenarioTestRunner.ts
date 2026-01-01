/**
 * Scenario Test Runner
 * Orchestrates the execution of all web-scraping.dev scenario tests
 */

import { Data, DateTime, Effect, HashMap } from 'effect';
import { AssertionCollector, createAssertionCollector } from './AssertionCollector.js';

/**
 * Error when a scenario is not found
 */
export class ScenarioNotFoundError extends Data.TaggedError('ScenarioNotFoundError')<{
  readonly scenarioId: string;
  readonly message: string;
}> {
  override get name(): string {
    return 'ScenarioNotFoundError';
  }
}

/**
 * Error when a scenario is not yet implemented
 */
export class NotImplementedError extends Data.TaggedError('NotImplementedError')<{
  readonly feature: string;
  readonly taskId: string;
  readonly message: string;
}> {
  override get name(): string {
    return 'NotImplementedError';
  }
}

/**
 * Generic data type for scenario result data
 */
export interface ScenarioData {
  readonly [key: string]: unknown;
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  category: 'static' | 'dynamic' | 'auth' | 'special';
  url: string;
  description: string;
  requiresBrowser: boolean;
  execute: () => Effect.Effect<ScenarioData, ScenarioNotFoundError | NotImplementedError>;
  validate: (result: ScenarioData, collector: AssertionCollector) => Effect.Effect<boolean>;
}

export interface ScenarioResult {
  scenario: string;
  success: boolean;
  data?: ScenarioData;
  errors?: Array<ScenarioNotFoundError | NotImplementedError>;
  duration: number;
  assertions: AssertionResult[];
}

export interface AssertionResult {
  name: string;
  passed: boolean;
  expected?: unknown;
  actual?: unknown;
  message?: string;
}

export class ScenarioTestRunner {
  private scenarios: HashMap.HashMap<string, ScenarioDefinition> = HashMap.empty();

  /**
   * Register all scenario definitions
   */
  registerScenarios(): void {
    // Static scenarios
    this.register({
      id: 'static-pagination',
      name: 'Static Pagination',
      category: 'static',
      url: 'https://web-scraping.dev/products',
      description: 'HTML-based server-side item paging',
      requiresBrowser: false,
      execute: () => this.executeStaticPagination(),
      validate: (result, collector) => this.validateStaticPagination(result, collector),
    });

    this.register({
      id: 'product-markup',
      name: 'Product HTML Markup',
      category: 'static',
      url: 'https://web-scraping.dev/product/1',
      description: 'Basic e-commerce product structure',
      requiresBrowser: false,
      execute: () => this.executeProductMarkup(),
      validate: (result, collector) => this.validateProductMarkup(result, collector),
    });

    this.register({
      id: 'hidden-data',
      name: 'Hidden Web Data',
      category: 'static',
      url: 'https://web-scraping.dev/product/1',
      description: 'Product review data hidden in JSON',
      requiresBrowser: false,
      execute: () => this.executeHiddenData(),
      validate: (result, collector) => this.validateHiddenData(result, collector),
    });

    // Dynamic scenarios
    this.register({
      id: 'infinite-scroll',
      name: 'Endless Scroll Paging',
      category: 'dynamic',
      url: 'https://web-scraping.dev/testimonials',
      description: 'Dynamic client side paging on scroll',
      requiresBrowser: true,
      execute: () => this.executeInfiniteScroll(),
      validate: (result, collector) => this.validateInfiniteScroll(result, collector),
    });

    this.register({
      id: 'load-more-button',
      name: 'Endless Button Paging',
      category: 'dynamic',
      url: 'https://web-scraping.dev/reviews',
      description: 'Dynamic paging with Load More button',
      requiresBrowser: true,
      execute: () => this.executeLoadMoreButton(),
      validate: (result, collector) => this.validateLoadMoreButton(result, collector),
    });

    this.register({
      id: 'graphql',
      name: 'GraphQL Background Requests',
      category: 'dynamic',
      url: 'https://web-scraping.dev/reviews',
      description: 'Data loaded through GraphQL API',
      requiresBrowser: true,
      execute: () => this.executeGraphQL(),
      validate: (result, collector) => this.validateGraphQL(result, collector),
    });

    // Authentication scenarios
    this.register({
      id: 'cookie-login',
      name: 'Cookies Based Login',
      category: 'auth',
      url: 'https://web-scraping.dev/login',
      description: 'Form authentication with cookies',
      requiresBrowser: false,
      execute: () => this.executeCookieLogin(),
      validate: (result, collector) => this.validateCookieLogin(result, collector),
    });

    this.register({
      id: 'csrf-token',
      name: 'CSRF Token Locks',
      category: 'auth',
      url: 'https://web-scraping.dev/product/1',
      description: 'X-CSRF-Token header protection',
      requiresBrowser: false,
      execute: () => this.executeCSRFToken(),
      validate: (result, collector) => this.validateCSRFToken(result, collector),
    });

    this.register({
      id: 'secret-api-token',
      name: 'Secret API Token',
      category: 'auth',
      url: 'https://web-scraping.dev/testimonials',
      description: 'X-Secret-Token for API access',
      requiresBrowser: true,
      execute: () => this.executeSecretAPIToken(),
      validate: (result, collector) => this.validateSecretAPIToken(result, collector),
    });

    // Special scenarios
    this.register({
      id: 'pdf-download',
      name: 'PDF Downloads',
      category: 'special',
      url: 'https://web-scraping.dev/login',
      description: 'File download triggers',
      requiresBrowser: false,
      execute: () => this.executePDFDownload(),
      validate: (result, collector) => this.validatePDFDownload(result, collector),
    });

    this.register({
      id: 'cookie-popup',
      name: 'Cookie Popup',
      category: 'special',
      url: 'https://web-scraping.dev/login?cookies',
      description: 'Modal popup handling',
      requiresBrowser: true,
      execute: () => this.executeCookiePopup(),
      validate: (result, collector) => this.validateCookiePopup(result, collector),
    });

    this.register({
      id: 'local-storage',
      name: 'Local Storage',
      category: 'special',
      url: 'https://web-scraping.dev/product/1',
      description: 'Client-side storage for cart',
      requiresBrowser: true,
      execute: () => this.executeLocalStorage(),
      validate: (result, collector) => this.validateLocalStorage(result, collector),
    });

    this.register({
      id: 'forced-new-tab',
      name: 'Forced New Tab Links',
      category: 'special',
      url: 'https://web-scraping.dev/reviews',
      description: 'Links that force new tabs',
      requiresBrowser: false,
      execute: () => this.executeForcedNewTab(),
      validate: (result, collector) => this.validateForcedNewTab(result, collector),
    });

    this.register({
      id: 'block-page',
      name: 'Example Block Page',
      category: 'special',
      url: 'https://web-scraping.dev/blocked',
      description: 'Block detection with 200 status',
      requiresBrowser: false,
      execute: () => this.executeBlockPage(),
      validate: (result, collector) => this.validateBlockPage(result, collector),
    });
  }

  private register(scenario: ScenarioDefinition): void {
    this.scenarios = HashMap.set(this.scenarios, scenario.id, scenario);
  }

  /**
   * Run a specific scenario
   */
  runScenario(id: string): Effect.Effect<ScenarioResult, ScenarioNotFoundError | NotImplementedError> {
    const self = this;
    return Effect.gen(function* () {
      const scenarioOption = HashMap.get(self.scenarios, id);
      if (scenarioOption._tag === 'None') {
        return yield* Effect.fail(new ScenarioNotFoundError({
          scenarioId: id,
          message: `Scenario ${id} not found`,
        }));
      }
      const scenario = scenarioOption.value;

      const startTime = yield* DateTime.now;
      const result = yield* scenario.execute();
      const endTime = yield* DateTime.now;
      const duration = DateTime.toEpochMillis(endTime) - DateTime.toEpochMillis(startTime);

      // Create assertion collector for validation
      const collector = createAssertionCollector();
      const success = yield* scenario.validate(result, collector);
      const assertions = yield* collector.getAssertions();

      return {
        scenario: scenario.name,
        success,
        data: result,
        duration,
        assertions,
      };
    });
  }

  /**
   * Run all scenarios
   */
  runAll(): Effect.Effect<HashMap.HashMap<string, ScenarioResult>> {
    const self = this;
    return Effect.gen(function* () {
      let results = HashMap.empty<string, ScenarioResult>();

      for (const [id, scenario] of HashMap.toEntries(self.scenarios)) {
        const result = yield* Effect.either(self.runScenario(id));
        if (result._tag === 'Right') {
          results = HashMap.set(results, id, result.right);
        } else {
          results = HashMap.set(results, id, {
            scenario: scenario.name,
            success: false,
            errors: [result.left],
            duration: 0,
            assertions: [],
          });
        }
      }

      return results;
    });
  }

  // Implementation stubs for each scenario
  // These will be implemented in Phase 4 tasks

  private executeStaticPagination(): Effect.Effect<ScenarioData, NotImplementedError> {
    return Effect.fail(new NotImplementedError({
      feature: 'Static Pagination',
      taskId: '4.4',
      message: 'Not implemented - Task 4.4',
    }));
  }

  private validateStaticPagination(result: ScenarioData, collector: AssertionCollector): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      // Example assertions for static pagination
      yield* collector.assertTruthy('Result exists', result);
      yield* collector.assertHasProperty('Has pages', result, 'pages');

      // Return overall validation status
      const summary = yield* collector.getSummary();
      return summary.failed === 0;
    });
  }

  private executeProductMarkup(): Effect.Effect<ScenarioData, NotImplementedError> {
    return Effect.fail(new NotImplementedError({
      feature: 'Product Markup',
      taskId: '4.5',
      message: 'Not implemented - Task 4.5',
    }));
  }

  private validateProductMarkup(result: ScenarioData, collector: AssertionCollector): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      yield* collector.assertTruthy('Result exists', result);
      const summary = yield* collector.getSummary();
      return summary.failed === 0;
    });
  }

  private executeHiddenData(): Effect.Effect<ScenarioData, NotImplementedError> {
    return Effect.fail(new NotImplementedError({
      feature: 'Hidden Data',
      taskId: '4.6',
      message: 'Not implemented - Task 4.6',
    }));
  }

  private validateHiddenData(result: ScenarioData, collector: AssertionCollector): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      yield* collector.assertTruthy('Result exists', result);
      const summary = yield* collector.getSummary();
      return summary.failed === 0;
    });
  }

  private executeInfiniteScroll(): Effect.Effect<ScenarioData, NotImplementedError> {
    return Effect.fail(new NotImplementedError({
      feature: 'Infinite Scroll',
      taskId: '4.7',
      message: 'Not implemented - Task 4.7',
    }));
  }

  private validateInfiniteScroll(result: ScenarioData, collector: AssertionCollector): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      yield* collector.assertTruthy('Result exists', result);
      const summary = yield* collector.getSummary();
      return summary.failed === 0;
    });
  }

  private executeLoadMoreButton(): Effect.Effect<ScenarioData, NotImplementedError> {
    return Effect.fail(new NotImplementedError({
      feature: 'Load More Button',
      taskId: '4.8',
      message: 'Not implemented - Task 4.8',
    }));
  }

  private validateLoadMoreButton(result: ScenarioData, collector: AssertionCollector): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      yield* collector.assertTruthy('Result exists', result);
      const summary = yield* collector.getSummary();
      return summary.failed === 0;
    });
  }

  private executeGraphQL(): Effect.Effect<ScenarioData, NotImplementedError> {
    return Effect.fail(new NotImplementedError({
      feature: 'GraphQL',
      taskId: '4.9',
      message: 'Not implemented - Task 4.9',
    }));
  }

  private validateGraphQL(result: ScenarioData, collector: AssertionCollector): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      yield* collector.assertTruthy('Result exists', result);
      const summary = yield* collector.getSummary();
      return summary.failed === 0;
    });
  }

  private executeCookieLogin(): Effect.Effect<ScenarioData, NotImplementedError> {
    return Effect.fail(new NotImplementedError({
      feature: 'Cookie Login',
      taskId: '4.10',
      message: 'Not implemented - Task 4.10',
    }));
  }

  private validateCookieLogin(result: ScenarioData, collector: AssertionCollector): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      yield* collector.assertTruthy('Result exists', result);
      const summary = yield* collector.getSummary();
      return summary.failed === 0;
    });
  }

  private executeCSRFToken(): Effect.Effect<ScenarioData, NotImplementedError> {
    return Effect.fail(new NotImplementedError({
      feature: 'CSRF Token',
      taskId: '4.11',
      message: 'Not implemented - Task 4.11',
    }));
  }

  private validateCSRFToken(result: ScenarioData, collector: AssertionCollector): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      yield* collector.assertTruthy('Result exists', result);
      const summary = yield* collector.getSummary();
      return summary.failed === 0;
    });
  }

  private executeSecretAPIToken(): Effect.Effect<ScenarioData, NotImplementedError> {
    return Effect.fail(new NotImplementedError({
      feature: 'Secret API Token',
      taskId: '4.12',
      message: 'Not implemented - Task 4.12',
    }));
  }

  private validateSecretAPIToken(result: ScenarioData, collector: AssertionCollector): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      yield* collector.assertTruthy('Result exists', result);
      const summary = yield* collector.getSummary();
      return summary.failed === 0;
    });
  }

  private executePDFDownload(): Effect.Effect<ScenarioData, NotImplementedError> {
    return Effect.fail(new NotImplementedError({
      feature: 'PDF Download',
      taskId: '4.13',
      message: 'Not implemented - Task 4.13',
    }));
  }

  private validatePDFDownload(result: ScenarioData, collector: AssertionCollector): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      yield* collector.assertTruthy('Result exists', result);
      const summary = yield* collector.getSummary();
      return summary.failed === 0;
    });
  }

  private executeCookiePopup(): Effect.Effect<ScenarioData, NotImplementedError> {
    return Effect.fail(new NotImplementedError({
      feature: 'Cookie Popup',
      taskId: '4.14',
      message: 'Not implemented - Task 4.14',
    }));
  }

  private validateCookiePopup(result: ScenarioData, collector: AssertionCollector): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      yield* collector.assertTruthy('Result exists', result);
      const summary = yield* collector.getSummary();
      return summary.failed === 0;
    });
  }

  private executeLocalStorage(): Effect.Effect<ScenarioData, NotImplementedError> {
    return Effect.fail(new NotImplementedError({
      feature: 'Local Storage',
      taskId: '4.15',
      message: 'Not implemented - Task 4.15',
    }));
  }

  private validateLocalStorage(result: ScenarioData, collector: AssertionCollector): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      yield* collector.assertTruthy('Result exists', result);
      const summary = yield* collector.getSummary();
      return summary.failed === 0;
    });
  }

  private executeForcedNewTab(): Effect.Effect<ScenarioData, NotImplementedError> {
    return Effect.fail(new NotImplementedError({
      feature: 'Forced New Tab',
      taskId: '4.16',
      message: 'Not implemented - Task 4.16',
    }));
  }

  private validateForcedNewTab(result: ScenarioData, collector: AssertionCollector): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      yield* collector.assertTruthy('Result exists', result);
      const summary = yield* collector.getSummary();
      return summary.failed === 0;
    });
  }

  private executeBlockPage(): Effect.Effect<ScenarioData, NotImplementedError> {
    return Effect.fail(new NotImplementedError({
      feature: 'Block Page',
      taskId: '4.17',
      message: 'Not implemented - Task 4.17',
    }));
  }

  private validateBlockPage(result: ScenarioData, collector: AssertionCollector): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      yield* collector.assertTruthy('Result exists', result);
      const summary = yield* collector.getSummary();
      return summary.failed === 0;
    });
  }
}
