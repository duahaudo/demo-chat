/**
 * The stored document schema — every shipped version of it — and the validators for the current
 * one.
 *
 * Reads top to bottom as a changelog: frozen versions first, the current one last. A shipped
 * interface is never edited. It describes bytes already on a user's machine, and the migration
 * that reads those bytes has to keep telling the truth about them (ADR-0006).
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

// ── v1 ─────────────────────────────────────────────────────────────────────────────────────────

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

// ── Current ────────────────────────────────────────────────────────────────────────────────────

/** The shape this build works with. Aliased so call sites do not name a version. */
export type StoredDocument = DocumentV1;

/** Any document that at least declares a version — the only thing a migration can rely on. */
export interface VersionedDocument {
  readonly version: number;
  readonly [key: string]: unknown;
}

/** A fresh, valid document. Used on first run and after an unreadable one is set aside. */
export function emptyDocument(): StoredDocument {
  return { version: CURRENT_VERSION, conversations: [] };
}

// ── Validation ─────────────────────────────────────────────────────────────────────────────────
//
// These describe the *current* version only. A migration's input is whatever the previous version
// wrote; its output is checked by `isCurrentDocument`, the same way a first-run document is.

export function isRecord(value: unknown): value is Record<string, unknown> {
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
