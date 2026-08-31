/**
 * Resumable spider crawling with configurable persistence strategies.
 *
 * This module provides a complete solution for resumable web crawling with
 * support for different persistence strategies and storage backends.
 *
 * ## Key Features
 *
 * - **Multiple Strategies**: Full state, delta, hybrid, and auto-selection
 * - **Multiple Backends**: File system, Redis, PostgreSQL with extensible interface
 * - **Effect Native**: Full integration with Effect ecosystem
 * - **Type Safe**: Complete TypeScript support with runtime validation
 * - **Production Ready**: Handles concurrency, errors, and edge cases
 *
 * ## Quick Start
 *
 * ```typescript
 * import { Effect, Layer } from 'effect';
 * import {
 *   ResumabilityConfigs,
 *   ResumabilityService,
 *   SpiderConfig,
 *   SpiderSchedulerService,
 *   SpiderService,
 * } from '@jambudipa/spider';
 *
 * // File-based resumability
 * const resumabilityLayer = Layer.effect(
 *   ResumabilityService,
 *   ResumabilityService.fromConfig(
 *     ResumabilityConfigs.file('./spider-state', 'hybrid')
 *   )
 * );
 *
 * const spiderLayer = SpiderService.layer.pipe(
 *   Layer.provideMerge(
 *     Layer.mergeAll(
 *       SpiderConfig.layerWith({ enableResumability: true }),
 *       SpiderSchedulerService.layer,
 *       resumabilityLayer
 *     )
 *   )
 * );
 *
 * // Use the services in an Effect program.
 * const program = Effect.gen(function* () {
 *   const spider = yield* SpiderService;
 *   const resumability = yield* ResumabilityService;
 *
 *   const info = yield* resumability.getInfo();
 *   console.log(info.backend.name);
 *   // Call `spider.resume(stateKey, sink)` after scheduler persistence restores state.
 * });
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(spiderLayer)
 *   )
 * );
 * ```
 *
 * @group Resumability
 * @public
 */

// Core types and interfaces
export type {
  StorageBackend,
  StorageCapabilities,
  PersistenceStrategy,
  StateOperation,
  HybridPersistenceConfig,
} from './types.js';

export {
  StateDelta,
  PersistenceError,
  DEFAULT_HYBRID_CONFIG,
} from './types.js';

// Persistence strategies
export {
  FullStatePersistence,
  DeltaPersistence,
  HybridPersistence,
} from './strategies.js';

// Storage backends
export { FileStorageBackend } from './backends/FileStorageBackend.js';
export {
  RedisStorageBackend,
  type RedisClientInterface,
  type RedisPipeline,
  type RedisMulti,
} from './backends/RedisStorageBackend.js';
export {
  PostgresStorageBackend,
  type DatabaseClientInterface,
  type PostgresStorageConfig,
} from './backends/PostgresStorageBackend.js';

// Main service
export {
  ResumabilityService,
  ResumabilityConfigs,
  createStateOperation,
  type ResumabilityConfig,
} from './Resumability.service.js';
