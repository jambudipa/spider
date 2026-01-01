/**
 * Schema Utilities
 * Effect-based schema encoding and decoding with proper error handling
 */

import { Effect, Data, Schema, Option } from 'effect';
import { JsonUtils } from './JsonUtils.js';

// ============================================================================
// Error Types
// ============================================================================

export class SchemaEncodeError extends Data.TaggedError('SchemaEncodeError')<{
  readonly schema: string;
  readonly value: unknown;
  readonly cause?: unknown;
}> {
  get message(): string {
    const valueType = typeof this.value === 'object' 
      ? this.value?.constructor?.name || 'Object'
      : typeof this.value;
    return `Failed to encode value of type ${valueType} with schema "${this.schema}": ${this.cause}`;
  }
}

export class SchemaDecodeError extends Data.TaggedError('SchemaDecodeError')<{
  readonly schema: string;
  readonly input: unknown;
  readonly cause?: unknown;
}> {
  get message(): string {
    const inputType = typeof this.input === 'object'
      ? this.input?.constructor?.name || 'Object'
      : typeof this.input;
    return `Failed to decode ${inputType} with schema "${this.schema}": ${this.cause}`;
  }
}

export class SchemaValidationError extends Data.TaggedError('SchemaValidationError')<{
  readonly schema: string;
  readonly value: unknown;
  readonly errors: ReadonlyArray<unknown>;
}> {
  get message(): string {
    const errorMessages = this.errors
      .map(e => `  - ${String(e)}`)
      .join('\n');
    return `Schema validation failed for "${this.schema}":\n${errorMessages}`;
  }
}

// ============================================================================
// Schema Operations
// ============================================================================

