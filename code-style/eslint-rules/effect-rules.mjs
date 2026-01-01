/**
 * Effect Idiomatic ESLint Rules
 *
 * These rules enforce Effect patterns over TypeScript primitives.
 * See: docs/technical/effect-idiomatic.md
 */

// Pattern #1: Asynchronous Computations (async/await -> Effect.gen)
export const noAsyncAwaitUseEffect = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow async/await - use Effect.gen instead for type-safe async operations',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noAsyncFunction:
        'Avoid async functions - use Effect.gen instead. Effect provides type-safe async operations with tracked error types. See: https://effect.website/docs/getting-started/the-effect-type/',
      noAwaitExpression:
        'Avoid await expressions - use yield* within Effect.gen instead. See: https://effect.website/docs/getting-started/the-effect-type/',
    },
    schema: [],
  },
  create(context) {
    return {
      FunctionDeclaration(node) {
        if (node.async) {
          context.report({
            node,
            messageId: 'noAsyncFunction',
          });
        }
      },
      FunctionExpression(node) {
        if (node.async) {
          context.report({
            node,
            messageId: 'noAsyncFunction',
          });
        }
      },
      ArrowFunctionExpression(node) {
        if (node.async) {
          context.report({
            node,
            messageId: 'noAsyncFunction',
          });
        }
      },
      AwaitExpression(node) {
        context.report({
          node,
          messageId: 'noAwaitExpression',
        });
      },
    };
  },
};

// Pattern #1: Promise constructor
export const noPromiseConstructor = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Promise constructor - use Effect for async computations',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noPromiseConstructor:
        'Avoid new Promise() - use Effect.gen, Effect.tryPromise, or Effect.promise instead. Effect provides stronger type safety with tracked error types. See: https://effect.website/docs/getting-started/the-effect-type/',
      noPromiseMethod:
        'Avoid Promise.{{method}}() - use Effect.all, Effect.race, or Effect combinators instead. See: https://effect.website/docs/getting-started/the-effect-type/',
    },
    schema: [],
  },
  create(context) {
    return {
      NewExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'Promise'
        ) {
          context.report({
            node,
            messageId: 'noPromiseConstructor',
          });
        }
      },
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'Promise' &&
          node.property.type === 'Identifier' &&
          ['all', 'race', 'allSettled', 'any'].includes(node.property.name)
        ) {
          context.report({
            node,
            messageId: 'noPromiseMethod',
            data: {
              method: node.property.name,
            },
          });
        }
      },
    };
  },
};

// Pattern #1/#4: Promise.resolve/reject
export const noPromiseResolveReject = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Promise.resolve/reject - use Effect.succeed/fail instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noPromiseResolve:
        'Avoid Promise.resolve() - use Effect.succeed() for creating successful effects. See: https://effect.website/docs/getting-started/creating-effects/',
      noPromiseReject:
        'Avoid Promise.reject() - use Effect.fail() for creating failed effects with typed errors. See: https://effect.website/docs/error-management/expected-errors/',
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'Promise' &&
          node.property.type === 'Identifier'
        ) {
          if (node.property.name === 'resolve') {
            context.report({ node, messageId: 'noPromiseResolve' });
          } else if (node.property.name === 'reject') {
            context.report({ node, messageId: 'noPromiseReject' });
          }
        }
      },
    };
  },
};

