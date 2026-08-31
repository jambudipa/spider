# Spider orchestration

This folder owns the public crawler service, its result model, operational
defaults, and the narrow Node-undici process guard. Start with
`Spider.service.ts` for crawl behavior and layer composition.

Keep fetch-failure classification in `Spider.types.ts`. Result sinks must use
the `CrawlResult` guards before accessing a successful page or a failure. The
undici guard is a process boundary; do not reuse it for generic exceptions.
