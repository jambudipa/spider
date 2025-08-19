/**
 * JSON Utilities
 * Effect-based JSON parsing and stringification with proper error handling
 */

import { Effect, Data, Schema } from 'effect';

// ============================================================================
// Error Types
// ============================================================================

export type JsonError = JsonParseError | JsonStringifyError;

export class JsonParseError extends Data.TaggedError('JsonParseError')<{
  readonly input: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    const preview = this.input.length > 100 
      ? `${this.input.substring(0, 100)}...` 
      : this.input;
    return `Failed to parse JSON: ${this.cause}. Input: "${preview}"`;
  }
}

export class JsonStringifyError extends Data.TaggedError('JsonStringifyError')<{
  readonly input: unknown;
  readonly cause?: unknown;
}> {
  get message(): string {
    const typeInfo = typeof this.input === 'object' 
      ? this.input?.constructor?.name || 'Object'
      : typeof this.input;
    return `Failed to stringify value of type ${typeInfo}: ${this.cause}`;
  }
}

export class JsonSchemaValidationError extends Data.TaggedError('JsonSchemaValidationError')<{
  readonly input: unknown;
  readonly schemaName: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    return `JSON validation failed for schema "${this.schemaName}": ${this.cause}`;
  }
}

// ============================================================================
// JSON Operations
// ============================================================================

export const JsonUtils = {
  /**
   * Safely parse JSON string
   * 
   * @example
   * ```ts
   * const result = yield* JsonUtils.parse('{"name": "test"}');
   * // result: { name: "test" }
   * ```
   */
  parse: <T = unknown>(input: string) =>
    Effect.try({
      try: () => JSON.parse(input) as T,
      catch: (cause) => new JsonParseError({ input, cause })
    }),

  /**
   * Parse JSON with schema validation
   * 
   * @example
   * ```ts
   * const UserSchema = Schema.Struct({
   *   name: Schema.String,
   *   age: Schema.Number
   * });
   * 
   * const user = yield* JsonUtils.parseWithSchema(
   *   '{"name": "Alice", "age": 30}',
   *   UserSchema
   * );
   * ```
   */
  parseWithSchema: <A, I = unknown>(
    input: string,
    schema: Schema.Schema<A, I>,
    options?: { readonly strict?: boolean }
  ) =>
    Effect.gen(function* () {
      const parsed = yield* JsonUtils.parse<I>(input);
      
      return yield* Effect.try({
        try: () => {
          const parseResult = Schema.decodeUnknownSync(schema, {
            errors: 'all',
            ...options
          })(parsed);
          return parseResult;
        },
        catch: (cause) => new JsonSchemaValidationError({
          input: parsed,
          schemaName: schema.ast._tag || 'Unknown',
          cause
        })
      });
    }),

  /**
   * Safely stringify value to JSON
   * 
   * @example
   * ```ts
   * const json = yield* JsonUtils.stringify({ name: "test" });
   * // json: '{"name":"test"}'
   * 
   * const pretty = yield* JsonUtils.stringify({ name: "test" }, 2);
   * // pretty: '{\n  "name": "test"\n}'
   * ```
   */
  stringify: (
    value: unknown,
    space?: string | number,
    replacer?: (key: string, value: unknown) => unknown
  ) =>
    Effect.try({
      try: () => JSON.stringify(value, replacer as any, space),
      catch: (cause) => new JsonStringifyError({ input: value, cause })
    }),

  /**
   * Parse JSON with fallback value
   * 
   * @example
   * ```ts
   * const config = yield* JsonUtils.parseOrDefault(
   *   configStr,
   *   { debug: false }
   * );
   * ```
   */
  parseOrDefault: <T>(input: string, defaultValue: T) =>
    JsonUtils.parse<T>(input).pipe(
      Effect.catchAll(() => Effect.succeed(defaultValue))
    ),

  /**
   * Parse JSON and return null on failure
   * 
   * @example
   * ```ts
   * const data = yield* JsonUtils.parseOrNull(input);
   * if (data !== null) {
   *   // Use parsed data
   * }
   * ```
   */
  parseOrNull: <T = unknown>(input: string) =>
    JsonUtils.parse<T>(input).pipe(
      Effect.catchAll(() => Effect.succeed(null))
    ),

  /**
   * Try to parse JSON and return boolean success
   * 
   * @example
   * ```ts
   * const isValid = yield* JsonUtils.isValid('{"valid": true}');
   * // isValid: true
   * ```
   */
  isValid: (input: string) =>
    JsonUtils.parse(input).pipe(
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false))
    ),

  /**
   * Pretty print JSON with indentation
   * 
   * @example
   * ```ts
   * const pretty = yield* JsonUtils.prettyPrint({ complex: { data: true } });
   * ```
   */
  prettyPrint: (value: unknown, indent: number = 2) =>
    JsonUtils.stringify(value, indent),

  /**
   * Deep clone an object via JSON serialization
   * Note: This will lose functions, undefined values, symbols, etc.
   * 
   * @example
   * ```ts
   * const clone = yield* JsonUtils.deepClone(originalObject);
   * ```
   */
  deepClone: <T>(value: T) =>
    Effect.gen(function* () {
      const json = yield* JsonUtils.stringify(value);
      return yield* JsonUtils.parse<T>(json);
    }),

  /**
   * Merge two JSON objects
   * 
   * @example
   * ```ts
   * const merged = yield* JsonUtils.merge(
   *   { a: 1 },
   *   { b: 2 }
   * );
   * // merged: { a: 1, b: 2 }
   * ```
   */
  merge: <T extends object, U extends object>(
    target: T,
    source: U
  ): Effect.Effect<T & U, JsonStringifyError | JsonParseError> =>
    Effect.gen(function* () {
      // Deep clone to avoid mutations
      const clonedTarget = yield* JsonUtils.deepClone(target);
      const clonedSource = yield* JsonUtils.deepClone(source);
      return { ...clonedTarget, ...clonedSource } as T & U;
    }),

  /**
   * Extract a subset of JSON properties
   * 
   * @example
   * ```ts
   * const subset = yield* JsonUtils.pick(
   *   { a: 1, b: 2, c: 3 },
   *   ['a', 'c']
   * );
   * // subset: { a: 1, c: 3 }
   * ```
   */
  pick: <T extends object, K extends keyof T>(
    obj: T,
    keys: K[]
  ): Effect.Effect<Pick<T, K>, never> =>
    Effect.succeed(
      keys.reduce((acc, key) => {
        if (key in obj) {
          acc[key] = obj[key];
        }
        return acc;
      }, {} as Pick<T, K>)
    ),

  /**
   * Omit properties from JSON object
   * 
   * @example
   * ```ts
   * const result = yield* JsonUtils.omit(
   *   { a: 1, b: 2, c: 3 },
   *   ['b']
   * );
   * // result: { a: 1, c: 3 }
   * ```
   */
  omit: <T extends object, K extends keyof T>(
    obj: T,
    keys: K[]
  ): Effect.Effect<Omit<T, K>, never> =>
    Effect.succeed(
      Object.keys(obj).reduce((acc, key) => {
        if (!keys.includes(key as K)) {
          acc[key as keyof Omit<T, K>] = obj[key as keyof T] as any;
        }
        return acc;
      }, {} as Omit<T, K>)
    )
};

// ============================================================================
// Re-exports for convenience
// ============================================================================

export const {
  parse,
  parseWithSchema,
  stringify,
  parseOrDefault,
  parseOrNull,
  isValid,
  prettyPrint,
  deepClone,
  merge,
  pick,
  omit
} = JsonUtils;