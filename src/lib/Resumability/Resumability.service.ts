import { Effect } from 'effect';
import {
  SpiderState,
  SpiderStateKey,
} from '../Scheduler/SpiderScheduler.service.js';
import {
  DEFAULT_HYBRID_CONFIG,
  HybridPersistenceConfig,
  PersistenceError,
  PersistenceStrategy,
  StateDelta,
  StateOperation,
  StorageBackend,
} from './types.js';
import {
  DeltaPersistence,
  FullStatePersistence,
  HybridPersistence,
} from './strategies.js';

/**
 * Configuration for the ResumabilityService.
 *
 * Allows choosing between different persistence strategies and
 * configuring their behavior based on use case requirements.
 *
 * @group Configuration
 * @public
 */
export interface ResumabilityConfig {
  /** Persistence strategy to use */
  strategy: 'full-state' | 'delta' | 'hybrid' | 'auto';
  /** Storage backend implementation */
  backend: StorageBackend;
  /** Configuration for hybrid strategy (only used when strategy is 'hybrid') */
  hybridConfig?: HybridPersistenceConfig;
}

/**
 * Service for resumable spider crawling with configurable persistence strategies.
 *
 * Provides a unified interface for different persistence approaches:
 * - Full state: Simple, saves complete state on every change
 * - Delta: Efficient, saves only incremental changes
 * - Hybrid: Best of both worlds, deltas + periodic snapshots
 * - Auto: Automatically chooses best strategy based on backend capabilities
 *
 * @example
 * ```typescript
 * // File-based full state persistence
 * const resumabilityLayer = ResumabilityService.fromConfig({
 *   strategy: 'full-state',
 *   backend: new FileStorageBackend('./spider-state')
 * });
 *
 * // Redis-based hybrid persistence
 * const resumabilityLayer = ResumabilityService.fromConfig({
 *   strategy: 'hybrid',
 *   backend: new RedisStorageBackend(redisClient),
 *   hybridConfig: {
 *     snapshotInterval: 1000,
 *     maxDeltasBeforeSnapshot: 500
 *   }
 * });
 *
 * // Auto-selected strategy based on backend
 * const resumabilityLayer = ResumabilityService.fromConfig({
 *   strategy: 'auto',
 *   backend: new PostgresStorageBackend(pgClient)
 * });
 * ```
 *
 * @group Services
 * @public
 */
export class ResumabilityService extends Effect.Service<ResumabilityService>()(
  '@jambudipa.io/ResumabilityService',
  {
    effect: Effect.gen(function* () {
      // Will be set during configuration
      let strategy: PersistenceStrategy | null = null;
      let backend: StorageBackend | null = null;

      const service = {
        /**
         * Configure the resumability service with a specific strategy and backend.
         *
         * This method initializes the storage backend and creates the appropriate
         * persistence strategy based on the configuration.
         *
         * @param config - Resumability configuration
         * @returns Effect that completes when configuration is applied
         */
        configure: (config: ResumabilityConfig) =>
          Effect.gen(function* () {
            backend = config.backend;

            // Initialize the backend
            yield* backend.initialize();

            // Create the appropriate strategy
            strategy = yield* createStrategy(config);
          }),

        /**
         * Persist a state operation using the configured strategy.
         *
         * @param operation - State operation to persist
         * @returns Effect that completes when operation is persisted
         */
        persistOperation: (operation: StateOperation) =>
          Effect.gen(function* () {
            if (!strategy) {
              return yield* Effect.fail(
                new PersistenceError({
                  message:
                    'ResumabilityService not configured. Call configure() first.',
                  operation: 'persistOperation',
                })
              );
            }

            yield* strategy.persist(operation);
          }),

        /**
         * Restore spider state from persistent storage.
         *
         * @param key - State key identifying the session to restore
         * @returns Effect containing the restored state, or null if not found
         */
        restore: (key: SpiderStateKey) =>
          Effect.gen(function* () {
            if (!strategy) {
              return yield* Effect.fail(
                new PersistenceError({
                  message:
                    'ResumabilityService not configured. Call configure() first.',
                  operation: 'restore',
                })
              );
            }

            return yield* strategy.restore(key);
          }),

        /**
         * Clean up old state data for a session.
         *
         * @param key - State key identifying the session to clean up
         * @returns Effect that completes when cleanup is finished
         */
        cleanup: (key: SpiderStateKey) =>
          Effect.gen(function* () {
            if (!strategy) {
              return yield* Effect.fail(
                new PersistenceError({
                  message:
                    'ResumabilityService not configured. Call configure() first.',
                  operation: 'cleanup',
                })
              );
            }

            yield* strategy.cleanup(key);
          }),

        /**
         * List all available sessions in storage.
         *
         * @returns Effect containing array of session keys
         */
        listSessions: () =>
          Effect.gen(function* () {
            if (!backend) {
              return yield* Effect.fail(
                new PersistenceError({
                  message:
                    'ResumabilityService not configured. Call configure() first.',
                  operation: 'listSessions',
                })
              );
            }

            if (!backend.listSessions) {
              return yield* Effect.fail(
                new PersistenceError({
                  message: `Backend ${backend.name} does not support listing sessions`,
                  operation: 'listSessions',
                })
              );
            }

            return yield* backend.listSessions();
          }),

        /**
         * Get information about the current configuration.
         *
         * @returns Information about strategy and backend
         */
        getInfo: () =>
          Effect.gen(function* () {
            if (!strategy || !backend) {
              return yield* Effect.fail(
                new PersistenceError({
                  message:
                    'ResumabilityService not configured. Call configure() first.',
                  operation: 'getInfo',
                })
              );
            }

            return {
              strategy: strategy.getInfo(),
              backend: {
                name: backend.name,
                capabilities: backend.capabilities,
              },
            };
          }),

        /**
         * Reconfigure the service with new settings.
         *
         * This will clean up the current backend and reinitialize with new config.
         *
         * @param config - New configuration
         * @returns Effect that completes when reconfiguration is finished
         */
        reconfigure: (config: ResumabilityConfig) =>
          Effect.gen(function* () {
            // Clean up current backend if exists
            if (backend) {
              yield* backend.cleanup();
            }

            // Apply new configuration
            yield* service.configure(config);
          }),
      };

      return service;
    }),
  }
) {
  /**
   * Create a ResumabilityService layer from configuration.
   *
   * This is the primary way to create and configure the ResumabilityService.
   *
   * @param config - Resumability configuration
   * @returns Effect layer providing the configured ResumabilityService
   */
  static fromConfig = (config: ResumabilityConfig) =>
    Effect.gen(function* () {
      const service = yield* ResumabilityService;
      yield* service.configure(config);
      return service;
    }).pipe(Effect.provide(ResumabilityService.Default));
}

