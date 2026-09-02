import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeJson } from '../lib/enigma.mjs';
import { checkpoint } from '../checkpoint.mjs';
import { coverage } from '../coverage.mjs';

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await writeJson(path.join(root, '.enigma/index/sources.json'), {
    sources: [
      { id: 'jira', status: 'available', consent: 'approved' },
      { id: 'slack', status: 'available', consent: 'excluded' },
    ],
  });
  await checkpoint(root, {
    label: 'shallow',
    scanned: ['jira'],
    sourceState: { jira: { depth: 'shallow', read: 20, known: 310, complete: false } },
    queue: [
      { area: 'data-platform', source: 'jira', depth: 'deep', status: 'pending' },
      { area: 'data-platform', source: 'docs', depth: 'deep', status: 'done' },
      { area: 'vault', source: 'jira', depth: 'deep', status: 'failed' },
    ],
  });
  return root;
}

test('reports per-source depth, counts, and consent', async () => {
  const root = await workspace();
  const res = await coverage(root);
  assert.equal(res.ok, true);
  assert.equal(res.sources.jira.depth, 'shallow');
  assert.equal(res.sources.jira.read, 20);
  assert.equal(res.sources.jira.known, 310);
  assert.equal(res.sources.jira.complete, false);
  assert.equal(res.sources.slack.consent, 'excluded');
  assert.equal(res.sources.slack.depth, 'none');
});

test('summarises the queue by status', async () => {
  const root = await workspace();
  const res = await coverage(root);
  assert.deepEqual(res.queue, { pending: 1, in_progress: 0, done: 1, failed: 1 });
});

test('entity coverage lists that area only', async () => {
  const root = await workspace();
  const res = await coverage(root, 'data-platform');
  assert.equal(res.entity.id, 'data-platform');
  assert.equal(res.entity.areas.length, 2);
  assert.equal(res.entity.deep_done, true);
  assert.equal(res.entity.pending, 1);
});

test('an unscanned workspace reports zeros rather than throwing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  const res = await coverage(root);
  assert.deepEqual(res.sources, {});
  assert.deepEqual(res.queue, { pending: 0, in_progress: 0, done: 0, failed: 0 });
});
