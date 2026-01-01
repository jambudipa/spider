/**
 * Regular Expression Utilities
 * Effect-based regex operations with proper error handling
 */

import { Effect, Data, Option, Chunk } from 'effect';

// ============================================================================
// Error Types
// ============================================================================

export class RegexCompileError extends Data.TaggedError('RegexCompileError')<{
  readonly pattern: string;
  readonly flags?: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    const flagsInfo = this.flags ? ` with flags "${this.flags}"` : '';
    return `Invalid regex pattern: "${this.pattern}"${flagsInfo}. ${this.cause}`;
  }
}

export class RegexExecutionError extends Data.TaggedError('RegexExecutionError')<{
  readonly pattern: string;
  readonly operation: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    return `Regex ${this.operation} failed for pattern "${this.pattern}": ${this.cause}`;
  }
}

// ============================================================================
// Types
// ============================================================================

export interface RegexMatch {
  readonly match: string;
  readonly index: number;
  readonly groups: Record<string, string | undefined>;
  readonly input: string;
}

export interface RegexReplacement {
  readonly original: string;
  readonly replaced: string;
  readonly matches: number;
}

// ============================================================================
// Regex Operations
// ============================================================================

export const RegexUtils = {
  /**
   * Safely compile regex pattern
   * 
   * @example
   * ```ts
   * const regex = yield* RegexUtils.compile('[a-z]+', 'gi');
   * ```
   */
  compile: (pattern: string, flags?: string) =>
    Effect.try({
      try: () => new RegExp(pattern, flags),
      catch: (cause) => new RegexCompileError({ pattern, flags, cause })
    }),

  /**
   * Test if string matches pattern
   * 
   * @example
   * ```ts
   * const matches = yield* RegexUtils.test('[0-9]+', '123abc');
   * // matches: true
   * ```
   */
  test: (pattern: string, input: string, flags?: string) =>
    Effect.gen(function* () {
      const regex = yield* RegexUtils.compile(pattern, flags);
      return regex.test(input);
    }),

  /**
   * Find all matches in string
   * 
   * @example
   * ```ts
   * const matches = yield* RegexUtils.findAll('[0-9]+', 'abc123def456');
   * // matches: [{ match: '123', index: 3, ... }, { match: '456', index: 9, ... }]
   * ```
   */
  findAll: (pattern: string, input: string, flags?: string): Effect.Effect<RegexMatch[], RegexCompileError> =>
    Effect.gen(function* () {
      // Ensure global flag is set for matchAll
      const globalFlags = flags?.includes('g') ? flags : `${flags ?? ''}g`;
      const regex = yield* RegexUtils.compile(pattern, globalFlags);

      const allMatches = input.matchAll(regex);

      const matches = Chunk.fromIterable(
        Array.from(allMatches).map((match) => ({
          match: match[0],
          index: match.index ?? 0,
          groups: match.groups ?? {},
          input: match.input ?? ''
        }))
      );

      return Chunk.toArray(matches);
    }),

  /**
   * Find first match in string
   * 
   * @example
   * ```ts
   * const match = yield* RegexUtils.findFirst('[0-9]+', 'abc123def');
   * if (Option.isSome(match)) {
   *   console.log(match.value.match); // '123'
   * }
   * ```
   */
  findFirst: (pattern: string, input: string, flags?: string) =>
    Effect.gen(function* () {
      const regex = yield* RegexUtils.compile(pattern, flags);
      const matchResult = input.match(regex);

      return Option.fromNullable(matchResult).pipe(
        Option.flatMap((m) =>
          Option.fromNullable(m.index).pipe(
            Option.map((index) => ({
              match: m[0],
              index,
              groups: m.groups ?? {},
              input: m.input ?? ''
            }))
          )
        )
      );
    }),

  /**
   * Replace matches in string
   * 
   * @example
   * ```ts
   * const result = yield* RegexUtils.replace(
   *   '[0-9]+',
   *   'abc123def456',
   *   'X'
   * );
   * // result.replaced: 'abcXdefX'
   * ```
   */
  replace: (
    pattern: string,
    input: string,
    replacement: string | ((match: string, ...args: ReadonlyArray<string | number | Record<string, string>>) => string),
    flags?: string
  ): Effect.Effect<RegexReplacement, RegexCompileError> =>
    Effect.gen(function* () {
      const regex = yield* RegexUtils.compile(pattern, flags);
      let matchCount = 0;

      const replaced = input.replace(regex, (...args: ReadonlyArray<string | number | Record<string, string>>) => {
        matchCount++;
        if (typeof replacement === 'function') {
          const [matchStr, ...rest] = args;
          return replacement(String(matchStr), ...rest);
        }
        return replacement;
      });

      return {
        original: input,
        replaced,
        matches: matchCount
      };
    }),

  /**
   * Replace all occurrences (ensures global flag)
   * 
   * @example
   * ```ts
   * const result = yield* RegexUtils.replaceAll(
   *   '[0-9]+',
   *   'abc123def456',
   *   'X'
   * );
   * // result.replaced: 'abcXdefX'
   * ```
   */
  replaceAll: (
    pattern: string,
    input: string,
    replacement: string | ((match: string, ...args: ReadonlyArray<string | number | Record<string, string>>) => string),
    flags?: string
  ) => {
    // Ensure global flag is set
    const globalFlags = flags?.includes('g') ? flags : `${flags ?? ''}g`;
    return RegexUtils.replace(pattern, input, replacement, globalFlags);
  },

  /**
   * Split string by pattern
   * 
   * @example
   * ```ts
   * const parts = yield* RegexUtils.split('[,;]', 'a,b;c,d');
   * // parts: ['a', 'b', 'c', 'd']
   * ```
   */
  split: (pattern: string, input: string, flags?: string, limit?: number) =>
    Effect.gen(function* () {
      const regex = yield* RegexUtils.compile(pattern, flags);
      return input.split(regex, limit);
    }),

  /**
   * Escape special regex characters in string
   * 
   * @example
   * ```ts
   * const escaped = yield* RegexUtils.escape('hello.world*');
   * // escaped: 'hello\\.world\\*'
   * ```
   */
  escape: (str: string) =>
    Effect.succeed(str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),

  /**
   * Extract groups from pattern match
   * 
   * @example
   * ```ts
   * const groups = yield* RegexUtils.extractGroups(
   *   '(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})',
   *   '2023-12-25'
   * );
   * // groups: Some({ year: '2023', month: '12', day: '25' })
   * ```
   */
  extractGroups: (pattern: string, input: string, flags?: string) =>
    Effect.gen(function* () {
      const regex = yield* RegexUtils.compile(pattern, flags);
      const match = input.match(regex);

      return Option.fromNullable(match?.groups);
    }),

  /**
   * Check if pattern is valid
   * 
   * @example
   * ```ts
   * const valid = yield* RegexUtils.isValid('[a-z]+');
   * // valid: true
   * 
   * const invalid = yield* RegexUtils.isValid('[a-z');
   * // invalid: false
   * ```
   */
  isValid: (pattern: string, flags?: string) =>
    RegexUtils.compile(pattern, flags).pipe(
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false))
    ),

  /**
   * Create regex from glob pattern
   * 
   * @example
   * ```ts
   * const regex = yield* RegexUtils.fromGlob('*.txt');
   * const matches = regex.test('file.txt'); // true
   * ```
   */
  fromGlob: (glob: string) =>
    Effect.gen(function* () {
      // Escape special regex chars except * and ?
      let pattern = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      
      // Convert glob wildcards to regex
      pattern = pattern
        .replace(/\*/g, '.*')      // * matches any characters
        .replace(/\?/g, '.');       // ? matches single character
      
      return yield* RegexUtils.compile(`^${pattern}$`);
    }),

  /**
   * Count matches in string
   * 
   * @example
   * ```ts
   * const count = yield* RegexUtils.count('[0-9]+', 'abc123def456ghi789');
   * // count: 3
   * ```
   */
  count: (pattern: string, input: string, flags?: string) =>
    RegexUtils.findAll(pattern, input, flags).pipe(
      Effect.map(matches => matches.length)
    ),

  /**
   * Check if string starts with pattern
   * 
   * @example
   * ```ts
   * const starts = yield* RegexUtils.startsWith('[A-Z]', 'Hello');
   * // starts: true
   * ```
   */
  startsWith: (pattern: string, input: string, flags?: string) =>
    Effect.gen(function* () {
      const anchoredPattern = `^${pattern}`;
      return yield* RegexUtils.test(anchoredPattern, input, flags);
    }),

  /**
   * Check if string ends with pattern
   * 
   * @example
   * ```ts
   * const ends = yield* RegexUtils.endsWith('[0-9]+', 'abc123');
   * // ends: true
   * ```
   */
  endsWith: (pattern: string, input: string, flags?: string) =>
    Effect.gen(function* () {
      const anchoredPattern = `${pattern}$`;
      return yield* RegexUtils.test(anchoredPattern, input, flags);
    }),

  /**
   * Extract all captured groups from all matches
   * 
   * @example
   * ```ts
   * const allGroups = yield* RegexUtils.extractAllGroups(
   *   '([a-z]+)([0-9]+)',
   *   'abc123def456'
   * );
   * // allGroups: [['abc', '123'], ['def', '456']]
   * ```
   */
  extractAllGroups: (pattern: string, input: string, flags?: string) =>
    Effect.gen(function* () {
      const globalFlags = flags?.includes('g') ? flags : `${flags ?? ''}g`;
      const regex = yield* RegexUtils.compile(pattern, globalFlags);

      const matches = input.matchAll(regex);

      const allGroups = Chunk.fromIterable(
        Array.from(matches)
          .map((match) => Array.from(match).slice(1))
          .filter((groups) => groups.length > 0)
      );

      return Chunk.toArray(allGroups);
    }),

  /**
   * Create case-insensitive regex
   * 
   * @example
   * ```ts
   * const regex = yield* RegexUtils.caseInsensitive('hello');
   * const matches = regex.test('HELLO'); // true
   * ```
   */
  caseInsensitive: (pattern: string, additionalFlags?: string) => {
    const flags = additionalFlags?.includes('i') 
      ? additionalFlags 
      : `i${additionalFlags || ''}`;
    return RegexUtils.compile(pattern, flags);
  },

  /**
   * Validate email address pattern
   * 
   * @example
   * ```ts
   * const valid = yield* RegexUtils.isEmail('user@example.com');
   * // valid: true
   * ```
   */
  isEmail: (email: string) => {
    // Basic email validation pattern
    const pattern = '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$';
    return RegexUtils.test(pattern, email);
  },

  /**
   * Validate URL pattern
   * 
   * @example
   * ```ts
   * const valid = yield* RegexUtils.isUrl('https://example.com');
   * // valid: true
   * ```
   */
  isUrl: (url: string) => {
    // Basic URL validation pattern
    const pattern = '^https?://[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}';
    return RegexUtils.test(pattern, url);
  }
};

// ============================================================================
// Re-exports for convenience
// ============================================================================

export const {
  compile,
  test,
  findAll,
  findFirst,
  replace,
  replaceAll,
  split,
  escape,
  extractGroups,
  isValid,
  fromGlob,
  count,
  startsWith,
  endsWith,
  extractAllGroups,
  caseInsensitive,
  isEmail,
  isUrl
} = RegexUtils;