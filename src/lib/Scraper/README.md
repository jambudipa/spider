# HTML scraper

This folder turns an HTTP adapter response into validated `PageData`. Start
with `Scraper.service.ts` when you change response parsing, content validation,
or the public fetch service contract.

The scraper owns HTML parsing and maps adapter failures into the typed errors
used by the crawl retry pipeline. HTTP transport implementations belong in
`../HttpAdapter`, and link extraction belongs in `../LinkExtractor`. Keep the
adapter error mapping stable so custom adapters keep the same retry behavior as
the default Undici adapter.
