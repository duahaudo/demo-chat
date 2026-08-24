/**
 * The shipped migration chain.
 *
 * The only file that grows with a schema change. A new version lands here as one entry, keyed by
 * the version it reads; the shapes in `./schema` gain an interface and the harness in `./migrate`
 * is untouched.
 *
 * Empty at v1 — there is nothing to migrate yet. The harness exists anyway, because adding
 * versioning later, over data already in the wild, is the case that loses data (ADR-0006).
 */

import type { VersionedDocument } from './schema';

/** One step forward, keyed by the version it reads. */
export type MigrationMap = ReadonlyMap<number, (doc: VersionedDocument) => VersionedDocument>;

/**
 * A v2 lands here as `[1, (doc) => ({ ...doc, version: 2, ... })]`, with a test that feeds it a
 * hand-written v1 document — hand-written, so it proves the step can read bytes from a build that
 * no longer exists.
 */
export const MIGRATIONS: MigrationMap = new Map();
