# Configuration

This folder defines the validated configuration service that controls a crawl.
Start with `SpiderConfig.service.ts` to add an option, its default, and its
service accessor together.

Keep configuration as data until the application edge provides `SpiderConfig`
through a Layer. `makeSpiderConfig` is the input boundary. It throws
`ConfigError` for invalid startup values, so callers must validate external
configuration before they start a crawl.

Do not add crawler behavior here. Put execution rules in the relevant service,
then expose only the data and accessors that service needs through this folder.
