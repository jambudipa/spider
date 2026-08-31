import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import * as jsoncPlugin from 'eslint-plugin-jsonc';
import jsoncParser from 'jsonc-eslint-parser';
import vitestPlugin from '@vitest/eslint-plugin';

import {
  effectLintConfig,
  enableAllEffectRules,
} from './code-style/eslint-rules/effect-eslint-config.mjs';
import { customRulesPlugin } from './code-style/eslint-rules/custom-rules.mjs';
import { jsonRulesPlugin } from './code-style/eslint-rules/json-rules.mjs';

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
const EFFECT_RULE_EXEMPTIONS = Object.fromEntries(
  Object.keys(enableAllEffectRules()).map((rule) => [rule, 'off'])
);

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
      // Git ignores local tool sidecars. A clean checkout cannot lint them.
      'tools/**',
      '**/*.d.ts',
      'eslint.config.mjs',
      'eslint.config.js',
      'eslint.config.cjs',
      // Code style resources are documentation/examples - not production code
      'code-style/**',
      // BMad framework directories — workflow artifacts, not project source.
      '_bmad/**',
      '_bmad-output/**',
      // Tool sidecar directories — not project source.
      '.ai/**',
      '.serena/**',
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
    files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts'],
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

  // Canonical Effect v4 idioms. Keep this after the TypeScript baseline so
  // test overrides can disable it as a complete, versioned bundle.
  effectLintConfig(['src/**/*.ts']),

  // ============================================
  // SECTION: Vitest (Unit Tests)
  // ============================================
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      'tests/**/*.ts',
    ],
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

  // Exempt test and example files from Effect idiom rules. These files exercise
  // public boundaries and browser APIs that do not use production service wiring.
  {
    files: [
      'src/test/**/*.ts',
      'src/examples/**/*.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      'tests/**/*.ts',
    ],
    rules: {
      ...EFFECT_RULE_EXEMPTIONS,
      ...TYPE_AWARE_EXEMPTIONS,
      // Type assertions often needed in test mocks and fixtures
      'custom-rules/no-type-assertion': 'off',
    },
  },

  // These adapters retain Node I/O, dynamic payloads, or public optional-field
  // contracts. The canonical rules remain active in other production modules.
  {
    files: [
      'src/lib/Config/SpiderConfig.service.ts',
      'src/lib/HttpAdapter/HttpAdapter.types.ts',
      'src/lib/PageData/PageData.ts',
      'src/lib/Scraper/Scraper.service.ts',
      'src/lib/Spider/Spider.service.ts',
    ],
    rules: {
      'effect/no-undefined-use-option': 'off',
    },
  },
  // The configuration factory preserves its synchronous public contract.
  // These native boundary checks reject invalid startup input before any
  // Effect runtime exists.
  {
    files: ['src/lib/Config/SpiderConfig.service.ts'],
    rules: {
      'effect/no-math-random-use-random': 'off',
      'effect/no-throw-use-effect': 'off',
      'effect/no-try-catch-use-effect': 'off',
    },
  },
  // Adapter selection is a synchronous public extension point. Its guard
  // turns a selector throw into the documented typed adapter failure.
  {
    files: ['src/lib/HttpAdapter/HttpAdapter.types.ts'],
    rules: {
      'effect/no-try-catch-use-effect': 'off',
    },
  },
  // This listener runs outside Effect in Node's fatal exception path. It
  // writes the required JSON line and restores Node's original termination.
  {
    files: ['src/lib/Spider/undiciTerminatedGuard.ts'],
    rules: {
      'effect/no-json-stringify-use-schema': 'off',
      'effect/no-throw-use-effect': 'off',
    },
  },
  // This public API exports a TypeScript type and its runtime narrowing
  // companion under one name, so consumers can import one stable symbol.
  {
    files: ['src/lib/Spider/Spider.service.ts'],
    rules: {
      'no-redeclare': 'off',
    },
  },
  {
    files: [
      'src/lib/Resumability/backends/FileStorageBackend.ts',
      'src/lib/utils/FileUtils.ts',
    ],
    rules: {
      'effect/no-fs-use-effect-fs': 'off',
    },
  },
  {
    files: [
      'src/lib/Config/SpiderConfig.service.ts',
      'src/lib/Resumability/backends/FileStorageBackend.ts',
      'src/lib/Spider/Spider.service.ts',
    ],
    rules: {
      'effect/no-string-error-in-catchall': 'off',
    },
  },
  {
    files: [
      'src/lib/HttpClient/CookieManager.ts',
      'src/lib/HttpClient/SessionStore.ts',
      'src/lib/PageData/PageData.ts',
      'src/lib/Resumability/backends/FileStorageBackend.ts',
      'src/lib/Resumability/backends/RedisStorageBackend.ts',
      'src/lib/Scheduler/SpiderScheduler.service.ts',
    ],
    rules: {
      'effect/no-schema-any-unknown': 'off',
      'effect/prefer-schema-annotations': 'off',
      'effect/prefer-schema-brand': 'off',
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
