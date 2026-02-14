import { Console, Context, DateTime, Effect, Layer, Schema } from 'effect';
import * as fs from 'fs';
import * as path from 'path';

export interface SpiderLogEvent {
  timestamp: string;
  type:
    | 'domain_start'
    | 'domain_complete'
    | 'domain_error'
    | 'page_scraped'
    | 'queue_status'
    | 'worker_status'
    | 'rate_limit'
    | 'spider_lifecycle'
    | 'worker_lifecycle'
    | 'worker_state'
    | 'completion_monitor'
    | 'edge_case'
    | 'crawl_delay_capped';
  domain?: string;
  url?: string;
  workerId?: string;
  fiberId?: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface SpiderLoggerService {
  readonly logEvent: (
    event: Omit<SpiderLogEvent, 'timestamp'>
  ) => Effect.Effect<void>;
  readonly logDomainStart: (
    domain: string,
    startUrl: string
  ) => Effect.Effect<void>;
  readonly logDomainComplete: (
    domain: string,
    pagesScraped: number,
    reason: 'max_pages' | 'queue_empty' | 'error'
  ) => Effect.Effect<void>;
  readonly logPageScraped: (
    url: string,
    domain: string,
    pageNumber: number
  ) => Effect.Effect<void>;
  readonly logQueueStatus: (
    domain: string,
    queueSize: number,
    activeWorkers: number
  ) => Effect.Effect<void>;
  readonly logRateLimit: (
    domain: string,
    requestsInWindow: number
  ) => Effect.Effect<void>;
  readonly logSpiderLifecycle: (
    event: 'start' | 'complete' | 'error',
    details?: Record<string, unknown>
  ) => Effect.Effect<void>;

  // Enhanced diagnostic logging
  readonly logWorkerLifecycle: (
    workerId: string,
    domain: string,
    event: 'created' | 'entering_loop' | 'exiting_loop',
    reason?: string,
    details?: Record<string, unknown>
  ) => Effect.Effect<void>;
  readonly logWorkerState: (
    workerId: string,
    domain: string,
    event: 'taking_task' | 'marked_active' | 'marked_idle' | 'task_completed',
    details?: Record<string, unknown>
  ) => Effect.Effect<void>;
  readonly logCompletionMonitor: (
    domain: string,
    checkCount: number,
    queueSize: number,
    activeWorkers: number,
    stableCount: number,
    maxPagesReached: boolean,
    decision: string
  ) => Effect.Effect<void>;
  readonly logEdgeCase: (
    domain: string,
    caseType: string,
    details?: Record<string, unknown>
  ) => Effect.Effect<void>;
  readonly logDomainStatus: (
    domain: string,
    status: {
      pagesScraped: number;
      queueSize: number;
      activeWorkers: number;
      maxWorkers: number;
    }
  ) => Effect.Effect<void>;
}

export class SpiderLogger extends Context.Tag('SpiderLogger')<
  SpiderLogger,
  SpiderLoggerService
>() {}

// Schema for validating parsed summary JSON
const SummarySchema = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown
});

// Type guard for Record<string, unknown>
// Uses Object.prototype.toString for more robust checking that avoids null comparison
const isRecordStringUnknown = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]';

// Schema-based JSON parsing for summary files
const SummaryJsonSchema = Schema.parseJson(SummarySchema);

// Schema for log event serialisation
const LogEventSchema = Schema.Struct({
  timestamp: Schema.String,
  type: Schema.String,
  domain: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  workerId: Schema.optional(Schema.String),
  fiberId: Schema.optional(Schema.String),
  message: Schema.String,
  details: Schema.optional(Schema.Record({
    key: Schema.String,
    value: Schema.Unknown
  }))
});

const LogEventJsonSchema = Schema.parseJson(LogEventSchema);

