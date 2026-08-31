# Resumability storage backends

This folder adapts file systems, Redis, and PostgreSQL to the `StorageBackend` contract. Each adapter owns its data encoding and its storage layout. Strategies in the parent folder decide when to call these operations.

Start with `FileStorageBackend.ts` for the simple local layout. Open `RedisStorageBackend.ts` or `PostgresStorageBackend.ts` when you need shared and concurrent persistence.

Keep clients caller-owned. The adapters do not create or close Redis or PostgreSQL connections. Preserve the `Option.none` contract for absent state or snapshots. Report unreadable persisted data as `PersistenceError`.

Do not add persistence policy here. Snapshot intervals, batching, and replay rules belong in the parent strategy code.
