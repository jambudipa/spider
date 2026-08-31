# Static-content scenarios

This folder tests normal static pages, page markup, local storage, and classic
pagination. `StaticPagingValidators.ts` holds shared checks for these cases.

Keep page-specific selectors close to their test. Move reusable assertions to
the validator only when multiple static scenarios need them.
