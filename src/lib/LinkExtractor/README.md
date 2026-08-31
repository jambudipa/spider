# LinkExtractorService

`LinkExtractorService` extracts raw URL values from HTML. It does not resolve
relative URLs, filter domains or patterns, normalize values, or remove
duplicates. Apply those policies after extraction, or use the spider crawl API
when you need crawl-specific URL processing.

## Use the service

Provide `LinkExtractorService.layer` at the program boundary. The service
returns every matching configured attribute as a raw string.

```typescript
import { Effect } from 'effect';
import { LinkExtractorService } from '@jambudipa/spider';

const program = Effect.gen(function* () {
  const extractor = yield* LinkExtractorService;
  const result = yield* extractor.extractLinks(
    `
      <main>
        <a href="/about">About</a>
        <form action="/search"></form>
      </main>
    `,
    {
      restrictCss: ['main a', 'main form'],
      attrs: ['href', 'action'],
    }
  );

  console.log(result.links);
  console.log(result.totalElementsProcessed);
  console.log(result.extractionBreakdown);
});

Effect.runPromise(program.pipe(Effect.provide(LinkExtractorService.layer)));
```

The example returns `['/about', '/search']`. The values stay relative because
the service only reads HTML attributes.

## Configure extraction

`LinkExtractorConfig` controls which elements and attributes the service
examines.

| Option              | Purpose                                          | Default                                            |
| ------------------- | ------------------------------------------------ | -------------------------------------------------- |
| `restrictCss`       | Limit extraction to matching CSS selectors.      | `[]`                                               |
| `tags`              | Select tag names when `restrictCss` is empty.    | `['a', 'area', 'form', 'frame', 'iframe', 'link']` |
| `attrs`             | Select URL-bearing attributes from each element. | `['href', 'action', 'src']`                        |
| `extractFromInputs` | Read URL-like hidden input values.               | `false`                                            |

Use `restrictCss` for a known page region. Use `tags` with `attrs` for a
document-wide scan. The service counts each attempted element-attribute pair in
`totalElementsProcessed` and groups extracted links by tag in
`extractionBreakdown`.

## Handle failures

`extractLinks` fails with `LinkExtractionError` when the HTML parser fails.
Handle that tagged error at the program boundary where the caller can choose a
fallback policy.

```typescript
const extractionEffect = extractor.extractLinks(html).pipe(
  Effect.catchTag('LinkExtractionError', (error) =>
    Effect.sync(() => {
      console.error(error.message);
      return {
        links: [],
        totalElementsProcessed: 0,
        extractionBreakdown: {},
      };
    })
  )
);

const extraction = yield * extractionEffect;
```

The fallback keeps the `LinkExtractionResult` shape. The caller can still use
the extraction counts and breakdown.
