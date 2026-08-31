/**
 * Effect Idiomatic ESLint Rules
 *
 * These rules enforce Effect patterns over TypeScript primitives.
 * See: docs/technical/effect-idiomatic.md
 */

const FUNCTION_NODE_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
]);

const FUNCTION_OWNER_BARRIERS = new Set([
  'ClassDeclaration',
  'ClassExpression',
  'PropertyDefinition',
  'StaticBlock',
]);

const getSourceCode = (context) =>
  context.sourceCode ?? context.getSourceCode();

const findNearestFunctionOwner = (node) => {
  let current = node.parent;
  while (current) {
    if (FUNCTION_OWNER_BARRIERS.has(current.type)) {
      return null;
    }
    if (FUNCTION_NODE_TYPES.has(current.type)) {
      return current;
    }
    current = current.parent;
  }
  return null;
};

/**
 * True when `node` is the argument of `Effect.die(...)` or `Effect.dieSync(...)`.
 *
 * v4 removed `Effect.dieMessage`, which used to construct the Error for you, so
 * building one at the call site is now the idiomatic spelling rather than a smell.
 */
const isDefectArgument = (node) => {
  const call = node.parent;
  if (!call || call.type !== 'CallExpression') return false;
  if (!call.arguments.includes(node)) return false;
  const callee = call.callee;
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'Effect' &&
    callee.property.type === 'Identifier' &&
    (callee.property.name === 'die' || callee.property.name === 'dieSync')
  );
};

/**
 * True when `node` is `Schema.Unknown` used as the inner schema of
 * `Schema.fromJsonString(...)` (or the v3 `Schema.parseJson(...)`).
 *
 * v3 allowed `Schema.parseJson()` with no argument; v4 requires one, so this is
 * the only way to express "decode JSON without asserting a shape here".
 */
const isUntypedJsonStringSchema = (node) => {
  if (node.property.type !== 'Identifier' || node.property.name !== 'Unknown') {
    return false;
  }
  const call = node.parent;
  if (!call || call.type !== 'CallExpression') return false;
  if (call.arguments[0] !== node) return false;
  const callee = call.callee;
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'Schema' &&
    callee.property.type === 'Identifier' &&
    (callee.property.name === 'fromJsonString' ||
      callee.property.name === 'parseJson')
  );
};

const findVariable = (sourceCode, node, name) => {
  let scope = sourceCode.getScope(node);
  while (scope) {
    const variable = scope.set?.get(name) ??
      scope.variables?.find((candidate) => candidate.name === name);
    if (variable) {
      return variable;
    }
    scope = scope.upper;
  }
  return null;
};

const isUnshadowedGlobal = (sourceCode, node, name) => {
  const variable = findVariable(sourceCode, node, name);
  return variable === null || variable.defs.length === 0;
};

const importedName = (specifier) => {
  if (specifier.type !== 'ImportSpecifier') {
    return null;
  }
  return specifier.imported.type === 'Identifier'
    ? specifier.imported.name
    : specifier.imported.value;
};

const effectImportState = (sourceCode, node, name) => {
  const effectImports = sourceCode.ast.body.filter(
    (statement) =>
      statement.type === 'ImportDeclaration' &&
      statement.source.value === 'effect'
  );
  const hasAlias = effectImports.some((statement) =>
    statement.specifiers.some(
      (specifier) =>
        importedName(specifier) === name &&
        specifier.local.name !== name
    )
  );
  if (hasAlias) {
    return 'conflict';
  }

  const variable = findVariable(sourceCode, node, name);
  if (variable) {
    const isCanonicalImport =
      variable.defs.length > 0 &&
      variable.defs.every(
        (definition) =>
          definition.type === 'ImportBinding' &&
          definition.parent?.source?.value === 'effect' &&
          definition.node?.type === 'ImportSpecifier' &&
          importedName(definition.node) === name &&
          definition.name?.name === name
      );
    return isCanonicalImport ? 'available' : 'conflict';
  }

  return 'missing';
};

const importInsertion = (sourceCode, name) => {
  if (sourceCode.ast.sourceType !== 'module') {
    return null;
  }

  const body = sourceCode.ast.body;
  const imports = body.filter(
    (statement) => statement.type === 'ImportDeclaration'
  );
  const text = `import { ${name} } from 'effect';`;
  if (imports.length > 0) {
    const anchor = imports.at(-1);
    const hasTrailingComment = sourceCode
      .getCommentsAfter(anchor)
      .some((comment) => comment.loc.start.line === anchor.loc.end.line);
    if (hasTrailingComment) {
      return null;
    }
    return { anchor, placement: 'after', text: `\n${text}` };
  }

  const anchor = body[0];
  if (!anchor || anchor.directive) {
    return null;
  }
  const hasLeadingComment = sourceCode
    .getAllComments()
    .some((comment) => comment.range[1] <= anchor.range[0]);
  if (hasLeadingComment) {
    return null;
  }
  return { anchor, placement: 'before', text: `${text}\n` };
};

const withNamedEffectImport = (context, node, name, makeLocalFixes) => {
  const sourceCode = getSourceCode(context);
  const state = effectImportState(sourceCode, node, name);
  if (state === 'conflict') {
    return null;
  }
  const insertion = state === 'missing'
    ? importInsertion(sourceCode, name)
    : null;
  if (state === 'missing' && insertion === null) {
    return null;
  }

  return (fixer) => {
    const localFixes = makeLocalFixes(fixer);
    if (localFixes === null) {
      return null;
    }
    const fixes = Array.isArray(localFixes) ? localFixes : [localFixes];
    if (insertion) {
      fixes.push(
        insertion.placement === 'after'
          ? fixer.insertTextAfter(insertion.anchor, insertion.text)
          : fixer.insertTextBefore(insertion.anchor, insertion.text)
      );
    }
    return fixes;
  };
};

const hasCanonicalEffectImport = (context, node, name) =>
  effectImportState(getSourceCode(context), node, name) === 'available';

const isDirectEffectGenCallback = (context, functionNode) => {
  const call = functionNode?.parent;
  return Boolean(
    functionNode?.type === 'FunctionExpression' &&
    functionNode.generator &&
    call?.type === 'CallExpression' &&
    call.arguments[0] === functionNode &&
    call.callee.type === 'MemberExpression' &&
    !call.callee.computed &&
    !call.optional &&
    call.callee.object.type === 'Identifier' &&
    call.callee.object.name === 'Effect' &&
    call.callee.property.type === 'Identifier' &&
    call.callee.property.name === 'gen' &&
    hasCanonicalEffectImport(context, call.callee.object, 'Effect')
  );
};

const isInsideDirectEffectGen = (context, node) =>
  isDirectEffectGenCallback(context, findNearestFunctionOwner(node));

const isDirectValuePosition = (node) => {
  const parent = node.parent;
  if (!parent) {
    return false;
  }
  switch (parent.type) {
    case 'ArrayExpression':
      return parent.elements.includes(node);
    case 'ArrowFunctionExpression':
      return parent.body === node;
    case 'AssignmentExpression':
      return parent.right === node;
    case 'CallExpression':
    case 'NewExpression':
      return parent.arguments.includes(node);
    case 'ConditionalExpression':
      return parent.consequent === node || parent.alternate === node;
    case 'Property':
      return parent.value === node && parent.kind === 'init';
    case 'ReturnStatement':
    case 'YieldExpression':
      return parent.argument === node;
    case 'VariableDeclarator':
      return parent.init === node;
    default:
      return false;
  }
};

const staticPropertyName = (member) => {
  if (!member.computed && member.property.type === 'Identifier') {
    return member.property.name;
  }
  if (
    member.computed &&
    member.property.type === 'Literal' &&
    typeof member.property.value === 'string'
  ) {
    return member.property.value;
  }
  return null;
};


