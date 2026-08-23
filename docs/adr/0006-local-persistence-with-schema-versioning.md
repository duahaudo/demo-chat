# ADR-0006 — Local persistence, schema-versioned from v1.0

**Status:** Accepted · **Date:** 2026-08-24

## Context

Conversations live in the browser. There are no accounts and no server-side store. The stored
shape will change — messages gain fields, conversations gain metadata — and the data already on
a user's machine at that moment cannot be migrated by a deploy.

## Options

1. **`localStorage`, unversioned.** Ship the shape; deal with change later.
2. **`localStorage` with a schema version and a migration path from every shipped version.**
3. **IndexedDB.** More capable, and more machinery than a conversation list needs.

## Decision

Option 2. Every stored document carries a schema version, and `migrate(doc)` walks it forward from
every shipped version. The schema and the migration harness live in `src/core/storage/`, behind a
narrow interface; the `localStorage` driver lives in the adapter.

The harness exists from v1, when there is nothing to migrate yet. That is the point: adding a
version later, over data already in the wild, is the case that produces data loss.

Conversations are persisted on first message, not on creation, so abandoned empty chats do not
accumulate.

## Consequences accepted

- Data is per-browser. No sync across devices, and clearing site data clears history. Stated in the
  UI rather than worked around.
- `localStorage` is synchronous and roughly 5 MB. Long transcripts will eventually press on that;
  IndexedDB is the upgrade path, behind the same narrow interface.
- A migration is written and tested for every shape change, including the ones that feel trivial.
  The v1 harness carries no migrations and still carries a test.
