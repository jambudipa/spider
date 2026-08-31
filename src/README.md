# Source modules

This folder contains the package entry point, runnable examples, browser
integration, library services, and test support. Start with `index.ts` when
you need the supported npm surface.

Keep implementation details below `lib/`. Add a public export through
`index.ts` only after its service contract and documentation are stable.
Examples demonstrate supported layer composition. They are not package source.