const rangeContainsComment = (sourceCode, start, end) =>
  sourceCode
    .getAllComments()
    .some((comment) => comment.range[0] >= start && comment.range[1] <= end);


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
    hasSuggestions: true,
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
      replaceWithEffectSucceed:
        'Replace this call with Effect.succeed(). Review the resulting Effect type.',
      replaceWithEffectFail:
        'Replace this call with Effect.fail(). Review the resulting error type.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = getSourceCode(context);

    return {
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'Promise' &&
          node.property.type === 'Identifier' &&
          !node.computed
        ) {
          const method = node.property.name;
          if (method !== 'resolve' && method !== 'reject') {
            return;
          }
          const call = node.parent;
          const canReplace =
            isUnshadowedGlobal(sourceCode, node.object, 'Promise') &&
            call.type === 'CallExpression' &&
            call.callee === node &&
            !call.optional &&
            call.arguments.length === 1 &&
            call.arguments[0].type !== 'SpreadElement';
          const fix = canReplace
            ? withNamedEffectImport(context, node, 'Effect', (fixer) =>
                fixer.replaceText(
                  call,
                  `Effect.${method === 'resolve' ? 'succeed' : 'fail'}(${sourceCode.getText(call.arguments[0])})`
                ))
            : null;
          const report = {
            node,
            messageId:
              method === 'resolve' ? 'noPromiseResolve' : 'noPromiseReject',
          };
          if (fix) {
            report.suggest = [{
              messageId:
                method === 'resolve'
                  ? 'replaceWithEffectSucceed'
                  : 'replaceWithEffectFail',
              fix,
            }];
          }
          context.report(report);
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
        'Avoid .catch() on Promises - use Effect.catch or Effect.catchTag for type-safe error handling. See: https://effect.website/docs/error-management/expected-errors/',
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
    hasSuggestions: true,
    docs: {
      description:
        'Discourage null literals for optional values - prefer Option',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      noNull:
        'Consider using Option instead of null for optional values. Option provides type-safe handling of absence. See: https://effect.website/docs/data-types/option/',
      replaceWithOptionNone:
        'Replace null with Option.none(). Review the resulting Option type.',
    },
    schema: [],
  },
  create(context) {
    return {
      Literal(node) {
        if (node.value === null && node.raw === 'null') {
          const fix = isDirectValuePosition(node)
            ? withNamedEffectImport(context, node, 'Option', (fixer) =>
                fixer.replaceText(node, 'Option.none()'))
            : null;
          const report = {
            node,
            messageId: 'noNull',
          };
          if (fix) {
            report.suggest = [{
              messageId: 'replaceWithOptionNone',
              fix,
            }];
          }
          context.report(report);
        }
      },
    };
  },
};

