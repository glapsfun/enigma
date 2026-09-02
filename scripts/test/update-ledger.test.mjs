import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readJsonl } from '../lib/enigma.mjs';
import { appendLedger } from '../update-ledger.mjs';

test('appendLedger stamps time and appends, never rewrites', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  const ledgerFile = path.join(root, '.enigma', 'ledger', 'changes.jsonl');
  const r1 = await appendLedger(root, {
    type: 'project.updated', entity: 'data-platform', source: 'jira',
    change: { status: ['planning', 'active'] },
  });
  assert.ok(!Number.isNaN(Date.parse(r1.time)));
  await appendLedger(root, { type: 'team.added', entity: 'platform-team', source: 'confluence' });
  const rows = await readJsonl(ledgerFile);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].entity, 'data-platform');
  assert.equal(rows[1].type, 'team.added');
});

test('appendLedger rejects entries without type or entity', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await assert.rejects(appendLedger(root, { entity: 'x' }), /type/);
  await assert.rejects(appendLedger(root, { type: 'x.added' }), /entity/);
});
