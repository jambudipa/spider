# Middleware pipeline

This folder defines request, response, and exception middleware for a crawl. Start with `SpiderMiddleware.ts` to use the pipeline manager or one of the supplied middleware factories.

Custom middleware belongs behind the `SpiderMiddleware` interface. It must return Effect values and must preserve the pipeline contract: requests run forward, responses and exceptions run backward.

`types.ts` contains the immutable request and response values that flow through the pipeline. Keep transport adapters and crawler orchestration outside this folder.
