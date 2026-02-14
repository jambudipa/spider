import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import * as jsoncPlugin from 'eslint-plugin-jsonc';
import jsoncParser from 'jsonc-eslint-parser';
import vitestPlugin from '@vitest/eslint-plugin';

// Import custom rules from code-style/eslint-rules
import { effectRulesPlugin } from './code-style/eslint-rules/index.mjs';
import { customRulesPlugin } from './code-style/eslint-rules/index.mjs';
import { jsonRulesPlugin } from './code-style/eslint-rules/index.mjs';

// ============================================
// SHARED CONSTANTS - Reduce duplication
// ============================================

/**
 * Shared Effect package exclusion pattern for no-restricted-imports.
 * This allows official @effect/* packages while blocking deprecated ones.
 */
const EFFECT_PACKAGES_PATTERN = {
  group: [
    '@effect/*',
    '!@effect/ai',
    '!@effect/ai-openai',
    '!@effect/cli',
    '!@effect/cluster',
    '!@effect/experimental',
    '!@effect/opentelemetry',
    '!@effect/platform',
    '!@effect/platform-node',
    '!@effect/platform-bun',
    '!@effect/platform-browser',
    '!@effect/printer',
    '!@effect/printer-ansi',
    '!@effect/rpc',
    '!@effect/sql',
    '!@effect/sql-kysely',
    '!@effect/sql-pg',
    '!@effect/sql-d1',
    '!@effect/sql-drizzle',
    '!@effect/typeclass',
    '!@effect/workflow',
  ],
  message:
    'Import from "effect" package instead of deprecated "@effect/*" subpackages (e.g., use \'import { Schema } from "effect"\' instead of \'import { Schema } from "@effect/schema"\').',
};

/**
 * Full Effect rule exemptions for non-production code (tests, scripts, etc.).
 * Spread this object in override blocks that need all Effect rules disabled.
 */
const EFFECT_RULE_EXEMPTIONS = {
  'effect/no-async-await-use-effect': 'off',
  'effect/no-promise-constructor': 'off',
  'effect/no-promise-resolve-reject': 'off',
  'effect/no-promise-then-catch': 'off',
  'effect/no-try-catch-use-effect': 'off',
  'effect/no-throw-use-effect': 'off',
  'effect/no-error-constructor': 'off',
  'effect/no-null-use-option': 'off',
  'effect/no-undefined-use-option': 'off',
  'effect/no-json-parse-use-schema': 'off',
  'effect/no-json-stringify-use-schema': 'off',
  'effect/no-array-mutation-use-chunk': 'off',
  'effect/no-set-use-hashset': 'off',
  'effect/no-map-use-hashmap': 'off',
  'effect/no-math-random-use-random': 'off',
  'effect/no-process-env-use-config': 'off',
  'effect/no-console-use-effect': 'off',
  'effect/no-new-date-use-datetime': 'off',
  'effect/no-date-static-use-datetime': 'off',
  'effect/no-set-timeout-use-schedule': 'off',
  'effect/no-manual-tag': 'off',
  // New rules - Schema libraries and Effect boundaries
  'effect/no-zod-use-schema': 'off',
  'effect/no-yup-use-schema': 'off',
  'effect/no-effect-runsync-unguarded': 'off',
  'effect/prefer-layer-construction': 'off',
};

/**
 * Type-aware rule exemptions for files where typed linting should be relaxed.
 * Used for test files, scripts, and integration code.
 */
const TYPE_AWARE_EXEMPTIONS = {
  '@typescript-eslint/await-thenable': 'off',
  '@typescript-eslint/no-floating-promises': 'off',
  '@typescript-eslint/require-await': 'off',
  '@typescript-eslint/no-misused-promises': 'off',
  '@typescript-eslint/no-unsafe-call': 'off',
  '@typescript-eslint/no-unsafe-member-access': 'off',
  '@typescript-eslint/no-unsafe-return': 'off',
};

