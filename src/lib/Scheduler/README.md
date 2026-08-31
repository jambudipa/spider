# Crawl scheduler

This folder holds the priority queue and persistence model for a crawl session.
Start with `SpiderScheduler.service.ts` to change request ordering, duplicate
handling, or session restoration.

The service owns the in-memory queue and its persistence snapshot. It uses the
`SpiderConfig` layer only to normalize URLs before it creates fingerprints. Keep
fetching, parsing, and storage implementations outside this folder. Storage
enters through `StatePersistence` so the scheduler stays independent of a
specific backend.
