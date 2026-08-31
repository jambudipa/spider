# Browser integration

This folder contains the Playwright adapter and the browser pool that supports it. It bridges Playwright's Promise API to the library's Effect API.

Start with `BrowserManager.ts` when you change browser lifecycle, context allocation, or browser defaults. Start with `PlaywrightAdapter.ts` when you change page automation or request and response hooks.

Keep Playwright calls inside `Effect.tryPromise` and map failures to the adapter errors. The manager owns launched browsers and contexts, so callers must close it after a crawl.
