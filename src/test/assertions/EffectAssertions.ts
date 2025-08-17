/**
 * Effect Assertions - Fixed Version
 * Assertion utilities for Effect-based testing
 */

import { Effect, pipe } from 'effect';
import { expect } from 'vitest';

export class AssertionError extends Error {
  readonly _tag = 'AssertionError';
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

export interface EffectAssertions {
  assertSucceeds: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, AssertionError, R>;
  assertFails: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<E, AssertionError, R>;
  assertData: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    expected: A
  ) => Effect.Effect<void, AssertionError, R>;
  assertError: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    errorPredicate: (e: E) => boolean
  ) => Effect.Effect<void, AssertionError, R>;
  assertExtractedData: <R>(
    data: any,
    validations: Array<{
      field: string;
      check: (value: any) => boolean;
      message?: string;
    }>
  ) => Effect.Effect<void, AssertionError, R>;
  assertStatusCode: (
    actual: number,
    expected: number
  ) => Effect.Effect<void, AssertionError, never>;
  assertContains: (
    text: string,
    substring: string
  ) => Effect.Effect<void, AssertionError, never>;
  assertElementExists: (
    html: string,
    selector: string
  ) => Effect.Effect<void, AssertionError, never>;
  assertMultipleElements: (
    html: string,
    selector: string,
    minCount: number
  ) => Effect.Effect<void, AssertionError, never>;
}

export const EffectAssertions = {
  make: (): EffectAssertions => ({
    assertSucceeds: <A, E, R>(
      effect: Effect.Effect<A, E, R>
    ): Effect.Effect<A, AssertionError, R> =>
      pipe(
        effect,
        Effect.mapError(() => new AssertionError('Effect did not succeed')),
        Effect.tap((value) =>
          Effect.sync(() => {
            expect(value).toBeDefined();
          })
        )
      ),

    assertFails: <A, E, R>(
      effect: Effect.Effect<A, E, R>
    ): Effect.Effect<E, AssertionError, R> =>
      pipe(
        effect,
        Effect.flip,
        Effect.mapError(() => new AssertionError('Effect did not fail')),
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(error).toBeDefined();
          })
        )
      ),

    assertData: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
      expected: A
    ): Effect.Effect<void, AssertionError, R> =>
      pipe(
        effect,
        Effect.mapError((e) => new AssertionError(`Effect failed: ${e}`)),
        Effect.tap((actual) =>
          Effect.sync(() => {
            expect(actual).toEqual(expected);
          })
        ),
        Effect.map(() => undefined)
      ),

    assertError: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
      errorPredicate: (e: E) => boolean
    ): Effect.Effect<void, AssertionError, R> =>
      pipe(
        effect,
        Effect.flip,
        Effect.mapError(
          () => new AssertionError('Effect did not fail as expected')
        ),
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(errorPredicate(error)).toBe(true);
          })
        ),
        Effect.map(() => undefined)
      ),

    assertExtractedData: <R>(
      data: any,
      validations: Array<{
        field: string;
        check: (value: any) => boolean;
        message?: string;
      }>
    ): Effect.Effect<void, AssertionError, R> =>
      Effect.gen(function* () {
        for (const validation of validations) {
          const value = data?.[validation.field];
          if (!validation.check(value)) {
            const message =
              validation.message ||
              `Validation failed for field '${validation.field}': got ${JSON.stringify(value)}`;
            return yield* Effect.fail(new AssertionError(message));
          }
        }
      }),

    assertStatusCode: (
      actual: number,
      expected: number
    ): Effect.Effect<void, AssertionError, never> =>
      Effect.sync(() => {
        if (actual !== expected) {
          throw new AssertionError(
            `Expected status code ${expected}, got ${actual}`
          );
        }
      }),

    assertContains: (
      text: string,
      substring: string
    ): Effect.Effect<void, AssertionError, never> =>
      Effect.sync(() => {
        if (!text.includes(substring)) {
          throw new AssertionError(`Text does not contain '${substring}'`);
        }
      }),

    assertElementExists: (
      html: string,
      selector: string
    ): Effect.Effect<void, AssertionError, never> =>
      Effect.sync(() => {
        const cheerio = require('cheerio');
        const $ = cheerio.load(html);
        const elements = $(selector);
        if (elements.length === 0) {
          throw new AssertionError(
            `No elements found for selector '${selector}'`
          );
        }
      }),

    assertMultipleElements: (
      html: string,
      selector: string,
      minCount: number
    ): Effect.Effect<void, AssertionError, never> =>
      Effect.sync(() => {
        const cheerio = require('cheerio');
        const $ = cheerio.load(html);
        const elements = $(selector);
        if (elements.length < minCount) {
          throw new AssertionError(
            `Expected at least ${minCount} elements for selector '${selector}', found ${elements.length}`
          );
        }
      }),
  }),
};
