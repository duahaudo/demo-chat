/**
 * The migration harness.
 *
 * Conversations live in the user's browser, so the data already on their machine cannot be
 * migrated by a deploy (ADR-0006). Every document carries its schema version, and `migrate` walks
 * it forward from whatever version it was written by to the current one.
 *
 * This file does not change when the schema does: the shapes live in `./schema` and the chain in
 * `./migrations`.
 *
 * Pure: no framework, no I/O, no clock. The `localStorage` driver is the adapter's job — this
 * module only ever sees a parsed value of unknown shape.
 */

import { MIGRATIONS, type MigrationMap } from './migrations';
import {
  CURRENT_VERSION,
  isCurrentDocument,
  isRecord,
  type StoredDocument,
  type VersionedDocument,
} from './schema';

export type MigrationResult =
  | {
      readonly ok: true;
      readonly doc: StoredDocument;
      /** The version the document was read from. Equal to `CURRENT_VERSION` when nothing ran. */
      readonly from: number;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Walk a document forward to `target`, one shipped version at a time.
 *
 * Takes its chain as an argument, because the harness is the part worth proving before there is
 * anything to migrate: a test drives a synthetic chain through it (ADR-0006). Total: never throws.
 */
export function runMigrations(
  doc: VersionedDocument,
  target: number,
  migrations: MigrationMap,
):
  | { readonly ok: true; readonly doc: VersionedDocument }
  | { readonly ok: false; readonly reason: string } {
  let current = doc;
  // Bounded by the chain: each step must advance, so at most `target` steps can run.
  while (current.version < target) {
    const step = migrations.get(current.version);
    if (!step) {
      return { ok: false, reason: `No migration from version ${String(current.version)}.` };
    }

    const next = step(current);
    if (next.version <= current.version) {
      return {
        ok: false,
        reason: `Migration from version ${String(current.version)} did not advance.`,
      };
    }
    current = next;
  }

  return { ok: true, doc: current };
}

/**
 * Bring a stored value up to the current schema.
 *
 * Total: never throws. A document that cannot be brought forward is rejected with a reason rather
 * than repaired by guesswork — the caller starts fresh and keeps the original bytes aside.
 *
 * A document from a *newer* version is rejected too: the user opened an older build, and silently
 * downgrading it would drop whatever the newer version added.
 */
export function migrate(input: unknown): MigrationResult {
  if (!isRecord(input)) {
    return { ok: false, reason: 'Stored value is not an object.' };
  }

  const version = input['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, reason: 'Stored document has no usable schema version.' };
  }

  if (version > CURRENT_VERSION) {
    return {
      ok: false,
      reason: `Stored document is at version ${String(version)}, newer than this build's ${String(CURRENT_VERSION)}.`,
    };
  }

  const walked = runMigrations(input as VersionedDocument, CURRENT_VERSION, MIGRATIONS);
  if (!walked.ok) return walked;

  const doc = walked.doc;
  const from = version;

  if (!isCurrentDocument(doc)) {
    return { ok: false, reason: 'Document does not match the current schema.' };
  }

  return { ok: true, doc, from };
}
