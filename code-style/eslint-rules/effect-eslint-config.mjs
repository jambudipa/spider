/**
 * Canonical Effect ESLint configuration for the TypeScript guidance bundle.
 *
 * Import `effectLintConfig` into a project's flat ESLint config. It enables the
 * exact canonical Effect rule implementation in `effect-rules.mjs` for the passed
 * runtime TypeScript globs.
 */
import { effectRulesPlugin } from './effect-rules.mjs';

/** Enables every bundled rule so projects cannot accidentally omit one from the canonical policy. */
export const enableAllEffectRules = () =>
  Object.fromEntries(
    Object.keys(effectRulesPlugin.rules).map((name) => [`effect/${name}`, 'error'])
  );

/** Builds the flat ESLint block that applies the full Effect policy to the selected runtime files. */
export const effectLintConfig = (files = ['src/**/*.ts']) => ({
  files,
  plugins: { effect: effectRulesPlugin },
  rules: enableAllEffectRules(),
});
