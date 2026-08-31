# HTTP adapters

This folder defines the narrow HTTP transport boundary used by the spider.
Start with `HttpAdapter.types.ts` when you add a custom adapter or change the
request and response contract.

An adapter must return structured `HttpAdapterError` values and must remain
cancellable. The spider owns retry policy and URL classification. The default
Undici adapter preserves the existing Fetch behavior, including the full-body
response contract.

Do not place crawler scheduling, parsing, or domain policy in this folder.
Keep those concerns in the spider services that consume an adapter.