// Pattern #2: Optional Values (undefined -> Option)
export const noUndefinedUseOption = {
  meta: {
    type: 'suggestion',
    hasSuggestions: true,
    docs: {
      description:
        'Discourage undefined for optional values - prefer Option',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      noUndefined:
        'Consider using Option instead of undefined for optional values. Option provides type-safe handling of absence. See: https://effect.website/docs/data-types/option/',
      replaceWithOptionNone:
        'Replace undefined with Option.none(). Review the resulting Option type.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = getSourceCode(context);

    return {
      Identifier(node) {
        if (node.name === 'undefined' && node.parent.type !== 'TSTypeReference') {
          if (node.parent.type === 'ReturnStatement') {
            return;
          }
          if (node.parent.type === 'BinaryExpression') {
            return;
          }
          const fix =
            isDirectValuePosition(node) &&
            isUnshadowedGlobal(sourceCode, node, 'undefined')
              ? withNamedEffectImport(context, node, 'Option', (fixer) =>
                  fixer.replaceText(node, 'Option.none()'))
              : null;
          const report = {
            node,
            messageId: 'noUndefined',
          };
          if (fix) {
            report.suggest = [{
              messageId: 'replaceWithOptionNone',
              fix,
            }];
          }
          context.report(report);
        }
      },
    };
  },
};

// Pattern #4: Typed Error Handling (throw -> Effect.fail)
export const noThrowUseEffect = {
  meta: {
    type: 'problem',
    hasSuggestions: true,
    docs: {
      description: 'Disallow throw statements - use Effect.fail instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noThrow:
        'Avoid throw statements - use Effect.fail for expected errors or Effect.die for defects. Typed errors in Effect are tracked in the type system. See: https://effect.website/docs/error-management/two-error-types/',
      replaceWithEffectFail:
        'Replace this throw with Effect.fail(). Use this for an expected error.',
      replaceWithEffectDie:
        'Replace this throw with Effect.die(). Use this only for a defect.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = getSourceCode(context);

    return {
      ThrowStatement(node) {
        const canReplace =
          node.argument &&
          isInsideDirectEffectGen(context, node);
        const report = {
          node,
          messageId: 'noThrow',
        };
        if (canReplace) {
          const argument = sourceCode.getText(node.argument);
          report.suggest = [
            {
              messageId: 'replaceWithEffectFail',
              fix: (fixer) =>
                fixer.replaceText(
                  node,
                  `return yield* Effect.fail(${argument});`
                ),
            },
            {
              messageId: 'replaceWithEffectDie',
              fix: (fixer) =>
                fixer.replaceText(
                  node,
                  `return yield* Effect.die(${argument});`
                ),
            },
          ];
        }
        context.report(report);
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
        'Avoid try/catch - use Effect.catch, Effect.catchTag, or Effect.orElse instead. Effect error handling is type-safe and composable. See: https://effect.website/docs/error-management/expected-errors/',
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
        // v4 removed `Effect.dieMessage`, so the only way to raise a defect with a
        // message is `Effect.die(new Error(msg))` — v3 built exactly that Error
        // internally. Flagging it would forbid the only remaining spelling.
        if (isDefectArgument(node)) return;
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
    hasSuggestions: true,
    docs: {
      description: 'Disallow new Date() - use Effect DateTime instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noNewDate:
        'Avoid new Date() - use DateTime from Effect for immutable, type-safe date/time handling. See: https://effect.website/docs/data-types/datetime/',
      replaceWithDateTimeNow:
        'Replace new Date() with DateTime.now. Review the resulting DateTime type.',
    },
    schema: [],
  },
  create(context) {
    return {
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Date') {
          const sourceCode = getSourceCode(context);
          const canReplace =
            node.arguments.length === 0 &&
            isDirectValuePosition(node) &&
            isUnshadowedGlobal(sourceCode, node.callee, 'Date') &&
            isInsideDirectEffectGen(context, node);
          const fix = canReplace
            ? withNamedEffectImport(context, node, 'DateTime', (fixer) =>
                fixer.replaceText(node, '(yield* DateTime.now)'))
            : null;
          const report = {
            node,
            messageId: 'noNewDate',
          };
          if (fix) {
            report.suggest = [{
              messageId: 'replaceWithDateTimeNow',
              fix,
            }];
          }
          context.report(report);
        }
      },
    };
  },
};

// Pattern #8: Date static methods -> DateTime
export const noDateStaticUseDateTime = {
  meta: {
    type: 'problem',
    hasSuggestions: true,
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
      replaceWithDateTimeNow:
        'Replace Date.now() with DateTime.now. Review the resulting DateTime type.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = getSourceCode(context);

    return {
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'Date' &&
          node.property.type === 'Identifier'
        ) {
          if (node.property.name === 'now') {
            const call = node.parent;
            const canReplace =
              !node.computed &&
              isUnshadowedGlobal(sourceCode, node.object, 'Date') &&
              call.type === 'CallExpression' &&
              call.callee === node &&
              call.arguments.length === 0 &&
              isDirectValuePosition(call) &&
              isInsideDirectEffectGen(context, call);
            const fix = canReplace
              ? withNamedEffectImport(context, call, 'DateTime', (fixer) =>
                  fixer.replaceText(call, '(yield* DateTime.now)'))
              : null;
            const report = { node, messageId: 'noDateNow' };
            if (fix) {
              report.suggest = [{
                messageId: 'replaceWithDateTimeNow',
                fix,
              }];
            }
            context.report(report);
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
    hasSuggestions: true,
    docs: {
      description: 'Discourage new Set() - prefer HashSet for value-based equality',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      noSet:
        'Consider using HashSet from Effect instead of Set for value-based equality. HashSet compares elements by structure, not reference. See: https://effect.website/docs/data-types/hash-set/',
      replaceWithHashSet:
        'Replace this Set with a HashSet constructor. Review collection equality and mutability.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = getSourceCode(context);

    return {
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Set') {
          const canReplace =
            isUnshadowedGlobal(sourceCode, node.callee, 'Set') &&
            node.arguments.length <= 1 &&
            node.arguments.every((argument) => argument.type !== 'SpreadElement') &&
            !node.typeArguments &&
            !node.typeParameters;
          const replacement = node.arguments.length === 0
            ? 'HashSet.empty()'
            : `HashSet.fromIterable(${sourceCode.getText(node.arguments[0])})`;
          const fix = canReplace
            ? withNamedEffectImport(context, node, 'HashSet', (fixer) =>
                fixer.replaceText(node, replacement))
            : null;
          const report = { node, messageId: 'noSet' };
          if (fix) {
            report.suggest = [{
              messageId: 'replaceWithHashSet',
              fix,
            }];
          }
          context.report(report);
        }
      },
    };
  },
};

// Pattern #11: Maps (Map -> HashMap)
export const noMapUseHashMap = {
  meta: {
    type: 'suggestion',
    hasSuggestions: true,
    docs: {
      description: 'Discourage new Map() - prefer HashMap for value-based key equality',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      noMap:
        'Consider using HashMap from Effect instead of Map for value-based key equality. HashMap compares keys by structure, not reference. See: https://effect.website/docs/data-types/hash-map/',
      replaceWithHashMap:
        'Replace this Map with a HashMap constructor. Review collection equality and mutability.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = getSourceCode(context);

    return {
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Map') {
          const canReplace =
            isUnshadowedGlobal(sourceCode, node.callee, 'Map') &&
            node.arguments.length <= 1 &&
            node.arguments.every((argument) => argument.type !== 'SpreadElement') &&
            !node.typeArguments &&
            !node.typeParameters;
          const replacement = node.arguments.length === 0
            ? 'HashMap.empty()'
            : `HashMap.fromIterable(${sourceCode.getText(node.arguments[0])})`;
          const fix = canReplace
            ? withNamedEffectImport(context, node, 'HashMap', (fixer) =>
                fixer.replaceText(node, replacement))
            : null;
          const report = { node, messageId: 'noMap' };
          if (fix) {
            report.suggest = [{
              messageId: 'replaceWithHashMap',
              fix,
            }];
          }
          context.report(report);
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
        'Avoid JSON.parse() - use Schema.decodeUnknownEffect or Schema.fromJsonString from Effect for type-safe JSON parsing with validation. See: https://effect.website/docs/schema/basic-usage/',
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
    hasSuggestions: true,
    docs: {
      description: 'Disallow Math.random() - use Effect Random service for testability',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noMathRandom:
        'Avoid Math.random() - use the Random service from Effect for testable random number generation. See: https://effect.website/docs/guides/observability/testing/#testrandom',
      replaceWithRandomNext:
        'Replace Math.random() with Random.next inside Effect.gen.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = getSourceCode(context);

    return {
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'Math' &&
          node.property.type === 'Identifier' &&
          node.property.name === 'random'
        ) {
          const call = node.parent;
          const canReplace =
            !node.computed &&
            isUnshadowedGlobal(sourceCode, node.object, 'Math') &&
            call.type === 'CallExpression' &&
            call.callee === node &&
            call.arguments.length === 0 &&
            isDirectValuePosition(call) &&
            isInsideDirectEffectGen(context, call);
          const fix = canReplace
            ? withNamedEffectImport(context, call, 'Random', (fixer) =>
                fixer.replaceText(call, '(yield* Random.next)'))
            : null;
          const report = { node, messageId: 'noMathRandom' };
          if (fix) {
            report.suggest = [{
              messageId: 'replaceWithRandomNext',
              fix,
            }];
          }
          context.report(report);
        }
      },
    };
  },
};

// Pattern #17: Logging (console -> Effect.log)
export const noConsoleUseEffect = {
  meta: {
    type: 'problem',
    hasSuggestions: true,
    docs: {
      description: 'Disallow console.* methods - use Effect logging instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noConsole:
        'Use Effect logging instead of console.{{method}}(). Replace with Effect.log{{effectMethod}}().',
      replaceWithEffectLog:
        'Replace this console statement with Effect.{{method}} inside Effect.gen.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = getSourceCode(context);
    const methodMap = {
      log: 'logInfo',
      info: 'logInfo',
      warn: 'logWarning',
      error: 'logError',
      debug: 'logDebug',
    };

    return {
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'console' &&
          node.property.type === 'Identifier'
        ) {
          const method = node.property.name;
          const effectMethod = methodMap[method] || 'logInfo';
          const call = node.parent;
          const statement = call.type === 'CallExpression'
            ? call.parent
            : null;
          const canReplace =
            !node.computed &&
            method in methodMap &&
            isUnshadowedGlobal(sourceCode, node.object, 'console') &&
            call.type === 'CallExpression' &&
            call.callee === node &&
            !call.optional &&
            statement?.type === 'ExpressionStatement' &&
            isInsideDirectEffectGen(context, statement);
          const report = {
            node,
            messageId: 'noConsole',
            data: {
              method,
              effectMethod: effectMethod.slice(3),
            },
          };
          if (canReplace) {
            const argumentsText = call.arguments
              .map((argument) => sourceCode.getText(argument))
              .join(', ');
            report.suggest = [{
              messageId: 'replaceWithEffectLog',
              data: { method: effectMethod },
              fix: (fixer) =>
                fixer.replaceText(
                  statement,
                  `yield* Effect.${effectMethod}(${argumentsText});`
                ),
            }];
          }
          context.report(report);
        }
      },
    };
  },
};

// Pattern #18: Configuration (process.env -> Config)
export const noProcessEnvUseConfig = {
  meta: {
    type: 'problem',
    hasSuggestions: true,
    docs: {
      description: 'Disallow process.env - use Effect Config instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noProcessEnv:
        'Avoid process.env - use Config from Effect for strongly-typed configuration management. See: https://effect.website/docs/configuration/',
      replaceWithConfigString:
        'Replace this environment read with Config.string(). Review required and optional configuration behavior.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = getSourceCode(context);

    return {
      MemberExpression(node) {
        if (
          node.object.type === 'MemberExpression' &&
          node.object.object.type === 'Identifier' &&
          node.object.object.name === 'process' &&
          node.object.property.type === 'Identifier' &&
          node.object.property.name === 'env'
        ) {
          const key = staticPropertyName(node);
          const canReplace =
            key !== null &&
            isDirectValuePosition(node) &&
            isUnshadowedGlobal(sourceCode, node.object.object, 'process') &&
            isInsideDirectEffectGen(context, node);
          const fix = canReplace
            ? withNamedEffectImport(context, node, 'Config', (fixer) =>
                fixer.replaceText(
                  node,
                  `(yield* Config.string(${JSON.stringify(key)}))`
                ))
            : null;
          const report = {
            node,
            messageId: 'noProcessEnv',
          };
          if (fix) {
            report.suggest = [{
              messageId: 'replaceWithConfigString',
              fix,
            }];
          }
          context.report(report);
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

// =============================================================================
// TIER 1: Library Replacement Rules (Simple Import Detection)
// =============================================================================

// Pattern #23: File System (fs -> Effect FileSystem)
export const noFsUseEffectFs = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Node.js fs module - use Effect FileSystem service instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noFs:
        'Avoid Node.js fs module - use FileSystem from effect/FileSystem for type-safe, testable file operations. In v4 the platform packages were consolidated into core. See: https://effect.website/docs/platform/file-system/',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (source === 'fs' || source === 'fs/promises' || source === 'node:fs' || source === 'node:fs/promises') {
          context.report({ node, messageId: 'noFs' });
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length > 0 &&
          node.arguments[0].type === 'Literal'
        ) {
          const source = node.arguments[0].value;
          if (source === 'fs' || source === 'fs/promises' || source === 'node:fs' || source === 'node:fs/promises') {
            context.report({ node, messageId: 'noFs' });
          }
        }
      },
    };
  },
};

// Pattern #24: HTTP Client (axios -> Effect HttpClient)
export const noAxiosUseHttpClient = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow axios - use Effect HttpClient instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noAxios:
        'Avoid axios - use HttpClient from effect/unstable/http/HttpClient for type-safe HTTP requests with proper error handling and interruption support. That module is unstable: it is exempt from the normal stability guarantee until it graduates to top-level effect/*. See: https://effect.website/docs/platform/http-client/',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === 'axios' || node.source.value.startsWith('axios/')) {
          context.report({ node, messageId: 'noAxios' });
        }
      },
    };
  },
};

