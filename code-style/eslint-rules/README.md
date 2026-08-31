# ESLint rules

This folder contains the project ESLint rules and the canonical Effect lint bundle. The rules protect dependency boundaries, configuration rules, and Effect programming conventions that TypeScript cannot prove.

Start with `index.mjs` to see the plugin exports. Start with `effect-eslint-config.mjs` to apply the complete Effect policy. Change `effect-rules.mjs` only when the user-wide TypeScript guidance also changes.

Keep rule reports specific and keep automatic fixes narrow. A rule must not change program behaviour or demand a risky Effect conversion without a reviewable suggestion.
