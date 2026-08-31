# Web scraping engine

This folder combines login, token extraction, cookies, and session storage into one authenticated scraping service. It coordinates existing focused services. It does not implement transport or persistence itself.

Start with `WebScrapingEngine.service.ts`. Provide its HTTP, cookie, session, token, and state dependencies before using `WebScrapingEngineLive`.

The engine treats a successful form response as authenticated when it has status 200 or 302, or a location header. It creates or loads sessions through `SessionStore` and refreshes the returned token snapshot from `StateManager`.
