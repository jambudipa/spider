import { Effect, MutableHashMap, Queue, Schema } from 'effect';
import { CrawlTask } from '../Spider/Spider.service.js';
import { ConfigurationError } from '../errors.js';
import { SpiderConfig } from '../Config/SpiderConfig.service.js';

/**
 * Unique identifier for a spider crawling session.
 *
 * Used to identify and restore specific crawl sessions when using
 * persistent storage. Each crawl session should have a unique key.
 *
 * @group Data Types
 * @public
 */
export class SpiderStateKey extends Schema.Class<SpiderStateKey>(
  'SpiderStateKey'
)({
  /** Unique identifier for the session */
  id: Schema.String,
  /** When the session was created */
  timestamp: Schema.Date,
  /** Human-readable name for the session */
  name: Schema.String,
}) {}

/**
 * A crawl request with priority and metadata for scheduling.
 *
 * Requests are processed in priority order (higher numbers first),
 * with FIFO ordering within the same priority level.
 *
 * @group Data Types
 * @public
 */
export class PriorityRequest extends Schema.Class<PriorityRequest>(
  'PriorityRequest'
)({
  /** The crawl task containing URL and depth information */
  request: Schema.Struct({
    url: Schema.String,
    depth: Schema.Number,
    fromUrl: Schema.optional(Schema.String),
  }),
  /** Priority level (higher numbers processed first) */
  priority: Schema.Number,
  /** When this request was created */
  timestamp: Schema.Date,
  /** Unique fingerprint for deduplication */
  fingerprint: Schema.String,
}) {}

/**
 * Complete state snapshot of a spider crawling session.
 *
 * This contains all information needed to resume a crawl session,
 * including pending requests, visited URLs, and progress counters.
 *
 * @group Data Types
 * @public
 */
export class SpiderState extends Schema.Class<SpiderState>('SpiderState')({
  /** The state key identifying this session */
  key: SpiderStateKey,
  /** All requests waiting to be processed */
  pendingRequests: Schema.Array(PriorityRequest),
  /** Fingerprints of URLs already visited (for deduplication) */
  visitedFingerprints: Schema.Array(Schema.String),
  /** Total number of requests processed so far */
  totalProcessed: Schema.Number,
}) {}

/**
 * Generic interface for persisting spider state.
 *
 * Implementations can use any storage backend (filesystem, database, etc.)
 * to save and restore crawling sessions. All operations are Effect-based
 * for composability and error handling.
 *
 * @example
 * ```typescript
 * class FilePersistence implements StatePersistence {
 *   saveState = (key: SpiderStateKey, state: SpiderState) =>
 *     Effect.tryPromise(() => fs.writeFile(key.id + '.json', JSON.stringify(state)))
 *
 *   loadState = (key: SpiderStateKey) =>
 *     Effect.tryPromise(() => fs.readFile(key.id + '.json').then(JSON.parse))
 *
 *   deleteState = (key: SpiderStateKey) =>
 *     Effect.tryPromise(() => fs.unlink(key.id + '.json'))
 * }
 * ```
 *
 * @group Interfaces
 * @public
 */
export interface StatePersistence {
  /** Saves the complete spider state to persistent storage */
  saveState: (
    key: SpiderStateKey,
    state: SpiderState
  ) => Effect.Effect<void, Error>;
  /** Loads spider state from persistent storage, returns null if not found */
  loadState: (key: SpiderStateKey) => Effect.Effect<SpiderState | null, Error>;
  /** Deletes spider state from persistent storage */
  deleteState: (key: SpiderStateKey) => Effect.Effect<void, Error>;
}

