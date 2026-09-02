import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nowIso, sha256Hex } from '../lib/enigma.mjs';
import { buildMap } from '../build-map.mjs';
import { ingestEvidence } from '../ingest-evidence.mjs';
import { buildIndex } from '../build-index.mjs';
import { query } from '../query.mjs';

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await buildMap(root, {
    entities: {
      teams: [{ id: 'data-eng', name: 'Data Engineering', aliases: ['DE'] }],
      projects: [{ id: 'data-platform', name: 'Data Platform', team: 'data-eng', status: 'active', aliases: ['DP', 'DATA'] }],
      components: [{ id: 'vault', name: 'Vault' }],
    },
    relationships: [],
  });
  await ingestEvidence(root, [{
    source: { type: 'jira', ref: 'DATA-142' },
    title: 'Security review for ingestion', kind: 'ticket',
    summary: 'Unowned security review blocking the ingestion cutover.',
    excerpts: [{ quote: 'No owner assigned for the security review.', why: 'blocker' }],
    entities: ['data-platform'], topics: ['risk'],
    fetched_at: nowIso(), content_hash: sha256Hex('DATA-142 v1'),
  }]);
  await buildIndex(root);
  return root;
}

test('resolves an exact entity id', async () => {
  const root = await workspace();
  const res = await query(root, 'data-platform');
  assert.equal(res.resolved, 'data-platform');
  assert.equal(res.hits[0].why[0], 'exact id');
});

test('resolves an alias case-insensitively', async () => {
  const root = await workspace();
  const res = await query(root, 'DP');
  assert.equal(res.resolved, 'data-platform');
  const lower = await query(root, 'dp');
  assert.equal(lower.resolved, 'data-platform');
});

test('ranks keyword hits, entities above evidence at equal score', async () => {
  const root = await workspace();
  const res = await query(root, 'security review ingestion');
  assert.equal(res.resolved, null);
  const top = res.hits[0];
  assert.ok(top.ref.startsWith('jira-'));
  assert.equal(top.kind, 'evidence');
  assert.equal(top.title, 'Security review for ingestion');
  assert.ok(top.why.includes('security'));
});

test('kind filter returns only entities of that kind', async () => {
  const root = await workspace();
  const res = await query(root, 'data', { kind: 'team' });
  assert.ok(res.hits.every((h) => h.kind === 'team'));
  assert.equal(res.resolved, 'data-eng');
});

test('no match returns an empty result rather than a guess', async () => {
  const root = await workspace();
  const res = await query(root, 'kubernetes billing');
  assert.equal(res.ok, true);
  assert.equal(res.resolved, null);
  assert.deepEqual(res.hits, []);
});

test('a stale index is rebuilt before answering', async () => {
  const root = await workspace();
  await buildMap(root, { entities: { components: [{ id: 'airflow', name: 'Airflow' }] }, relationships: [] });
  const later = new Date(Date.now() + 10_000);
  await utimes(path.join(root, '.enigma/map/components.json'), later, later);
  const res = await query(root, 'airflow');
  assert.equal(res.resolved, 'airflow');
});

test('limit caps the hit list', async () => {
  const root = await workspace();
  const res = await query(root, 'data platform security review ingestion vault', { limit: 2 });
  assert.ok(res.hits.length <= 2);
});

test('a known entity resolves even when many evidence items outrank it', async () => {
  const root = await workspace();
  // 14 items all mentioning the project, so evidence fills the whole hit list.
  const items = [];
  for (let i = 0; i < 14; i++) {
    items.push({
      source: { type: 'jira', ref: `DATA-${i}` },
      title: `Data platform migration note ${i}`, kind: 'ticket',
      summary: 'Data platform migration progress on the data platform.',
      excerpts: [{ quote: 'Data platform migration continues.', why: 'progress' }],
      entities: ['data-platform'], topics: ['delivery'],
      fetched_at: nowIso(), content_hash: sha256Hex(`note ${i}`),
    });
  }
  await ingestEvidence(root, items);
  await buildIndex(root);

  const res = await query(root, 'the data platform migration');
  assert.equal(res.resolved, 'data-platform',
    'resolution must scan every ranked entity, not just the truncated hit list');
  assert.ok(res.hits.length <= 10);
});