// Pattern #15: Concurrency - .then()/.catch() chains
export const noPromiseThenCatch = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow .then()/.catch() chains - use Effect composition instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noThen:
        'Avoid .then() chains on Promises - use Effect.map, Effect.flatMap, or Effect.pipe for composable async operations. See: https://effect.website/docs/getting-started/building-pipelines/',
      noCatch:
        'Avoid .catch() on Promises - use Effect.catchAll or Effect.catchTag for type-safe error handling. See: https://effect.website/docs/error-management/expected-errors/',
      noFinally:
        'Avoid .finally() on Promises - use Effect.ensuring or Effect.acquireRelease for cleanup. See: https://effect.website/docs/resource-management/scope/',
    },
    schema: [],
  },
  create(context) {
    const promiseReturningFunctions = ['fetch', 'import'];
    const promiseReturningMethods = ['json', 'text', 'blob', 'arrayBuffer', 'formData'];

    function isLikelyPromise(node) {
      if (node.type === 'CallExpression') {
        if (node.callee.type === 'Identifier' &&
            promiseReturningFunctions.includes(node.callee.name)) {
          return true;
        }
        if (node.callee.type === 'MemberExpression' &&
            node.callee.property.type === 'Identifier' &&
            promiseReturningMethods.includes(node.callee.property.name)) {
          return true;
        }
        if (node.callee.type === 'MemberExpression' &&
            node.callee.property.type === 'Identifier' &&
            ['then', 'catch', 'finally'].includes(node.callee.property.name)) {
          return true;
        }
      }
      if (node.type === 'NewExpression' &&
          node.callee.type === 'Identifier' &&
          node.callee.name === 'Promise') {
        return true;
      }
      if (node.type === 'CallExpression' &&
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Promise') {
        return true;
      }
      return false;
    }

    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier'
        ) {
          const methodName = node.callee.property.name;
          const objectNode = node.callee.object;

          if (['then', 'catch', 'finally'].includes(methodName) && isLikelyPromise(objectNode)) {
            if (methodName === 'then') {
              context.report({ node, messageId: 'noThen' });
            } else if (methodName === 'catch') {
              context.report({ node, messageId: 'noCatch' });
            } else if (methodName === 'finally') {
              context.report({ node, messageId: 'noFinally' });
            }
          }
        }
      },
    };
  },
};

// Pattern #2: Optional Values (null -> Option)
export const noNullUseOption = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Discourage null literals for optional values - prefer Option',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      noNull:
        'Consider using Option instead of null for optional values. Option provides type-safe handling of absence. See: https://effect.website/docs/data-types/option/',
    },
    schema: [],
  },
  create(context) {
    return {
      Literal(node) {
        if (node.value === null && node.raw === 'null') {
          context.report({
            node,
            messageId: 'noNull',
          });
        }
      },
    };
  },
};

// Pattern #2: Optional Values (undefined -> Option)
export const noUndefinedUseOption = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Discourage undefined for optional values - prefer Option',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      noUndefined:
        'Consider using Option instead of undefined for optional values. Option provides type-safe handling of absence. See: https://effect.website/docs/data-types/option/',
    },
    schema: [],
  },
  create(context) {
    return {
      Identifier(node) {
        if (node.name === 'undefined' && node.parent.type !== 'TSTypeReference') {
          if (node.parent.type === 'BinaryExpression' &&
              node.parent.operator === '===' &&
              node.parent.left.type === 'UnaryExpression' &&
              node.parent.left.operator === 'typeof') {
            return;
          }
          context.report({
            node,
            messageId: 'noUndefined',
          });
        }
      },
    };
  },
};

// Pattern #4: Typed Error Handling (throw -> Effect.fail)
export const noThrowUseEffect = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow throw statements - use Effect.fail instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noThrow:
        'Avoid throw statements - use Effect.fail for expected errors or Effect.die for defects. Typed errors in Effect are tracked in the type system. See: https://effect.website/docs/error-management/two-error-types/',
    },
    schema: [],
  },
  create(context) {
    return {
      ThrowStatement(node) {
        context.report({
          node,
          messageId: 'noThrow',
        });
      },
    };
  },
};

// Pattern #4: try/catch -> Effect error handling
export const noTryCatchUseEffect = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow try/catch - use Effect error handling instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noTryCatch:
        'Avoid try/catch - use Effect.catchAll, Effect.catchTag, or Effect.orElse instead. Effect error handling is type-safe and composable. See: https://effect.website/docs/error-management/expected-errors/',
    },
    schema: [],
  },
  create(context) {
    return {
      TryStatement(node) {
        context.report({
          node,
          messageId: 'noTryCatch',
        });
      },
    };
  },
};