/**
 * Manages request scheduling, prioritization, and state persistence for web crawling.
 *
 * The SpiderSchedulerService provides a priority-based request queue with optional persistence
 * capabilities. It handles:
 * - Request deduplication via fingerprinting
 * - Priority-based scheduling (higher numbers processed first)
 * - State persistence for resumable crawling
 * - Atomic state operations
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const scheduler = yield* SpiderSchedulerService;
 *
 *   // Configure persistence
 *   const persistence = new FilePersistence('./state');
 *   const stateKey = new SpiderStateKey({
 *     id: 'my-crawl',
 *     timestamp: new Date(),
 *     name: 'Example Crawl'
 *   });
 *
 *   yield* scheduler.configurePersistence(persistence, stateKey);
 *
 *   // Queue requests
 *   yield* scheduler.enqueue({ url: 'https://example.com', depth: 0 }, 10);
 *   yield* scheduler.enqueue({ url: 'https://example.com/about', depth: 1 }, 5);
 *
 *   // Process requests
 *   const request = yield* scheduler.dequeue();
 *   console.log(`Processing: ${request.request.url}`);
 * });
 * ```
 *
 * @group Services
 * @public
 */
export class SpiderSchedulerService extends Effect.Service<SpiderSchedulerService>()(
  '@jambudipa.io/SpiderSchedulerService',
  {
    effect: Effect.gen(function* () {
      const config = yield* SpiderConfig;
      const shouldNormalizeUrls =
        yield* config.shouldNormalizeUrlsForDeduplication();

      const memoryQueue = yield* Queue.unbounded<PriorityRequest>();
      const seenFingerprints = MutableHashMap.empty<string, boolean>();
      const pendingRequestsForPersistence: PriorityRequest[] = []; // Keep track for persistence
      let totalProcessed = 0;
      let persistenceLayer: StatePersistence | null = null;
      let currentStateKey: SpiderStateKey | null = null;

      /**
       * Normalizes a URL for consistent deduplication.
       *
       * @param url - The URL to normalize
       * @returns The normalized URL string
       * @internal
       */
      const normalizeUrl = (url: string): string => {
        if (!shouldNormalizeUrls) {
          return url;
        }

        try {
          const parsed = new URL(url);

          // Normalize pathname: remove multiple consecutive slashes and trailing slashes
          let normalizedPath = parsed.pathname
            .replace(/\/+/g, '/') // Replace multiple slashes with single slash
            .replace(/\/$/, ''); // Remove trailing slash

          // Keep root path as '/'
          if (normalizedPath === '') {
            normalizedPath = '/';
          }

          parsed.pathname = normalizedPath;

          // Remove fragment
          parsed.hash = '';

          // Remove default ports
          if (
            (parsed.protocol === 'http:' && parsed.port === '80') ||
            (parsed.protocol === 'https:' && parsed.port === '443')
          ) {
            parsed.port = '';
          }

          // Sort query parameters alphabetically
          if (parsed.search) {
            const params = new URLSearchParams(parsed.search);
            const sortedParams = new URLSearchParams();
            Array.from(params.keys())
              .sort()
              .forEach((key) => {
                params.getAll(key).forEach((value) => {
                  sortedParams.append(key, value);
                });
              });
            parsed.search = sortedParams.toString();
          }

          return parsed.toString();
        } catch {
          // If URL parsing fails, return original
          return url;
        }
      };

      /**
       * Generates a unique fingerprint for request deduplication.
       *
       * @param request - The crawl task to fingerprint
       * @returns A unique string identifying this request
       * @internal
       */
      const generateFingerprint = (request: CrawlTask): string => {
        // Create a unique fingerprint for the request with normalized URL
        const normalizedUrl = normalizeUrl(request.url);
        return `${normalizedUrl}:${request.depth}`;
      };

      const createPriorityRequest = (
        request: CrawlTask,
        priority: number
      ): PriorityRequest =>
        new PriorityRequest({
          request,
          priority,
          timestamp: new Date(),
          fingerprint: generateFingerprint(request),
        });

      const persistState = (): Effect.Effect<void, Error> =>
        Effect.gen(function* () {
          if (!persistenceLayer || !currentStateKey) {
            return;
          }

          const state = new SpiderState({
            key: currentStateKey,
            pendingRequests: [...pendingRequestsForPersistence],
            visitedFingerprints: Array.from(
              MutableHashMap.keys(seenFingerprints)
            ),
            totalProcessed,
          });

          yield* persistenceLayer.saveState(currentStateKey, state);
        });

      const restoreFromStateImpl = (
        state: SpiderState
      ): Effect.Effect<void, Error> =>
        Effect.gen(function* () {
          // Clear current state
          const currentSize = yield* Queue.size(memoryQueue);
          for (let i = 0; i < currentSize; i++) {
            yield* Queue.take(memoryQueue).pipe(Effect.ignore);
          }
          MutableHashMap.clear(seenFingerprints);
          pendingRequestsForPersistence.length = 0; // Clear persistence array

          // Restore fingerprints
          state.visitedFingerprints.forEach((fp) => {
            MutableHashMap.set(seenFingerprints, fp, true);
          });

          // Restore queue (sort by priority, highest first)
          const sortedRequests = [...state.pendingRequests].sort(
            (a, b) => b.priority - a.priority
          );
          pendingRequestsForPersistence.push(...sortedRequests); // Restore persistence tracking
          yield* Effect.forEach(sortedRequests, (req) =>
            Queue.offer(memoryQueue, req)
          );

          totalProcessed = state.totalProcessed;
          currentStateKey = state.key;
        });

      return {
        // Configure persistence layer for resumable scraping
        configurePersistence: (
          persistence: StatePersistence,
          stateKey: SpiderStateKey
        ) =>
          Effect.sync(() => {
            persistenceLayer = persistence;
            currentStateKey = stateKey;
          }),

        // Remove persistence configuration
        clearPersistence: () =>
          Effect.sync(() => {
            persistenceLayer = null;
            currentStateKey = null;
          }),

        // Enqueue a request with priority
        enqueue: (request: CrawlTask, priority = 0) =>
          Effect.gen(function* () {
            const fingerprint = generateFingerprint(request);

            if (MutableHashMap.has(seenFingerprints, fingerprint)) {
              return false; // Already seen
            }

            MutableHashMap.set(seenFingerprints, fingerprint, true);
            const priorityRequest = createPriorityRequest(request, priority);

            yield* Queue.offer(memoryQueue, priorityRequest);
            pendingRequestsForPersistence.push(priorityRequest); // Track for persistence

            // Persist if persistence layer is configured
            if (persistenceLayer && currentStateKey) {
              yield* persistState();
            }

            return true;
          }),

        // Dequeue highest priority request
        dequeue: () =>
          Effect.gen(function* () {
            const request = yield* Queue.take(memoryQueue);
            totalProcessed++;

            // Remove from persistence tracking
            const index = pendingRequestsForPersistence.findIndex(
              (r) => r.fingerprint === request.fingerprint
            );
            if (index !== -1) {
              pendingRequestsForPersistence.splice(index, 1);
            }

            // Persist state after processing if persistence layer is configured
            if (persistenceLayer && currentStateKey) {
              yield* persistState();
            }

            return request;
          }),

        // Get queue size
        size: () => Queue.size(memoryQueue),

        // Check if queue is empty
        isEmpty: () =>
          Queue.size(memoryQueue).pipe(Effect.map((size) => size === 0)),

        // Get current state for persistence
        getState: () =>
          Effect.gen(function* () {
            if (!currentStateKey) {
              return yield* Effect.fail(
                new ConfigurationError({
                  message: 'No state key configured',
                  details: 'State key is required for persistence operations',
                })
              );
            }

            return new SpiderState({
              key: currentStateKey,
              pendingRequests: [...pendingRequestsForPersistence],
              visitedFingerprints: Array.from(
                MutableHashMap.keys(seenFingerprints)
              ),
              totalProcessed,
            });
          }),

        // Restore from state
        restoreFromState: restoreFromStateImpl,

        // Generic restore method that can work with any persistence implementation
        restore: (persistence: StatePersistence, stateKey: SpiderStateKey) =>
          Effect.gen(function* () {
            const state = yield* persistence.loadState(stateKey);
            if (state) {
              persistenceLayer = persistence;
              yield* restoreFromStateImpl(state);
              return true;
            }
            return false;
          }),
      };
    }),
    dependencies: [SpiderConfig.Default],
  }
) {}
