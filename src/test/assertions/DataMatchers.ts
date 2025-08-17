/**
 * Data Matchers
 * Utilities for matching and comparing data structures in tests
 */

import { Effect } from 'effect';

export interface MatchResult {
  readonly matches: boolean;
  readonly path?: string;
  readonly message?: string;
  readonly actual?: any;
  readonly expected?: any;
}

/**
 * Deep equality matcher with custom comparisons
 */
export const deepMatch = (
  actual: any,
  expected: any,
  options: {
    ignoreKeys?: string[];
    allowExtraKeys?: boolean;
    customMatchers?: Record<string, (a: any, e: any) => boolean>;
    path?: string;
  } = {}
): MatchResult => {
  const {
    ignoreKeys = [],
    allowExtraKeys = false,
    customMatchers = {},
    path = '$',
  } = options;

  // Handle null/undefined
  if (expected === null || expected === undefined) {
    if (actual === expected) {
      return { matches: true };
    }
    return {
      matches: false,
      path,
      message: `Expected ${expected}, got ${actual}`,
      actual,
      expected,
    };
  }

  // Handle primitives
  if (typeof expected !== 'object') {
    if (actual === expected) {
      return { matches: true };
    }
    return {
      matches: false,
      path,
      message: `Values do not match`,
      actual,
      expected,
    };
  }

  // Handle arrays
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return {
        matches: false,
        path,
        message: `Expected array, got ${typeof actual}`,
        actual,
        expected,
      };
    }

    if (actual.length !== expected.length) {
      return {
        matches: false,
        path,
        message: `Array length mismatch`,
        actual: actual.length,
        expected: expected.length,
      };
    }

    for (let i = 0; i < expected.length; i++) {
      const result = deepMatch(actual[i], expected[i], {
        ignoreKeys,
        allowExtraKeys,
        customMatchers,
        path: `${path}[${i}]`,
      });

      if (!result.matches) {
        return result;
      }
    }

    return { matches: true };
  }

  // Handle objects
  if (typeof actual !== 'object' || actual === null) {
    return {
      matches: false,
      path,
      message: `Expected object, got ${typeof actual}`,
      actual,
      expected,
    };
  }

  // Check for missing keys
  for (const key of Object.keys(expected)) {
    if (ignoreKeys.includes(key)) continue;

    if (!(key in actual)) {
      return {
        matches: false,
        path: `${path}.${key}`,
        message: `Missing key`,
        actual: undefined,
        expected: expected[key],
      };
    }

    // Use custom matcher if available
    if (customMatchers[key]) {
      if (!customMatchers[key](actual[key], expected[key])) {
        return {
          matches: false,
          path: `${path}.${key}`,
          message: `Custom matcher failed`,
          actual: actual[key],
          expected: expected[key],
        };
      }
      continue;
    }

    // Recursive match
    const result = deepMatch(actual[key], expected[key], {
      ignoreKeys,
      allowExtraKeys,
      customMatchers,
      path: `${path}.${key}`,
    });

    if (!result.matches) {
      return result;
    }
  }

  // Check for extra keys
  if (!allowExtraKeys) {
    for (const key of Object.keys(actual)) {
      if (ignoreKeys.includes(key)) continue;

      if (!(key in expected)) {
        return {
          matches: false,
          path: `${path}.${key}`,
          message: `Unexpected key`,
          actual: actual[key],
          expected: undefined,
        };
      }
    }
  }

  return { matches: true };
};

/**
 * Partial matcher - checks if actual contains all expected properties
 */
export const partialMatch = (
  actual: any,
  expected: any,
  path: string = '$'
): MatchResult => {
  return deepMatch(actual, expected, {
    allowExtraKeys: true,
    path,
  });
};

/**
 * Pattern matcher using wildcards and regex
 */
