# Browser engine service

This folder exposes browser automation through the `BrowserEngineService` Effect service. It keeps Playwright state behind a service key so crawlers depend on the interface, not a concrete browser.

Start with `BrowserEngine.service.ts` for the public operations, default layer, and configuration layer. Browser adapters and browser pools belong outside this folder.

The service lazily creates browser resources and releases them through `withBrowser`. Keep every Playwright boundary inside an Effect and keep the service interface independent of Playwright implementation details.