// Pattern #4/#5: Error constructor -> Data.TaggedError
export const noErrorConstructorUseData = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow new Error() - use Data.TaggedError for typed errors',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noErrorConstructor:
        'Avoid new Error() - use Data.TaggedError for typed, trackable errors in Effect. See: https://effect.website/docs/error-management/expected-errors/',
    },
    schema: [],
  },
  create(context) {
    return {
      NewExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          (node.callee.name === 'Error' ||
           node.callee.name === 'TypeError' ||
           node.callee.name === 'RangeError' ||
           node.callee.name === 'SyntaxError' ||
           node.callee.name === 'ReferenceError')
        ) {
          context.report({ node, messageId: 'noErrorConstructor' });
        }
      },
    };
  },
};

// Pattern #8: Date and Time (new Date -> DateTime)
export const noNewDateUseDateTime = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow new Date() - use Effect DateTime instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noNewDate:
        'Avoid new Date() - use DateTime from Effect for immutable, type-safe date/time handling. See: https://effect.website/docs/data-types/datetime/',
    },
    schema: [],
  },
  create(context) {
    return {
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Date') {
          context.report({
            node,
            messageId: 'noNewDate',
          });
        }
      },
    };
  },
};

// Pattern #8: Date static methods -> DateTime
export const noDateStaticUseDateTime = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Date.now() and Date.parse() - use Effect DateTime instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noDateNow:
        'Avoid Date.now() - use DateTime.now from Effect for type-safe, immutable timestamps. See: https://effect.website/docs/data-types/datetime/',
      noDateParse:
        'Avoid Date.parse() - use DateTime.parse from Effect for type-safe date parsing with proper error handling. See: https://effect.website/docs/data-types/datetime/',
      noDateUTC:
        'Avoid Date.UTC() - use DateTime.make or DateTime.utc from Effect. See: https://effect.website/docs/data-types/datetime/',
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'Date' &&
          node.property.type === 'Identifier'
        ) {
          if (node.property.name === 'now') {
            context.report({ node, messageId: 'noDateNow' });
          } else if (node.property.name === 'parse') {
            context.report({ node, messageId: 'noDateParse' });
          } else if (node.property.name === 'UTC') {
            context.report({ node, messageId: 'noDateUTC' });
          }
        }
      },
    };
  },
};

// Pattern #10: Immutable Collections (Array mutations -> Chunk)
export const noArrayMutationUseChunk = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Discourage array mutations - prefer Chunk for immutable collections',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      noArrayMutation:
        'Consider using Chunk from Effect for immutable collection operations. Chunk.append, Chunk.prepend provide immutable alternatives. See: https://effect.website/docs/data-types/chunk/',
    },
    schema: [],
  },
  create(context) {
    const mutatingMethods = ['push', 'pop', 'shift', 'unshift', 'splice'];

    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          mutatingMethods.includes(node.callee.property.name)
        ) {
          const objectNode = node.callee.object;
          if (objectNode.type === 'Identifier') {
            const name = objectNode.name.toLowerCase();
            if (name.endsWith('s') || name.includes('list') ||
                name.includes('array') || name.includes('items') ||
                name.includes('results') || name.includes('data')) {
              context.report({ node, messageId: 'noArrayMutation' });
            }
          }
          if (objectNode.type === 'ArrayExpression') {
            context.report({ node, messageId: 'noArrayMutation' });
          }
        }
      },
    };
  },
};

// Pattern #11: Sets (Set -> HashSet)
export const noSetUseHashSet = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Discourage new Set() - prefer HashSet for value-based equality',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      noSet:
        'Consider using HashSet from Effect instead of Set for value-based equality. HashSet compares elements by structure, not reference. See: https://effect.website/docs/data-types/hash-set/',
    },
    schema: [],
  },
  create(context) {
    return {
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Set') {
          context.report({ node, messageId: 'noSet' });
        }
      },
    };
  },
};