export const patternMatch = (
  actual: any,
  pattern: any,
  path: string = '$'
): MatchResult => {
  // Special pattern symbols
  const ANY = Symbol.for('ANY');
  const ANY_STRING = Symbol.for('ANY_STRING');
  const ANY_NUMBER = Symbol.for('ANY_NUMBER');
  const ANY_BOOLEAN = Symbol.for('ANY_BOOLEAN');
  const ANY_ARRAY = Symbol.for('ANY_ARRAY');
  const ANY_OBJECT = Symbol.for('ANY_OBJECT');

  // Handle special patterns
  if (pattern === ANY) {
    return { matches: true };
  }

  if (pattern === ANY_STRING) {
    if (typeof actual === 'string') {
      return { matches: true };
    }
    return {
      matches: false,
      path,
      message: `Expected string, got ${typeof actual}`,
      actual,
      expected: 'string',
    };
  }

  if (pattern === ANY_NUMBER) {
    if (typeof actual === 'number') {
      return { matches: true };
    }
    return {
      matches: false,
      path,
      message: `Expected number, got ${typeof actual}`,
      actual,
      expected: 'number',
    };
  }

  if (pattern === ANY_BOOLEAN) {
    if (typeof actual === 'boolean') {
      return { matches: true };
    }
    return {
      matches: false,
      path,
      message: `Expected boolean, got ${typeof actual}`,
      actual,
      expected: 'boolean',
    };
  }

  if (pattern === ANY_ARRAY) {
    if (Array.isArray(actual)) {
      return { matches: true };
    }
    return {
      matches: false,
      path,
      message: `Expected array, got ${typeof actual}`,
      actual,
      expected: 'array',
    };
  }

  if (pattern === ANY_OBJECT) {
    if (
      typeof actual === 'object' &&
      actual !== null &&
      !Array.isArray(actual)
    ) {
      return { matches: true };
    }
    return {
      matches: false,
      path,
      message: `Expected object, got ${typeof actual}`,
      actual,
      expected: 'object',
    };
  }

  // Handle regex patterns
  if (pattern instanceof RegExp) {
    if (typeof actual === 'string' && pattern.test(actual)) {
      return { matches: true };
    }
    return {
      matches: false,
      path,
      message: `String does not match pattern`,
      actual,
      expected: pattern.toString(),
    };
  }

  // Default to deep match
  return deepMatch(actual, pattern, { path });
};

/**
 * Array matcher with order-independent comparison
 */
export const arrayMatch = (
  actual: any[],
  expected: any[],
  options: {
    ordered?: boolean;
    allowExtra?: boolean;
    allowMissing?: boolean;
    itemMatcher?: (a: any, e: any) => boolean;
  } = {}
): MatchResult => {
  const {
    ordered = true,
    allowExtra = false,
    allowMissing = false,
    itemMatcher,
  } = options;

  if (!Array.isArray(actual)) {
    return {
      matches: false,
      path: '$',
      message: `Expected array, got ${typeof actual}`,
      actual,
      expected: 'array',
    };
  }

  if (ordered) {
    // Ordered comparison
    if (!allowExtra && !allowMissing && actual.length !== expected.length) {
      return {
        matches: false,
        path: '$',
        message: `Array length mismatch`,
        actual: actual.length,
        expected: expected.length,
      };
    }

    for (let i = 0; i < expected.length; i++) {
      if (i >= actual.length) {
        if (!allowMissing) {
          return {
            matches: false,
            path: `$[${i}]`,
            message: `Missing element`,
            actual: undefined,
            expected: expected[i],
          };
        }
        continue;
      }

      const matches = itemMatcher
        ? itemMatcher(actual[i], expected[i])
        : deepMatch(actual[i], expected[i]).matches;

      if (!matches) {
        return {
          matches: false,
          path: `$[${i}]`,
          message: `Element mismatch`,
          actual: actual[i],
          expected: expected[i],
        };
      }
    }

    if (!allowExtra && actual.length > expected.length) {
      return {
        matches: false,
        path: `$[${expected.length}]`,
        message: `Unexpected element`,
        actual: actual[expected.length],
        expected: undefined,
      };
    }
  } else {
    // Unordered comparison
    const unmatchedActual = [...actual];
    const unmatchedExpected = [...expected];

    for (let i = unmatchedExpected.length - 1; i >= 0; i--) {
      const expectedItem = unmatchedExpected[i];
      const actualIndex = unmatchedActual.findIndex((item) =>
        itemMatcher
          ? itemMatcher(item, expectedItem)
          : deepMatch(item, expectedItem).matches
      );

      if (actualIndex >= 0) {
        unmatchedActual.splice(actualIndex, 1);
        unmatchedExpected.splice(i, 1);
      }
    }

    if (!allowMissing && unmatchedExpected.length > 0) {
      return {
        matches: false,
        path: '$',
        message: `Missing elements`,
        actual: unmatchedActual,
        expected: unmatchedExpected,
      };
    }

    if (!allowExtra && unmatchedActual.length > 0) {
      return {
        matches: false,
        path: '$',
        message: `Unexpected elements`,
        actual: unmatchedActual,
        expected: [],
      };
    }
  }

  return { matches: true };
};

/**
 * Create Effect from match result
 */
export const matchToEffect = (
  result: MatchResult
): Effect.Effect<void, MatchResult, never> => {
  if (result.matches) {
    return Effect.void;
  }
  return Effect.fail(result);
};

/**
 * Pattern matching symbols for export
 */
export const Patterns = {
  ANY: Symbol.for('ANY'),
  ANY_STRING: Symbol.for('ANY_STRING'),
  ANY_NUMBER: Symbol.for('ANY_NUMBER'),
  ANY_BOOLEAN: Symbol.for('ANY_BOOLEAN'),
  ANY_ARRAY: Symbol.for('ANY_ARRAY'),
  ANY_OBJECT: Symbol.for('ANY_OBJECT'),
} as const;
