import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  nowIso, enigmaDir, readJson, writeJson, appendJsonl, readJsonl,
  envelopeErrors, parseArgs,
} from '../lib/enigma.mjs';

const tmp = () => mkdtemp(path.join(tmpdir(), 'enigma-'));

test('nowIso returns ISO-8601', () => {
  assert.ok(!Number.isNaN(Date.parse(nowIso())));
});

test('enigmaDir joins .enigma under root', () => {
  assert.equal(enigmaDir('/ws'), path.join('/ws', '.enigma'));
});

test('writeJson/readJson round-trip and fallback', async () => {
  const dir = await tmp();
  const file = path.join(dir, 'a', 'b.json');
  await writeJson(file, { x: 1 });
  assert.deepEqual(await readJson(file), { x: 1 });
  assert.deepEqual(await readJson(path.join(dir, 'missing.json'), []), []);
  await assert.rejects(readJson(path.join(dir, 'missing.json')));
  const raw = await readFile(file, 'utf8');
  assert.ok(raw.endsWith('\n'));
});

test('appendJsonl/readJsonl round-trip; missing file is []', async () => {
  const dir = await tmp();
  const file = path.join(dir, 'log.jsonl');
  assert.deepEqual(await readJsonl(file), []);
  await appendJsonl(file, { n: 1 });
  await appendJsonl(file, { n: 2 });
  assert.deepEqual(await readJsonl(file), [{ n: 1 }, { n: 2 }]);
});

test('envelopeErrors accepts a valid envelope', () => {
  const env = {
    value: 'Platform team owns Airflow', status: 'FACT',
    source: { type: 'confluence', ref: '12345' },
    confidence: 0.94, observed_at: nowIso(),
  };
  assert.deepEqual(envelopeErrors(env), []);
});

test('envelopeErrors rejects bad status, confidence, missing source', () => {
  const errs = envelopeErrors({ status: 'GUESS', confidence: 2 }, 'f0');
  assert.ok(errs.some((e) => e.includes('status')));
  assert.ok(errs.some((e) => e.includes('confidence')));
  assert.ok(errs.some((e) => e.includes('source')));
  assert.ok(errs.every((e) => e.startsWith('f0')));
});

test('parseArgs parses flags, values, booleans, positionals', () => {
  const a = parseArgs(['--dir', '/ws', '--full', 'pos1', '--entity', 'data-platform'], ['full']);
  assert.equal(a.dir, '/ws');
  assert.equal(a.full, true);
  assert.equal(a.entity, 'data-platform');
  assert.deepEqual(a._, ['pos1']);
});
