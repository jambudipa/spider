/**
 * JSON Utilities
 * Effect-based JSON parsing and stringification with proper error handling
 */

import { Effect, Data, Schema, Option, pipe, Struct } from 'effect';

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
// Helper Functions
// ============================================================================

/**
 * Check if a value is a non-null object (not an array)
 * Uses Option to handle the null case idiomatically
 */
const isNonNullObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && !Array.isArray(value) && Option.isSome(Option.fromNullable(value));

/**
 * Apply a replacer function to traverse and transform an object recursively
 */
const applyReplacer = (
  value: unknown,
  replacer: (key: string, value: unknown) => unknown
): unknown => {
  const transform = (key: string, val: unknown): unknown => {
    const replaced = replacer(key, val);
    if (isNonNullObject(replaced)) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(replaced)) {
        result[k] = transform(k, v);
      }
      return result;
    }
    if (Array.isArray(replaced)) {
      return replaced.map((item, index) => transform(String(index), item));
    }
    return replaced;
  };
  return transform('', value);
};

/**
 * Format a JSON string with indentation
 * Implements proper JSON formatting without using JSON.stringify
 */
const formatJsonString = (jsonString: string, space: string | number): string => {
  const indent = typeof space === 'number' ? ' '.repeat(space) : space;
  let result = '';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonString.length; i++) {
    const char = jsonString[i];

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && inString) {
      result += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString) {
      result += char;
      continue;
    }

    switch (char) {
      case '{':
      case '[':
        result += char;
        depth++;
        if (jsonString[i + 1] !== '}' && jsonString[i + 1] !== ']') {
          result += '\n' + indent.repeat(depth);
        }
        break;
      case '}':
      case ']':
        depth--;
        if (jsonString[i - 1] !== '{' && jsonString[i - 1] !== '[') {
          result += '\n' + indent.repeat(depth);
        }
        result += char;
        break;
      case ',':
        result += char + '\n' + indent.repeat(depth);
        break;
      case ':':
        result += char + ' ';
        break;
      default:
        if (char !== ' ' && char !== '\n' && char !== '\t') {
          result += char;
        }
    }
  }

  return result;
};

// ============================================================================
// JSON Operations
// ============================================================================