/**
 * Create a persistence strategy based on configuration.
 *
 * @param config - Resumability configuration
 * @returns Effect containing the created strategy
 */
const createStrategy = (
  config: ResumabilityConfig
): Effect.Effect<PersistenceStrategy, PersistenceError> =>
  Effect.gen(function* () {
    const { strategy: strategyType, backend, hybridConfig } = config;

    switch (strategyType) {
      case 'full-state':
        return new FullStatePersistence(backend);

      case 'delta':
        return new DeltaPersistence(backend);

      case 'hybrid':
        return new HybridPersistence(
          backend,
          hybridConfig || DEFAULT_HYBRID_CONFIG
        );

      case 'auto':
        // Automatically choose best strategy based on backend capabilities
        const capabilities = backend.capabilities;

        if (capabilities.supportsDelta && capabilities.supportsSnapshot) {
          // Backend supports both - use hybrid for best performance
          return new HybridPersistence(
            backend,
            hybridConfig || DEFAULT_HYBRID_CONFIG
          );
        } else if (capabilities.supportsDelta) {
          // Backend supports deltas - use delta strategy
          return new DeltaPersistence(backend);
        } else {
          // Fall back to full state
          return new FullStatePersistence(backend);
        }

      default:
        return yield* Effect.fail(
          new PersistenceError({
            message: `Unknown strategy type: ${strategyType}`,
            operation: 'createStrategy',
          })
        );
    }
  });

/**
 * Utility function to create a state operation.
 *
 * @param delta - The delta operation
 * @param resultingState - The complete state after applying the delta
 * @param shouldSnapshot - Whether this operation should trigger a snapshot
 * @returns StateOperation object
 */
export const createStateOperation = (
  delta: StateDelta,
  resultingState: SpiderState,
  shouldSnapshot = false
): StateOperation => ({
  delta,
  resultingState,
  shouldSnapshot,
});

/**
 * Factory functions for creating common resumability configurations.
 */
export const ResumabilityConfigs = {
  /**
   * Create a file-based configuration.
   *
   * @param baseDir - Directory to store state files
   * @param strategy - Persistence strategy (defaults to 'auto')
   * @returns ResumabilityConfig
   */
  file: (
    baseDir: string,
    strategy: 'full-state' | 'delta' | 'hybrid' | 'auto' = 'auto'
  ): ResumabilityConfig => ({
    strategy,
    backend:
      new (require('./backends/FileStorageBackend.js').FileStorageBackend)(
        baseDir
      ),
  }),

  /**
   * Create a Redis-based configuration.
   *
   * @param redisClient - Redis client instance
   * @param strategy - Persistence strategy (defaults to 'hybrid')
   * @param keyPrefix - Redis key prefix (defaults to 'spider')
   * @returns ResumabilityConfig
   */
  redis: (
    redisClient: import('./backends/RedisStorageBackend.js').RedisClientInterface,
    strategy: 'full-state' | 'delta' | 'hybrid' | 'auto' = 'hybrid',
    keyPrefix = 'spider'
  ): ResumabilityConfig => ({
    strategy,
    backend:
      new (require('./backends/RedisStorageBackend.js').RedisStorageBackend)(
        redisClient,
        keyPrefix
      ),
  }),

  /**
   * Create a PostgreSQL-based configuration.
   *
   * @param dbClient - Database client instance
   * @param strategy - Persistence strategy (defaults to 'hybrid')
   * @param config - PostgreSQL configuration
   * @returns ResumabilityConfig
   */
  postgres: (
    dbClient: import('./backends/PostgresStorageBackend.js').DatabaseClientInterface,
    strategy: 'full-state' | 'delta' | 'hybrid' | 'auto' = 'hybrid',
    config?: import('./backends/PostgresStorageBackend.js').PostgresStorageConfig
  ): ResumabilityConfig => ({
    strategy,
    backend:
      new (require('./backends/PostgresStorageBackend.js').PostgresStorageBackend)(
        dbClient,
        config
      ),
  }),
};
