/**
 * The stored document schema and the migration harness.
 *
 * Conversations live in the user's browser, so the data already on their machine cannot be
 * migrated by a deploy (ADR-0006). Every document carries its schema version, and `migrate` walks
 * it forward from whatever version it was written by to the current one.
 *
 * v1 has nothing to migrate yet. The harness is the point: adding versioning later, over data
 * already in the wild, is the case that loses data.
 *
 * Pure: no framework, no I/O, no clock. The `localStorage` driver is the adapter's job — this
 * module only ever sees a parsed value of unknown shape.
 */

/** The version this build writes. Bump it in the same commit that adds a migration. */
export const CURRENT_VERSION = 1;

export type MessageRole = 'user' | 'assistant';

/**
 * Terminal state of a message. Partial content is kept for `interrupted` and `failed` alike —
 * it is never discarded (DESIGN-SYSTEM §5).
 */
export type MessageStatus = 'complete' | 'interrupted' | 'failed';

export interface MessageV1 {
  readonly id: string;
  readonly role: MessageRole;
  readonly content: string;
  /** Epoch milliseconds. Supplied by the caller; core has no clock. */
  readonly createdAt: number;
  readonly status: MessageStatus;
}

export interface ConversationV1 {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  /** Epoch milliseconds of the last message. The chat list orders by this. */
  readonly updatedAt: number;
  readonly messages: readonly MessageV1[];
}

export interface DocumentV1 {
  readonly version: 1;
  readonly conversations: readonly ConversationV1[];
}

/** The shape this build works with. Aliased so call sites do not name a version. */
export type StoredDocument = DocumentV1;

/** Any document that at least declares a version — the only thing a migration can rely on. */
export interface VersionedDocument {
  readonly version: number;
  readonly [key: string]: unknown;
}

/** One step forward, keyed by the version it reads. */
export type MigrationMap = ReadonlyMap<number, (doc: VersionedDocument) => VersionedDocument>;

/**
 * The shipped chain.
 *
 * Empty at v1. A v2 lands here as `[1, (doc) => ({ ...doc, version: 2, ... })]`, with a test that
 * feeds it a hand-written v1 document.
 */
const MIGRATIONS: MigrationMap = new Map();

export type MigrationResult =
  | {
      readonly ok: true;
      readonly doc: StoredDocument;
      /** The version the document was read from. Equal to `CURRENT_VERSION` when nothing ran. */
      readonly from: number;
    }
  | { readonly ok: false; readonly reason: string };

/** A fresh, valid document. Used on first run and after an unreadable one is set aside. */
export function emptyDocument(): StoredDocument {
  return { version: CURRENT_VERSION, conversations: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMessage(value: unknown): value is MessageV1 {
  if (!isRecord(value)) return false;
  const { id, role, content, createdAt, status } = value;
  return (
    typeof id === 'string' &&
    (role === 'user' || role === 'assistant') &&
    typeof content === 'string' &&
    typeof createdAt === 'number' &&
    Number.isFinite(createdAt) &&
    (status === 'complete' || status === 'interrupted' || status === 'failed')
  );
}

function isConversation(value: unknown): value is ConversationV1 {
  if (!isRecord(value)) return false;
  const { id, title, createdAt, updatedAt, messages } = value;
  return (
    typeof id === 'string' &&
    typeof title === 'string' &&
    typeof createdAt === 'number' &&
    Number.isFinite(createdAt) &&
    typeof updatedAt === 'number' &&
    Number.isFinite(updatedAt) &&
    Array.isArray(messages) &&
    messages.every(isMessage)
  );
}

/**
 * Validate a document that claims to be at the current version.
 *
 * Exported because a migration's output is validated by exactly the same check its input was —
 * a migration that produces a broken document must fail loudly, in a test, not silently in a
 * user's browser.
 */
export function isCurrentDocument(value: unknown): value is StoredDocument {
  if (!isRecord(value)) return false;
  if (value['version'] !== CURRENT_VERSION) return false;
  const conversations = value['conversations'];
  return Array.isArray(conversations) && conversations.every(isConversation);
}

/**
 * Walk a document forward to `target`, one shipped version at a time.
 *
 * Separate from `migrate` and taking its chain as an argument, because the harness is the part
 * worth proving before there is anything to migrate: a test drives a synthetic chain through it
 * (ADR-0006). Total: never throws.
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
