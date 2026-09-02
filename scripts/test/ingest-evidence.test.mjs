import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nowIso, readJson, readJsonl, sha256Hex } from '../lib/enigma.mjs';
import { buildMap } from '../build-map.mjs';
import { ingestEvidence } from '../ingest-evidence.mjs';

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await buildMap(root, {
    entities: {
      teams: [{ id: 'data-eng', name: 'Data Engineering' }],
      projects: [{ id: 'data-platform', name: 'Data Platform', team: 'data-eng', status: 'active' }],
    },
    relationships: [],
  });
  return root;
}

const item = (over = {}) => ({
  source: { type: 'confluence', ref: '12345', url: 'https://x/12345' },
  title: 'Data Platform architecture',
  kind: 'page',
  summary: 'Describes the ingestion path and the Vault dependency.',
  excerpts: [{ quote: 'Ingestion depends on Vault for secrets.', why: 'states dependency' }],
  entities: ['data-platform'],
  topics: ['architecture'],
  fetched_at: nowIso(),
  updated_at_source: null,
  content_hash: sha256Hex('page body v1'),
  ...over,
});

test('ingests an item, derives its id, and writes a ledger entry first', async () => {
  const root = await workspace();
  const res = await ingestEvidence(root, [item()]);
  assert.equal(res.ok, true);
  const id = `confluence-${sha256Hex('page body v1').slice(0, 8)}`;
  assert.deepEqual(res.added, [id]);

  const stored = await readJson(path.join(root, '.enigma/evidence/confluence', `${id}.json`));
  assert.equal(stored.title, 'Data Platform architecture');
  assert.equal(stored.excerpts[0].quote, 'Ingestion depends on Vault for secrets.');

  const ledger = await readJsonl(path.join(root, '.enigma/ledger/changes.jsonl'));
  const entry = ledger.find((e) => e.type === 'evidence.added');
  assert.equal(entry.entity, 'data-platform');
  assert.equal(entry.change.evidence, id);
  assert.deepEqual(entry.change.entities, ['data-platform']);
});

test('re-ingesting unchanged content is skipped, not duplicated', async () => {
  const root = await workspace();
  await ingestEvidence(root, [item()]);
  const res = await ingestEvidence(root, [item()]);
  assert.equal(res.ok, true);
  assert.deepEqual(res.added, []);
  assert.equal(res.skipped.length, 1);
  const ledger = await readJsonl(path.join(root, '.enigma/ledger/changes.jsonl'));
  assert.equal(ledger.filter((e) => e.type === 'evidence.added').length, 1);
});

test('changed content produces a new id alongside the old one', async () => {
  const root = await workspace();
  await ingestEvidence(root, [item()]);
  const res = await ingestEvidence(root, [
    item(),
    item({ content_hash: sha256Hex('page body v2') }),
  ]);
  assert.equal(res.added.length, 1);
  assert.equal(res.skipped.length, 1);
  assert.notEqual(res.added[0], res.skipped[0]);
});

test('rejects the whole batch when any item is invalid', async () => {
  const root = await workspace();
  const res = await ingestEvidence(root, [
    item(),
    item({ entities: ['ghost'], content_hash: sha256Hex('other') }),
  ]);
  assert.equal(res.ok, false);
  assert.deepEqual(res.added, []);
  assert.ok(res.errors.some((e) => e.includes('ghost')));
  const ledger = await readJsonl(path.join(root, '.enigma/ledger/changes.jsonl'));
  assert.equal(ledger.filter((e) => e.type === 'evidence.added').length, 0);
});

test('names every missing required field', async () => {
  const root = await workspace();
  const res = await ingestEvidence(root, [{ source: { type: 'nope' }, entities: [] }]);
  assert.equal(res.ok, false);
  for (const field of ['source.type', 'title', 'kind', 'summary', 'fetched_at', 'content_hash', 'entities']) {
    assert.ok(res.errors.some((e) => e.includes(field)), `expected an error naming ${field}`);
  }
});
