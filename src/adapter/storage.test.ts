import { afterEach, describe, expect, it, vi } from 'vitest';

import { CURRENT_VERSION, emptyDocument, type StoredDocument } from '@/core/storage/schema';

import {
  browserStorage,
  loadDocument,
  QUARANTINE_KEY,
  saveDocument,
  STORAGE_KEY,
  type StorageLike,
} from './storage';

/** A `Storage` that can be told to fail, which is the interesting half of the driver. */
function fakeStorage(
  initial: Record<string, string> = {},
  fail: { get?: boolean; set?: boolean } = {},
): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(key) {
      if (fail.get === true) throw new Error('SecurityError');
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      if (fail.set === true) throw new Error('QuotaExceededError');
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

const DOC: StoredDocument = {
  version: CURRENT_VERSION,
  conversations: [
    {
      id: 'c1',
      title: 'First chat',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_500,
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'Hello',
          createdAt: 1_700_000_000_000,
          status: 'complete',
        },
      ],
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadDocument', () => {
  it('returns an empty document on first run, with nothing to report', () => {
    expect(loadDocument(fakeStorage())).toEqual({
      doc: emptyDocument(),
      from: undefined,
      problem: undefined,
    });
  });

  it('round-trips a document written by saveDocument', () => {
    const store = fakeStorage();
    expect(saveDocument(store, DOC)).toEqual({ ok: true });

    const loaded = loadDocument(store);
    expect(loaded.doc).toEqual(DOC);
    expect(loaded.from).toBe(CURRENT_VERSION);
    expect(loaded.problem).toBeUndefined();
  });

  it('sets unparseable bytes aside instead of overwriting them', () => {
    const store = fakeStorage({ [STORAGE_KEY]: '{ not json' });
    const loaded = loadDocument(store);

    expect(loaded.doc).toEqual(emptyDocument());
    expect(loaded.problem).toBe('Stored conversations were not valid JSON.');
    expect(store.map.get(QUARANTINE_KEY)).toBe('{ not json');
  });

  it('sets a document the migration rejects aside, and reports the reason', () => {
    const raw = JSON.stringify({ version: 99, conversations: [] });
    const store = fakeStorage({ [STORAGE_KEY]: raw });
    const loaded = loadDocument(store);

    expect(loaded.doc).toEqual(emptyDocument());
    expect(loaded.problem).toMatch(/version 99/);
    expect(store.map.get(QUARANTINE_KEY)).toBe(raw);
  });

  it('sets a structurally invalid document aside rather than half-loading it', () => {
    const raw = JSON.stringify({ version: 1, conversations: [{ id: 'c1' }] });
    const store = fakeStorage({ [STORAGE_KEY]: raw });

    expect(loadDocument(store).doc).toEqual(emptyDocument());
    expect(store.map.get(QUARANTINE_KEY)).toBe(raw);
  });

  it('survives a storage that throws on read', () => {
    const loaded = loadDocument(fakeStorage({}, { get: true }));

    expect(loaded.doc).toEqual(emptyDocument());
    expect(loaded.problem).toBe('Stored conversations could not be read.');
  });

  it('still loads when the quarantine write itself fails', () => {
    // Quota is full and the stored value is junk: losing the copy beats failing the load.
    const store = fakeStorage({ [STORAGE_KEY]: 'junk' }, { set: true });

    expect(loadDocument(store).doc).toEqual(emptyDocument());
    expect(store.map.has(QUARANTINE_KEY)).toBe(false);
  });
});

describe('saveDocument', () => {
  it('reports a full quota rather than throwing', () => {
    const result = saveDocument(fakeStorage({}, { set: true }), DOC);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/local storage is full/);
  });

  it('writes under the documented key', () => {
    const store = fakeStorage();
    saveDocument(store, DOC);

    expect(JSON.parse(store.map.get(STORAGE_KEY) ?? 'null')).toEqual(DOC);
  });
});

describe('browserStorage', () => {
  it('returns the store when localStorage is usable, leaving no probe behind', () => {
    const store = fakeStorage();
    vi.stubGlobal('localStorage', store);

    expect(browserStorage()).toBe(store);
    expect(store.map.size).toBe(0);
  });

  it('returns null when localStorage is present but cannot be written', () => {
    vi.stubGlobal('localStorage', fakeStorage({}, { set: true }));

    expect(browserStorage()).toBeNull();
  });

  it('returns null when reaching for localStorage throws', () => {
    // Safari private mode and a blocked-cookies policy both throw on access itself.
    vi.stubGlobal('localStorage', undefined);

    expect(browserStorage()).toBeNull();
  });
});