export const makeSpiderLogger = (logDir = './spider-logs'): SpiderLoggerService => {
  // Ensure log directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFileName = `spider-${DateTime.formatIso(DateTime.unsafeNow()).replace(/[:.]/g, '-')}.jsonl`;
  const logFilePath = path.join(logDir, logFileName);
  const summaryFilePath = path.join(logDir, 'spider-summary.json');

  const stringifyForLog = (event: SpiderLogEvent): string => {
    const result = Schema.encodeEither(LogEventJsonSchema)(event);
    if (result._tag === 'Right') {
      return result.right;
    }
    // Fallback for any encoding errors - use a minimal representation
    return `{"timestamp":"${event.timestamp}","type":"${event.type}","message":"${event.message}"}`;
  };

  const stringifyPretty = (value: Record<string, unknown>): string => {
    const result = Schema.encodeEither(SummaryJsonSchema)(value);
    if (result._tag === 'Right') {
      // Pretty print the JSON string
      const parsed = Schema.decodeUnknownEither(SummaryJsonSchema)(result.right);
      if (parsed._tag === 'Right') {
        const prettyResult = Schema.encodeEither(Schema.parseJson(SummarySchema, { space: 2 }))(parsed.right);
        if (prettyResult._tag === 'Right') {
          return prettyResult.right;
        }
      }
      return result.right;
    }
    return '{}';
  };

  const writeLogEvent = (event: SpiderLogEvent) =>
    Effect.gen(function* () {
      const logLine = stringifyForLog(event) + '\n';
      yield* Effect.sync(() => fs.appendFileSync(logFilePath, logLine));

      // Only log important events to console to prevent memory overflow
      const importantTypes = [
        'domain_start',
        'domain_complete',
        'spider_lifecycle',
        'domain_error',
      ];
      if (importantTypes.includes(event.type)) {
        const prefix = `[${event.type}]`;
        const domainInfo = event.domain ? ` [${event.domain}]` : '';
        yield* Console.log(`${prefix}${domainInfo} ${event.message}`);
      }
    });

  const updateSummary = (
    update: (summary: Record<string, unknown>) => Record<string, unknown>
  ) =>
    Effect.sync(() => {
      let summary: Record<string, unknown> = {};
      if (fs.existsSync(summaryFilePath)) {
        const content = fs.readFileSync(summaryFilePath, 'utf-8');
        const parseResult = Schema.decodeUnknownEither(SummaryJsonSchema)(content);
        if (parseResult._tag === 'Right') {
          const parsed = parseResult.right;
          summary = isRecordStringUnknown(parsed) ? parsed : {};
        }
      }
      summary = update(summary);
      fs.writeFileSync(summaryFilePath, stringifyPretty(summary));
    });

  // Helper to get domains record from summary
  const getDomainsRecord = (summary: Record<string, unknown>): Record<string, unknown> => {
    const domains = summary.domains;
    return isRecordStringUnknown(domains) ? domains : {};
  };

  // Helper to get domain record from domains
  const getDomainRecord = (domains: Record<string, unknown>, domain: string): Record<string, unknown> => {
    const domainRecord = domains[domain];
    return isRecordStringUnknown(domainRecord) ? domainRecord : {};
  };

  return {
    logEvent: (event) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const fullEvent: SpiderLogEvent = {
          ...event,
          timestamp: DateTime.formatIso(now),
        };
        yield* writeLogEvent(fullEvent);
      }),

    logDomainStart: (domain, startUrl) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const timestamp = DateTime.formatIso(now);
        yield* writeLogEvent({
          timestamp,
          type: 'domain_start',
          domain,
          url: startUrl,
          message: `Starting crawl for domain: ${domain}`,
          details: { startUrl },
        });

        yield* updateSummary((summary) => ({
          ...summary,
          domains: {
            ...getDomainsRecord(summary),
            [domain]: {
              status: 'running',
              startTime: timestamp,
              startUrl,
              pagesScraped: 0,
            },
          },
        }));
      }),

    logDomainComplete: (domain, pagesScraped, reason) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const timestamp = DateTime.formatIso(now);
        yield* writeLogEvent({
          timestamp,
          type: 'domain_complete',
          domain,
          message: `Domain ${domain} completed: ${pagesScraped} pages scraped (reason: ${reason})`,
          details: { pagesScraped, reason },
        });

        yield* updateSummary((summary) => {
          const domains = getDomainsRecord(summary);
          const existingDomain = getDomainRecord(domains, domain);
          return {
            ...summary,
            domains: {
              ...domains,
              [domain]: {
                ...existingDomain,
                status: 'completed',
                endTime: timestamp,
                pagesScraped,
                completionReason: reason,
              },
            },
          };
        });
      }),

    logPageScraped: (url, domain, pageNumber) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        yield* writeLogEvent({
          timestamp: DateTime.formatIso(now),
          type: 'page_scraped',
          domain,
          url,
          message: `Scraped page #${pageNumber} from ${domain}`,
          details: { pageNumber },
        });

        // Update the summary with current page count
        yield* updateSummary((summary) => {
          const domains = getDomainsRecord(summary);
          const existingDomain = getDomainRecord(domains, domain);
          return {
            ...summary,
            domains: {
              ...domains,
              [domain]: {
                ...existingDomain,
                pagesScraped: pageNumber,
              },
            },
          };
        });
      }),

    logQueueStatus: (domain, queueSize, activeWorkers) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        yield* writeLogEvent({
          timestamp: DateTime.formatIso(now),
          type: 'queue_status',
          domain,
          message: `Queue status - size: ${queueSize}, active workers: ${activeWorkers}`,
          details: { queueSize, activeWorkers },
        });
      }),

    logRateLimit: (domain, requestsInWindow) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        yield* writeLogEvent({
          timestamp: DateTime.formatIso(now),
          type: 'rate_limit',
          domain,
          message: `Rate limit applied - ${requestsInWindow} requests in window`,
          details: { requestsInWindow },
        });
      }),

    logSpiderLifecycle: (event, details) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const timestamp = DateTime.formatIso(now);
        yield* writeLogEvent({
          timestamp,
          type: 'spider_lifecycle',
          message: `Spider ${event}`,
          details,
        });

        if (event === 'start') {
          yield* updateSummary((summary) => ({
            ...summary,
            spiderStartTime: timestamp,
            status: 'running',
          }));
        } else if (event === 'complete' || event === 'error') {
          yield* updateSummary((summary) => ({
            ...summary,
            spiderEndTime: timestamp,
            status: event === 'complete' ? 'completed' : 'error',
            ...(details && { finalDetails: details }),
          }));
        }
      }),

    // Enhanced diagnostic logging methods
    logWorkerLifecycle: (workerId, domain, event, reason, details) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        yield* writeLogEvent({
          timestamp: DateTime.formatIso(now),
          type: 'worker_lifecycle',
          domain,
          workerId,
          message: `[WORKER_LIFECYCLE] Worker ${workerId} ${event}${reason ? ` - reason: ${reason}` : ''} (domain: ${domain})`,
          details: { event, reason, ...details },
        });
      }),

    logWorkerState: (workerId, domain, event, details) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        yield* writeLogEvent({
          timestamp: DateTime.formatIso(now),
          type: 'worker_state',
          domain,
          workerId,
          message: `[WORKER_STATE] Worker ${workerId} ${event} (domain: ${domain})`,
          details: { event, ...details },
        });
      }),

    logCompletionMonitor: (
      domain,
      checkCount,
      queueSize,
      activeWorkers,
      stableCount,
      maxPagesReached,
      decision
    ) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        yield* writeLogEvent({
          timestamp: DateTime.formatIso(now),
          type: 'completion_monitor',
          domain,
          message: `[COMPLETION_MONITOR] Check #${checkCount}: queue=${queueSize}, active=${activeWorkers}, stable=${stableCount}, maxPages=${maxPagesReached} -> ${decision}`,
          details: {
            checkCount,
            queueSize,
            activeWorkers,
            stableCount,
            maxPagesReached,
            decision,
          },
        });
      }),

    logEdgeCase: (domain, caseType, details) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        yield* writeLogEvent({
          timestamp: DateTime.formatIso(now),
          type: 'edge_case',
          domain,
          message: `[EDGE_CASE] ${caseType} (domain: ${domain})`,
          details: { case: caseType, ...details },
        });
      }),

    logDomainStatus: (domain, status) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        yield* writeLogEvent({
          timestamp: DateTime.formatIso(now),
          type: 'domain_start', // Reuse existing type for now
          domain,
          message: `[DOMAIN_STATUS] ${domain}: ${status.pagesScraped} pages, queue=${status.queueSize}, workers=${status.activeWorkers}/${status.maxWorkers}`,
          details: status,
        });

        // Update summary with current status
        yield* updateSummary((summary) => {
          const domains = getDomainsRecord(summary);
          const existingDomain = getDomainRecord(domains, domain);
          return {
            ...summary,
            domains: {
              ...domains,
              [domain]: {
                ...existingDomain,
                pagesScraped: Math.max(0, status.pagesScraped || 0),
                queueSize: Math.max(0, status.queueSize || 0),
                activeWorkers: Math.max(0, status.activeWorkers || 0),
                maxWorkers: Math.max(1, status.maxWorkers || 5),
              },
            },
          };
        });
      }),
  };
};

export const SpiderLoggerLive = Layer.succeed(SpiderLogger, makeSpiderLogger());