// Pattern #11: Maps (Map -> HashMap)
export const noMapUseHashMap = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Discourage new Map() - prefer HashMap for value-based key equality',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      noMap:
        'Consider using HashMap from Effect instead of Map for value-based key equality. HashMap compares keys by structure, not reference. See: https://effect.website/docs/data-types/hash-map/',
    },
    schema: [],
  },
  create(context) {
    return {
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Map') {
          context.report({ node, messageId: 'noMap' });
        }
      },
    };
  },
};

// Pattern #12: Schema-driven parsing (JSON.parse -> Schema)
export const noJsonParseUseSchema = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow JSON.parse() - use Effect Schema for type-safe parsing',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noJsonParse:
        'Avoid JSON.parse() - use Schema.decodeUnknown or Schema.parseJson from Effect for type-safe JSON parsing with validation. See: https://effect.website/docs/schema/basic-usage/',
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'JSON' &&
          node.property.type === 'Identifier' &&
          node.property.name === 'parse'
        ) {
          context.report({ node, messageId: 'noJsonParse' });
        }
      },
    };
  },
};

// Pattern #12: JSON.stringify -> Schema.encode
export const noJsonStringifyUseSchema = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Discourage JSON.stringify() - prefer Effect Schema for type-safe serialization',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      noJsonStringify:
        'Consider using Schema.encode from Effect for type-safe JSON serialization with validation. See: https://effect.website/docs/schema/basic-usage/',
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'JSON' &&
          node.property.type === 'Identifier' &&
          node.property.name === 'stringify'
        ) {
          context.report({ node, messageId: 'noJsonStringify' });
        }
      },
    };
  },
};

// Pattern #12: Data Module (_tag -> Data.TaggedError)
export const noManualTag = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow manually defining _tag - use idiomatic Effect patterns instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noManualTag:
        'Avoid manually defining _tag. Use idiomatic Effect patterns: Data.TaggedError for errors, Data.TaggedClass for data types, or Schema.TaggedStruct for schemas. See: https://effect.website/docs/error-management/expected-errors/ and https://effect.website/docs/schema/basic-usage/#discriminated-unions',
    },
    schema: [],
  },
  create(context) {
    return {
      PropertyDefinition(node) {
        if (
          node.key.type === 'Identifier' &&
          node.key.name === '_tag' &&
          node.readonly
        ) {
          context.report({
            node,
            messageId: 'noManualTag',
          });
        }
      },
      Property(node) {
        if (
          node.key.type === 'Identifier' &&
          node.key.name === '_tag'
        ) {
          context.report({
            node,
            messageId: 'noManualTag',
          });
        }
      },
    };
  },
};

// Pattern #15: Testability (Math.random -> Random service)
export const noMathRandomUseRandom = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Math.random() - use Effect Random service for testability',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noMathRandom:
        'Avoid Math.random() - use the Random service from Effect for testable random number generation. See: https://effect.website/docs/guides/observability/testing/#testrandom',
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'Math' &&
          node.property.type === 'Identifier' &&
          node.property.name === 'random'
        ) {
          context.report({ node, messageId: 'noMathRandom' });
        }
      },
    };
  },
};

// Pattern #17: Logging (console -> Effect.log)
export const noConsoleUseEffect = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow console.* methods - use Effect logging instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noConsole:
        'Use Effect logging instead of console.{{method}}(). Replace with Effect.log{{effectMethod}}().',
    },
    schema: [],
  },
  create(context) {
    const methodMap = {
      log: 'Info',
      info: 'Info',
      warn: 'Warning',
      error: 'Error',
      debug: 'Debug',
    };

    return {
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'console' &&
          node.property.type === 'Identifier'
        ) {
          const method = node.property.name;
          const effectMethod = methodMap[method] || 'Info';

          context.report({
            node,
            messageId: 'noConsole',
            data: {
              method,
              effectMethod,
            },
          });
        }
      },
    };
  },
};

