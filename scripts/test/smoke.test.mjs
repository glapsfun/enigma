import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nowIso, writeJson, sha256Hex } from '../lib/enigma.mjs';
import { buildMap } from '../build-map.mjs';
import { validateState } from '../validate-state.mjs';
import { loadContext } from '../load-context.mjs';
import { checkpoint } from '../checkpoint.mjs';
import { diffState } from '../diff-state.mjs';
import { ingestEvidence } from '../ingest-evidence.mjs';
import { buildIndex, indexIsStale } from '../build-index.mjs';
import { query } from '../query.mjs';
import { coverage } from '../coverage.mjs';

const prov = (v, status = 'FACT') => ({
  value: v, status, source: { type: 'docs', ref: 'fixtures/acme' },
  confidence: status === 'FACT' ? 0.9 : 0.6, observed_at: nowIso(),
});

test('full deterministic pipeline on acme-shaped data', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await writeJson(path.join(root, '.enigma/index/sources.json'), {
    sources: [{ id: 'docs', status: 'available' }],
  });
  const built = await buildMap(root, {
    entities: {
      company: { name: 'Acme' },
      teams: [
        { id: 'data-eng', name: 'Data Engineering', process: prov('scrum', 'INFERENCE') },
        { id: 'platform', name: 'Platform', process: prov('kanban', 'INFERENCE') },
      ],
      people: [
        { id: 'dana', name: 'Dana Reyes', role: 'EM', team: 'data-eng' },
        { id: 'sam', name: 'Sam Cole', role: 'EM', team: 'platform' },
      ],
      projects: [{ id: 'data-platform', name: 'Data Platform', status: 'active', team: 'data-eng' }],
      components: [
        { id: 'airflow', name: 'Airflow' }, { id: 'vault', name: 'Vault' },
        { id: 'ingestion', name: 'Ingestion service' },
      ],
    },
    relationships: [
      { from: 'data-eng', type: 'owns', to: 'airflow', provenance: prov('owns') },
      { from: 'platform', type: 'owns', to: 'vault', provenance: prov('owns') },
      { from: 'ingestion', type: 'depends_on', to: 'vault', provenance: prov('depends') },
      { from: 'data-platform', type: 'depends_on', to: 'ingestion', provenance: prov('depends') },
    ],
  });
  assert.equal(built.ok, true);

  const valid = await validateState(root);
  assert.deepEqual(valid.errors, []);

  const ctx = await loadContext(root, 'data-platform');
  assert.equal(ctx.ok, true);
  assert.equal(ctx.bundle.team.id, 'data-eng');
  assert.ok(ctx.bundle.components.some((c) => c.id === 'ingestion'));

  await checkpoint(root, { label: 'init', scanned: ['docs'] });
  const diff = await diffState(root);
  assert.deepEqual(diff.fresh, ['docs']);
  assert.deepEqual(diff.refresh, []);
});

test('slice 2: evidence, index, and query on top of the map', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await writeJson(path.join(root, '.enigma/index/sources.json'), {
    sources: [{ id: 'docs', status: 'available', consent: 'approved' }],
  });
  const built = await buildMap(root, {
    entities: {
      teams: [{ id: 'data-eng', name: 'Data Engineering', aliases: ['DE'] }],
      projects: [{ id: 'data-platform', name: 'Data Platform', team: 'data-eng', status: 'active', aliases: ['DP'] }],
      components: [{ id: 'vault', name: 'Vault' }],
    },
    relationships: [{ from: 'data-platform', type: 'depends_on', to: 'vault', provenance: prov('depends') }],
  });
  assert.equal(built.ok, true);

  const ingested = await ingestEvidence(root, [{
    source: { type: 'docs', ref: 'roadmap.md' }, title: 'Roadmap Q3', kind: 'readme',
    summary: 'Roadmap claims a June cutover for the ingestion rewrite.',
    excerpts: [{ quote: 'Cutover: June.', why: 'stated date' }],
    entities: ['data-platform'], topics: ['roadmap'],
    fetched_at: nowIso(), content_hash: sha256Hex('roadmap v1'),
  }]);
  assert.equal(ingested.ok, true);

  const index = await buildIndex(root);
  assert.deepEqual(index.warnings, []);
  assert.equal(index.counts.entities, 3);

  assert.equal((await query(root, 'data-platform')).resolved, 'data-platform');
  assert.equal((await query(root, 'dp')).resolved, 'data-platform');
  const kw = await query(root, 'cutover june roadmap');
  assert.ok(kw.hits[0].ref.startsWith('docs-'));

  const valid = await validateState(root);
  assert.deepEqual(valid.errors, []);

  await checkpoint(root, {
    label: 'init', scanned: ['docs'],
    sourceState: { docs: { depth: 'deep', read: 4, known: 4, complete: true } },
    queue: [{ area: 'data-platform', source: 'docs', depth: 'deep', status: 'done' }],
  });
  const cov = await coverage(root, 'data-platform');
  assert.equal(cov.sources.docs.complete, true);
  assert.equal(cov.entity.deep_done, true);

  const later = new Date(Date.now() + 10_000);
  await utimes(path.join(root, '.enigma/map/teams.json'), later, later);
  assert.equal(await indexIsStale(root), true);
});