// Pattern #25: HTTP Client (node-fetch -> Effect HttpClient)
export const noNodeFetchUseHttpClient = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow node-fetch - use Effect HttpClient instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noNodeFetch:
        'Avoid node-fetch - use HttpClient from effect/unstable/http/HttpClient for type-safe HTTP requests. That module is unstable: it is exempt from the normal stability guarantee until it graduates to top-level effect/*. See: https://effect.website/docs/platform/http-client/',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === 'node-fetch' || node.source.value.startsWith('node-fetch/')) {
          context.report({ node, messageId: 'noNodeFetch' });
        }
      },
    };
  },
};

// Pattern #26: Date/Time Libraries (moment/dayjs -> DateTime)
export const noMomentUseDatetime = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow moment.js and dayjs - use Effect DateTime instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noMoment:
        'Avoid moment.js - use DateTime from Effect for immutable, type-safe date/time handling. See: https://effect.website/docs/data-types/datetime/',
      noDayjs:
        'Avoid dayjs - use DateTime from Effect for immutable, type-safe date/time handling. See: https://effect.website/docs/data-types/datetime/',
      noDateFns:
        'Avoid date-fns - use DateTime from Effect for immutable, type-safe date/time handling. See: https://effect.website/docs/data-types/datetime/',
      noLuxon:
        'Avoid luxon - use DateTime from Effect for immutable, type-safe date/time handling. See: https://effect.website/docs/data-types/datetime/',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (source === 'moment' || source.startsWith('moment/') || source === 'moment-timezone') {
          context.report({ node, messageId: 'noMoment' });
        } else if (source === 'dayjs' || source.startsWith('dayjs/')) {
          context.report({ node, messageId: 'noDayjs' });
        } else if (source === 'date-fns' || source.startsWith('date-fns/')) {
          context.report({ node, messageId: 'noDateFns' });
        } else if (source === 'luxon' || source.startsWith('luxon/')) {
          context.report({ node, messageId: 'noLuxon' });
        }
      },
    };
  },
};

// Pattern #27: Debounce/Throttle (lodash -> Schedule)
export const noLodashDebounceUseSchedule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow lodash debounce/throttle - use Effect Schedule instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noDebounce:
        'Avoid _.debounce() - use Schedule from Effect for structured timing control. See: https://effect.website/docs/scheduling/introduction/',
      noThrottle:
        'Avoid _.throttle() - use Schedule from Effect for structured timing control. See: https://effect.website/docs/scheduling/introduction/',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === 'MemberExpression') {
          const prop = node.callee.property;
          if (prop.type === 'Identifier') {
            if (prop.name === 'debounce') {
              context.report({ node, messageId: 'noDebounce' });
            } else if (prop.name === 'throttle') {
              context.report({ node, messageId: 'noThrottle' });
            }
          }
        }
      },
    };
  },
};

// Pattern #28: Event Emitter (EventEmitter -> PubSub)
export const noEventEmitterUsePubSub = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow EventEmitter - use Effect PubSub instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noEventEmitter:
        'Avoid EventEmitter - use PubSub from Effect for type-safe, backpressure-aware pub/sub. See: https://effect.website/docs/concurrency/pubsub/',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === 'events' || node.source.value === 'node:events') {
          context.report({ node, messageId: 'noEventEmitter' });
        }
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'EventEmitter') {
          context.report({ node, messageId: 'noEventEmitter' });
        }
      },
    };
  },
};

// Pattern #29: RxJS (rxjs -> Stream)
export const noRxjsUseStream = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow RxJS - use Effect Stream instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noRxjs:
        'Avoid RxJS - use Stream from Effect for type-safe reactive streams with proper resource management. See: https://effect.website/docs/stream/introduction/',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === 'rxjs' || node.source.value.startsWith('rxjs/')) {
          context.report({ node, messageId: 'noRxjs' });
        }
      },
    };
  },
};

// Pattern #30: Crypto Random (crypto.randomBytes -> Random service)
export const noCryptoRandomUseRandom = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow crypto.randomBytes - use Effect Random service for testability',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noCryptoRandom:
        'Avoid crypto.randomBytes/randomUUID - use Random service from Effect for testable random generation. See: https://effect.website/docs/trait/random/',
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'crypto' &&
          node.property.type === 'Identifier' &&
          (node.property.name === 'randomBytes' ||
           node.property.name === 'randomUUID' ||
           node.property.name === 'getRandomValues')
        ) {
          context.report({ node, messageId: 'noCryptoRandom' });
        }
      },
    };
  },
};

// Pattern #31: Ajv (ajv -> Schema)
export const noAjvUseSchema = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Ajv - use Effect Schema instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noAjv:
        'Avoid Ajv - use Effect Schema for type-safe validation with automatic TypeScript inference. See: https://effect.website/docs/schema/basic-usage/',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === 'ajv' || node.source.value.startsWith('ajv/')) {
          context.report({ node, messageId: 'noAjv' });
        }
      },
    };
  },
};

// Pattern #32: Joi (joi -> Schema)
export const noJoiUseSchema = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Joi - use Effect Schema instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noJoi:
        'Avoid Joi - use Effect Schema for type-safe validation with automatic TypeScript inference. See: https://effect.website/docs/schema/basic-usage/',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === 'joi' || node.source.value.startsWith('joi/')) {
          context.report({ node, messageId: 'noJoi' });
        }
      },
    };
  },
};

// Pattern #33: class-validator (class-validator -> Schema)
export const noClassValidatorUseSchema = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow class-validator - use Effect Schema instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noClassValidator:
        'Avoid class-validator - use Effect Schema for type-safe validation. See: https://effect.website/docs/schema/basic-usage/',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === 'class-validator' || node.source.value.startsWith('class-validator/')) {
          context.report({ node, messageId: 'noClassValidator' });
        }
      },
    };
  },
};

// Pattern #34: io-ts (io-ts -> Schema)
export const noIoTsUseSchema = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow io-ts - use Effect Schema instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noIoTs:
        'Avoid io-ts - use Effect Schema which provides better error messages and TypeScript integration. See: https://effect.website/docs/schema/basic-usage/',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === 'io-ts' || node.source.value.startsWith('io-ts/')) {
          context.report({ node, messageId: 'noIoTs' });
        }
      },
    };
  },
};

// Pattern #35: superstruct (superstruct -> Schema)
export const noSuperstructUseSchema = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow superstruct - use Effect Schema instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noSuperstruct:
        'Avoid superstruct - use Effect Schema for type-safe validation. See: https://effect.website/docs/schema/basic-usage/',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === 'superstruct' || node.source.value.startsWith('superstruct/')) {
          context.report({ node, messageId: 'noSuperstruct' });
        }
      },
    };
  },
};

// =============================================================================
// TIER 2: Heuristic Pattern Detection Rules
// =============================================================================

// Pattern #36: Config.redacted for secrets
export const preferRedactedForSecrets = {
  meta: {
    type: 'problem',
    hasSuggestions: true,
    docs: {
      description: 'Use Config.redacted for secret configuration values',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      useRedacted:
        'Config value "{{name}}" appears to be a secret. Use Config.redacted() instead of Config.string() to prevent accidental exposure in logs. See: https://effect.website/docs/configuration/',
      replaceWithConfigRedacted:
        'Replace Config.string() with Config.redacted(). Review the resulting Redacted value type.',
    },
    schema: [],
  },
  create(context) {
    const secretPatterns = /(_KEY|_SECRET|_PASSWORD|_TOKEN|_API_KEY|_PRIVATE|_CREDENTIAL|PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)$/i;

    return {
      CallExpression(node) {
        // Match Config.string("SECRET_NAME")
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Config' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'string' &&
          node.arguments.length > 0 &&
          node.arguments[0].type === 'Literal' &&
          typeof node.arguments[0].value === 'string'
        ) {
          const configName = node.arguments[0].value;
          if (secretPatterns.test(configName)) {
            const canReplace =
              !node.callee.computed &&
              hasCanonicalEffectImport(
                context,
                node.callee.object,
                'Config'
              );
            const report = {
              node,
              messageId: 'useRedacted',
              data: { name: configName },
            };
            if (canReplace) {
              report.suggest = [{
                messageId: 'replaceWithConfigRedacted',
                fix: (fixer) =>
                  fixer.replaceText(node.callee.property, 'redacted'),
              }];
            }
            context.report(report);
          }
        }
      },
    };
  },
};

