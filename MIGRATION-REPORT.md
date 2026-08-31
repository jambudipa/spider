# Effect v4 migration report

## Provenance

- Target branch: `codex/migrate-effect-v4`
- Effect dist-tag: `rc`
- Effect version: `4.0.0-rc.112`
- Rename-map base: `7c6e1e5d2ac9dfe00649a65fa80a61dcc14d55ae`
- Rename-map head: `f356bc2da6abb4dee05b8c22fb597af3823e2ef7`
- Upstream data fetched: `2026-08-31T07:40:34Z`

## Dependency plan

- Pin `effect` at `4.0.0-rc.112`.
- Pin TypeScript at `6.0.3`.
- The TypeScript cap is `<6.1.0` from `typescript-eslint` and `@typescript-eslint/*`.
- No Effect package was consolidated into the core package.
- No `effect/unstable/*` import exists before the migration.

## Baseline

- `npx tsc --noEmit` reports two `TS2345` errors in `src/test/unit/core/InterruptOnStop.test.ts`.
- `npm run test:run` passed: 44 test files, 519 tests, and one todo test.
- The canonical Effect lint bundle is v4. It targets `4.0.0-rc.112`.

## Completed migration

- The project now uses `effect@4.0.0-rc.112` in peer and development dependencies.
- The project now uses TypeScript `6.0.3`.
- The migration adds `@effect/language-service@^0.87.2` and enables it in `tsconfig.json`.
- The migration removes TypeScript 6 deprecations from the project, test, and example compiler commands.
- The migration converts Effect services to `Context.Service` and gives every service an explicit v4 layer.
- The migration updates removed Effect, Schema, Result, DateTime, Stream, Schedule, Semaphore, and concurrency APIs.
- The migration updates examples and test helpers with the same v4 APIs.

## Runtime compatibility decisions

- `SpiderService` builds a fresh `UrlDeduplicatorService` for each `crawlSingle` call. The mutable set cannot cross a domain boundary.
- The result queue now uses `Cause.Done` and `Queue.end` on normal completion. In v4, `Queue.shutdown` interrupts `Stream.fromQueue` consumers.
- Cancellation paths still use `Queue.shutdown` so blocked producers release promptly.
- The project has no `effect/unstable/*` import or public unstable Effect API exposure.
- The import scan reports `@effect/schema` only in an ESLint diagnostic string. It is not a package import or a dependency decision.

## Linting

- The repository carries the canonical v4 Effect rule bundle unchanged from the user guidance source.
- The lint gate follows the canonical Vadz layout. It runs ESLint and Effect diagnostics independently.
- `npm run lint:eslint` runs `eslint . --max-warnings=0`.
- `npm run lint:effect` blocks Effect errors and warnings under `--strict`.
- `npm run lint:effect:all` also blocks Effect messages.
- `npm run lint` and `npm run lint:effect:all` report zero errors, warnings, and messages across 120 files.

## Validation

- `npm run typecheck` passes.
- `npm run typecheck:test` passes.
- `npm run typecheck:examples` passes.
- `npm run lint` passes with zero diagnostics.
- `npm run lint:effect:all` passes with zero diagnostics.
- `npm run test:run` passes: 44 test files, 523 tests, and one todo test.
- `npm run build` passes.
- `npm run docs:build` passes with zero errors and 88 documentation warnings.
- `npm run ci:validate` passes, including its optional scenario tests.

## Remaining decisions

No Effect v4 migration or lint decision remains. The documentation warnings are non-blocking maintenance work outside this migration.
