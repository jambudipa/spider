# URL deduplicator

This folder owns the concurrent URL set that prevents a spider from scheduling the same target twice. It normalizes URLs only when `SpiderConfig` enables that behavior.

Start with `UrlDeduplicator.service.ts`. The service serializes each check-and-add operation, so callers must use `tryAdd` instead of separate `contains` and add steps.

Do not put crawl scheduling or link extraction here. This folder only decides whether a normalized URL is new for one service instance.