// Pattern #18: Configuration (process.env -> Config)
export const noProcessEnvUseConfig = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow process.env - use Effect Config instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noProcessEnv:
        'Avoid process.env - use Config from Effect for strongly-typed configuration management. See: https://effect.website/docs/configuration/',
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === 'MemberExpression' &&
          node.object.object.type === 'Identifier' &&
          node.object.object.name === 'process' &&
          node.object.property.type === 'Identifier' &&
          node.object.property.name === 'env'
        ) {
          context.report({
            node,
            messageId: 'noProcessEnv',
          });
        }
      },
    };
  },
};

// Pattern #20: Schema Libraries (Zod -> Effect Schema)
export const noZodUseSchema = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid Zod imports - use Effect Schema instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noZod:
        'Zod is not allowed in this codebase. Use Effect Schema (@effect/schema or effect/Schema) for validation. Effect Schema integrates seamlessly with Effect runtime. See: https://effect.website/docs/schema/basic-usage/',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === 'zod' || node.source.value.startsWith('zod/')) {
          context.report({
            node,
            messageId: 'noZod',
          });
        }
      },
      CallExpression(node) {
        // Also catch dynamic imports: import('zod')
        if (
          node.callee.type === 'Import' &&
          node.arguments.length > 0 &&
          node.arguments[0].type === 'Literal' &&
          (node.arguments[0].value === 'zod' || String(node.arguments[0].value).startsWith('zod/'))
        ) {
          context.report({
            node,
            messageId: 'noZod',
          });
        }
      },
    };
  },
};

// Pattern #20: Schema Libraries (Yup -> Effect Schema)
export const noYupUseSchema = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid Yup imports - use Effect Schema instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noYup:
        'Yup is not allowed in this codebase. Use Effect Schema (@effect/schema or effect/Schema) for validation. Effect Schema provides superior type inference. See: https://effect.website/docs/schema/basic-usage/',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === 'yup' || node.source.value.startsWith('yup/')) {
          context.report({
            node,
            messageId: 'noYup',
          });
        }
      },
      CallExpression(node) {
        // Also catch dynamic imports: import('yup')
        if (
          node.callee.type === 'Import' &&
          node.arguments.length > 0 &&
          node.arguments[0].type === 'Literal' &&
          (node.arguments[0].value === 'yup' || String(node.arguments[0].value).startsWith('yup/'))
        ) {
          context.report({
            node,
            messageId: 'noYup',
          });
        }
      },
    };
  },
};

// Pattern #21: Effect Boundary Control (Effect.runSync -> proper boundaries)
export const noEffectRunSyncUnguarded = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Effect.runSync should only be used at program boundaries',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noRunSync:
        'Effect.runSync should only be used at program boundaries (main entry points, CLI handlers, test setup). Consider Effect.runPromise for async contexts or proper Effect composition. See: https://effect.website/docs/getting-started/running-effects/',
      noRunSyncExit:
        'Effect.runSyncExit should only be used at program boundaries. Consider Effect.runPromiseExit or proper Effect composition. See: https://effect.website/docs/getting-started/running-effects/',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        // Match Effect.runSync() and Effect.runSyncExit()
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Effect' &&
          node.callee.property.type === 'Identifier'
        ) {
          if (node.callee.property.name === 'runSync') {
            context.report({
              node,
              messageId: 'noRunSync',
            });
          } else if (node.callee.property.name === 'runSyncExit') {
            context.report({
              node,
              messageId: 'noRunSyncExit',
            });
          }
        }
      },
    };
  },
};

