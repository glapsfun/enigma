import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nowIso, writeJson } from '../lib/enigma.mjs';
import { buildMap } from '../build-map.mjs';
import { validateState } from '../validate-state.mjs';
import { loadContext } from '../load-context.mjs';
import { checkpoint } from '../checkpoint.mjs';
import { diffState } from '../diff-state.mjs';

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