export const JsonUtils = {
  /**
   * Safely parse JSON string with schema validation
   *
   * @example
   * ```ts
   * const UserSchema = Schema.Struct({ name: Schema.String });
   * const result = yield* JsonUtils.parse('{"name": "test"}', UserSchema);
   * // result: { name: "test" }
   * ```
   */
  parse: <A, I = A, R = never>(input: string, schema: Schema.Schema<A, I, R>) =>
    Schema.decodeUnknown(Schema.parseJson(schema))(input).pipe(
      Effect.mapError((cause) => new JsonParseError({ input, cause }))
    ),

  /**
   * Safely parse JSON string as unknown
   *
   * @example
   * ```ts
   * const result = yield* JsonUtils.parseUnknown('{"name": "test"}');
   * // result: unknown
   * ```
   */
  parseUnknown: (input: string) =>
    Schema.decodeUnknown(Schema.parseJson(Schema.Unknown))(input).pipe(
      Effect.mapError((cause) => new JsonParseError({ input, cause }))
    ),

  /**
   * Parse JSON with schema validation (alias for parse with additional options)
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
      const parsed = yield* JsonUtils.parseUnknown(input);

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
  ) => {
    const spaceOption = Option.fromNullable(space);
    const replacerOption = Option.fromNullable(replacer);

    return pipe(
      Schema.encode(Schema.parseJson(Schema.Unknown))(value),
      Effect.flatMap((jsonString) => {
        // Apply formatting options if specified
        if (Option.isSome(spaceOption) || Option.isSome(replacerOption)) {
          return pipe(
            Schema.decodeUnknown(Schema.parseJson(Schema.Unknown))(jsonString),
            Effect.flatMap((parsed) =>
              Schema.encode(Schema.parseJson(Schema.Unknown))(
                Option.isSome(replacerOption) ? applyReplacer(parsed, replacerOption.value) : parsed
              )
            ),
            Effect.map((result) => Option.isSome(spaceOption) ? formatJsonString(result, spaceOption.value) : result)
          );
        }
        return Effect.succeed(jsonString);
      }),
      Effect.mapError((cause) => new JsonStringifyError({ input: value, cause }))
    );
  },

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
  parseOrDefault: <T>(input: string, defaultValue: T, schema?: Schema.Schema<T>) =>
    (schema
      ? JsonUtils.parse(input, schema)
      : JsonUtils.parseUnknown(input)
    ).pipe(Effect.catchAll(() => Effect.succeed(defaultValue))),

  /**
   * Parse JSON and return Option.none() on failure
   *
   * @example
   * ```ts
   * const data = yield* JsonUtils.parseOrNone(input);
   * if (Option.isSome(data)) {
   *   // Use parsed data via data.value
   * }
   * ```
   */
  parseOrNone: <T>(input: string, schema?: Schema.Schema<T>) =>
    (schema
      ? JsonUtils.parse(input, schema)
      : JsonUtils.parseUnknown(input)
    ).pipe(
      Effect.map((value) => Option.some(value)),
      Effect.catchAll(() => Effect.succeed(Option.none()))
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
    JsonUtils.parseUnknown(input).pipe(
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
  deepClone: <T, I = unknown>(value: T, schema: Schema.Schema<T, I>) =>
    Effect.gen(function* () {
      const json = yield* JsonUtils.stringify(value);
      return yield* JsonUtils.parse(json, schema);
    }),

  /**
   * Deep clone an unknown JSON value without schema validation
   * Returns unknown type - caller must validate the result
   *
   * @example
   * ```ts
   * const clone = yield* JsonUtils.deepCloneUnknown(originalObject);
   * ```
   */
  deepCloneUnknown: (value: unknown) =>
    Effect.gen(function* () {
      const json = yield* JsonUtils.stringify(value);
      return yield* JsonUtils.parseUnknown(json);
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
  merge: <T extends Record<string, unknown>, U extends Record<string, unknown>>(
    target: T,
    source: U,
    schema: Schema.Schema<T & U>
  ): Effect.Effect<T & U, JsonStringifyError | JsonParseError | JsonSchemaValidationError> =>
    Effect.gen(function* () {
      // Deep clone to avoid mutations using JSON round-trip
      const targetJson = yield* JsonUtils.stringify(target);
      const sourceJson = yield* JsonUtils.stringify(source);
      const clonedTarget = yield* JsonUtils.parseUnknown(targetJson);
      const clonedSource = yield* JsonUtils.parseUnknown(sourceJson);
      // Both are objects at runtime after JSON round-trip
      const merged = { ...Object(clonedTarget), ...Object(clonedSource) };
      // Validate with schema
      return yield* Schema.decodeUnknown(schema)(merged).pipe(
        Effect.mapError((cause) => new JsonSchemaValidationError({
          input: merged,
          schemaName: schema.ast._tag || 'Unknown',
          cause
        }))
      );
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
  pick: <T extends Record<string, unknown>, K extends keyof T>(
    obj: T,
    keys: readonly K[]
  ) =>
    Effect.succeed(Struct.pick(obj, ...keys)),

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
  omit: <T extends Record<string, unknown>, K extends keyof T>(
    obj: T,
    keys: readonly K[]
  ) =>
    Effect.succeed(Struct.omit(obj, ...keys))
};

// ============================================================================
// Re-exports for convenience
// ============================================================================

export const {
  parse,
  parseUnknown,
  parseWithSchema,
  stringify,
  parseOrDefault,
  parseOrNone,
  isValid,
  prettyPrint,
  deepClone,
  deepCloneUnknown,
  merge,
  pick,
  omit
} = JsonUtils;