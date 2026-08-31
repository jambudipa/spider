# Resumability

This folder preserves crawler scheduler state so a crawl can resume after a stop or failure. It defines the service, the persistence contracts, and the strategies that select full-state, delta, or hybrid storage.

Start with `Resumability.service.ts` when you need to configure the service. Read `types.ts` before you add a backend or change a storage contract. Read `strategies.ts` when you change snapshot, replay, or compaction behavior.

Keep storage I/O behind `StorageBackend`. A strategy chooses when data is saved. A backend decides where it is saved. Do not put database or Redis client code in a strategy.

The `backends/` folder contains supported storage adapters. It does not contain scheduler state definitions or crawl orchestration.