export const SchemaUtils = {
  /**
   * Safely encode value with schema
   * 
   * @example
   * ```ts
   * const UserSchema = Schema.Struct({
   *   name: Schema.String,
   *   age: Schema.Number
   * });
   * 
   * const encoded = yield* SchemaUtils.encode(
   *   UserSchema,
   *   { name: "Alice", age: 30 }
   * );
   * ```
   */
  encode: <A, I>(schema: Schema.Schema<A, I>, value: A) =>
    Effect.try({
      try: () => Schema.encodeSync(schema)(value),
      catch: (cause: unknown) => new SchemaEncodeError({
        schema: getSchemaName(schema),
        value,
        cause
      })
    }),

  /**
   * Safely decode input with schema
   * 
   * @example
   * ```ts
   * const decoded = yield* SchemaUtils.decode(
   *   UserSchema,
   *   { name: "Alice", age: "30" } // age will be coerced to number
   * );
   * ```
   */
  decode: <A, I>(schema: Schema.Schema<A, I>, input: I) =>
    Effect.try({
      try: () => Schema.decodeSync(schema)(input),
      catch: (cause: unknown) => new SchemaDecodeError({
        schema: getSchemaName(schema),
        input,
        cause
      })
    }),

  /**
   * Decode unknown input with schema
   * 
   * @example
   * ```ts
   * const decoded = yield* SchemaUtils.decodeUnknown(
   *   UserSchema,
   *   unknownData
   * );
   * ```
   */
  decodeUnknown: <A, I>(schema: Schema.Schema<A, I>, input: unknown) =>
    Effect.try({
      try: () => Schema.decodeUnknownSync(schema)(input),
      catch: (cause: unknown) => {
        const schemaName = getSchemaName(schema);
        return new SchemaDecodeError({
          schema: schemaName,
          input,
          cause
        });
      }
    }),

  /**
   * Encode value to JSON string
   * 
   * @example
   * ```ts
   * const json = yield* SchemaUtils.encodeToJson(
   *   UserSchema,
   *   { name: "Alice", age: 30 }
   * );
   * // json: '{"name":"Alice","age":30}'
   * ```
   */
  encodeToJson: <A, I>(schema: Schema.Schema<A, I>, value: A, space?: number) =>
    Effect.gen(function* () {
      const encoded = yield* SchemaUtils.encode(schema, value);
      return yield* JsonUtils.stringify(encoded, space);
    }),

  /**
   * Decode value from JSON string
   * 
   * @example
   * ```ts
   * const user = yield* SchemaUtils.decodeFromJson(
   *   UserSchema,
   *   '{"name":"Alice","age":30}'
   * );
   * ```
   */
  decodeFromJson: <A, I>(schema: Schema.Schema<A, I>, json: string) =>
    Effect.gen(function* () {
      const parsed = yield* JsonUtils.parseUnknown(json);
      return yield* SchemaUtils.decodeUnknown(schema, parsed);
    }),

  /**
   * Validate value against schema (returns boolean)
   * 
   * @example
   * ```ts
   * const isValid = yield* SchemaUtils.validate(
   *   UserSchema,
   *   { name: "Alice", age: 30 }
   * );
   * // isValid: true
   * ```
   */
  validate: <A, I>(schema: Schema.Schema<A, I>, value: unknown) =>
    SchemaUtils.decodeUnknown(schema, value).pipe(
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false))
    ),

  /**
   * Validate and return validation result with errors
   * 
   * @example
   * ```ts
   * const result = yield* SchemaUtils.validateWithErrors(
   *   UserSchema,
   *   { name: "Alice" } // missing age
   * );
   * if (result.success) {
   *   // Use result.data
   * } else {
   *   // Handle result.errors
   * }
   * ```
   */
  validateWithErrors: <A, I>(schema: Schema.Schema<A, I>, value: unknown) =>
    SchemaUtils.decodeUnknown(schema, value).pipe(
      Effect.map(data => ({
        success: true as const,
        data: Option.some(data),
        errors: Option.none<ReadonlyArray<unknown>>()
      })),
      Effect.catchAll((error) => {
        return Effect.succeed({
          success: false as const,
          data: Option.none<A>(),
          errors: Option.some<ReadonlyArray<unknown>>(
            'errors' in error && Array.isArray(error.errors)
              ? error.errors
              : [error]
          )
        });
      })
    ),

  /**
   * Parse with default value on failure
   * 
   * @example
   * ```ts
   * const config = yield* SchemaUtils.parseOrDefault(
   *   ConfigSchema,
   *   unknownData,
   *   defaultConfig
   * );
   * ```
   */
  parseOrDefault: <A, I>(
    schema: Schema.Schema<A, I>,
    input: unknown,
    defaultValue: A
  ) =>
    SchemaUtils.decodeUnknown(schema, input).pipe(
      Effect.catchAll(() => Effect.succeed(defaultValue))
    ),

  /**
   * Try parse and return Option
   * 
   * @example
   * ```ts
   * const maybeUser = yield* SchemaUtils.tryParse(
   *   UserSchema,
   *   userData
   * );
   * if (Option.isSome(maybeUser)) {
   *   // Use maybeUser.value
   * }
   * ```
   */
  tryParse: <A, I>(schema: Schema.Schema<A, I>, input: unknown) =>
    SchemaUtils.decodeUnknown(schema, input).pipe(
      Effect.map(Option.some),
      Effect.catchAll(() => Effect.succeed(Option.none()))
    ),

  /**
   * Transform value through encode then decode
   * Useful for data migration/transformation
   * 
   * @example
   * ```ts
   * const transformed = yield* SchemaUtils.transform(
   *   OldSchema,
   *   NewSchema,
   *   oldData
   * );
   * ```
   */
  transform: <A, I, B, J>(
    fromSchema: Schema.Schema<A, I>,
    toSchema: Schema.Schema<B, J>,
    value: A
  ) =>
    Effect.gen(function* () {
      const encoded = yield* SchemaUtils.encode(fromSchema, value);
      return yield* SchemaUtils.decodeUnknown(toSchema, encoded);
    }),

  /**
   * Merge two Struct schemas (creates a new schema with combined properties)
   *
   * @example
   * ```ts
   * const BaseSchema = Schema.Struct({ id: Schema.String });
   * const ExtSchema = Schema.Struct({ name: Schema.String });
   * const MergedSchema = SchemaUtils.merge(BaseSchema, ExtSchema);
   * // Results in schema with both id and name
   * ```
   */
  merge: <
    F1 extends Schema.Struct.Fields,
    F2 extends Schema.Struct.Fields
  >(
    schema1: Schema.Struct<F1>,
    schema2: Schema.Struct<F2>
  ): Schema.Struct<F1 & F2> => {
    // Merge the fields from both structs
    const mergedFields = { ...schema1.fields, ...schema2.fields };
    return Schema.Struct(mergedFields);
  },

  /**
   * Create optional version of schema
   * 
   * @example
   * ```ts
   * const OptionalUser = SchemaUtils.optional(UserSchema);
   * const user = yield* SchemaUtils.decode(OptionalUser, undefined);
   * // user: User | undefined
   * ```
   */
  optional: <A, I>(schema: Schema.Schema<A, I>) =>
    Schema.optional(schema),

  /**
   * Create nullable version of schema
   * 
   * @example
   * ```ts
   * const NullableUser = SchemaUtils.nullable(UserSchema);
   * const user = yield* SchemaUtils.decode(NullableUser, null);
   * // user: User | null
   * ```
   */
  nullable: <A, I>(schema: Schema.Schema<A, I>) =>
    Schema.NullOr(schema),

  /**
   * Create array schema
   * 
   * @example
   * ```ts
   * const UsersSchema = SchemaUtils.array(UserSchema);
   * const users = yield* SchemaUtils.decode(UsersSchema, [userData1, userData2]);
   * ```
   */
  array: <A, I>(schema: Schema.Schema<A, I>) =>
    Schema.Array(schema),

  /**
   * Create record schema
   *
   * @example
   * ```ts
   * const UserMapSchema = SchemaUtils.record(Schema.String, UserSchema);
   * const userMap = yield* SchemaUtils.decode(UserMapSchema, {
   *   alice: aliceData,
   *   bob: bobData
   * });
   * ```
   */
  record: <
    KA extends string | symbol,
    KI,
    VA,
    VI
  >(
    key: Schema.Schema<KA, KI>,
    value: Schema.Schema<VA, VI>
  ) =>
    Schema.Record({ key, value })
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if value is a non-null object
 */