// Pattern #37: Duration over raw milliseconds
export const preferDurationLiterals = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Prefer Duration module over raw milliseconds in timing contexts',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      useDuration:
        'Use the duration string {{duration}} instead of raw milliseconds. See: https://effect.website/docs/data-types/duration/',
    },
    schema: [],
  },
  create(context) {
    const formatDuration = (value) => {
      if (value >= 1000 && Number.isInteger(value / 1000)) {
        const seconds = value / 1000;
        return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
      }
      return `${value} ${value === 1 ? 'milli' : 'millis'}`;
    };

    const reportDuration = (node, effectObject) => {
      if (
        node.type !== 'Literal' ||
        typeof node.value !== 'number' ||
        !Number.isFinite(node.value) ||
        node.value < 0
      ) {
        return;
      }
      const duration = formatDuration(node.value);
      const canFix = hasCanonicalEffectImport(
        context,
        effectObject,
        'Effect'
      );
      context.report({
        node,
        messageId: 'useDuration',
        data: { duration: JSON.stringify(duration) },
        fix: canFix
          ? (fixer) => fixer.replaceText(node, JSON.stringify(duration))
          : null,
      });
    };

    const durationProperty = (object) => {
      if (object?.type !== 'ObjectExpression') {
        return null;
      }
      const matches = object.properties.filter((property) => {
        if (
          property.type !== 'Property' ||
          property.kind !== 'init' ||
          property.method ||
          property.shorthand
        ) {
          return false;
        }
        const name = !property.computed && property.key.type === 'Identifier'
          ? property.key.name
          : property.key.type === 'Literal'
            ? property.key.value
            : null;
        return name === 'duration';
      });
      return matches.length === 1 ? matches[0].value : null;
    };

    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Effect' &&
          node.callee.property.type === 'Identifier' &&
          !node.callee.computed &&
          !node.optional
        ) {
          const method = node.callee.property.name;
          if (method === 'sleep' && node.arguments.length === 1) {
            reportDuration(node.arguments[0], node.callee.object);
          } else if (
            (method === 'delay' || method === 'timeout') &&
            (node.arguments.length === 1 || node.arguments.length === 2)
          ) {
            reportDuration(
              node.arguments[node.arguments.length - 1],
              node.callee.object
            );
          } else if (
            (method === 'timeoutFail' || method === 'timeoutTo') &&
            (node.arguments.length === 1 || node.arguments.length === 2)
          ) {
            const options = durationProperty(
              node.arguments[node.arguments.length - 1]
            );
            if (options) {
              reportDuration(options, node.callee.object);
            }
          }
        }
      },
    };
  },
};

// Pattern #38: Prefer pipe method
export const preferPipeMethod = {
  meta: {
    type: 'suggestion',
    hasSuggestions: true,
    docs: {
      description: 'Prefer .pipe() method over standalone pipe function',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      usePipeMethod:
        'Prefer value.pipe(...) over pipe(value, ...) for better readability. See: https://effect.website/docs/getting-started/building-pipelines/',
      replaceWithPipeMethod:
        'Replace the standalone pipe call with the value pipe method. Review method availability.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = getSourceCode(context);

    return {
      CallExpression(node) {
        // Match: pipe(someValue, Effect.map(...), ...)
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'pipe' &&
          node.arguments.length >= 2
        ) {
          const firstArg = node.arguments[0];
          // Skip if first arg is already a function call (likely a constructor)
          if (firstArg.type === 'Identifier' || firstArg.type === 'MemberExpression') {
            const opening = sourceCode.getTokenAfter(node.callee);
            const comma = sourceCode.getTokenAfter(firstArg);
            const secondArg = node.arguments[1];
            const canReplace =
              !node.optional &&
              !node.typeArguments &&
              !node.typeParameters &&
              opening?.value === '(' &&
              comma?.value === ',' &&
              hasCanonicalEffectImport(context, node.callee, 'pipe') &&
              !rangeContainsComment(
                sourceCode,
                node.range[0],
                secondArg.range[0]
              );
            const report = {
              node,
              messageId: 'usePipeMethod',
            };
            if (canReplace) {
              report.suggest = [{
                messageId: 'replaceWithPipeMethod',
                fix: (fixer) => [
                  fixer.removeRange([node.range[0], firstArg.range[0]]),
                  fixer.replaceTextRange(
                    [comma.range[0], secondArg.range[0]],
                    '.pipe('
                  ),
                ],
              }];
            }
            context.report(report);
          }
        }
      },
    };
  },
};

// Pattern #39: No andThen with async function
export const noAndThenWithAsync = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Effect.andThen with async functions',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noAsyncInAndThen:
        'Avoid async functions in Effect.andThen - use Effect.tryPromise to wrap the async operation, or Effect.gen for the entire workflow. See: https://effect.website/docs/getting-started/using-generators/',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          (node.callee.property.name === 'andThen' || node.callee.property.name === 'flatMap' || node.callee.property.name === 'tap')
        ) {
          node.arguments.forEach((arg) => {
            if (
              (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') &&
              arg.async
            ) {
              context.report({
                node: arg,
                messageId: 'noAsyncInAndThen',
              });
            }
          });
        }
      },
    };
  },
};

// Pattern #40: Suggest batching option
//
// NARROWED 2026-07-21 (provider-routing, BLOCKER-toolchain-gate-integrity).
//
// This rule used to fire on EVERY `Effect.forEach` that did not pass
// `batching`. That made it a defect generator, because request batching is
// only meaningful when the mapped effect actually goes through a `Request` /
// `RequestResolver` — and in effect 3.22 a *failing* `Effect.forEach` under
// `{ batching: true }` NEVER SETTLES.
//
// The cost of the old behaviour, measured on this repo (task T1.6):
// the migration runner hung forever while holding the cluster-wide
// `pg_advisory_xact_lock(87351502)`, wedging every other process's migrations,
// so the sha256 checksum guard could never fire. Four row-decode loops carried
// the same pattern, so a single undecodable row hung a read instead of failing
// it. Removing the option from five sites took one suite from 130s to 12s.
//
// So the rule now fires ONLY where batching could do something: the mapped
// callback must syntactically involve Request machinery. Where no `Request` is
// mapped, `{ batching: true }` buys nothing and costs a deadlock, and the rule
// stays silent rather than demanding it.
const REQUEST_MACHINERY = /\bRequestResolver\b|\bEffect\s*\.\s*request\b|\bRequest\s*\.\s*(?:of|tagged|Class)\b/;

export const suggestBatchingOption = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Suggest adding batching option to Effect.forEach, but only where a Request/RequestResolver is actually mapped',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      considerBatching:
        'This Effect.forEach maps a Request/RequestResolver, so { batching: true } may help. Note: in effect 3.22 a FAILING Effect.forEach under batching never settles — only add it if every mapped effect is infallible, or handle failures outside the loop. See: https://effect.website/docs/caching-and-batching/batching/',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /**
     * Batching only does anything when the mapped effect resolves through a
     * Request/RequestResolver. Without one the option is inert except for the
     * effect 3.22 failure deadlock, so demanding it is actively harmful.
     */
    const mapsARequest = (node) => {
      const mapper = node.arguments[1];
      if (mapper === undefined) {
        return false;
      }
      return REQUEST_MACHINERY.test(sourceCode.getText(mapper));
    };

    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Effect' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'forEach'
        ) {
          if (!mapsARequest(node)) {
            return;
          }

          // Check if options object is provided with batching
          const hasOptions = node.arguments.length >= 3;
          if (hasOptions) {
            const optionsArg = node.arguments[2];
            if (optionsArg.type === 'ObjectExpression') {
              const hasBatching = optionsArg.properties.some(
                (prop) =>
                  prop.type === 'Property' &&
                  prop.key.type === 'Identifier' &&
                  prop.key.name === 'batching'
              );
              if (!hasBatching) {
                context.report({
                  node: optionsArg,
                  messageId: 'considerBatching',
                });
              }
            }
          } else if (node.arguments.length === 2) {
            context.report({
              node,
              messageId: 'considerBatching',
            });
          }
        }
      },
    };
  },
};

