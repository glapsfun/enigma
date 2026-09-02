import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nowIso, appendJsonl, sha256Hex } from '../lib/enigma.mjs';
import { ingestEvidence } from '../ingest-evidence.mjs';
import { checkpoint } from '../checkpoint.mjs';
import { buildMap } from '../build-map.mjs';
import { loadContext } from '../load-context.mjs';

const prov = (v = 'x') => ({
  value: v, status: 'FACT',
  source: { type: 'jira', ref: '1' }, confidence: 0.9, observed_at: nowIso(),
});

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await buildMap(root, {
    entities: {
      teams: [{ id: 'data-eng', name: 'Data Engineering' }, { id: 'sec', name: 'Security' }],
      people: [
        { id: 'dana', name: 'Dana', role: 'EM', team: 'data-eng' },
        { id: 'sam', name: 'Sam', role: 'engineer', team: 'sec' },
      ],
      projects: [{ id: 'data-platform', name: 'Data Platform', status: 'active', team: 'data-eng' }],
      components: [{ id: 'airflow', name: 'Airflow' }, { id: 'vault', name: 'Vault' }],
    },
    relationships: [
      { from: 'data-eng', type: 'owns', to: 'airflow', provenance: prov() },
      { from: 'data-platform', type: 'depends_on', to: 'airflow', provenance: prov() },
      { from: 'sec', type: 'owns', to: 'vault', provenance: prov() },
    ],
  });
  await appendJsonl(path.join(root, '.enigma/memory/facts.jsonl'),
    { entity: 'data-platform', ...prov('migration planned for Q4') });
  await appendJsonl(path.join(root, '.enigma/memory/facts.jsonl'),
    { entity: 'vault', ...prov('unrelated fact') });
  return root;
}

test('loadContext returns the related slice, not the whole map', async () => {
  const root = await workspace();
  const res = await loadContext(root, 'data-platform');
  assert.equal(res.ok, true);
  const b = res.bundle;
  assert.equal(b.kind, 'project');
  assert.equal(b.team.id, 'data-eng');
  assert.deepEqual(b.members.map((p) => p.id), ['dana']);
  assert.deepEqual(b.components.map((c) => c.id), ['airflow']);
  assert.equal(b.relationships.length, 1); // only edges touching data-platform
  assert.ok(b.ledger.every((e) => ['data-platform', 'airflow'].includes(e.entity)));
  assert.deepEqual(b.facts.map((f) => f.entity), ['data-platform']);
});

test('unknown entity lists known ids', async () => {
  const root = await workspace();
  const res = await loadContext(root, 'nope');
  assert.equal(res.ok, false);
  assert.ok(res.known.includes('data-platform'));
});

test('bundle carries aliases, related evidence newest first, and coverage', async () => {
  const root = await workspace();
  await buildMap(root, {
    entities: { projects: [{ id: 'data-platform', name: 'Data Platform', aliases: ['DP'] }] },
    relationships: [],
  });
  await ingestEvidence(root, [
    {
      source: { type: 'jira', ref: 'DATA-1' }, title: 'Older ticket', kind: 'ticket',
      summary: 'Older.', excerpts: [], entities: ['data-platform'], topics: [],
      fetched_at: '2026-08-01T00:00:00Z', content_hash: sha256Hex('older'),
    },
    {
      source: { type: 'jira', ref: 'DATA-2' }, title: 'Newer ticket', kind: 'ticket',
      summary: 'Newer.', excerpts: [], entities: ['airflow'], topics: [],
      fetched_at: '2026-08-20T00:00:00Z', content_hash: sha256Hex('newer'),
    },
    {
      source: { type: 'jira', ref: 'SEC-9' }, title: 'Unrelated ticket', kind: 'ticket',
      summary: 'Elsewhere.', excerpts: [], entities: ['vault'], topics: [],
      fetched_at: '2026-08-25T00:00:00Z', content_hash: sha256Hex('unrelated'),
    },
  ]);
  await checkpoint(root, {
    label: 'shallow', scanned: ['jira'],
    sourceState: { jira: { depth: 'shallow', read: 5, known: 90, complete: false } },
    queue: [{ area: 'data-platform', source: 'jira', depth: 'deep', status: 'pending' }],
  });

  const res = await loadContext(root, 'data-platform');
  assert.deepEqual(res.bundle.aliases, ['DP']);
  assert.deepEqual(res.bundle.evidence.map((e) => e.title), ['Newer ticket', 'Older ticket']);
  assert.equal(res.bundle.coverage.sources.jira.depth, 'shallow');
  assert.equal(res.bundle.coverage.entity.pending, 1);
});
