/**
 * Operational defaults for Spider service.
 * These are runtime defaults, not configuration — they represent
 * sensible operational thresholds and intervals.
 */
export const SPIDER_DEFAULTS = Object.freeze({
  /** Threshold in ms after which a worker is considered stale (60s) */
  STALE_WORKER_THRESHOLD_MS: 60_000,

  /** Interval for health check monitoring */
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
