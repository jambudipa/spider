/**
 * Operational defaults for Spider service.
 * These are runtime defaults, not configuration — they represent
 * sensible operational thresholds and intervals.
 */
export const SPIDER_DEFAULTS = Object.freeze({
  /**
   * Threshold in ms after which a worker is considered stale (300 s).
   *
   * Sized to cover the documented worst-case fetch chain under the default
   * `fetchRetry` policy: `maxAttempts (3) × per-attempt timeout (~45 s) +
   * exponential backoff (1 s + 2 s) ≈ 138 s`. The 300 s headroom absorbs
   * slow but legitimate adapters (TLS-impersonating clients, sidecar APIs)
   * whose per-attempt timeout can run higher than the undici default.
   *
   * Override per-spider via `SpiderConfigOptions.staleWorkerThresholdMs`.
   */
  STALE_WORKER_THRESHOLD_MS: 300_000,

  /**
   * Interval in ms at which the worker-health monitor scans for stale
   * workers. Override per-spider via
   * `SpiderConfigOptions.staleWorkerCheckIntervalMs`. Default tracks the
   * legacy `'15 seconds'` value below.
   */
  STALE_WORKER_CHECK_INTERVAL_MS: 15_000,

  /**
   * Interval for health check monitoring (string form, legacy).
   * @deprecated Prefer `STALE_WORKER_CHECK_INTERVAL_MS`. Retained for
   * any external consumers reading the string form.
   */
  HEALTH_CHECK_INTERVAL: '15 seconds' as const,

  /** Memory usage threshold in bytes (1GB) before logging warnings */
  MEMORY_THRESHOLD_BYTES: 1024 * 1024 * 1024,

  /** Queue size threshold before logging warnings */
  QUEUE_SIZE_THRESHOLD: 10_000,

  /** Timeout for task acquisition from queue */
  TASK_ACQUISITION_TIMEOUT: '10 seconds' as const,

  /** Timeout for page fetch operations */
  FETCH_TIMEOUT: '45 seconds' as const,

  /** Number of retry attempts for fetch operations */
  FETCH_RETRY_COUNT: 2,

  /** Interval for domain failure detection checks */
  FAILURE_DETECTOR_INTERVAL: '30 seconds' as const,
});
