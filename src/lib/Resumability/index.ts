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
 * - **Effect.js Native**: Full integration with Effect.js ecosystem
 * - **Type Safe**: Complete TypeScript support with runtime validation
 * - **Production Ready**: Handles concurrency, errors, and edge cases
 *
 * ## Quick Start
 *
 * ```typescript
 * import { ResumabilityService, ResumabilityConfigs } from '@jambudipa.io/spider/resumability';
 *
 * // File-based resumability
 * const resumabilityLayer = ResumabilityService.fromConfig(
 *   ResumabilityConfigs.file('./spider-state', 'hybrid')
 * );
 *
 * // Use with Spider
 * const program = Effect.gen(function* () {
 *   const spider = yield* Spider;
 *   const resumability = yield* ResumabilityService;
 *
 *   // Configure resumable crawling...
 * });
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(Spider.Default),
 *     Effect.provide(resumabilityLayer)
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
