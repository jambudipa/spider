# Bug: npm publish missing .d.ts type declarations

## Problem

The published npm package (`@jambudipa/spider@0.2.1` and `0.2.2`) does not include `.d.ts` type declaration files. The tarball only contains:

- `dist/index.js`
- `dist/index.js.map`

Despite `package.json` declaring `"types": "./dist/index.d.ts"`, the file is absent.

## Root Cause

The `build` script uses Vite (`vite build`), which only emits `.js` and `.js.map` files. TypeScript's `declaration: true` in `tsconfig.json` is ignored by Vite's bundler.

The `prepublishOnly` script runs `npm run clean && npm run build`, which only runs the Vite build - no `tsc` step to generate declarations.

## Fix

Update the `build` script to also generate declarations after the Vite bundle:

```json
"build": "vite build && tsc -p tsconfig.build.json --emitDeclarationOnly"
```

Where `tsconfig.build.json` excludes test files:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "src/test"]
}
```

Note: `tsconfig.build.json` already exists in the repo.

## Additional Issue

The npm auth token is expired, so republishing requires `npm login` first.