// Pattern #41: No Effect.provide in loops
export const noProvideInLoop = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Avoid Effect.provide inside loops - provide at outer scope',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noProvideInLoop:
        'Avoid calling Effect.provide inside loops - it creates new contexts on each iteration. Provide the layer at the outer scope instead. See: https://effect.website/docs/requirements-management/layers/',
    },
    schema: [],
  },
  create(context) {
    let loopDepth = 0;

    return {
      ForStatement() { loopDepth++; },
      'ForStatement:exit'() { loopDepth--; },
      ForInStatement() { loopDepth++; },
      'ForInStatement:exit'() { loopDepth--; },
      ForOfStatement() { loopDepth++; },
      'ForOfStatement:exit'() { loopDepth--; },
      WhileStatement() { loopDepth++; },
      'WhileStatement:exit'() { loopDepth--; },
      DoWhileStatement() { loopDepth++; },
      'DoWhileStatement:exit'() { loopDepth--; },

      CallExpression(node) {
        if (loopDepth > 0) {
          if (
            node.callee.type === 'MemberExpression' &&
            node.callee.property.type === 'Identifier' &&
            (node.callee.property.name === 'provide' || node.callee.property.name === 'provideService')
          ) {
            context.report({
              node,
              messageId: 'noProvideInLoop',
            });
          }
        }
      },
    };
  },
};

// Pattern #42: Prefer Effect.gen over long chains
export const preferGenOverLongChains = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer Effect.gen over long flatMap/andThen chains',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      preferGen:
        'Consider using Effect.gen for better readability when chaining 4+ operations. See: https://effect.website/docs/getting-started/using-generators/',
    },
    schema: [],
  },
  create(context) {
    const chainMethods = ['flatMap', 'andThen', 'tap'];

    function countChainDepth(node, depth = 0) {
      if (
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        node.callee.property.type === 'Identifier' &&
        chainMethods.includes(node.callee.property.name)
      ) {
        return countChainDepth(node.callee.object, depth + 1);
      }
      return depth;
    }

    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          chainMethods.includes(node.callee.property.name)
        ) {
          const depth = countChainDepth(node);
          if (depth >= 4) {
            context.report({
              node,
              messageId: 'preferGen',
            });
          }
        }
      },
    };
  },
};

// Pattern #43: No class extends Error
export const noClassExtendsError = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow class extends Error - use Data.TaggedError instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noExtendsError:
        'Avoid "class X extends Error" - use Data.TaggedError for typed, trackable errors in Effect. See: https://effect.website/docs/error-management/expected-errors/',
    },
    schema: [],
  },
  create(context) {
    return {
      ClassDeclaration(node) {
        if (
          node.superClass &&
          node.superClass.type === 'Identifier' &&
          (node.superClass.name === 'Error' ||
           node.superClass.name === 'TypeError' ||
           node.superClass.name === 'RangeError')
        ) {
          context.report({
            node: node.superClass,
            messageId: 'noExtendsError',
          });
        }
      },
      ClassExpression(node) {
        if (
          node.superClass &&
          node.superClass.type === 'Identifier' &&
          (node.superClass.name === 'Error' ||
           node.superClass.name === 'TypeError' ||
           node.superClass.name === 'RangeError')
        ) {
          context.report({
            node: node.superClass,
            messageId: 'noExtendsError',
          });
        }
      },
    };
  },
};

// Pattern #44: No interface with _tag property
export const noInterfaceWithTag = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow interfaces with _tag property - use Schema.TaggedStruct or Data.TaggedClass',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noTagInInterface:
        'Avoid manually defining _tag in interfaces. Use Schema.TaggedStruct for schemas, Data.TaggedClass for data types, or Data.TaggedError for errors. See: https://effect.website/docs/schema/basic-usage/#discriminated-unions',
    },
    schema: [],
  },
  create(context) {
    return {
      TSInterfaceDeclaration(node) {
        if (node.body && node.body.body) {
          node.body.body.forEach((member) => {
            if (
              member.type === 'TSPropertySignature' &&
              member.key.type === 'Identifier' &&
              member.key.name === '_tag'
            ) {
              context.report({
                node: member,
                messageId: 'noTagInInterface',
              });
            }
          });
        }
      },
      TSTypeLiteral(node) {
        if (node.members) {
          node.members.forEach((member) => {
            if (
              member.type === 'TSPropertySignature' &&
              member.key.type === 'Identifier' &&
              member.key.name === '_tag'
            ) {
              context.report({
                node: member,
                messageId: 'noTagInInterface',
              });
            }
          });
        }
      },
    };
  },
};

// =============================================================================
// TIER 3: Service/Layer Pattern Rules
// =============================================================================

// Pattern #45: Prefer Context.Service over the retired v3 service constructors
export const preferContextService = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require Context.Service for service definitions; Context.Tag, Context.GenericTag, Effect.Tag and Effect.Service were all removed in Effect v4',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      preferContextService:
        '{{ctor}} was removed in Effect v4. Define the service with Context.Service instead: `Context.Service<Self, Shape>()(\'id\')` for the class form, `Context.Service<T>(\'id\')` for the function form. Note the identifier moved from the leading call to a trailing one. See: https://effect.website/docs/requirements-management/services/',
    },
    schema: [],
  },
  create(context) {
    // Context.Tag / Context.GenericTag / Effect.Tag / Effect.Service. There is no
    // autofix: the class form moves the identifier into a second call and reorders
    // the type parameters, which is a reshape rather than a rename.
    const RETIRED = {
      Context: new Set(['Tag', 'GenericTag']),
      Effect: new Set(['Tag', 'Service']),
    };
    return {
      MemberExpression(node) {
        if (
          node.computed ||
          node.object.type !== 'Identifier' ||
          node.property.type !== 'Identifier'
        ) {
          return;
        }
        const retired = RETIRED[node.object.name];
        if (!retired || !retired.has(node.property.name)) return;
        if (!hasCanonicalEffectImport(context, node.object, node.object.name)) {
          return;
        }
        context.report({
          node,
          messageId: 'preferContextService',
          data: { ctor: `${node.object.name}.${node.property.name}` },
        });
      },
    };
  },
};

// Pattern #46: Require a service identifier
export const requireServiceIdentifier = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a string identifier on Context.Service, which v4 takes in a trailing call',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      missingIdentifier:
        'Context.Service needs a string identifier for debugging: `Context.Service<Self, Shape>()("ServiceName")` or `Context.Service<T>("@app/ServiceName")`. See: https://effect.website/docs/requirements-management/services/',
    },
    schema: [],
  },
  create(context) {
    // v4 moved the identifier. `Context.Tag('id')<Self, Shape>()` read it from the
    // FIRST call; `Context.Service<Self, Shape>()('id')` reads it from the SECOND.
    // So the node to inspect is a CallExpression whose *callee* is the call on
    // Context.Service — not the member expression itself. The one-call function
    // form `Context.Service<T>('id')` is checked directly.
    const isContextService = (n) =>
      n.type === 'MemberExpression' &&
      !n.computed &&
      n.object.type === 'Identifier' &&
      n.object.name === 'Context' &&
      n.property.type === 'Identifier' &&
      n.property.name === 'Service' &&
      hasCanonicalEffectImport(context, n.object, 'Context');

    const hasStringIdentifier = (call) =>
      call.arguments.length > 0 &&
      call.arguments[0].type === 'Literal' &&
      typeof call.arguments[0].value === 'string';

    return {
      CallExpression(node) {
        // class form: Context.Service<Self, Shape>()('id')
        if (
          node.callee.type === 'CallExpression' &&
          isContextService(node.callee.callee)
        ) {
          if (!hasStringIdentifier(node)) {
            context.report({ node, messageId: 'missingIdentifier' });
          }
          return;
        }
        // function form: Context.Service<T>('id') — a direct call with args.
        // The empty inner call of the class form is skipped, since its
        // identifier lives on the outer call handled above.
        if (isContextService(node.callee)) {
          const isInnerOfClassForm =
            node.parent &&
            node.parent.type === 'CallExpression' &&
            node.parent.callee === node;
          if (isInnerOfClassForm) return;
          if (!hasStringIdentifier(node)) {
            context.report({ node, messageId: 'missingIdentifier' });
          }
        }
      },
    };
  },
};

