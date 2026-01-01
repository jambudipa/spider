/**
 * JSON/Config File ESLint Rules
 *
 * These rules enforce TypeScript Project References architecture and
 * other JSON configuration constraints.
 */

// Disallow paths in tsconfig.base.json
export const noTsconfigPaths = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow "paths" in tsconfig.base.json - enforce TypeScript Project References',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noPaths:
        'ILLEGAL: "paths" in tsconfig.base.json conflicts with TypeScript Project References. This monorepo uses Project References (NOT Path Mappings). Libraries are linked via package.json exports and pnpm workspaces. TypeScript project references are managed by "npx nx sync". Applications CAN have local path aliases in apps/*/tsconfig.json, but tsconfig.base.json must NOT. See: docs/nx.md',
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();

    if (!filename.match(/tsconfig\.base\.json$/)) {
      return {};
    }

    return {
      JSONProperty(node) {
        if (
          node.key &&
          node.key.type === 'JSONLiteral' &&
          node.key.value === 'paths'
        ) {
          context.report({
            node: node.key,
            messageId: 'noPaths',
          });
        }
      },
    };
  },
};

// Enforce composite and declaration in tsconfig.base.json
export const enforceTsconfigBaseComposite = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce "composite: true" and "declaration: true" in tsconfig.base.json',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      missingComposite:
        'REQUIRED: tsconfig.base.json must have "composite": true for TypeScript Project References. This enables incremental compilation and proper type checking. See: docs/nx.md',
      missingDeclaration:
        'REQUIRED: tsconfig.base.json must have "declaration": true for TypeScript Project References. This generates .d.ts files needed for proper type resolution. See: docs/nx.md',
      wrongCompositeValue:
        'REQUIRED: "composite" must be true (not false) in tsconfig.base.json for TypeScript Project References. See: docs/nx.md',
      wrongDeclarationValue:
        'REQUIRED: "declaration" must be true (not false) in tsconfig.base.json for TypeScript Project References. See: docs/nx.md',
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();

    if (!filename.match(/tsconfig\.base\.json$/)) {
      return {};
    }

    let hasComposite = false;
    let hasDeclaration = false;
    let compositeValue = null;
    let declarationValue = null;

    return {
      JSONProperty(node) {
        if (!node.key || node.key.type !== 'JSONLiteral') {
          return;
        }

        if (node.key.value === 'composite') {
          hasComposite = true;
          if (node.value.type === 'JSONLiteral') {
            compositeValue = node.value.value;
            if (compositeValue === false) {
              context.report({
                node: node.value,
                messageId: 'wrongCompositeValue',
              });
            }
          }
        }

        if (node.key.value === 'declaration') {
          hasDeclaration = true;
          if (node.value.type === 'JSONLiteral') {
            declarationValue = node.value.value;
            if (declarationValue === false) {
              context.report({
                node: node.value,
                messageId: 'wrongDeclarationValue',
              });
            }
          }
        }
      },
      'Program:exit'(node) {
        if (!hasComposite || compositeValue !== true) {
          context.report({
            node,
            messageId: 'missingComposite',
          });
        }
        if (!hasDeclaration || declarationValue !== true) {
          context.report({
            node,
            messageId: 'missingDeclaration',
          });
        }
      },
    };
  },
};

// Enforce outDir in library tsconfig.lib.json
export const enforceLibOutdir = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce "outDir": "./out-tsc/lib" in library tsconfig.lib.json files',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      wrongOutDir:
        'CRITICAL: Library tsconfig.lib.json must use "outDir": "./out-tsc/lib" NOT "{{actual}}". Package.json exports expect output in out-tsc/lib/. Using dist/ or other directories breaks module resolution. See: docs/nx.md',
      missingOutDir:
        'REQUIRED: Library tsconfig.lib.json must specify "outDir": "./out-tsc/lib". This is required for package.json exports to work correctly. See: docs/nx.md',
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();

    if (!filename.match(/libs\/[^/]+\/tsconfig\.lib\.json$/)) {
      return {};
    }

    let hasOutDir = false;
    let outDirValue = null;

    return {
      JSONProperty(node) {
        if (!node.key || node.key.type !== 'JSONLiteral') {
          return;
        }

        if (node.key.value === 'outDir') {
          hasOutDir = true;
          if (node.value.type === 'JSONLiteral') {
            outDirValue = node.value.value;
            if (outDirValue !== './out-tsc/lib') {
              context.report({
                node: node.value,
                messageId: 'wrongOutDir',
                data: {
                  actual: outDirValue,
                },
              });
            }
          }
        }
      },
      'Program:exit'(node) {
        if (!hasOutDir || outDirValue !== './out-tsc/lib') {
          context.report({
            node,
            messageId: 'missingOutDir',
          });
        }
      },
    };
  },
};

// Disallow batch in nx.json
export const noBatchInNxJson = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow "batch: true" in nx.json targetDefaults - must use --batch flag',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noBatchInConfig:
        'INVALID: Setting "batch": true in nx.json does NOT work. Batch mode must be enabled via --batch flag when running commands (e.g., "nx build mylib --batch"). Remove this property. See: docs/nx.md',
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();

    if (!filename.match(/nx\.json$/)) {
      return {};
    }

    return {
      JSONProperty(node) {
        if (!node.key || node.key.type !== 'JSONLiteral') {
          return;
        }

        if (node.key.value === 'batch') {
          context.report({
            node: node.key,
            messageId: 'noBatchInConfig',
          });
        }
      },
    };
  },
};

/**
 * All JSON rules as a plugin object
 */
export const jsonRulesPlugin = {
  rules: {
    'no-tsconfig-paths': noTsconfigPaths,
    'enforce-tsconfig-base-composite': enforceTsconfigBaseComposite,
    'enforce-lib-outdir': enforceLibOutdir,
    'no-batch-in-nx-json': noBatchInNxJson,
  },
};
