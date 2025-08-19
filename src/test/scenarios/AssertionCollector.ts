/**
 * Assertion Collector
 * Collects and manages test assertions during scenario execution
 */

import { Effect, Ref, Option } from 'effect';
import { AssertionResult } from './ScenarioTestRunner.js';

/**
 * Assertion collector that accumulates test assertions during execution
 */
export class AssertionCollector {
  private assertionsRef: Ref.Ref<AssertionResult[]>;

  constructor() {
    this.assertionsRef = Ref.unsafeMake<AssertionResult[]>([]);
  }

  /**
   * Add an assertion result to the collection
   */
  collect(assertion: AssertionResult): Effect.Effect<void> {
    return Ref.update(this.assertionsRef, (assertions) => [...assertions, assertion]);
  }

  /**
   * Assert a condition and collect the result
   */
  assert(
    name: string,
    condition: boolean,
    expected?: any,
    actual?: any,
    message?: string
  ): Effect.Effect<void> {
    const assertion: AssertionResult = {
      name,
      passed: condition,
      expected,
      actual,
      message: message ?? (condition ? 'Assertion passed' : 'Assertion failed'),
    };
    return this.collect(assertion);
  }

  /**
   * Assert equality and collect the result
   */
  assertEqual<T>(
    name: string,
    actual: T,
    expected: T,
    message?: string
  ): Effect.Effect<void> {
    const passed = actual === expected;
    return this.assert(
      name,
      passed,
      expected,
      actual,
      message ?? `Expected ${expected}, got ${actual}`
    );
  }

  /**
   * Assert array contains value and collect the result
   */
  assertContains<T>(
    name: string,
    array: T[],
    value: T,
    message?: string
  ): Effect.Effect<void> {
    const passed = array.includes(value);
    return this.assert(
      name,
      passed,
      `array containing ${value}`,
      array,
      message ?? `Array does not contain ${value}`
    );
  }

  /**
   * Assert truthy value and collect the result
   */
  assertTruthy(
    name: string,
    value: any,
    message?: string
  ): Effect.Effect<void> {
    const passed = !!value;
    return this.assert(
      name,
      passed,
      'truthy value',
      value,
      message ?? `Expected truthy value, got ${value}`
    );
  }

  /**
   * Assert falsy value and collect the result
   */
  assertFalsy(
    name: string,
    value: any,
    message?: string
  ): Effect.Effect<void> {
    const passed = !value;
    return this.assert(
      name,
      passed,
      'falsy value',
      value,
      message ?? `Expected falsy value, got ${value}`
    );
  }

  /**
   * Assert greater than and collect the result
   */
  assertGreaterThan(
    name: string,
    actual: number,
    expected: number,
    message?: string
  ): Effect.Effect<void> {
    const passed = actual > expected;
    return this.assert(
      name,
      passed,
      `> ${expected}`,
      actual,
      message ?? `Expected ${actual} > ${expected}`
    );
  }

  /**
   * Assert less than and collect the result
   */
  assertLessThan(
    name: string,
    actual: number,
    expected: number,
    message?: string
  ): Effect.Effect<void> {
    const passed = actual < expected;
    return this.assert(
      name,
      passed,
      `< ${expected}`,
      actual,
      message ?? `Expected ${actual} < ${expected}`
    );
  }

  /**
   * Assert object has property and collect the result
   */
  assertHasProperty(
    name: string,
    obj: any,
    property: string,
    value?: any,
    message?: string
  ): Effect.Effect<void> {
    const hasProperty = property in obj;
    const passed = value === undefined ? hasProperty : hasProperty && obj[property] === value;
    
    return this.assert(
      name,
      passed,
      value === undefined ? `has property ${property}` : `${property} = ${value}`,
      value === undefined ? hasProperty : obj[property],
      message ?? (value === undefined 
        ? `Object does not have property ${property}`
        : `Property ${property} expected ${value}, got ${obj[property]}`)
    );
  }

  /**
   * Assert regex match and collect the result
   */
  assertMatches(
    name: string,
    text: string,
    pattern: RegExp,
    message?: string
  ): Effect.Effect<void> {
    const passed = pattern.test(text);
    return this.assert(
      name,
      passed,
      `matches ${pattern}`,
      text,
      message ?? `Text does not match pattern ${pattern}`
    );
  }

  /**
   * Assert no errors and collect the result
   */
  assertNoErrors(
    name: string,
    errors: any[] | undefined,
    message?: string
  ): Effect.Effect<void> {
    const passed = !errors || errors.length === 0;
    return this.assert(
      name,
      passed,
      'no errors',
      errors,
      message ?? `Expected no errors, found ${errors?.length ?? 0}`
    );
  }

  /**
   * Get all collected assertions
   */
  getAssertions(): Effect.Effect<AssertionResult[]> {
    return Ref.get(this.assertionsRef);
  }

  /**
   * Clear all assertions
   */
  clear(): Effect.Effect<void> {
    return Ref.set(this.assertionsRef, []);
  }

  /**
   * Get summary of assertions
   */
  getSummary(): Effect.Effect<{
    total: number;
    passed: number;
    failed: number;
    failedAssertions: AssertionResult[];
  }> {
    const self = this;
    return Effect.gen(function* () {
      const assertions = yield* Ref.get(self.assertionsRef);
      const passed = assertions.filter((a) => a.passed).length;
      const failed = assertions.filter((a) => !a.passed).length;
      const failedAssertions = assertions.filter((a) => !a.passed);

      return {
        total: assertions.length,
        passed,
        failed,
        failedAssertions,
      };
    });
  }
}

/**
 * Create a new assertion collector
 */
export const createAssertionCollector = (): AssertionCollector => {
  return new AssertionCollector();
};

/**
 * Run assertions with a collector and return results
 */
export const withAssertions = <A, E, R>(
  assertions: (collector: AssertionCollector) => Effect.Effect<A, E, R>
): Effect.Effect<{ result: A; assertions: AssertionResult[] }, E, R> =>
  Effect.gen(function* () {
    const collector = createAssertionCollector();
    const result = yield* assertions(collector);
    const collectedAssertions = yield* collector.getAssertions();
    
    return {
      result,
      assertions: collectedAssertions,
    };
  });