// Pattern #22: Layer Construction (manual service wiring -> Layer)
export const preferLayerConstruction = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prefer Layer construction over manual service wiring',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      preferLayer:
        'Avoid manual service construction with Effect.provideService in non-test code. Use Layer.effect, Layer.succeed, or Layer.provide for composable service construction. See: https://effect.website/docs/requirements-management/layers/',
    },
    schema: [],
  },
  create(context) {
    // Track if we're in a test file
    const filename = context.getFilename();
    const isTestFile = /\.(test|spec)\.[jt]sx?$/.test(filename) ||
                       filename.includes('__tests__') ||
                       filename.includes('/test/') ||
                       filename.includes('/e2e/');

    // Skip test files - manual service provision is expected there
    if (isTestFile) {
      return {};
    }

    return {
      CallExpression(node) {
        // Match Effect.provideService() or .pipe(Effect.provideService())
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'provideService'
        ) {
          // Check if it's Effect.provideService
          if (
            node.callee.object.type === 'Identifier' &&
            node.callee.object.name === 'Effect'
          ) {
            context.report({
              node,
              messageId: 'preferLayer',
            });
          }
        }
      },
    };
  },
};

// Pattern #19: Scheduling (setTimeout -> Effect.sleep/Schedule)
export const noSetTimeoutUseSchedule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow setTimeout/setInterval - use Effect Schedule instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noSetTimeout:
        'Avoid setTimeout - use Effect.sleep or Effect.delay instead. For repeated execution, use Schedule.repeat. See: https://effect.website/docs/scheduling/introduction/',
      noSetInterval:
        'Avoid setInterval - use Schedule.repeat or Effect.repeat instead for structured recurring tasks. See: https://effect.website/docs/scheduling/introduction/',
      noClearTimeout:
        'Avoid clearTimeout - Effect handles cancellation via Fiber interruption. See: https://effect.website/docs/concurrency/fibers/',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === 'Identifier') {
          if (node.callee.name === 'setTimeout') {
            context.report({
              node,
              messageId: 'noSetTimeout',
            });
          } else if (node.callee.name === 'setInterval') {
            context.report({
              node,
              messageId: 'noSetInterval',
            });
          } else if (
            node.callee.name === 'clearTimeout' ||
            node.callee.name === 'clearInterval'
          ) {
            context.report({
              node,
              messageId: 'noClearTimeout',
            });
          }
        }
      },
    };
  },
};

/**
 * All Effect rules as a plugin object
 */
export const effectRulesPlugin = {
  rules: {
    'no-async-await-use-effect': noAsyncAwaitUseEffect,
    'no-promise-constructor': noPromiseConstructor,
    'no-promise-resolve-reject': noPromiseResolveReject,
    'no-promise-then-catch': noPromiseThenCatch,
    'no-null-use-option': noNullUseOption,
    'no-undefined-use-option': noUndefinedUseOption,
    'no-throw-use-effect': noThrowUseEffect,
    'no-try-catch-use-effect': noTryCatchUseEffect,
    'no-error-constructor': noErrorConstructorUseData,
    'no-new-date-use-datetime': noNewDateUseDateTime,
    'no-date-static-use-datetime': noDateStaticUseDateTime,
    'no-array-mutation-use-chunk': noArrayMutationUseChunk,
    'no-set-use-hashset': noSetUseHashSet,
    'no-map-use-hashmap': noMapUseHashMap,
    'no-json-parse-use-schema': noJsonParseUseSchema,
    'no-json-stringify-use-schema': noJsonStringifyUseSchema,
    'no-manual-tag': noManualTag,
    'no-math-random-use-random': noMathRandomUseRandom,
    'no-console-use-effect': noConsoleUseEffect,
    'no-process-env-use-config': noProcessEnvUseConfig,
    'no-set-timeout-use-schedule': noSetTimeoutUseSchedule,
    // New rules - Schema libraries and Effect boundaries
    'no-zod-use-schema': noZodUseSchema,
    'no-yup-use-schema': noYupUseSchema,
    'no-effect-runsync-unguarded': noEffectRunSyncUnguarded,
    'prefer-layer-construction': preferLayerConstruction,
  },
};
