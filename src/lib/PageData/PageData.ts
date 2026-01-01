import { Schema } from 'effect';

export const PageDataSchema = Schema.Struct({
  url: Schema.String.pipe(
    Schema.filter((s) => URL.canParse(s), {
      message: () => 'Invalid URL format',
    })
  ),
  html: Schema.String,
  title: Schema.optional(Schema.String),
  /** All available metadata from meta tags */
  metadata: Schema.Record({ key: Schema.String, value: Schema.String }),
  /** Commonly used metadata fields for convenience */
  commonMetadata: Schema.optional(
    Schema.Struct({
      description: Schema.optional(Schema.String),
      keywords: Schema.optional(Schema.String),
      author: Schema.optional(Schema.String),
      robots: Schema.optional(Schema.String),
    })
  ),
  statusCode: Schema.Number.pipe(Schema.int(), Schema.between(100, 599)),
  /** All response headers */
  headers: Schema.Record({ key: Schema.String, value: Schema.String }),
  /** When the fetch operation started */
  fetchedAt: Schema.DateFromSelf,
  /** How long the entire fetch and parse operation took in milliseconds */
  scrapeDurationMs: Schema.Number,
  /** The crawl depth (number of hops from the starting URL) */
  depth: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  /** Optional extracted data from the page */
  extractedData: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown })
  ),
});

export type PageData = Schema.Schema.Type<typeof PageDataSchema>;
