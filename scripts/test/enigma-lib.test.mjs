import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  nowIso, enigmaDir, readJson, writeJson, appendJsonl, readJsonl,
  envelopeErrors, parseArgs,
  sha256Hex, tokenize, evidenceId, evidenceFileFor, readEvidence,
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

// --- slice 2 primitives ---

test('sha256Hex is stable 64-char hex', () => {
  assert.equal(sha256Hex('abc').length, 64);
  assert.equal(sha256Hex('abc'), sha256Hex('abc'));
  assert.notEqual(sha256Hex('abc'), sha256Hex('abd'));
});

test('tokenize lowercases, splits on punctuation, drops stopwords and 1-char tokens', () => {
  assert.deepEqual(tokenize('The Data-Platform is a Vault dependency!'),
    ['data', 'platform', 'vault', 'dependency']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
});

test('evidenceId and evidenceFileFor round-trip a hyphenated source type', () => {
  const id = evidenceId('cli-gh', 'abcdef0123456789');
  assert.equal(id, 'cli-gh-abcdef01');
  assert.equal(evidenceFileFor('/ws', id),
    path.join('/ws', '.enigma/evidence/cli-gh', 'cli-gh-abcdef01.json'));
});

test('readEvidence returns [] with no directory and reads every item', async () => {
  const root = await tmp();
  assert.deepEqual(await readEvidence(root), []);
  await mkdir(path.join(root, '.enigma/evidence/jira'), { recursive: true });
  await writeFile(path.join(root, '.enigma/evidence/jira/jira-aaaaaaaa.json'),
    JSON.stringify({ id: 'jira-aaaaaaaa', title: 'One' }));
  await writeFile(path.join(root, '.enigma/evidence/jira/notes.txt'), 'ignored');
  const items = await readEvidence(root);
  assert.deepEqual(items.map((i) => i.title), ['One']);
});

test('readEvidence throws with the file path on corrupt JSON', async () => {
  const root = await tmp();
  await mkdir(path.join(root, '.enigma/evidence/docs'), { recursive: true });
  await writeFile(path.join(root, '.enigma/evidence/docs/docs-bbbbbbbb.json'), '{not json');
  await assert.rejects(() => readEvidence(root), /docs-bbbbbbbb\.json/);
});

test('readJsonl reports the real line number when the file has blank lines', async () => {
  const dir = await tmp();
  const file = path.join(dir, 'log.jsonl');
  await writeFile(file, '{"n":1}\n\n{"n":2}\n{oops\n');
  await assert.rejects(() => readJsonl(file), /log\.jsonl:4 is not valid JSON/);
});