// Pattern #47: Suggest ManagedRuntime
export const suggestManagedRuntime = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Suggest ManagedRuntime for repeated Effect.runPromise with layers',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      useManagedRuntime:
        'Consider using ManagedRuntime.make() for repeated Effect.runPromise calls with the same layers. See: https://effect.website/docs/runtime/',
    },
    schema: [],
  },
  create(context) {
    let runPromiseWithProvideCount = 0;

    return {
      Program() {
        runPromiseWithProvideCount = 0;
      },
      CallExpression(node) {
        // Match: Effect.runPromise(effect.pipe(Effect.provide(layer)))
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Effect' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'runPromise'
        ) {
          // Check if the argument contains Effect.provide
          const sourceCode = context.sourceCode ?? context.getSourceCode();
          const argText = sourceCode.getText(node.arguments[0]);
          if (argText.includes('.provide(') || argText.includes('Effect.provide')) {
            runPromiseWithProvideCount++;
            if (runPromiseWithProvideCount >= 3) {
              context.report({
                node,
                messageId: 'useManagedRuntime',
              });
            }
          }
        }
      },
    };
  },
};

// Pattern #48: No Layer with duplicate service
export const noLayerDuplicateService = {
  meta: {
    type: 'problem',
    hasSuggestions: true,
    docs: {
      description: 'Warn about potential duplicate services in Layer.merge',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      potentialDuplicate:
        'Layer.merge or Layer.mergeAll may create duplicate services - ensure layers provide distinct services. See: https://effect.website/docs/requirements-management/layers/',
      removeDuplicate:
        'Remove the exact duplicate Layer argument. Review the resulting Layer requirements.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = getSourceCode(context);

    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Layer' &&
          node.callee.property.type === 'Identifier' &&
          (node.callee.property.name === 'merge' || node.callee.property.name === 'mergeAll')
        ) {
          // Only warn if multiple arguments reference the same variable name pattern
          const argNames = node.arguments
            .filter((arg) => arg.type === 'Identifier')
            .map((arg) => arg.name);

          const duplicates = argNames.filter((name, index) =>
            argNames.findIndex((n) => n === name) !== index
          );

          if (duplicates.length > 0) {
            const duplicateIndices = node.arguments
              .map((argument, index) =>
                argument.type === 'Identifier' &&
                node.arguments
                  .slice(0, index)
                  .some(
                    (previous) =>
                      previous.type === 'Identifier' &&
                      previous.name === argument.name
                  )
                  ? index
                  : -1)
              .filter((index) => index >= 0);
            const duplicateIndex = duplicateIndices.length === 1
              ? duplicateIndices[0]
              : null;
            const method = node.callee.property.name;
            const canSuggest =
              duplicateIndex !== null &&
              hasCanonicalEffectImport(
                context,
                node.callee.object,
                'Layer'
              );
            let fix = null;
            if (
              canSuggest &&
              method === 'merge' &&
              node.arguments.length === 2 &&
              !rangeContainsComment(
                sourceCode,
                node.range[0],
                node.range[1]
              )
            ) {
              fix = (fixer) =>
                fixer.replaceText(node, node.arguments[0].name);
            } else if (canSuggest && method === 'mergeAll') {
              const duplicate = node.arguments[duplicateIndex];
              const comma = sourceCode.getTokenBefore(duplicate);
              if (
                comma?.value === ',' &&
                !rangeContainsComment(
                  sourceCode,
                  comma.range[1],
                  duplicate.range[0]
                )
              ) {
                fix = (fixer) =>
                  fixer.removeRange([comma.range[0], duplicate.range[1]]);
              }
            }
            const report = {
              node,
              messageId: 'potentialDuplicate',
            };
            if (fix) {
              report.suggest = [{
                messageId: 'removeDuplicate',
                fix,
              }];
            }
            context.report(report);
          }
        }
      },
    };
  },
};

// =============================================================================
// TIER 4: Schema-Specific Rules
// =============================================================================

// Pattern #49: Prefer Schema annotations
export const preferSchemaAnnotations = {
  meta: {
    type: 'suggestion',
    hasSuggestions: true,
    docs: {
      description: 'Suggest adding annotations to Schema definitions for debugging',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      addAnnotations:
        'Consider adding .annotate({ identifier: "Name" }) to Schema for better error messages and debugging. See: https://effect.website/docs/schema/basic-usage/',
      addIdentifierAnnotation:
        'Add the Schema identifier annotation "{{name}}". Review generated Schema metadata.',
    },
    schema: [],
  },
  create(context) {
    return {
      VariableDeclarator(node) {
        if (
          node.id.type === 'Identifier' &&
          node.init &&
          node.init.type === 'CallExpression' &&
          node.init.callee.type === 'MemberExpression' &&
          node.init.callee.object.type === 'Identifier' &&
          node.init.callee.object.name === 'Schema' &&
          node.init.callee.property.type === 'Identifier' &&
          node.init.callee.property.name === 'Struct'
        ) {
          // Check if .annotations is chained
          let parent = node.init;
          while (parent.parent && parent.parent.type === 'CallExpression') {
            parent = parent.parent;
          }
          const sourceCode = context.sourceCode ?? context.getSourceCode();
          const text = sourceCode.getText(parent);
          if (!text.includes('.annotate(')) {
            const canSuggest = hasCanonicalEffectImport(
              context,
              node.init.callee.object,
              'Schema'
            );
            const report = {
              node: node.init,
              messageId: 'addAnnotations',
            };
            if (canSuggest) {
              report.suggest = [{
                messageId: 'addIdentifierAnnotation',
                data: { name: node.id.name },
                fix: (fixer) =>
                  fixer.insertTextAfter(
                    node.init,
                    `.annotations({ identifier: ${JSON.stringify(node.id.name)} })`
                  ),
              }];
            }
            context.report(report);
          }
        }
      },
    };
  },
};

// Pattern #50: No Schema.Any or Schema.Unknown in production
export const noSchemaAnyUnknown = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Discourage Schema.Any and Schema.Unknown - use specific schemas',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noSchemaAny:
        'Avoid Schema.Any - it provides no type safety. Use a specific schema type instead. See: https://effect.website/docs/schema/basic-usage/',
      noSchemaUnknown:
        'Avoid Schema.Unknown in production code - use a specific schema for proper validation. See: https://effect.website/docs/schema/basic-usage/',
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'Schema' &&
          node.property.type === 'Identifier'
        ) {
          // v4's `Schema.fromJsonString` REQUIRES an inner schema where v3's
          // `Schema.parseJson()` took none, so `Schema.Unknown` is the only
          // faithful spelling for "parse JSON without asserting a shape". The
          // value is still validated downstream by an operation-specific schema.
          if (isUntypedJsonStringSchema(node)) return;
          if (node.property.name === 'Any') {
            context.report({ node, messageId: 'noSchemaAny' });
          } else if (node.property.name === 'Unknown') {
            context.report({ node, messageId: 'noSchemaUnknown' });
          }
        }
      },
    };
  },
};