// ============================================
// MAIN CONFIGURATION
// ============================================

export default [
  // Base configurations
  js.configs.recommended,

  // ============================================
  // SECTION: Global Ignores
  // ============================================
  {
    ignores: [
      '**/dist',
      '**/node_modules',
      '**/coverage',
      '**/test-output',
      '**/spider-logs',
      '**/docs',
      '**/*.d.ts',
      'eslint.config.mjs',
      'eslint.config.js',
      'eslint.config.cjs',
      // Code style resources are documentation/examples - not production code
      'code-style/**',
      // Config files not in tsconfig - build/tool configs
      '**/vite.config.ts',
      '**/vitest.config.ts',
      '**/vitest.integration.config.ts',
      '**/vitest.workspace.ts',
      // Test fixtures
      'tests/fixtures/**',
    ],
  },

  // ============================================
  // SECTION: TypeScript + Effect Idiomatic Rules
  // ============================================
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
    ],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        // Enable typed linting with project references
        // Uses closest tsconfig.json for each file
        projectService: {
          allowDefaultProject: ['examples/*.ts', 'scripts/*.ts'],
          defaultProject: 'tsconfig.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        // Browser globals (for Playwright adapter)
        document: 'readonly',
        window: 'readonly',
        HTMLElement: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        NodeFilter: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
      },
    },
    plugins: {
      import: importPlugin,
      jsonc: jsoncPlugin,
      effect: effectRulesPlugin,
      'custom-rules': customRulesPlugin,
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      // ----------------------------------------
      // Custom Rules: Project-specific enforcement
      // ----------------------------------------

      // Forbid aliasing Schema import - use Schema directly
      'custom-rules/no-unnecessary-schema-alias': 'error',
      // Forbid "as" type assertions - use type-safe alternatives
      'custom-rules/no-type-assertion': 'error',

      // ----------------------------------------
      // Effect Idiomatic Patterns
      // See: docs/technical/effect-idiomatic.md
      // ----------------------------------------

      // Pattern #1: Asynchronous Computations (async/await -> Effect.gen)
      'effect/no-async-await-use-effect': 'error',
      'effect/no-promise-constructor': 'error',
      'effect/no-promise-resolve-reject': 'error',
      'effect/no-promise-then-catch': 'error',

      // Pattern #2: Optional Values (null/undefined -> Option)
      'effect/no-null-use-option': 'warn',
      'effect/no-undefined-use-option': 'warn',

      // Pattern #4: Typed Error Handling (throw -> Effect.fail)
      'effect/no-throw-use-effect': 'error',
      'effect/no-try-catch-use-effect': 'error',
      'effect/no-error-constructor': 'error',

      // Pattern #8: Date and Time (Date -> DateTime)
      'effect/no-new-date-use-datetime': 'error',
      'effect/no-date-static-use-datetime': 'error',

      // Pattern #10: Immutable Collections (Array mutations -> Chunk)
      'effect/no-array-mutation-use-chunk': 'warn',

      // Pattern #11: Sets and Maps (Set/Map -> HashSet/HashMap)
      'effect/no-set-use-hashset': 'warn',
      'effect/no-map-use-hashmap': 'warn',

      // Pattern #12: Schema-driven parsing (JSON.parse -> Schema)
      'effect/no-json-parse-use-schema': 'error',
      'effect/no-json-stringify-use-schema': 'warn',

      // Pattern #12: Data Module (_tag -> Data.TaggedError)
      'effect/no-manual-tag': 'error',

      // Pattern #15: Testability (Math.random -> Random service)
      'effect/no-math-random-use-random': 'error',

      // Pattern #17: Logging (console -> Effect.log)
      'effect/no-console-use-effect': 'error',

      // Pattern #18: Configuration (process.env -> Config)
      'effect/no-process-env-use-config': 'error',

      // Pattern #19: Scheduling (setTimeout -> Effect.sleep/Schedule)
      'effect/no-set-timeout-use-schedule': 'error',

      // Pattern #20: Schema Libraries (Zod/Yup -> Effect Schema)
      'effect/no-zod-use-schema': 'warn',
      'effect/no-yup-use-schema': 'error',

      // Pattern #21: Effect Boundary Control (runSync at boundaries only)
      'effect/no-effect-runsync-unguarded': 'warn',

      // Pattern #22: Layer Construction (prefer Layers over manual wiring)
      'effect/prefer-layer-construction': 'error',

      // ----------------------------------------
      // TypeScript Rules (Non-Type-Aware)
      // ----------------------------------------

      // Enforce single quotes instead of double quotes
      quotes: [
        'error',
        'single',
        { avoidEscape: true, allowTemplateLiterals: true },
      ],

      // Disallow explicit any types - forces proper typing
      '@typescript-eslint/no-explicit-any': 'error',

      // Forbid @ts-ignore and other TS suppression comments
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],

      // Disable base rule in favor of TypeScript-aware version
      // The base ESLint rule doesn't understand TypeScript type definitions
      'no-unused-vars': 'off',

      // Disallow unused variables (with underscore prefix exception)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // ----------------------------------------
      // Type-Aware TypeScript Rules
      // These rules require parserOptions.projectService and provide
      // deeper static analysis. Effect handles many type safety concerns,
      // so we focus on rules that complement Effect's type system.
      // ----------------------------------------

      // Warn on deprecated APIs - helps catch outdated library usage
      '@typescript-eslint/no-deprecated': 'warn',

      // Disallow awaiting non-Promise values - catches common async mistakes
      '@typescript-eslint/await-thenable': 'error',

      // Require Promises to be handled (awaited, returned, or caught)
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          ignoreVoid: true, // Allow void operator for intentionally ignored promises
          ignoreIIFE: true, // Allow IIFEs for top-level async in scripts
        },
      ],

      // Disallow async functions with no await
      '@typescript-eslint/require-await': 'error',

      // Require consistent return types in async functions
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksConditionals: true,
          checksVoidReturn: {
            arguments: false, // Allow promise callbacks
            attributes: false, // Allow promise event handlers
          },
        },
      ],

      // Prevent unnecessary type assertions
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',

      // Disallow type assertions that don't change the type
      '@typescript-eslint/no-unnecessary-type-arguments': 'warn',

      // Enforce using type parameter when calling Array#reduce
      '@typescript-eslint/prefer-reduce-type-parameter': 'warn',

      // Prefer nullish coalescing over logical OR for null/undefined checks
      '@typescript-eslint/prefer-nullish-coalescing': [
        'warn',
        {
          ignorePrimitives: { string: true, boolean: true },
        },
      ],

      // Prefer optional chain expressions over && chains
      '@typescript-eslint/prefer-optional-chain': 'warn',

      // Require switch statements to be exhaustive
      '@typescript-eslint/switch-exhaustiveness-check': [
        'warn',
        {
          requireDefaultForNonUnion: false,
          allowDefaultCaseForExhaustiveSwitch: true,
        },
      ],

      // Disallow calling functions without type safety
      '@typescript-eslint/no-unsafe-call': 'warn',

      // Disallow member access on any typed values
      '@typescript-eslint/no-unsafe-member-access': 'warn',

      // Disallow returning any from functions
      '@typescript-eslint/no-unsafe-return': 'warn',

      // ----------------------------------------
      // Import Restrictions
      // ----------------------------------------

      'no-restricted-imports': [
        'error',
        {
          patterns: [EFFECT_PACKAGES_PATTERN],
        },
      ],

      // Ensure all import declarations appear before other statements
      'import/first': 'error',

      // Keep a blank line after the import block and avoid duplicate imports
      'import/newline-after-import': ['error', { count: 1 }],
      'import/no-duplicates': 'error',

      // Disallow require() usage - prefer ES module imports
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="require"]',
          message:
            'require() is disallowed. Use ES module import declarations at the top of the file.',
        },
      ],
    },
  },

  // ============================================
  // SECTION: Vitest (Unit Tests)
  // ============================================
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx', 'tests/**/*.ts'],
    plugins: {
      vitest: vitestPlugin,
    },
    rules: {
      // Ensure tests have assertions
      'vitest/expect-expect': [
        'error',
        {
          assertFunctionNames: [
            'expect',
            'expectInvalid',
            'expectValid',
            'expectTypeOf',
          ],
        },
      ],
      // Prevent duplicate test titles
      'vitest/no-identical-title': 'error',
      // Enforce valid test titles
      'vitest/valid-title': 'error',
      // Limit describe nesting depth
      'vitest/max-nested-describe': ['warn', { max: 3 }],
      // Prefer toBe for primitive comparisons
      'vitest/prefer-to-be': 'warn',
      // Prefer toHaveLength for array/string length checks
      'vitest/prefer-to-have-length': 'warn',
      // No focused tests (fit, fdescribe)
      'vitest/no-focused-tests': 'error',
      // No disabled tests without reason
      'vitest/no-disabled-tests': 'warn',
    },
  },

  // ============================================
  // SECTION: File-Specific Overrides
  // ============================================

  // Allow process.env in config files and infrastructure code
  {
    files: [
      '**/vite.config.ts',
      '**/vitest.config.ts',
      '**/*.config.ts',
      '**/*.config.js',
      '**/*.config.mjs',
    ],
    rules: {
      'effect/no-process-env-use-config': 'off',
      'effect/no-try-catch-use-effect': 'off',
    },
  },

  // ============================================
  // SECTION: Effect Rule Exemptions
  // ============================================

  // Exempt test files from Effect idiom rules (testing infrastructure requires native JS patterns)
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx', 'tests/**/*.ts'],
    rules: {
      ...EFFECT_RULE_EXEMPTIONS,
      ...TYPE_AWARE_EXEMPTIONS,
      // Type assertions often needed in test mocks and fixtures
      'custom-rules/no-type-assertion': 'off',
    },
  },

  // Relax rules for CLI scripts (utility code with console output, process.env, etc.)
  {
    files: ['scripts/**/*.ts'],
    rules: {
      ...EFFECT_RULE_EXEMPTIONS,
      ...TYPE_AWARE_EXEMPTIONS,
      // Type assertions may be needed for CLI argument parsing
      'custom-rules/no-type-assertion': 'off',
    },
  },

  // ============================================
  // SECTION: Disable Type-Aware Linting for Unsupported Files
  // Files not included in any tsconfig.json cannot use type-aware rules.
  // ============================================
  {
    files: [
      // JavaScript config files (not in tsconfig)
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
    ],
    ...tseslint.configs.disableTypeChecked,
  },

  // ============================================
  // SECTION: JSON File Linting
  // ============================================
  {
    files: ['**/*.json', '**/*.jsonc', '**/*.json5'],
    ignores: ['**/node_modules/**', '**/package-lock.json'],
    languageOptions: {
      parser: jsoncParser,
    },
    plugins: {
      jsonc: jsoncPlugin,
      'custom-rules': jsonRulesPlugin,
    },
    rules: {
      // Enforce consistent JSON formatting
      'jsonc/indent': ['error', 2],
      'jsonc/key-spacing': 'error',
      'jsonc/no-comments': 'off', // Allow comments in JSONC files
      'jsonc/comma-dangle': ['error', 'never'],
      'jsonc/array-bracket-spacing': ['error', 'never'],
      'jsonc/object-curly-spacing': ['error', 'always'],
      'jsonc/quote-props': ['error', 'always'],
      'jsonc/quotes': ['error', 'double'],
    },
  },
];
