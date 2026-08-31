import { Schema } from 'effect';

/**
 * Runtime schema for a fetched page.
 *
 * The schema rejects malformed URLs, non-HTTP status values, and negative
 * crawl depths before page data reaches downstream extraction or persistence.
 */
export const PageDataSchema = Schema.Struct({
  url: Schema.String.pipe(
    Schema.check(Schema.makeFilter((s) => URL.canParse(s) ? undefined : 'Invalid URL format'))
  ),
  html: Schema.String,
  title: Schema.optional(Schema.String),
  /** All available metadata from meta tags */
  metadata: Schema.Record(Schema.String, Schema.String),
  /** Commonly used metadata fields for convenience */
  commonMetadata: Schema.optional(
    Schema.Struct({
      description: Schema.optional(Schema.String),
      keywords: Schema.optional(Schema.String),
      author: Schema.optional(Schema.String),
      robots: Schema.optional(Schema.String),
    })
  ),
  statusCode: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 100, maximum: 599 })),
  /** All response headers */
  headers: Schema.Record(Schema.String, Schema.String),
  /** When the fetch operation started */
  fetchedAt: Schema.Date,
  /** How long the entire fetch and parse operation took in milliseconds */
  scrapeDurationMs: Schema.Number,
  /** The crawl depth (number of hops from the starting URL) */
  depth: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  /** Optional extracted data from the page */
  extractedData: Schema.optional(
    Schema.Record(Schema.String, Schema.Unknown)
  ),
});

/**
 * Validated page data that the crawler sends to result sinks.
 *
 * This type is derived from {@link PageDataSchema}; update the schema rather
 * than constructing a competing structural definition.
 */
export type PageData = Schema.Schema.Type<typeof PageDataSchema>;
