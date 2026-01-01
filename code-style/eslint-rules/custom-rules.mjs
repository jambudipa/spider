/**
 * Custom Project-Specific ESLint Rules
 *
 * These rules enforce project-specific patterns and constraints.
 */

// Schema import alias rule
export const noUnnecessarySchemaAlias = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow aliasing Schema import (e.g., "Schema as S")',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noSchemaAlias:
        'Avoid aliasing Schema import. Use "import { Schema } from \'effect\'" instead of "import { Schema as {{alias}} } from \'effect\'".',
    },
    fixable: 'code',
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();

    return {
      ImportDeclaration(node) {
        const importPath = node.source.value;

        if (importPath !== 'effect') {
          return;
        }

        node.specifiers.forEach((specifier) => {
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'Schema' &&
            specifier.local.name !== 'Schema'
          ) {
            const aliasName = specifier.local.name;

            context.report({
              node: specifier,
              messageId: 'noSchemaAlias',
              data: {
                alias: aliasName,
              },
              *fix(fixer) {
                yield fixer.replaceText(specifier, 'Schema');

                const text = sourceCode.getText();
                const aliasRegex = new RegExp(`\\b${aliasName}\\.`, 'g');
                let match;

                while ((match = aliasRegex.exec(text)) !== null) {
                  const start = match.index;
                  const end = start + aliasName.length;
                  yield fixer.replaceTextRange([start, end], 'Schema');
                }
              },
            });
          }
        });
      },
    };
  },
};

// Database access boundary rule
export const noDatabaseAccess = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow direct database pool imports outside libs/database',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noPgImport:
        'Direct pg imports not allowed. Use repositories from @jambudipa.io/database instead.',
      noDatabasePool:
        'DatabasePool is internal to libs/database. Use repository services instead.',
      noManagedPool:
        'ManagedDatabasePool is internal to libs/database. Use repository services instead.',
      noPoolQuery:
        'Direct pool.query() or client.query() not allowed. Use repository methods instead.',
    },
    schema: [],
  },
  create(context) {
    const filePath = context.getFilename();
    const isInDatabase = filePath.includes('libs/database/');
    const isTestFile =
      filePath.includes('.test.') || filePath.includes('.spec.');
    const isCodegen = filePath.includes('db/db-codegen/') || filePath.includes('scripts/db-codegen/');

    if (isInDatabase || isTestFile || isCodegen) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        const importPath = node.source.value;

        if (importPath === 'pg' || importPath.startsWith('pg/')) {
          context.report({
            node,
            messageId: 'noPgImport',
          });
        }

        if (
          importPath === '@neondatabase/serverless' ||
          importPath.startsWith('@neondatabase/serverless/')
        ) {
          context.report({
            node,
            messageId: 'noPgImport',
          });
        }

        if (importPath.includes('@jambudipa.io/database')) {
          node.specifiers.forEach((specifier) => {
            const importedName = specifier.imported?.name;
            if (importedName === 'DatabasePool') {
              context.report({
                node: specifier,
                messageId: 'noDatabasePool',
              });
            }
            if (importedName === 'ManagedDatabasePool') {
              context.report({
                node: specifier,
                messageId: 'noManagedPool',
              });
            }
          });
        }
      },

      MemberExpression(node) {
        if (
          node.property.type === 'Identifier' &&
          node.property.name === 'query' &&
          node.object.type === 'Identifier' &&
          (node.object.name === 'pool' || node.object.name === 'client')
        ) {
          context.report({
            node,
            messageId: 'noPoolQuery',
          });
        }
      },
    };
  },
};

// Direct fetch rule for UI app
export const noDirectFetch = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow direct fetch() calls in UI app - use Effect HttpApi client instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noDirectFetch:
        'Direct fetch() calls are forbidden in the UI app. Use the Effect HttpApi client via useHttpApi() hooks (e.g., useSearchGroup().useSearchBooksMutation()) or HttpApiClient.make() for non-React contexts. The HttpApi client properly uses the baseUrl from ApiProvider which includes the production API URL.',
    },
    schema: [],
  },
  create(context) {
    const filePath = context.getFilename();

    if (!filePath.includes('apps/ui/')) {
      return {};
    }

    if (filePath.includes('effect-httpapi.ts')) {
      return {};
    }

    if (filePath.includes('streaming-client.tsx')) {
      return {};
    }

    return {
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'fetch'
        ) {
          context.report({
            node,
            messageId: 'noDirectFetch',
          });
        }
      },
    };
  },
};

// Type assertion rule
export const noTypeAssertion = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow "as" type assertions - use type-safe alternatives instead',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noAsAssertion:
        'Avoid "as" type assertions - they bypass TypeScript\'s type checking and can hide type errors. Use type-safe alternatives: Schema.decodeUnknown for runtime validation, user-defined type guards (isX(value)), proper generic typing, or if truly necessary, add an eslint-disable comment with a detailed justification explaining why type-safe alternatives are not possible.',
      noAngleBracketAssertion:
        'Avoid angle-bracket type assertions (<Type>value) - they bypass TypeScript\'s type checking. Use type-safe alternatives: Schema.decodeUnknown for runtime validation, user-defined type guards, or proper generic typing.',
    },
    schema: [],
  },
  create(context) {
    /**
     * Checks if the node is inside an XState setup() types property.
     * XState v5 requires `types: {} as MachineTypes` pattern for TypeScript inference.
     * This is the documented, canonical pattern with no type-safe alternative.
     *
     * Pattern: setup({ types: {} as SomeType, ... })
     */
    function isXStateSetupTypes(node) {
      let current = node.parent;
      while (current) {
        if (
          current.type === 'Property' &&
          current.key.type === 'Identifier' &&
          current.key.name === 'types'
        ) {
          const objectExpr = current.parent;
          if (objectExpr && objectExpr.type === 'ObjectExpression') {
            const callExpr = objectExpr.parent;
            if (
              callExpr &&
              callExpr.type === 'CallExpression' &&
              callExpr.callee.type === 'Identifier' &&
              callExpr.callee.name === 'setup'
            ) {
              return true;
            }
          }
        }
        current = current.parent;
      }
      return false;
    }

    return {
      TSAsExpression(node) {
        // Allow "as const" assertions - these are safe and useful for literal types
        if (
          node.typeAnnotation.type === 'TSTypeReference' &&
          node.typeAnnotation.typeName.type === 'Identifier' &&
          node.typeAnnotation.typeName.name === 'const'
        ) {
          return;
        }
        // Allow XState setup() types pattern - required by XState v5 for TypeScript inference
        if (isXStateSetupTypes(node)) {
          return;
        }
        context.report({
          node,
          messageId: 'noAsAssertion',
        });
      },
      TSTypeAssertion(node) {
        context.report({
          node,
          messageId: 'noAngleBracketAssertion',
        });
      },
    };
  },
};

/**
 * All custom rules as a plugin object
 */
export const customRulesPlugin = {
  rules: {
    'no-unnecessary-schema-alias': noUnnecessarySchemaAlias,
    'no-direct-database-access': noDatabaseAccess,
    'no-direct-fetch': noDirectFetch,
    'no-type-assertion': noTypeAssertion,
  },
};
