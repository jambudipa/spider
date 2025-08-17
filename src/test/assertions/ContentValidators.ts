/**
 * Content Validators
 * Utilities for validating scraped content from web pages
 */

import { Effect } from 'effect';
import * as cheerio from 'cheerio';

export interface ValidationError {
  readonly _tag: 'ValidationError';
  readonly field: string;
  readonly message: string;
  readonly actual?: any;
  readonly expected?: any;
}

export const ValidationError = {
  make: (
    field: string,
    message: string,
    actual?: any,
    expected?: any
  ): ValidationError => ({
    _tag: 'ValidationError',
    field,
    message,
    actual,
    expected,
  }),
};

/**
 * HTML content validation
 */
export interface HTMLValidation {
  readonly selector: string;
  readonly count?: number;
  readonly minCount?: number;
  readonly maxCount?: number;
  readonly hasText?: string | RegExp;
  readonly hasAttribute?: { name: string; value?: string | RegExp };
  readonly children?: HTMLValidation[];
}

/**
 * Validate HTML content against a schema
 */
export const validateHTML = (
  html: string,
  validations: HTMLValidation[]
): Effect.Effect<void, ValidationError, never> =>
  Effect.gen(function* () {
    const $ = cheerio.load(html);

    for (const validation of validations) {
      const elements = $(validation.selector);

      // Validate element count
      if (validation.count !== undefined) {
        if (elements.length !== validation.count) {
          return yield* Effect.fail(
            ValidationError.make(
              validation.selector,
              `Expected ${validation.count} elements, found ${elements.length}`,
              elements.length,
              validation.count
            )
          );
        }
      }

      if (validation.minCount !== undefined) {
        if (elements.length < validation.minCount) {
          return yield* Effect.fail(
            ValidationError.make(
              validation.selector,
              `Expected at least ${validation.minCount} elements, found ${elements.length}`,
              elements.length,
              validation.minCount
            )
          );
        }
      }

      if (validation.maxCount !== undefined) {
        if (elements.length > validation.maxCount) {
          return yield* Effect.fail(
            ValidationError.make(
              validation.selector,
              `Expected at most ${validation.maxCount} elements, found ${elements.length}`,
              elements.length,
              validation.maxCount
            )
          );
        }
      }

      // Validate text content
      if (validation.hasText !== undefined) {
        const text = elements.text().trim();
        const pattern = validation.hasText;

        if (typeof pattern === 'string') {
          if (!text.includes(pattern)) {
            return yield* Effect.fail(
              ValidationError.make(
                validation.selector,
                `Text does not contain expected string`,
                text,
                pattern
              )
            );
          }
        } else if (pattern instanceof RegExp) {
          if (!pattern.test(text)) {
            return yield* Effect.fail(
              ValidationError.make(
                validation.selector,
                `Text does not match pattern`,
                text,
                pattern.toString()
              )
            );
          }
        }
      }

      // Validate attributes
      if (validation.hasAttribute) {
        const { name, value } = validation.hasAttribute;
        elements.each((_, el) => {
          const $el = $(el);
          const attrValue = $el.attr(name);

          if (attrValue === undefined) {
            throw ValidationError.make(
              validation.selector,
              `Element missing attribute: ${name}`,
              'undefined',
              name
            );
          }

          if (value !== undefined) {
            if (typeof value === 'string') {
              if (attrValue !== value) {
                throw ValidationError.make(
                  validation.selector,
                  `Attribute ${name} has unexpected value`,
                  attrValue,
                  value
                );
              }
            } else if (value instanceof RegExp) {
              if (!value.test(attrValue)) {
                throw ValidationError.make(
                  validation.selector,
                  `Attribute ${name} does not match pattern`,
                  attrValue,
                  value.toString()
                );
              }
            }
          }
        });
      }

      // Validate nested elements
      if (validation.children) {
        for (const childValidation of validation.children) {
          const childHtml = elements.html() || '';
          yield* validateHTML(childHtml, [childValidation]);
        }
      }
    }
  });

/**
 * JSON data validation
 */
export interface JSONSchema {
  readonly type?: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  readonly properties?: Record<string, JSONSchema>;
  readonly required?: string[];
  readonly items?: JSONSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly pattern?: RegExp;
}

/**
 * Validate JSON data against a schema
 */
