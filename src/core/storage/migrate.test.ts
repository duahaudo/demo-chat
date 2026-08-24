import { describe, expect, it } from 'vitest';

import {
  CURRENT_VERSION,
  emptyDocument,
  isCurrentDocument,
  migrate,
  runMigrations,
  type MigrationMap,
  type VersionedDocument,
} from './migrate';

const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'm1',
  role: 'user',
  content: 'Hello',
  createdAt: 1_700_000_000_000,
  status: 'complete',
  ...overrides,
});

const conversation = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  title: 'First chat',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_500,
  messages: [message()],
  ...overrides,
});

const document = (overrides: Record<string, unknown> = {}) => ({
  version: CURRENT_VERSION,
  conversations: [conversation()],
  ...overrides,
});

describe('emptyDocument', () => {
  it('is valid at the current version and holds nothing', () => {
    const doc = emptyDocument();
    expect(doc.version).toBe(CURRENT_VERSION);
    expect(doc.conversations).toEqual([]);
    expect(isCurrentDocument(doc)).toBe(true);
  });
});

describe('migrate — current version', () => {
  it('accepts a document already at the current version, unchanged', () => {
    const stored = document();
    const result = migrate(stored);
    expect(result).toEqual({ ok: true, doc: stored, from: CURRENT_VERSION });
  });

  it('survives a round trip through JSON, which is how it is really stored', () => {
    const result = migrate(JSON.parse(JSON.stringify(emptyDocument())));
    expect(result.ok).toBe(true);
  });

  it('accepts an interrupted message, because partial content is kept', () => {
    const stored = document({
      conversations: [
        conversation({
          messages: [message({ role: 'assistant', status: 'interrupted', content: 'Par' })],
        }),
      ],
    });
    expect(migrate(stored).ok).toBe(true);
  });
});

describe('migrate — rejection', () => {
  it.each([
    ['a newer version', document({ version: CURRENT_VERSION + 1 })],
    ['version zero', document({ version: 0 })],
    ['a non-integer version', document({ version: 1.5 })],
    ['a string version', document({ version: '1' })],
    ['no version at all', { conversations: [] }],
    ['a JSON array', []],
    ['a string', 'not a document'],
    ['null', null],
  ])('rejects %s with a reason', (_label, input) => {
    const result = migrate(input);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason.length > 0).toBe(true);
  });

  it('names the version it could not read', () => {
    const result = migrate(document({ version: 99 }));
    expect(result.ok === false && result.reason).toContain('99');
  });

  it.each([
    ['conversations is not an array', document({ conversations: {} })],
    ['a conversation is missing its id', document({ conversations: [conversation({ id: 42 })] })],
    [
      'a timestamp is not finite',
      document({ conversations: [conversation({ updatedAt: Number.NaN })] }),
    ],
    ['messages is not an array', document({ conversations: [conversation({ messages: 'none' })] })],
    [
      'a message has an unknown role',
      document({ conversations: [conversation({ messages: [message({ role: 'system' })] })] }),
    ],
    [
      'a message has an unknown status',
      document({ conversations: [conversation({ messages: [message({ status: 'pending' })] })] }),
    ],
  ])('rejects a document where %s', (_label, input) => {
    expect(migrate(input).ok).toBe(false);
  });
});

describe('isCurrentDocument', () => {
  it('accepts a valid document and rejects a mismatched version', () => {
    expect(isCurrentDocument(document())).toBe(true);
    expect(isCurrentDocument(document({ version: 2 }))).toBe(false);
    expect(isCurrentDocument('nope')).toBe(false);
  });
});

/**
 * The harness carries no migrations at v1, so it is proven against a synthetic chain. This is the
 * test that would have to exist anyway the day a real v2 lands (ADR-0006).
 */
describe('runMigrations — the harness', () => {
  const bump =
    (to: number, mutate: (doc: VersionedDocument) => Record<string, unknown> = () => ({})) =>
    (doc: VersionedDocument): VersionedDocument => ({ ...doc, ...mutate(doc), version: to });

  const chain: MigrationMap = new Map([
    [1, bump(2, () => ({ renamedIn: 2 }))],
    [2, bump(3, () => ({ renamedIn: 3 }))],
  ]);

  it('walks every version forward to the target', () => {
    const result = runMigrations({ version: 1, conversations: [] }, 3, chain);
    expect(result).toEqual({ ok: true, doc: { version: 3, conversations: [], renamedIn: 3 } });
  });

  it('starts from whatever version the document declares, not from the first', () => {
    const result = runMigrations({ version: 2 }, 3, chain);
    expect(result.ok && result.doc.version).toBe(3);
    expect(result.ok && result.doc['renamedIn']).toBe(3);
  });

  it('does nothing when the document is already at the target', () => {
    const doc = { version: 3, conversations: [] };
    expect(runMigrations(doc, 3, chain)).toEqual({ ok: true, doc });
  });

  it('rejects rather than guessing when a step is missing from the chain', () => {
    const result = runMigrations({ version: 1 }, 3, new Map([[2, bump(3)]]));
    expect(result).toEqual({ ok: false, reason: 'No migration from version 1.' });
  });

  it('rejects a step that fails to advance, instead of looping forever', () => {
    const stuck: MigrationMap = new Map([[1, (doc) => doc]]);
    const result = runMigrations({ version: 1 }, 2, stuck);
    expect(result).toEqual({ ok: false, reason: 'Migration from version 1 did not advance.' });
  });

  it('rejects a step that moves the version backwards', () => {
    const backwards: MigrationMap = new Map([[2, bump(1)]]);
    expect(runMigrations({ version: 2 }, 3, backwards).ok).toBe(false);
  });
});
