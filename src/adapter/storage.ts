/**
 * The `localStorage` driver. Schema and migration walk live in `core/storage` (ADR-0006). Storage is
 * passed in, not reached for, so both paths are testable without a DOM.
 */

import { migrate } from '@/core/storage/migrate';
import { emptyDocument, type StoredDocument } from '@/core/storage/schema';

/** Unversioned: the version lives inside the document, not the key. */
export const STORAGE_KEY = 'chat-demo.chat';
/** Unreadable bytes are set aside here rather than overwritten, so the failure stays recoverable. */
export const QUARANTINE_KEY = 'chat-demo.chat.unreadable';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LoadOutcome {
  /** Always usable — an empty document when nothing readable was stored. */
  readonly doc: StoredDocument;
  /** Version the stored document was written by. */
  readonly from: number | undefined;
  /** Why the stored value was not used. The original bytes are under `QUARANTINE_KEY`. */
  readonly problem: string | undefined;
}

export type SaveOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * `localStorage`, or `null` when it cannot be used — access itself throws in Safari's private mode
 * and under a blocked-cookies policy, so this is a `try`, not a truthiness check.
 */
export function browserStorage(): StorageLike | null {
  try {
    const store = globalThis.localStorage;
    // Availability is not the same as writability: a full quota fails only on write.
    const probe = `${STORAGE_KEY}.probe`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

function quarantine(store: StorageLike, raw: string): void {
  try {
    store.setItem(QUARANTINE_KEY, raw);
  } catch {
    // Out of quota, most likely. Losing the copy is bad; failing the load over it is worse.
    return;
  }
}

/**
 * Never throws. Anything unreadable is set aside rather than repaired by guesswork — a half-valid
 * document written back is worse than a fresh start.
 */
export function loadDocument(store: StorageLike): LoadOutcome {
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return {
      doc: emptyDocument(),
      from: undefined,
      problem: 'Stored conversations could not be read.',
    };
  }

  if (raw === null) return { doc: emptyDocument(), from: undefined, problem: undefined };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantine(store, raw);
    return {
      doc: emptyDocument(),
      from: undefined,
      problem: 'Stored conversations were not valid JSON.',
    };
  }

  const result = migrate(parsed);
  if (!result.ok) {
    quarantine(store, raw);
    return { doc: emptyDocument(), from: undefined, problem: result.reason };
  }

  return { doc: result.doc, from: result.from, problem: undefined };
}

/** Reports a full quota rather than throwing — the message the user just sent must not be lost. */
export function saveDocument(store: StorageLike, doc: StoredDocument): SaveOutcome {
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(doc));
    return { ok: true };
  } catch {
    // ponytail: quota is the overwhelmingly likely cause and the message is the same either way;
    // distinguishing QuotaExceededError by name across browsers buys nothing until it does.
    return {
      ok: false,
      reason:
        'Conversations could not be saved — local storage is full. Delete a chat to free space.',
    };
  }
}