export const validateJSON = (
  data: unknown,
  schema: JSONSchema,
  path: string = '$'
): Effect.Effect<void, ValidationError, never> =>
  Effect.gen(function* () {
    // Type validation
    if (schema.type !== undefined) {
      const actualType = Array.isArray(data) ? 'array' : typeof data;
      if (actualType !== schema.type) {
        return yield* Effect.fail(
          ValidationError.make(
            path,
            `Expected type ${schema.type}, got ${actualType}`,
            actualType,
            schema.type
          )
        );
      }
    }

    // Object validation
    if (schema.properties && typeof data === 'object' && data !== null) {
      const obj = data as Record<string, any>;

      // Check required properties
      if (schema.required) {
        for (const prop of schema.required) {
          if (!(prop in obj)) {
            return yield* Effect.fail(
              ValidationError.make(
                `${path}.${prop}`,
                `Required property missing`,
                'undefined',
                'defined'
              )
            );
          }
        }
      }

      // Validate each property
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        if (prop in obj) {
          yield* validateJSON(obj[prop], propSchema, `${path}.${prop}`);
        }
      }
    }

    // Array validation
    if (schema.items && Array.isArray(data)) {
      if (schema.minItems !== undefined && data.length < schema.minItems) {
        return yield* Effect.fail(
          ValidationError.make(
            path,
            `Array has too few items`,
            data.length,
            schema.minItems
          )
        );
      }

      if (schema.maxItems !== undefined && data.length > schema.maxItems) {
        return yield* Effect.fail(
          ValidationError.make(
            path,
            `Array has too many items`,
            data.length,
            schema.maxItems
          )
        );
      }

      // Validate each item
      for (let i = 0; i < data.length; i++) {
        yield* validateJSON(data[i], schema.items, `${path}[${i}]`);
      }
    }

    // String validation
    if (typeof data === 'string') {
      if (schema.minLength !== undefined && data.length < schema.minLength) {
        return yield* Effect.fail(
          ValidationError.make(
            path,
            `String too short`,
            data.length,
            schema.minLength
          )
        );
      }

      if (schema.maxLength !== undefined && data.length > schema.maxLength) {
        return yield* Effect.fail(
          ValidationError.make(
            path,
            `String too long`,
            data.length,
            schema.maxLength
          )
        );
      }

      if (schema.pattern && !schema.pattern.test(data)) {
        return yield* Effect.fail(
          ValidationError.make(
            path,
            `String does not match pattern`,
            data,
            schema.pattern.toString()
          )
        );
      }
    }

    // Number validation
    if (typeof data === 'number') {
      if (schema.minimum !== undefined && data < schema.minimum) {
        return yield* Effect.fail(
          ValidationError.make(
            path,
            `Number below minimum`,
            data,
            schema.minimum
          )
        );
      }

      if (schema.maximum !== undefined && data > schema.maximum) {
        return yield* Effect.fail(
          ValidationError.make(
            path,
            `Number above maximum`,
            data,
            schema.maximum
          )
        );
      }
    }
  });

/**
 * Validate extracted data structure
 */
export interface ExtractedDataValidation {
  readonly fields: Record<
    string,
    {
      readonly required?: boolean;
      readonly type?: string;
      readonly pattern?: RegExp;
      readonly minLength?: number;
      readonly maxLength?: number;
    }
  >;
}

/**
 * Validate extracted data from web scraping
 */
export const validateExtractedData = (
  data: Record<string, any>,
  validation: ExtractedDataValidation
): Effect.Effect<void, ValidationError, never> =>
  Effect.gen(function* () {
    for (const [field, rules] of Object.entries(validation.fields)) {
      const value = data[field];

      // Check required fields
      if (
        rules.required &&
        (value === undefined || value === null || value === '')
      ) {
        return yield* Effect.fail(
          ValidationError.make(
            field,
            `Required field is missing or empty`,
            value,
            'non-empty value'
          )
        );
      }

      // Skip validation for optional empty fields
      if (!value) continue;

      // Type validation
      if (rules.type) {
        const actualType = typeof value;
        if (actualType !== rules.type) {
          return yield* Effect.fail(
            ValidationError.make(
              field,
              `Field has wrong type`,
              actualType,
              rules.type
            )
          );
        }
      }

      // String validations
      if (typeof value === 'string') {
        if (rules.minLength && value.length < rules.minLength) {
          return yield* Effect.fail(
            ValidationError.make(
              field,
              `Field too short`,
              value.length,
              rules.minLength
            )
          );
        }

        if (rules.maxLength && value.length > rules.maxLength) {
          return yield* Effect.fail(
            ValidationError.make(
              field,
              `Field too long`,
              value.length,
              rules.maxLength
            )
          );
        }

        if (rules.pattern && !rules.pattern.test(value)) {
          return yield* Effect.fail(
            ValidationError.make(
              field,
              `Field does not match pattern`,
              value,
              rules.pattern.toString()
            )
          );
        }
      }
    }
  });

/**
 * Create a custom content validator
 */
export const createValidator =
  <T>(
    name: string,
    validate: (data: T) => boolean | { valid: boolean; error?: string }
  ) =>
  (data: T): Effect.Effect<void, ValidationError, never> =>
    Effect.suspend(() => {
      const result = validate(data);
      const isValid = typeof result === 'boolean' ? result : result.valid;

      if (!isValid) {
        const error =
          typeof result === 'object'
            ? result.error
            : `Validation '${name}' failed`;
        return Effect.fail(
          ValidationError.make(name, error || 'Validation failed', data)
        );
      }

      return Effect.void;
    });