// Pattern #51: Prefer branded types for IDs
export const preferSchemaBrand = {
  meta: {
    type: 'suggestion',
    hasSuggestions: true,
    docs: {
      description: 'Suggest branded types for ID-like fields',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      useBrand:
        'Consider using Schema.String.pipe(Schema.brand("{{name}}")) for type-safe IDs. Branded types prevent mixing different ID types. See: https://effect.website/docs/schema/basic-usage/',
      addSchemaBrand:
        'Add the Schema brand "{{name}}". Review the public field type.',
    },
    schema: [],
  },
  create(context) {
    const idPatterns = /^(id|.*Id|.*_id|uuid|.*Uuid|.*_uuid)$/;

    return {
      Property(node) {
        if (
          node.key.type === 'Identifier' &&
          idPatterns.test(node.key.name) &&
          node.value.type === 'MemberExpression' &&
          node.value.object.type === 'Identifier' &&
          node.value.object.name === 'Schema' &&
          node.value.property.type === 'Identifier' &&
          node.value.property.name === 'String'
        ) {
          // Check if .pipe(Schema.brand(...)) is already used
          const parent = node.value.parent;
          if (parent && parent.type === 'CallExpression') {
            const sourceCode = context.sourceCode ?? context.getSourceCode();
            const text = sourceCode.getText(parent);
            if (text.includes('brand(')) {
              return; // Already branded
            }
          }
          const object = node.parent;
          const structCall = object?.type === 'ObjectExpression'
            ? object.parent
            : null;
          const declaration = structCall?.type === 'CallExpression'
            ? structCall.parent
            : null;
          const namedStruct =
            structCall?.type === 'CallExpression' &&
            structCall.arguments[0] === object &&
            structCall.callee.type === 'MemberExpression' &&
            !structCall.callee.computed &&
            structCall.callee.object.type === 'Identifier' &&
            structCall.callee.object.name === 'Schema' &&
            structCall.callee.property.type === 'Identifier' &&
            structCall.callee.property.name === 'Struct' &&
            declaration?.type === 'VariableDeclarator' &&
            declaration.init === structCall &&
            declaration.id.type === 'Identifier';
          const canSuggest =
            namedStruct &&
            hasCanonicalEffectImport(
              context,
              node.value.object,
              'Schema'
            );
          const report = {
            node: node.value,
            messageId: 'useBrand',
            data: { name: node.key.name },
          };
          if (canSuggest) {
            report.suggest = [{
              messageId: 'addSchemaBrand',
              data: { name: node.key.name },
              fix: (fixer) =>
                fixer.replaceText(
                  node.value,
                  `Schema.String.pipe(Schema.brand(${JSON.stringify(node.key.name)}))`
                ),
            }];
          }
          context.report(report);
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

// Pattern retired in the v4 update: `prefer-layer-construction`.
//
// It flagged every `Effect.provideService` outside tests as manual service
// wiring. v4 made `Effect.provideService` the ONLY way to provide a
// `Context.Reference` — the mechanism that replaced `FiberRef` — and ESLint
// cannot tell a Reference from a service without type information, so the rule
// could no longer separate mandatory code from a smell.
//
// `@effect/language-service` covers the same ground WITH types, via
// `strictEffectProvide`, `multipleEffectProvide` and `missingLayerContext`.
// See AGENTS.md §"What this bundle does not cover, on purpose".

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

// Pattern #52: No String(err) in Effect.catch — loses real error messages
export const noStringErrorInCatchAll = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow String(err) or template literal ${err} inside Effect.catch — Effect wraps errors in UnknownException whose toString() returns "An unknown error occurred in Effect.try" instead of the real message. Extract the nested cause instead.',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      noStringErr:
        'String({{name}}) inside Effect.catch loses the real error message. Effect wraps errors in UnknownException/FiberFailure — use a helper to extract the nested cause (e.g. err.error?.cause?.message).',
      noTemplateLiteralErr:
        '`${{{name}}}` inside Effect.catch loses the real error message. Effect wraps errors in UnknownException/FiberFailure — use a helper to extract the nested cause.',
    },
    schema: [],
  },
  create(context) {
    // Track whether we're inside a catchAll/catchAllCause callback
    const catchAllStack = [];

    function isCatchAllCall(node) {
      return (
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        node.callee.property.type === 'Identifier' &&
        (node.callee.property.name === 'catch' || node.callee.property.name === 'catchCause') &&
        // Check it's Effect.catch or .pipe(Effect.catch(...))
        (
          (node.callee.object.type === 'Identifier' && node.callee.object.name === 'Effect') ||
          node.callee.object.type === 'CallExpression' // .pipe(...)
        )
      );
    }

    function getErrParamName(node) {
      // Effect.catch((err) => ...) — get the param name from the arrow/function
      if (node.arguments.length > 0) {
        const callback = node.arguments[node.arguments.length - 1];
        if (
          (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') &&
          callback.params.length > 0 &&
          callback.params[0].type === 'Identifier'
        ) {
          return callback.params[0].name;
        }
      }
      return null;
    }

    function isInsideCatchAll() {
      return catchAllStack.length > 0;
    }

    function getCurrentErrNames() {
      return catchAllStack.map(entry => entry.errName).filter(Boolean);
    }

    return {
      CallExpression(node) {
        if (isCatchAllCall(node)) {
          catchAllStack.push({ node, errName: getErrParamName(node) });
        }

        // Check for String(err) calls
        if (
          isInsideCatchAll() &&
          node.callee.type === 'Identifier' &&
          node.callee.name === 'String' &&
          node.arguments.length === 1 &&
          node.arguments[0].type === 'Identifier'
        ) {
          const argName = node.arguments[0].name;
          if (getCurrentErrNames().includes(argName)) {
            context.report({
              node,
              messageId: 'noStringErr',
              data: { name: argName },
            });
          }
        }
      },

      'CallExpression:exit'(node) {
        if (catchAllStack.length > 0 && catchAllStack[catchAllStack.length - 1].node === node) {
          catchAllStack.pop();
        }
      },

      TemplateLiteral(node) {
        if (!isInsideCatchAll()) return;
        const errNames = getCurrentErrNames();
        for (const expr of node.expressions) {
          if (expr.type === 'Identifier' && errNames.includes(expr.name)) {
            context.report({
              node: expr,
              messageId: 'noTemplateLiteralErr',
              data: { name: expr.name },
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
    // Original rules (Patterns 1-22)
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
    'no-zod-use-schema': noZodUseSchema,
    'no-yup-use-schema': noYupUseSchema,
    'no-effect-runsync-unguarded': noEffectRunSyncUnguarded,

    // Tier 1: Library Replacement Rules (Patterns 23-35)
    'no-fs-use-effect-fs': noFsUseEffectFs,
    'no-axios-use-httpclient': noAxiosUseHttpClient,
    'no-node-fetch-use-httpclient': noNodeFetchUseHttpClient,
    'no-moment-use-datetime': noMomentUseDatetime,
    'no-lodash-debounce-use-schedule': noLodashDebounceUseSchedule,
    'no-event-emitter-use-pubsub': noEventEmitterUsePubSub,
    'no-rxjs-use-stream': noRxjsUseStream,
    'no-crypto-random-use-random': noCryptoRandomUseRandom,
    'no-ajv-use-schema': noAjvUseSchema,
    'no-joi-use-schema': noJoiUseSchema,
    'no-class-validator-use-schema': noClassValidatorUseSchema,
    'no-io-ts-use-schema': noIoTsUseSchema,
    'no-superstruct-use-schema': noSuperstructUseSchema,

    // Tier 2: Heuristic Pattern Detection (Patterns 36-44)
    'prefer-redacted-for-secrets': preferRedactedForSecrets,
    'prefer-duration-literals': preferDurationLiterals,
    'prefer-pipe-method': preferPipeMethod,
    'no-andthen-with-async': noAndThenWithAsync,
    'suggest-batching-option': suggestBatchingOption,
    'no-provide-in-loop': noProvideInLoop,
    'prefer-gen-over-long-chains': preferGenOverLongChains,
    'no-class-extends-error': noClassExtendsError,
    'no-interface-with-tag': noInterfaceWithTag,

    // Tier 3: Service/Layer Pattern Rules (Patterns 45-48)
    'prefer-context-service': preferContextService,
    'require-service-identifier': requireServiceIdentifier,
    'suggest-managed-runtime': suggestManagedRuntime,
    'no-layer-duplicate-service': noLayerDuplicateService,

    // Tier 4: Schema-Specific Rules (Patterns 49-51)
    'prefer-schema-annotations': preferSchemaAnnotations,
    'no-schema-any-unknown': noSchemaAnyUnknown,
    'prefer-schema-brand': preferSchemaBrand,

    // Pattern #52: Error Message Preservation
    'no-string-error-in-catchall': noStringErrorInCatchAll,
  },
};
