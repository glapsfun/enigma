import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nowIso, writeJson, appendJsonl, sha256Hex } from '../lib/enigma.mjs';
import { ingestEvidence } from '../ingest-evidence.mjs';
import { buildIndex } from '../build-index.mjs';
import { buildMap } from '../build-map.mjs';
import { validateState } from '../validate-state.mjs';

const prov = () => ({
  value: 'owns', status: 'FACT',
  source: { type: 'confluence', ref: '1' }, confidence: 0.9, observed_at: nowIso(),
});

async function healthyWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await buildMap(root, {
    entities: {
      teams: [{ id: 't1', name: 'T1' }],
      people: [{ id: 'p1', name: 'P1', team: 't1' }],
      projects: [{ id: 'proj1', name: 'Proj', team: 't1', status: 'active' }],
      components: [{ id: 'c1', name: 'C1' }],
    },
    relationships: [{ from: 't1', type: 'owns', to: 'c1', provenance: prov() }],
  });
  return root;
}

test('healthy workspace validates clean', async () => {
  const root = await healthyWorkspace();
  const res = await validateState(root);
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
});

test('missing .enigma directory is a single clear error', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  const res = await validateState(root);
  assert.equal(res.ok, false);
  assert.ok(res.errors[0].includes('/enigma:init'));
});

test('detects corrupt json, bad envelope, and map entity missing from ledger', async () => {
  const root = await healthyWorkspace();
  // corrupt one map file
  await writeFile(path.join(root, '.enigma/map/components.json'), '{not json');
  // fact with an invalid envelope
  await appendJsonl(path.join(root, '.enigma/memory/facts.jsonl'), {
    value: 'x', status: 'GUESS', source: {}, confidence: 5, observed_at: 'nope',
  });
  // team added behind the ledger's back
  await writeJson(path.join(root, '.enigma/map/teams.json'), [
    { id: 't1', name: 'T1' }, { id: 'ghost', name: 'Ghost' },
  ]);
  const res = await validateState(root);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('components.json')));
  assert.ok(res.errors.some((e) => e.includes('facts.jsonl')));
  assert.ok(res.errors.some((e) => e.includes('ghost') && e.includes('ledger')));
});

test('a workspace with evidence and a fresh index validates clean', async () => {
  const root = await healthyWorkspace();
  await ingestEvidence(root, [{
    source: { type: 'docs', ref: 'README.md' }, title: 'Readme', kind: 'readme',
    summary: 'Explains C1.', excerpts: [{ quote: 'C1 is owned by T1.', why: 'ownership' }],
    entities: ['c1'], topics: ['ownership'],
    fetched_at: nowIso(), content_hash: sha256Hex('readme v1'),
  }]);
  await buildIndex(root);
  const res = await validateState(root);
  assert.deepEqual(res.errors, []);
  assert.ok(!res.warnings.some((w) => w.includes('index stale')));
});

test('evidence written outside ingest-evidence is an error', async () => {
  const root = await healthyWorkspace();
  await mkdir(path.join(root, '.enigma/evidence/docs'), { recursive: true });
  await writeJson(path.join(root, '.enigma/evidence/docs/docs-deadbeef.json'), {
    id: 'docs-deadbeef', source: { type: 'docs', ref: 'x' }, title: 'Smuggled',
    kind: 'readme', summary: 'No ledger entry.', excerpts: [], entities: ['c1'],
    fetched_at: nowIso(), content_hash: sha256Hex('x'),
  });
  const res = await validateState(root);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('docs-deadbeef') && e.includes('ledger')));
});

test('evidence pointing at an unknown entity is an error', async () => {
  const root = await healthyWorkspace();
  await mkdir(path.join(root, '.enigma/evidence/docs'), { recursive: true });
  await writeJson(path.join(root, '.enigma/evidence/docs/docs-cafebabe.json'), {
    id: 'docs-cafebabe', source: { type: 'docs', ref: 'x' }, title: 'Orphan',
    kind: 'readme', summary: 'Points nowhere.', excerpts: [], entities: ['ghost'],
    fetched_at: nowIso(), content_hash: sha256Hex('y'),
  });
  const res = await validateState(root);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('unknown entity "ghost"')));
});

test('missing consent and a stale index are warnings, not errors', async () => {
  const root = await healthyWorkspace();
  await writeJson(path.join(root, '.enigma/index/sources.json'), {
    sources: [{ id: 'jira', status: 'available' }],
  });
  const res = await validateState(root);
  assert.deepEqual(res.errors, []);
  assert.ok(res.warnings.some((w) => w.includes('consent')));
  assert.ok(res.warnings.some((w) => w.includes('index stale')));
});

test('a queue entry for an unknown area is a warning', async () => {
  const root = await healthyWorkspace();
  await writeJson(path.join(root, '.enigma/state/discovery.json'), {
    sources: {}, queue: [{ area: 'nope', source: 'jira', depth: 'deep', status: 'pending' }],
  });
  const res = await validateState(root);
  assert.ok(res.warnings.some((w) => w.includes('unknown area "nope"')));
});
