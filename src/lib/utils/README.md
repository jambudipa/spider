# Utility helpers

This folder holds small, reusable Effect helpers for files, JSON, schemas, regular expressions, URLs, and migration support. It also holds URL deduplication utilities that do not belong to a crawler service.

Start with the focused utility file that matches the concern. Use `index.ts` only as the public export boundary.

Return typed Effect failures from a helper. Keep spider orchestration, browser work, and service-layer state outside this folder.
