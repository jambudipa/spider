# Page data

This folder defines the validated page payload that flows from scraping to
result sinks and persistence. `PageData.ts` is the entry point.

Keep the TypeScript type derived from `PageDataSchema`. The schema is the
runtime boundary for URLs, status codes, crawl depth, and optional extracted
data. Do not add a second structural page-data type in a consumer.