function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== Object.create(Object.prototype) && Boolean(value);
}

/**
 * Safely get a string property from an unknown object
 */
function getStringProperty(obj: unknown, key: string): Option.Option<string> {
  if (!isNonNullObject(obj)) {
    return Option.none();
  }
  // Use Object.prototype.hasOwnProperty for safe property access
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    return Option.none();
  }
  const value: unknown = Reflect.get(obj, key);
  if (typeof value === 'string') {
    return Option.some(value);
  }
  return Option.none();
}

/**
 * Safely get a string value from annotations using a symbol key
 */
function getAnnotationString(annotations: unknown, symbolKey: symbol): Option.Option<string> {
  if (!isNonNullObject(annotations)) {
    return Option.none();
  }
  const value: unknown = Reflect.get(annotations, symbolKey);
  if (typeof value === 'string') {
    return Option.some(value);
  }
  return Option.none();
}

/**
 * Get schema name for error messages
 */
function getSchemaName<A, I>(schema: Schema.Schema<A, I>): string {
  // Try to get the name from the AST (schema.ast is always present)
  const ast: unknown = schema.ast;

  // Try to get the _tag property first
  const tagResult = getStringProperty(ast, '_tag');
  if (Option.isSome(tagResult)) {
    return tagResult.value;
  }

  // Check for annotations which may contain identifier
  if (isNonNullObject(ast) && 'annotations' in ast) {
    const annotations: unknown = Reflect.get(ast, 'annotations');
    const identifierSymbol = Symbol.for('effect/Schema/annotation/Identifier');
    const identifierResult = getAnnotationString(annotations, identifierSymbol);
    if (Option.isSome(identifierResult)) {
      return identifierResult.value;
    }
  }

  // Fallback to a generic name
  return 'Schema';
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export const {
  encode,
  decode,
  decodeUnknown,
  encodeToJson,
  decodeFromJson,
  validate,
  validateWithErrors,
  parseOrDefault,
  tryParse,
  transform,
  merge,
  optional,
  nullable,
  array,
  record
} = SchemaUtils;