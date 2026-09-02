import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nowIso, readJson, readJsonl, appendJsonl, sha256Hex } from '../lib/enigma.mjs';
import { buildMap } from '../build-map.mjs';
import { ingestEvidence } from '../ingest-evidence.mjs';
import { buildIndex, indexIsStale } from '../build-index.mjs';

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await buildMap(root, {
    entities: {
      teams: [{ id: 'data-eng', name: 'Data Engineering', aliases: ['DE'] }],
      projects: [{ id: 'data-platform', name: 'Data Platform', team: 'data-eng', status: 'active', aliases: ['DP'] }],
      components: [{ id: 'vault', name: 'Vault' }],
    },
    relationships: [],
  });
  await appendJsonl(path.join(root, '.enigma/memory/facts.jsonl'), {
    entity: 'data-platform', value: 'Migration blocked on a security review',
    status: 'FACT', source: { type: 'user' }, confidence: 1, observed_at: nowIso(),
  });
  await ingestEvidence(root, [{
    source: { type: 'confluence', ref: '1' },
    title: 'Ingestion architecture', kind: 'page',
    summary: 'Ingestion writes to the warehouse.',
    excerpts: [{ quote: 'Ingestion depends on Vault.', why: 'dependency' }],
    entities: ['data-platform', 'vault'], topics: ['Architecture'],
    fetched_at: nowIso(), content_hash: sha256Hex('body'),
  }]);
  return root;
}

test('builds entities, aliases, keywords, and topics', async () => {
  const root = await workspace();
  const res = await buildIndex(root);
  assert.equal(res.ok, true);
  assert.deepEqual(res.warnings, []);

  const entities = await readJson(path.join(root, '.enigma/index/entities.json'));
  assert.equal(entities['data-platform'].kind, 'project');
  assert.equal(entities['data-platform'].file, 'map/projects.json');
  assert.equal(entities['data-platform'].evidence_count, 1);
  assert.equal(entities['vault'].evidence_count, 1);
  assert.equal(entities['data-eng'].evidence_count, 0);

  const aliases = await readJson(path.join(root, '.enigma/index/aliases.json'));
  assert.equal(aliases['dp'], 'data-platform');
  assert.equal(aliases['data platform'], 'data-platform');
  assert.equal(aliases['data-platform'], 'data-platform');

  const keywords = await readJson(path.join(root, '.enigma/index/keywords.json'));
  assert.equal(keywords['platform'].find((r) => r.ref === 'data-platform').weight, 3);
  assert.ok(keywords['security'].some((r) => r.ref === 'data-platform'));
  assert.ok(keywords['ingestion'].some((r) => r.ref.startsWith('confluence-')));

  const topics = await readJson(path.join(root, '.enigma/index/topics.json'));
  assert.deepEqual(topics['architecture'].entities.sort(), ['data-platform', 'vault']);

  const ledger = await readJsonl(path.join(root, '.enigma/ledger/changes.jsonl'));
  const entry = ledger.filter((e) => e.type === 'index.rebuilt').at(-1);
  assert.equal(entry.entity, 'index');
  assert.equal(entry.change.entities, 3);
});

test('rebuild is idempotent and drops removed data', async () => {
  const root = await workspace();
  await buildIndex(root);
  const first = await readJson(path.join(root, '.enigma/index/keywords.json'));
  await buildIndex(root);
  const second = await readJson(path.join(root, '.enigma/index/keywords.json'));
  assert.deepEqual(second, first);
});

test('an alias claimed by two entities is omitted and warned about', async () => {
  const root = await workspace();
  await buildMap(root, {
    entities: { components: [{ id: 'dp-service', name: 'DP', aliases: [] }] },
    relationships: [],
  });
  const res = await buildIndex(root);
  assert.ok(res.warnings.some((w) => w.includes('"dp"')));
  const aliases = await readJson(path.join(root, '.enigma/index/aliases.json'));
  assert.equal(aliases['dp'], undefined);
});

test('indexIsStale: true with no index, false after build, true after a later map write', async () => {
  const root = await workspace();
  assert.equal(await indexIsStale(root), true);
  await buildIndex(root);
  assert.equal(await indexIsStale(root), false);
  const later = new Date(Date.now() + 10_000);
  await utimes(path.join(root, '.enigma/map/teams.json'), later, later);
  assert.equal(await indexIsStale(root), true);
});
