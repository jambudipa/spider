/**
 * ESLint Rules Index
 *
 * Re-exports all custom ESLint rules and plugins.
 */

// Effect idiomatic rules
export {
  effectRulesPlugin,
  noAsyncAwaitUseEffect,
  noPromiseConstructor,
  noPromiseResolveReject,
  noPromiseThenCatch,
  noNullUseOption,
  noUndefinedUseOption,
  noThrowUseEffect,
  noTryCatchUseEffect,
  noErrorConstructorUseData,
  noNewDateUseDateTime,
  noDateStaticUseDateTime,
  noArrayMutationUseChunk,
  noSetUseHashSet,
  noMapUseHashMap,
  noJsonParseUseSchema,
  noJsonStringifyUseSchema,
  noManualTag,
  noMathRandomUseRandom,
  noConsoleUseEffect,
  noProcessEnvUseConfig,
  noSetTimeoutUseSchedule,
} from './effect-rules.mjs';

// Custom project-specific rules
export {
  customRulesPlugin,
  noUnnecessarySchemaAlias,
  noDatabaseAccess,
  noDirectFetch,
  noTypeAssertion,
} from './custom-rules.mjs';

// JSON/config file rules
export {
  jsonRulesPlugin,
  noTsconfigPaths,
  enforceTsconfigBaseComposite,
  enforceLibOutdir,
  noBatchInNxJson,
} from './json-rules.mjs';
