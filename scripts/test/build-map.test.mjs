import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readJson, readJsonl, nowIso } from '../lib/enigma.mjs';
import { buildMap } from '../build-map.mjs';

const prov = () => ({
  value: 'owns', status: 'FACT',
  source: { type: 'confluence', ref: '1' }, confidence: 0.9, observed_at: nowIso(),
});

const candidates = () => ({
  entities: {
    company: { name: 'Acme' },
    teams: [{ id: 'platform-team', name: 'Platform' }],
    people: [{ id: 'dana', name: 'Dana', role: 'EM', team: 'platform-team' }],
    projects: [{ id: 'data-platform', name: 'Data Platform', status: 'active', team: 'platform-team' }],
    components: [{ id: 'airflow', name: 'Airflow' }],
  },
  relationships: [
    { from: 'platform-team', type: 'owns', to: 'airflow', provenance: prov() },
  ],
});

test('buildMap writes map files and ledger entries for every add', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  const res = await buildMap(root, candidates());
  assert.equal(res.ok, true);
  assert.equal(res.summary.added, 4);
  const teams = await readJson(path.join(root, '.enigma/map/teams.json'));
  assert.equal(teams[0].id, 'platform-team');
  const rels = await readJson(path.join(root, '.enigma/map/relationships.json'));
  assert.equal(rels.length, 1);
  const ledger = await readJsonl(path.join(root, '.enigma/ledger/changes.jsonl'));
  const types = ledger.map((e) => e.type).sort();
  assert.deepEqual(types, [
    'company.updated', 'component.added', 'person.added',
    'project.added', 'relationship.added', 'team.added',
  ]);
});

test('re-running with same candidates is idempotent; changes are updates', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await buildMap(root, candidates());
  const again = await buildMap(root, candidates());
  assert.equal(again.summary.added, 0);
  assert.equal(again.summary.updated, 0);
  const changed = candidates();
  changed.entities.projects[0].status = 'at-risk';
  const res = await buildMap(root, changed);
  assert.equal(res.summary.updated, 1);
  const ledger = await readJsonl(path.join(root, '.enigma/ledger/changes.jsonl'));
  assert.ok(ledger.some((e) => e.type === 'project.updated' && e.entity === 'data-platform'));
});

test('buildMap refuses relationships with unknown endpoints, writes nothing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  const bad = candidates();
  bad.relationships.push({ from: 'ghost-team', type: 'owns', to: 'airflow', provenance: prov() });
  const res = await buildMap(root, bad);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('ghost-team')));
  assert.deepEqual(await readJson(path.join(root, '.enigma/map/teams.json'), []), []);
});

test('aliases are merged across runs, never overwritten', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await buildMap(root, {
    entities: { projects: [{ id: 'data-platform', name: 'Data Platform', aliases: ['DP'] }] },
    relationships: [],
  });
  await buildMap(root, {
    entities: { projects: [{ id: 'data-platform', name: 'Data Platform', aliases: ['DATA', 'DP'] }] },
    relationships: [],
  });
  const projects = await readJson(path.join(root, '.enigma/map/projects.json'));
  assert.deepEqual(projects[0].aliases, ['DP', 'DATA']);
});

test('an entity with no aliases gains no aliases field', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await buildMap(root, {
    entities: { components: [{ id: 'vault', name: 'Vault' }] },
    relationships: [],
  });
  await buildMap(root, {
    entities: { components: [{ id: 'vault', name: 'Vault', kind: 'service' }] },
    relationships: [],
  });
  const components = await readJson(path.join(root, '.enigma/map/components.json'));
  assert.equal(components[0].aliases, undefined);
  assert.equal(components[0].kind, 'service');
});

test('a relationship without a valid provenance envelope is rejected before any write', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  const res = await buildMap(root, {
    entities: { teams: [{ id: 't1', name: 'T1' }], components: [{ id: 'c1', name: 'C1' }] },
    relationships: [{ from: 't1', type: 'owns', to: 'c1' }],
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('provenance')));
  // Nothing was written, so validate-state cannot be bricked by this batch.
  assert.deepEqual(await readJson(path.join(root, '.enigma/map/relationships.json'), []), []);
  assert.deepEqual(await readJsonl(path.join(root, '.enigma/ledger/changes.jsonl')), []);
});

test('an id cannot be claimed by two kinds', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await buildMap(root, {
    entities: { projects: [{ id: 'vault', name: 'Vault programme' }] },
    relationships: [],
  });
  const res = await buildMap(root, {
    entities: { components: [{ id: 'vault', name: 'Vault service' }] },
    relationships: [],
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('vault') && e.includes('unique across kinds')));
  const projects = await readJson(path.join(root, '.enigma/map/projects.json'));
  assert.equal(projects[0].name, 'Vault programme', 'the original entity is untouched');
});
