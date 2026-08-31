# Library services

This folder holds the crawler's implementation modules. Each feature folder
owns a service, a data model, or a narrow boundary adapter.

Keep dependency direction toward lower-level data and adapter folders. Service
layers belong with their service definitions. Export only supported API through
`src/index.ts`; do not make a deep library path part of the package contract.
