import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeJson, readJson } from '../lib/enigma.mjs';
import { diffState } from '../diff-state.mjs';
import { checkpoint } from '../checkpoint.mjs';

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await writeJson(path.join(root, '.enigma/index/sources.json'), {
    sources: [
      { id: 'jira', status: 'available' },
      { id: 'slack', status: 'degraded' },
      { id: 'docs', status: 'available' },
    ],
  });
  return root;
}

test('diffState: unscanned sources need refresh; degraded are unavailable', async () => {
  const root = await workspace();
  const res = await diffState(root);
  assert.deepEqual(res.refresh.sort(), ['docs', 'jira']);
  assert.deepEqual(res.unavailable, ['slack']);
});

test('checkpoint marks sources scanned; diffState then reports them fresh', async () => {
  const root = await workspace();
  const rec = await checkpoint(root, { label: 'init', scanned: ['jira'] });
  assert.ok(!Number.isNaN(Date.parse(rec.time)));
  const res = await diffState(root);
  assert.deepEqual(res.fresh, ['jira']);
  assert.deepEqual(res.refresh, ['docs']);
  const cps = await readJson(path.join(root, '.enigma/state/checkpoints.json'));
  assert.equal(cps.length, 1);
  assert.equal(cps[0].label, 'init');
});

test('old scans fall back into refresh after max age', async () => {
  const root = await workspace();
  await writeJson(path.join(root, '.enigma/state/discovery.json'), {
    sources: { jira: { last_scanned: '2020-01-01T00:00:00Z' } },
  });
  const res = await diffState(root, 24);
  assert.ok(res.refresh.includes('jira'));
});

test('checkpoint merges per-source cursor state and replaces the queue', async () => {
  const root = await workspace();
  await checkpoint(root, {
    label: 'shallow',
    scanned: ['jira'],
    sourceState: { jira: { depth: 'shallow', read: 20, known: 310, complete: false } },
    queue: [{ area: 'data-platform', source: 'jira', depth: 'deep', status: 'pending' }],
  });
  const d = await readJson(path.join(root, '.enigma/state/discovery.json'));
  assert.equal(d.sources.jira.depth, 'shallow');
  assert.equal(d.sources.jira.known, 310);
  assert.ok(d.sources.jira.last_scanned);
  assert.equal(d.queue.length, 1);

  await checkpoint(root, { label: 'deep', sourceState: { jira: { depth: 'deep', complete: true } } });
  const after = await readJson(path.join(root, '.enigma/state/discovery.json'));
  assert.equal(after.sources.jira.depth, 'deep');
  assert.equal(after.sources.jira.known, 310, 'unrelated cursor fields survive a merge');
  assert.equal(after.sources.jira.complete, true);
});

test('diffState reports incomplete sources, excluded consent, and resumable queue entries', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await writeJson(path.join(root, '.enigma/index/sources.json'), {
    sources: [
      { id: 'jira', status: 'available', consent: 'approved' },
      { id: 'slack', status: 'available', consent: 'excluded' },
      { id: 'docs', status: 'available', consent: 'approved' },
    ],
  });
  await checkpoint(root, {
    label: 'shallow',
    scanned: ['jira', 'docs'],
    sourceState: { jira: { complete: false }, docs: { complete: true } },
    queue: [
      { area: 'data-platform', source: 'jira', depth: 'deep', status: 'pending' },
      { area: 'vault', source: 'jira', depth: 'deep', status: 'done' },
    ],
  });
  const res = await diffState(root);
  assert.deepEqual(res.excluded, ['slack']);
  assert.ok(res.refresh.includes('jira'), 'complete:false always needs refresh');
  assert.ok(res.fresh.includes('docs'));
  assert.deepEqual(res.resume.map((q) => q.area), ['data-platform']);
});

test('diffState lists sources with no consent decision so init can ask before reading', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await writeJson(path.join(root, '.enigma/index/sources.json'), {
    sources: [
      { id: 'jira', status: 'available', consent: 'approved' },
      { id: 'confluence', status: 'available', consent: 'limited' },
      { id: 'github', status: 'available' },
      { id: 'slack', status: 'available', consent: 'excluded' },
    ],
  });
  const res = await diffState(root);
  assert.deepEqual(res.needs_consent, ['github']);
  assert.deepEqual(res.excluded, ['slack']);
});

test('a corrupt last_scanned forces a refresh instead of pinning the source as fresh', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await writeJson(path.join(root, '.enigma/index/sources.json'), {
    sources: [{ id: 'docs', status: 'available', consent: 'approved' }],
  });
  await writeJson(path.join(root, '.enigma/state/discovery.json'), {
    sources: { docs: { last_scanned: 'not-a-date', complete: true } }, queue: [],
  });
  const res = await diffState(root);
  assert.deepEqual(res.refresh, ['docs']);
  assert.deepEqual(res.fresh, []);
});
