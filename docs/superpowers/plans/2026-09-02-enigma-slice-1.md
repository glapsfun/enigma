# Enigma Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Enigma Claude Code plugin's first slice: `/enigma:init` (org discovery + persistent memory) and `/enigma:status` (project status via parallel oracle subagents), backed by six dependency-free Node scripts.

**Architecture:** A Claude Code plugin (commands + skill + agents + scripts). Agent-led discovery writes to a `.enigma/` memory tree in the user's workspace; deterministic `.mjs` scripts own normalization, ledger, validation, and context loading; five oracle subagents plus a Judge produce evidence-gated judgments.

**Tech Stack:** Claude Code plugin conventions (markdown commands/agents/skills), Node ≥ 18 stdlib only (`node:fs`, `node:path`, `node:test`), JSON/JSONL storage.

**Spec:** `docs/superpowers/specs/2026-09-02-enigma-plugin-design.md`

## Global Constraints

- Node ≥ 18, **zero npm dependencies** — stdlib only; no `package.json` dependencies, no install step.
- All external-system access in this slice is **read-only**; the only writes are inside `.enigma/` and `reports/`.
- Every stored fact/relationship carries the provenance envelope: `{value, status: FACT|INFERENCE|ASSUMPTION|UNKNOWN, source: {type, ref}, confidence: 0..1, observed_at}`.
- `ledger/changes.jsonl` is append-only; `update-ledger.mjs` (via `appendLedger`) is its **sole writer**; map mutations go through the ledger first.
- Scripts never interpret/classify/judge; the agent never hand-edits JSON files a script owns.
- Test command for all script tasks: `node --test scripts/test/` — run it before **every** commit.
- Commit messages: plain conventional style, **no Co-Authored-By and no "Generated with Claude Code" lines** (user's global rule).
- Repo root = plugin root. `.gitignore` contains `docs/*` with a `!docs/superpowers` exception already committed — do not re-add ignores for `docs/`.

---

### Task 1: Plugin scaffold

**Files:**
- Create: `.claude-plugin/plugin.json`
- Modify: `README.md`

**Interfaces:**
- Produces: valid plugin manifest named `enigma`; later tasks add `commands/`, `skills/`, `agents/`, `scripts/` which Claude Code auto-discovers.

- [ ] **Step 1: Write the manifest**

```json
{
  "name": "enigma",
  "description": "Management copilot for engineering leaders: builds persistent organizational context (company map, memory, ledger) from sources your harness already exposes, then runs evidence-gated management workflows like project status.",
  "version": "0.1.0",
  "author": { "name": "vladtara" }
}
```

Save as `.claude-plugin/plugin.json`.

- [ ] **Step 2: Replace README.md content**

```markdown
# Enigma

A Claude Code plugin — a management copilot for people who run software
projects, products, and engineering teams.

Enigma understands how the company works before helping the manager decide:
`/enigma:init` builds a persistent organizational map (`.enigma/`) from
sources your harness already exposes (Jira, Confluence, Slack, GitHub, local
docs — read-only, never bypassing permissions), and `/enigma:status <project>`
produces an evidence-gated status assessment via independent oracle agents.

Design spec: `docs/superpowers/specs/2026-09-02-enigma-plugin-design.md`.
```

- [ ] **Step 3: Verify manifest parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/plugin.json README.md
git commit -m "feat: scaffold enigma plugin manifest"
```

---

### Task 2: Shared script library `scripts/lib/enigma.mjs`

**Files:**
- Create: `scripts/lib/enigma.mjs`
- Test: `scripts/test/enigma-lib.test.mjs`

**Interfaces:**
- Produces (exact exports, used by every later script):
  - `nowIso(): string`
  - `enigmaDir(root?: string): string` → `<root>/.enigma`
  - `readJson(file, fallback?): Promise<any>` — ENOENT + fallback → fallback; other errors throw
  - `writeJson(file, data): Promise<void>` — mkdir -p, 2-space indent, trailing newline
  - `appendJsonl(file, obj): Promise<void>`
  - `readJsonl(file): Promise<any[]>` — ENOENT → `[]`; bad line → throw with file:line
  - `envelopeErrors(env, where?): string[]` — empty array means valid
  - `parseArgs(argv): {_: string[], [flag: string]: string | boolean}`
  - `isMain(importMetaUrl): boolean` — true when the module is the CLI entrypoint

- [ ] **Step 1: Write the failing test**

`scripts/test/enigma-lib.test.mjs`:

```js
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
  const a = parseArgs(['--dir', '/ws', '--full', 'pos1', '--entity', 'data-platform']);
  assert.equal(a.dir, '/ws');
  assert.equal(a.full, true);
  assert.equal(a.entity, 'data-platform');
  assert.deepEqual(a._, ['pos1']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/test/`
Expected: FAIL — `Cannot find module '../lib/enigma.mjs'`

- [ ] **Step 3: Write the implementation**

`scripts/lib/enigma.mjs`:

```js
// Shared primitives for Enigma's deterministic scripts.
// Node stdlib only — no npm dependencies (global constraint).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const nowIso = () => new Date().toISOString();

export function enigmaDir(root = process.cwd()) {
  return path.join(root, '.enigma');
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`cannot read JSON ${file}: ${err.message}`);
  }
}

export async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

export async function appendJsonl(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(obj)}\n`);
}

export async function readJsonl(file) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return text.split('\n').filter(Boolean).map((line, i) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`${file}:${i + 1} is not valid JSON`);
    }
  });
}

const STATUSES = ['FACT', 'INFERENCE', 'ASSUMPTION', 'UNKNOWN'];

export function envelopeErrors(env, where = 'envelope') {
  if (!env || typeof env !== 'object') return [`${where}: not an object`];
  const errors = [];
  if (!STATUSES.includes(env.status)) {
    errors.push(`${where}: status must be one of ${STATUSES.join('|')}`);
  }
  if (!env.source || typeof env.source.type !== 'string') {
    errors.push(`${where}: source.type is required`);
  }
  if (typeof env.confidence !== 'number' || env.confidence < 0 || env.confidence > 1) {
    errors.push(`${where}: confidence must be a number in 0..1`);
  }
  if (typeof env.observed_at !== 'string' || Number.isNaN(Date.parse(env.observed_at))) {
    errors.push(`${where}: observed_at must be an ISO-8601 string`);
  }
  return errors;
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

export function isMain(importMetaUrl) {
  return Boolean(process.argv[1]) && importMetaUrl === pathToFileURL(process.argv[1]).href;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/test/`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/enigma.mjs scripts/test/enigma-lib.test.mjs
git commit -m "feat: shared script library (json/jsonl io, envelope validation, args)"
```

---

### Task 3: `scripts/update-ledger.mjs`

**Files:**
- Create: `scripts/update-ledger.mjs`
- Test: `scripts/test/update-ledger.test.mjs`

**Interfaces:**
- Consumes: `enigmaDir, appendJsonl, nowIso, parseArgs, isMain` from `scripts/lib/enigma.mjs`.
- Produces: `appendLedger(root: string, entry: {type, entity, source?, change?}): Promise<record>` — validates `type`/`entity`, stamps `time`, appends to `<root>/.enigma/ledger/changes.jsonl`, returns the record. CLI: `node scripts/update-ledger.mjs --dir <ws> --entry '<json>'`. **This module is the only code path that writes `changes.jsonl`** (Tasks 4 and later import it).

- [ ] **Step 1: Write the failing test**

`scripts/test/update-ledger.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/test/`
Expected: FAIL — `Cannot find module '../update-ledger.mjs'`

- [ ] **Step 3: Write the implementation**

`scripts/update-ledger.mjs`:

```js
#!/usr/bin/env node
// Sole writer of .enigma/ledger/changes.jsonl (append-only history).
import path from 'node:path';
import { enigmaDir, appendJsonl, nowIso, parseArgs, isMain } from './lib/enigma.mjs';

export async function appendLedger(root, entry) {
  if (!entry || typeof entry.type !== 'string') throw new Error('ledger entry requires "type"');
  if (typeof entry.entity !== 'string') throw new Error('ledger entry requires "entity"');
  const record = { time: nowIso(), ...entry };
  await appendJsonl(path.join(enigmaDir(root), 'ledger', 'changes.jsonl'), record);
  return record;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = typeof args.dir === 'string' ? args.dir : process.cwd();
  if (typeof args.entry !== 'string') {
    console.error('usage: update-ledger.mjs --dir <workspace> --entry \'<json>\'');
    process.exit(1);
  }
  try {
    console.log(JSON.stringify(await appendLedger(root, JSON.parse(args.entry))));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/test/`
Expected: PASS

- [ ] **Step 5: Verify the CLI path works**

Run:
```bash
cd "$(mktemp -d)" && node /Users/vladtarasov/dev/enigma/scripts/update-ledger.mjs --dir . --entry '{"type":"team.added","entity":"t1","source":"user"}' && cat .enigma/ledger/changes.jsonl && cd -
```
Expected: one JSON line echoed and present in the file.

- [ ] **Step 6: Commit**

```bash
git add scripts/update-ledger.mjs scripts/test/update-ledger.test.mjs
git commit -m "feat: append-only ledger writer"
```

---

### Task 4: `scripts/build-map.mjs`

**Files:**
- Create: `scripts/build-map.mjs`
- Test: `scripts/test/build-map.test.mjs`

**Interfaces:**
- Consumes: lib exports; `appendLedger` from `scripts/update-ledger.mjs`.
- Produces: `buildMap(root, candidates): Promise<{ok, errors?, summary?}>` where `candidates = {entities: {company?, teams?, people?, projects?, components?}, relationships?}`. Entities are `{id, name, ...fields}` (people also `team`, projects also `team`/`status`); relationships are `{from, type, to, provenance}`. Dedup by `id` (shallow-merge, candidate wins), referential-integrity check before any write, every add/update goes through `appendLedger` **before** the map file is written. CLI: `node scripts/build-map.mjs --dir <ws> --candidates <file.json>` → prints result JSON, exit 1 when `ok: false`.
- Ledger entry types produced: `company.updated`, `team.added|updated`, `person.added|updated`, `project.added|updated`, `component.added|updated`, `relationship.added`.

- [ ] **Step 1: Write the failing test**

`scripts/test/build-map.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/test/`
Expected: FAIL — `Cannot find module '../build-map.mjs'`

- [ ] **Step 3: Write the implementation**

`scripts/build-map.mjs`:

```js
#!/usr/bin/env node
// Normalizes candidate entities into .enigma/map/*.json.
// All mutations go through the ledger first (spec: Contract 2).
import path from 'node:path';
import { enigmaDir, readJson, writeJson, parseArgs, isMain } from './lib/enigma.mjs';
import { appendLedger } from './update-ledger.mjs';

const KINDS = { teams: 'team', people: 'person', projects: 'project', components: 'component' };

export async function buildMap(root, candidates) {
  const mapDir = path.join(enigmaDir(root), 'map');
  const entities = candidates.entities ?? {};
  const errors = [];

  const ids = new Set();
  const existing = {};
  for (const kind of Object.keys(KINDS)) {
    existing[kind] = await readJson(path.join(mapDir, `${kind}.json`), []);
    for (const e of existing[kind]) ids.add(e.id);
    for (const e of entities[kind] ?? []) {
      if (typeof e.id !== 'string' || !e.id) errors.push(`${kind}: entity without id (${e.name ?? '?'})`);
      else ids.add(e.id);
    }
  }
  for (const r of candidates.relationships ?? []) {
    if (!ids.has(r.from)) errors.push(`relationship ${r.from} -[${r.type}]-> ${r.to}: unknown "from" ${r.from}`);
    if (!ids.has(r.to)) errors.push(`relationship ${r.from} -[${r.type}]-> ${r.to}: unknown "to" ${r.to}`);
  }
  if (errors.length) return { ok: false, errors };

  const summary = { added: 0, updated: 0, unchanged: 0 };
  for (const [kind, singular] of Object.entries(KINDS)) {
    const byId = new Map(existing[kind].map((e) => [e.id, e]));
    for (const cand of entities[kind] ?? []) {
      const prev = byId.get(cand.id);
      if (!prev) {
        byId.set(cand.id, cand);
        summary.added++;
        await appendLedger(root, { type: `${singular}.added`, entity: cand.id, source: cand.source?.type ?? 'discovery', change: cand });
      } else {
        const merged = { ...prev, ...cand };
        if (JSON.stringify(merged) === JSON.stringify(prev)) {
          summary.unchanged++;
        } else {
          byId.set(cand.id, merged);
          summary.updated++;
          await appendLedger(root, { type: `${singular}.updated`, entity: cand.id, source: cand.source?.type ?? 'discovery', change: cand });
        }
      }
    }
    await writeJson(path.join(mapDir, `${kind}.json`), [...byId.values()]);
  }

  if (entities.company) {
    const prev = await readJson(path.join(mapDir, 'company.json'), null);
    const merged = { ...(prev ?? {}), ...entities.company };
    if (JSON.stringify(merged) !== JSON.stringify(prev)) {
      await appendLedger(root, { type: 'company.updated', entity: 'company', source: 'discovery', change: entities.company });
      await writeJson(path.join(mapDir, 'company.json'), merged);
    }
  }

  const relFile = path.join(mapDir, 'relationships.json');
  const prevRels = await readJson(relFile, []);
  const relKey = (r) => `${r.from}|${r.type}|${r.to}`;
  const rels = new Map(prevRels.map((r) => [relKey(r), r]));
  for (const r of candidates.relationships ?? []) {
    if (!rels.has(relKey(r))) {
      rels.set(relKey(r), r);
      await appendLedger(root, {
        type: 'relationship.added', entity: r.from,
        source: r.provenance?.source?.type ?? 'discovery', change: r,
      });
    }
  }
  await writeJson(relFile, [...rels.values()]);

  return { ok: true, summary };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = typeof args.dir === 'string' ? args.dir : process.cwd();
  if (typeof args.candidates !== 'string') {
    console.error('usage: build-map.mjs --dir <workspace> --candidates <file.json>');
    process.exit(1);
  }
  const result = await buildMap(root, await readJson(args.candidates));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/test/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/build-map.mjs scripts/test/build-map.test.mjs
git commit -m "feat: map builder with dedup, referential integrity, ledger writes"
```

---

### Task 5: `scripts/validate-state.mjs`

**Files:**
- Create: `scripts/validate-state.mjs`
- Test: `scripts/test/validate-state.test.mjs`

**Interfaces:**
- Consumes: lib exports; test uses `buildMap` (Task 4) and `appendLedger` (Task 3) to build fixtures.
- Produces: `validateState(root): Promise<{ok, errors: string[], warnings: string[]}>`. Checks: map files parse; entity ids unique per kind; relationship endpoints exist in map; relationship `provenance` and every `facts.jsonl` row pass `envelopeErrors`; every map entity id appears in ≥ 1 ledger entry (map ↔ ledger consistency). Missing `.enigma/` → single error `no .enigma directory — run /enigma:init`. CLI: `--dir <ws>`, prints report JSON, exit 1 on errors.

- [ ] **Step 1: Write the failing test**

`scripts/test/validate-state.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nowIso, writeJson, appendJsonl } from '../lib/enigma.mjs';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/test/`
Expected: FAIL — `Cannot find module '../validate-state.mjs'`

- [ ] **Step 3: Write the implementation**

`scripts/validate-state.mjs`:

```js
#!/usr/bin/env node
// Integrity check for .enigma/. Runs at the start of every Enigma command.
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  enigmaDir, readJson, readJsonl, envelopeErrors, parseArgs, isMain,
} from './lib/enigma.mjs';

const KINDS = ['teams', 'people', 'projects', 'components'];

export async function validateState(root) {
  const dir = enigmaDir(root);
  const errors = [];
  const warnings = [];

  try {
    await fs.stat(dir);
  } catch {
    return { ok: false, errors: ['no .enigma directory — run /enigma:init'], warnings };
  }

  const mapIds = new Set();
  const perKind = {};
  for (const kind of KINDS) {
    const file = path.join(dir, 'map', `${kind}.json`);
    try {
      const list = await readJson(file, []);
      perKind[kind] = list;
      const seen = new Set();
      for (const e of list) {
        if (seen.has(e.id)) errors.push(`${kind}.json: duplicate id "${e.id}"`);
        seen.add(e.id);
        mapIds.add(e.id);
      }
    } catch (err) {
      errors.push(err.message); // includes file path, e.g. corrupt components.json
      perKind[kind] = [];
    }
  }

  let rels = [];
  try {
    rels = await readJson(path.join(dir, 'map', 'relationships.json'), []);
  } catch (err) {
    errors.push(err.message);
  }
  rels.forEach((r, i) => {
    if (!mapIds.has(r.from)) errors.push(`relationships.json[${i}]: unknown "from" ${r.from}`);
    if (!mapIds.has(r.to)) errors.push(`relationships.json[${i}]: unknown "to" ${r.to}`);
    errors.push(...envelopeErrors(r.provenance, `relationships.json[${i}].provenance`));
  });

  const factsFile = path.join(dir, 'memory', 'facts.jsonl');
  try {
    (await readJsonl(factsFile)).forEach((f, i) => {
      errors.push(...envelopeErrors(f, `facts.jsonl:${i + 1}`));
    });
  } catch (err) {
    errors.push(err.message);
  }

  let ledgerEntities = new Set();
  try {
    ledgerEntities = new Set((await readJsonl(path.join(dir, 'ledger', 'changes.jsonl'))).map((e) => e.entity));
  } catch (err) {
    errors.push(err.message);
  }
  for (const kind of KINDS) {
    for (const e of perKind[kind]) {
      if (!ledgerEntities.has(e.id)) {
        errors.push(`${kind}.json: "${e.id}" has no ledger entry — map was mutated outside the ledger`);
      }
    }
  }

  if (!(await readJson(path.join(dir, 'index', 'sources.json'), null))) {
    warnings.push('index/sources.json missing — harness discovery has not run');
  }

  return { ok: errors.length === 0, errors, warnings };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const result = await validateState(typeof args.dir === 'string' ? args.dir : process.cwd());
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/test/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/validate-state.mjs scripts/test/validate-state.test.mjs
git commit -m "feat: state validation (schemas, envelopes, map-ledger consistency)"
```

---

### Task 6: `scripts/load-context.mjs`

**Files:**
- Create: `scripts/load-context.mjs`
- Test: `scripts/test/load-context.test.mjs`

**Interfaces:**
- Consumes: lib exports; test builds fixtures with `buildMap`/`appendJsonl`.
- Produces: `loadContext(root, entityId): Promise<{ok, bundle?}|{ok: false, error, known?}>`. Bundle shape (the `/enigma:status` command and the skill rely on these exact keys):

```json
{
  "entity": { "id": "...", "...": "..." },
  "kind": "project|team|person|component",
  "team": { }, "members": [ ], "components": [ ],
  "relationships": [ ], "ledger": [ ], "facts": [ ], "decisions": [ ]
}
```

  Rules: `team` resolved from `entity.team`; `members` = people whose `team` matches (when entity is a team, its own members; when a project, the owning team's); `components` = components whose id appears in any relationship touching the entity; `ledger` = last 20 entries whose `entity` is the id or a related id; `facts`/`decisions` = rows whose `entity` field matches the id or a related id. Unknown id → `{ok: false, error, known: [all ids]}`. CLI: `--dir <ws> --entity <id>`, prints bundle JSON, exit 1 on unknown id.

- [ ] **Step 1: Write the failing test**

`scripts/test/load-context.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nowIso, appendJsonl } from '../lib/enigma.mjs';
import { buildMap } from '../build-map.mjs';
import { loadContext } from '../load-context.mjs';

const prov = (v = 'x') => ({
  value: v, status: 'FACT',
  source: { type: 'jira', ref: '1' }, confidence: 0.9, observed_at: nowIso(),
});

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-'));
  await buildMap(root, {
    entities: {
      teams: [{ id: 'data-eng', name: 'Data Engineering' }, { id: 'sec', name: 'Security' }],
      people: [
        { id: 'dana', name: 'Dana', role: 'EM', team: 'data-eng' },
        { id: 'sam', name: 'Sam', role: 'engineer', team: 'sec' },
      ],
      projects: [{ id: 'data-platform', name: 'Data Platform', status: 'active', team: 'data-eng' }],
      components: [{ id: 'airflow', name: 'Airflow' }, { id: 'vault', name: 'Vault' }],
    },
    relationships: [
      { from: 'data-eng', type: 'owns', to: 'airflow', provenance: prov() },
      { from: 'data-platform', type: 'depends_on', to: 'airflow', provenance: prov() },
      { from: 'sec', type: 'owns', to: 'vault', provenance: prov() },
    ],
  });
  await appendJsonl(path.join(root, '.enigma/memory/facts.jsonl'),
    { entity: 'data-platform', ...prov('migration planned for Q4') });
  await appendJsonl(path.join(root, '.enigma/memory/facts.jsonl'),
    { entity: 'vault', ...prov('unrelated fact') });
  return root;
}

test('loadContext returns the related slice, not the whole map', async () => {
  const root = await workspace();
  const res = await loadContext(root, 'data-platform');
  assert.equal(res.ok, true);
  const b = res.bundle;
  assert.equal(b.kind, 'project');
  assert.equal(b.team.id, 'data-eng');
  assert.deepEqual(b.members.map((p) => p.id), ['dana']);
  assert.deepEqual(b.components.map((c) => c.id), ['airflow']);
  assert.equal(b.relationships.length, 1); // only edges touching data-platform
  assert.ok(b.ledger.every((e) => ['data-platform', 'airflow'].includes(e.entity)));
  assert.deepEqual(b.facts.map((f) => f.entity), ['data-platform']);
});

test('unknown entity lists known ids', async () => {
  const root = await workspace();
  const res = await loadContext(root, 'nope');
  assert.equal(res.ok, false);
  assert.ok(res.known.includes('data-platform'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/test/`
Expected: FAIL — `Cannot find module '../load-context.mjs'`

- [ ] **Step 3: Write the implementation**

`scripts/load-context.mjs`:

```js
#!/usr/bin/env node
// Emits the map/memory/ledger slice relevant to one entity as a JSON bundle.
import path from 'node:path';
import { enigmaDir, readJson, readJsonl, parseArgs, isMain } from './lib/enigma.mjs';

const KINDS = { teams: 'team', people: 'person', projects: 'project', components: 'component' };

export async function loadContext(root, entityId) {
  const mapDir = path.join(enigmaDir(root), 'map');
  const all = {};
  for (const kind of Object.keys(KINDS)) {
    all[kind] = await readJson(path.join(mapDir, `${kind}.json`), []);
  }

  let entity = null;
  let kind = null;
  for (const [k, singular] of Object.entries(KINDS)) {
    const hit = all[k].find((e) => e.id === entityId);
    if (hit) { entity = hit; kind = singular; break; }
  }
  if (!entity) {
    return {
      ok: false,
      error: `unknown entity "${entityId}"`,
      known: Object.keys(KINDS).flatMap((k) => all[k].map((e) => e.id)),
    };
  }

  const rels = (await readJson(path.join(mapDir, 'relationships.json'), []))
    .filter((r) => r.from === entityId || r.to === entityId);
  const relatedIds = new Set([entityId, ...rels.flatMap((r) => [r.from, r.to])]);

  const teamId = kind === 'team' ? entityId : entity.team;
  const team = all.teams.find((t) => t.id === teamId) ?? null;
  const members = team ? all.people.filter((p) => p.team === team.id) : [];
  const components = all.components.filter((c) => relatedIds.has(c.id) && c.id !== entityId);

  const memDir = path.join(enigmaDir(root), 'memory');
  const facts = (await readJsonl(path.join(memDir, 'facts.jsonl'))).filter((f) => relatedIds.has(f.entity));
  const decisions = (await readJsonl(path.join(memDir, 'decisions.jsonl'))).filter((d) => relatedIds.has(d.entity));
  const ledger = (await readJsonl(path.join(enigmaDir(root), 'ledger', 'changes.jsonl')))
    .filter((e) => relatedIds.has(e.entity))
    .slice(-20);

  return { ok: true, bundle: { entity, kind, team, members, components, relationships: rels, ledger, facts, decisions } };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = typeof args.dir === 'string' ? args.dir : process.cwd();
  if (typeof args.entity !== 'string') {
    console.error('usage: load-context.mjs --dir <workspace> --entity <id>');
    process.exit(1);
  }
  const result = await loadContext(root, args.entity);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/test/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/load-context.mjs scripts/test/load-context.test.mjs
git commit -m "feat: context loader emitting per-entity evidence bundles"
```

---

### Task 7: `scripts/diff-state.mjs` and `scripts/checkpoint.mjs`

**Files:**
- Create: `scripts/diff-state.mjs`, `scripts/checkpoint.mjs`
- Test: `scripts/test/state-cycle.test.mjs`

**Interfaces:**
- Consumes: lib exports.
- Produces:
  - `diffState(root, maxAgeHours = 24): Promise<{refresh: string[], fresh: string[], unavailable: string[]}>` — reads `index/sources.json` (`{sources: [{id, status: "available"|"degraded"|"unavailable", tools?: []}]}`) and `state/discovery.json` (`{sources: {<id>: {last_scanned}}}`). Never scanned or older than cutoff → `refresh`; degraded/unavailable → `unavailable`.
  - `checkpoint(root, {label?, note?, scanned?: string[]}): Promise<record>` — appends `{time, label, note}` to `state/checkpoints.json` (array) and sets `last_scanned = time` in `state/discovery.json` for each id in `scanned`.
  - CLIs: `diff-state.mjs --dir <ws> [--max-age-hours N]`; `checkpoint.mjs --dir <ws> [--label L] [--note N] [--scanned id1,id2]`.

- [ ] **Step 1: Write the failing test**

`scripts/test/state-cycle.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/test/`
Expected: FAIL — `Cannot find module '../diff-state.mjs'`

- [ ] **Step 3: Write both implementations**

`scripts/diff-state.mjs`:

```js
#!/usr/bin/env node
// Decides which sources need re-discovery (incremental init).
import path from 'node:path';
import { enigmaDir, readJson, parseArgs, isMain } from './lib/enigma.mjs';

export async function diffState(root, maxAgeHours = 24) {
  const dir = enigmaDir(root);
  const { sources = [] } = await readJson(path.join(dir, 'index', 'sources.json'), { sources: [] });
  const discovery = await readJson(path.join(dir, 'state', 'discovery.json'), { sources: {} });
  const cutoff = Date.now() - maxAgeHours * 3_600_000;
  const refresh = [];
  const fresh = [];
  const unavailable = [];
  for (const s of sources) {
    if (s.status !== 'available') { unavailable.push(s.id); continue; }
    const last = discovery.sources?.[s.id]?.last_scanned;
    if (!last || Date.parse(last) < cutoff) refresh.push(s.id);
    else fresh.push(s.id);
  }
  return { refresh, fresh, unavailable };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = typeof args.dir === 'string' ? args.dir : process.cwd();
  const hours = args['max-age-hours'] ? Number(args['max-age-hours']) : 24;
  console.log(JSON.stringify(await diffState(root, hours), null, 2));
}
```

`scripts/checkpoint.mjs`:

```js
#!/usr/bin/env node
// Records a checkpoint and marks sources as freshly scanned.
import path from 'node:path';
import { enigmaDir, readJson, writeJson, nowIso, parseArgs, isMain } from './lib/enigma.mjs';

export async function checkpoint(root, { label = 'checkpoint', note = '', scanned = [] } = {}) {
  const stateDir = path.join(enigmaDir(root), 'state');
  const cpFile = path.join(stateDir, 'checkpoints.json');
  const record = { time: nowIso(), label, note };
  const list = await readJson(cpFile, []);
  list.push(record);
  await writeJson(cpFile, list);

  if (scanned.length) {
    const dFile = path.join(stateDir, 'discovery.json');
    const discovery = await readJson(dFile, { sources: {} });
    discovery.sources ??= {};
    for (const id of scanned) {
      discovery.sources[id] = { ...(discovery.sources[id] ?? {}), last_scanned: record.time };
    }
    await writeJson(dFile, discovery);
  }
  return record;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = typeof args.dir === 'string' ? args.dir : process.cwd();
  const scanned = typeof args.scanned === 'string' ? args.scanned.split(',').filter(Boolean) : [];
  const record = await checkpoint(root, {
    label: typeof args.label === 'string' ? args.label : 'checkpoint',
    note: typeof args.note === 'string' ? args.note : '',
    scanned,
  });
  console.log(JSON.stringify(record));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/test/`
Expected: PASS (all suites)

- [ ] **Step 5: Commit**

```bash
git add scripts/diff-state.mjs scripts/checkpoint.mjs scripts/test/state-cycle.test.mjs
git commit -m "feat: incremental discovery diffing and checkpoints"
```

---

### Task 8: Core references — memory schema, gates, discovery recipes

**Files:**
- Create: `skills/enigma-core/references/memory-schema.md`
- Create: `skills/enigma-core/references/gates.md`
- Create: `skills/enigma-core/references/discovery.md`

**Interfaces:**
- Produces: reference docs cited by the skill (Task 10), commands (Tasks 13–14), and agents (Tasks 11–12). File names above are load-bearing — later tasks reference them by exact path.

- [ ] **Step 1: Write `memory-schema.md`**

````markdown
# Enigma memory schema (`.enigma/`)

All paths are relative to the user's workspace directory.

## Provenance envelope (used everywhere)

```json
{
  "value": "Platform team owns Airflow",
  "status": "FACT",
  "source": { "type": "confluence", "ref": "12345" },
  "confidence": 0.94,
  "observed_at": "2026-09-02T10:00:00Z"
}
```

- `status`: `FACT` (stated verbatim in a source) | `INFERENCE` (concluded from
  evidence) | `ASSUMPTION` (gap-filling default) | `UNKNOWN` (question with no
  answer yet — stored, not omitted).
- `source.type`: `jira|confluence|slack|github|repo|docs|user`. User answers
  are `FACT` with `source.type: "user"`.
- Never present INFERENCE or ASSUMPTION as fact downstream.

## Files

| File | Shape |
|---|---|
| `map/company.json` | `{name, domains?, ...}` single object |
| `map/teams.json` | `[{id, name, process?: envelope, ...}]` |
| `map/people.json` | `[{id, name, role, team, ...}]` |
| `map/projects.json` | `[{id, name, status, team, tracker?: {type, ref}, ...}]` |
| `map/components.json` | `[{id, name, kind?: "service|repo|system", ...}]` |
| `map/relationships.json` | `[{from, type, to, provenance: envelope}]` |
| `memory/facts.jsonl` | one envelope per line, plus `entity: <id>` linking it to the map |
| `memory/decisions.jsonl` | `{entity, decision, rationale, ...envelope}` per line |
| `ledger/changes.jsonl` | `{time, type, entity, source, change}` — append-only |
| `index/sources.json` | `{sources: [{id, status: "available|degraded|unavailable", tools?: [...], notes?}]}` |
| `state/discovery.json` | `{sources: {<id>: {last_scanned}}}` |
| `state/checkpoints.json` | `[{time, label, note}]` |
| `reports/*.md` | generated markdown outputs |

## Relationship types (initial vocabulary)

`owns`, `manages`, `member_of`, `implements`, `depends_on`, `belongs_to`,
`stakeholder_of`. Add new types when evidence demands — record them in a
ledger entry.

## Rules

1. Map files are mutated only by `scripts/build-map.mjs`, which writes the
   ledger first. Never hand-edit files a script owns.
2. `ledger/changes.jsonl` is append-only. Never rewrite history.
3. Ids are kebab-case slugs, stable across runs (`data-platform`, not
   `Data Platform (Q3)`).
````

- [ ] **Step 2: Write `gates.md`**

```markdown
# Management gates

Run the applicable gates as a checklist before presenting any significant
output. A failed gate is REPORTED in the output, never silently passed —
"Evidence Gate: weak — no delivery data newer than 3 weeks" is a valid and
useful result.

| Gate | Question | Applies to |
|---|---|---|
| Context | Do we understand enough about the problem? | every workflow |
| Evidence | Is every recommendation supported by company information with provenance? | every workflow |
| People | Did we consider ownership, capacity, stakeholders, communication? | judgments |
| Product | Does this align with customer and business value? | judgments |
| Engineering | Did we consider architecture, debt, dependencies, reliability, delivery complexity? | judgments |
| Delivery | Is the proposed plan/assessment realistic given capacity and history? | judgments |
| Risk | What could fail? Are unknowns explicit? | every workflow |
| Decision | Are alternatives and trade-offs clear? | recommendations |
| Action | Exact action + scope confirmed by the user before ANY write to an external system? | write workflows (none in slice 1) |

Slice 1 workflows are read-only; if a workflow ever appears to need a write
to Jira/Slack/GitHub/etc., stop — that requires the Action Gate and belongs
to a later slice.
```

- [ ] **Step 3: Write `discovery.md`**

```markdown
# Discovery recipes (read-only, budgeted)

Discovery uses ONLY tools already exposed by the harness. Never enumerate
resources the user cannot access; never authenticate to anything new. Every
extracted item gets a provenance envelope. Where evidence is thin, record
INFERENCE or ASSUMPTION — never fabricate a FACT.

Budget rule: first init should complete in minutes, not hours. Respect the
per-source caps below; deeper scans can be requested explicitly later.

| Source | Fetch (capped) | Extract |
|---|---|---|
| Jira / tracker MCP | visible projects; boards; up to 20 active epics per project | projects, teams (from boards/components), process signals (board type, cadence) |
| Confluence / wiki MCP | space list; 20 most recently updated pages per relevant space (titles + excerpts) | teams, people, roles, ownership, architecture notes |
| GitHub / GitLab MCP | repo list; CODEOWNERS; up to 20 recent PRs per key repo | components, ownership, delivery signals |
| Slack MCP | channel list only on first init (names + topics); NO message bodies unless the user asks | team/communication structure |
| Local repos & docs (`--docs`, `--reference` paths) | directory tree; README/ARCHITECTURE/OWNERS-style files | components, structure, ownership |
| Company URL (`--company`) | the page itself + obvious about/team pages | company facts, products |

Failure handling: a source that errors mid-scan is marked `degraded` in
`index/sources.json` with a note; continue with remaining sources; the final
report names the gap. Never hard-abort discovery for one bad source.

Process classification per team: infer Scrum/Kanban/Scrumban/waterfall/
ad-hoc/release-driven/continuous-delivery from evidence (board type, sprint
cadence, WIP patterns, release tags). Always status INFERENCE unless a
document states the process. Do not force one methodology onto all teams.
```

- [ ] **Step 4: Verify files exist and are non-empty**

Run: `wc -l skills/enigma-core/references/{memory-schema,gates,discovery}.md`
Expected: three non-zero line counts.

- [ ] **Step 5: Commit**

```bash
git add skills/enigma-core/references
git commit -m "docs: memory schema, gates, and discovery reference docs"
```

---

### Task 9: Knowledge references — management rubrics

**Files:**
- Create: `skills/enigma-core/references/engineering-management.md`
- Create: `skills/enigma-core/references/methodologies.md`

**Interfaces:**
- Produces: rubric files the oracles read. The People/Delivery/Risk oracles (Task 11) cite `engineering-management.md`; Delivery/Product cite `methodologies.md`.

- [ ] **Step 1: Write `engineering-management.md`**

```markdown
# Engineering management rubric

Condensed from research (Microsoft EM study, GitLab handbook, Project
Aristotle, Google SRE, DORA/SPACE — see Sources). Use as evaluation lenses,
not as universal law; company context can dominate.

## The EM's six accountabilities

Direction (strategy → clear goals/constraints), People (hire/coach/feedback/
performance), Team system (safety + accountability + decision rules),
Delivery (capacity, dependencies, risk, credible forecasts), Technical
stewardship (quality governable without being the bottleneck),
Organizational interface (context in, evidence up, dependencies negotiated).

## Signals of health (use in People/Delivery assessments)

- Priorities and decision owners are explicit; non-goals stated.
- Risks surface early; forecasts carry assumptions + confidence, not fictional dates.
- Ownership named for architecture/security/reliability; bus factor known.
- 1:1s happen; feedback is timely, specific, evidence-based.
- Team operates when the manager is away (leverage test).
- Blameless incident learning WITH owned corrective actions that complete.

## Signals of dysfunction (anti-patterns)

Hero-coder manager on the critical path; task-dispatcher assigning every
ticket; status-router copying information without changing decisions;
umbrella blocking all stakeholder contact; peacekeeper delaying corrective
feedback; metric gamer with output quotas; single point of decision;
permanently overloaded manager (cancelled 1:1s, risks found via escalation).

## Measurement rules

- Use balanced lenses: customer/product, delivery flow, reliability/quality,
  people health, capability, organization. DORA metrics (change lead time,
  deploy frequency, failed-deploy recovery, change fail rate, rework rate)
  are team-level diagnostic signals, examined as trends.
- NEVER evaluate individuals by LOC, commit/PR counts, story points,
  velocity, ticket counts, hours online, or raw incident count. These are
  gameable and penalize high-leverage work. This prohibition binds every
  Enigma oracle and report.

## Sources

Kalliamvakou et al., IEEE TSE 2017 (What Makes a Great Manager of Software
Engineers); GitLab public handbook (EM role, 1:1s, underperformance);
Google Project Aristotle; Google SRE book (error budgets, postmortem
culture); DORA metrics guide; Forsgren et al., The SPACE of Developer
Productivity.
```

- [ ] **Step 2: Write `methodologies.md`**

```markdown
# Methodology & process rubric

Condensed from PMI Pulse 2024, State of Agile 2025, Scrum Guide 2020, Kanban
Guide 2025, Shape Up, DORA. There is no single best methodology; hybrids
dominate. Classify what a team ACTUALLY does from evidence — never force a
framework.

## Classification signals

| Process | Evidence looks like |
|---|---|
| Scrum | fixed sprints, sprint goals, regular reviews/retros, stable cross-functional team |
| Kanban | continuous pull, WIP limits, flow metrics (age, cycle time), continuous replenishment |
| Scrumban | Scrum cadences + Kanban pull/WIP for daily work |
| Waterfall / predictive | phase gates, big up-front spec, one late validation phase |
| Release-driven | work batched to dated releases/cutovers |
| Incident-driven / ad-hoc | interrupt-dominated intake, no visible cadence |
| Continuous delivery | trunk-based, small batches, frequent deploys, feature flags |

## Fit heuristics (for assessments, not prescriptions)

- Continuous/interrupt-driven arrival → Kanban fits; sprint commitments that
  ignore interruptions are a red flag.
- Stable cadence + formable sprint goal → Scrum can help focus.
- High assurance/regulatory burden → risk gates + continuous evidence, not
  one big final validation.
- Dependencies dominating cycle time → fix boundaries/architecture BEFORE
  adding coordination ceremonies or scaling frameworks.

## Red flags (cite in findings when observed)

Infrequent releases + late integration labeled "Agile"; identical sprint
lengths mandated everywhere; committed feature roadmap with no discovery;
QA/security/ops as downstream queues; normalized sprint carry-over; story
points compared across teams; methodology compliance measured instead of
outcomes; scaling framework before priorities/boundaries fixed.

## Delivery-health lenses

Flow: WIP, throughput, work-item age, cycle time percentiles, blocked time.
Delivery: DORA five. Quality: escaped defects, SLO attainment, rework.
Team: SPACE dimensions (satisfaction, performance, activity, communication,
efficiency) — never reduced to a single activity count.
```

- [ ] **Step 3: Verify files exist and are non-empty**

Run: `wc -l skills/enigma-core/references/{engineering-management,methodologies}.md`
Expected: two non-zero counts.

- [ ] **Step 4: Commit**

```bash
git add skills/enigma-core/references
git commit -m "docs: condensed EM and methodology rubrics for oracles"
```

---

### Task 10: Core skill — `skills/enigma-core/SKILL.md`

**Files:**
- Create: `skills/enigma-core/SKILL.md`

**Interfaces:**
- Consumes: reference files from Tasks 8–9 (exact names); script CLIs from Tasks 3–7.
- Produces: the always-loadable invariants; commands in Tasks 13–14 say "follow the invariants in the enigma-core skill".

- [ ] **Step 1: Write SKILL.md**

````markdown
---
name: enigma-core
description: Organizational-context engine for management questions. Use this whenever the user asks management-flavored questions — project or team status, who owns a service or component, delivery risks, dependencies between teams, roadmap or priority questions — even if they don't mention Enigma. Also use it whenever a `.enigma/` directory exists in the workspace, or before running any /enigma command logic.
---

# Enigma core

Enigma answers management questions from a persistent organizational map in
`./.enigma/` instead of guessing. If `.enigma/` does not exist, say so and
suggest `/enigma:init`; do not fabricate organizational facts.

## Invariants (every Enigma workflow obeys these)

1. **Validate first.** Start every workflow with
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-state.mjs --dir .`
   On errors: name the broken file and offer ledger-based reconstruction;
   never silently proceed on corrupt state.
2. **Provenance envelope** on every stored fact/relationship — schema in
   `references/memory-schema.md`. FACT / INFERENCE / ASSUMPTION / UNKNOWN
   are distinct; never launder inference into fact.
3. **Read-only default.** Slice 1 never writes to external systems. The only
   writes are `.enigma/` and `reports/`. Anything else needs the Action Gate
   (`references/gates.md`) — which no slice-1 workflow passes.
4. **Ledger rule.** Map changes go through `scripts/build-map.mjs` /
   `scripts/update-ledger.mjs`. Never hand-edit `map/*.json` or append to
   `changes.jsonl` directly.
5. **Gates are reported, not performed.** Run the checklist in
   `references/gates.md`; a weak gate appears in the output as a warning.
6. **Ask only necessary questions**, batched in one round — after exhausting
   map, memory, and live read-only sources.
7. **Division of labor.** Scripts (in `${CLAUDE_PLUGIN_ROOT}/scripts/`) do
   deterministic work: normalization, ledger, validation, context bundles,
   diffing, checkpoints. You do interpretation, classification, judgment.

## Conversational use (no slash command)

For a management question with `.enigma/` present:
1. Identify the entity (`node ${CLAUDE_PLUGIN_ROOT}/scripts/load-context.mjs
   --dir . --entity <id>`; on unknown id, offer the `known` list).
2. Answer from the bundle, citing provenance status. For a full status
   assessment, tell the user `/enigma:status <id>` runs the complete
   oracle pipeline, and offer to run it.

## Reference files

- `references/memory-schema.md` — all `.enigma/` file shapes + envelope
- `references/gates.md` — gate checklist
- `references/discovery.md` — per-source scan recipes and caps
- `references/engineering-management.md` — EM rubric (People/Delivery/Risk lenses)
- `references/methodologies.md` — process classification + delivery health
````

- [ ] **Step 2: Verify frontmatter parses (manual check)**

Run: `head -5 skills/enigma-core/SKILL.md`
Expected: `---`, `name: enigma-core`, a single-line description, `---`.

- [ ] **Step 3: Commit**

```bash
git add skills/enigma-core/SKILL.md
git commit -m "feat: enigma-core skill with workflow invariants"
```

---

### Task 11: Oracle agents (5 files)

**Files:**
- Create: `agents/product-oracle.md`, `agents/engineering-oracle.md`, `agents/delivery-oracle.md`, `agents/people-oracle.md`, `agents/risk-oracle.md`

**Interfaces:**
- Consumes: evidence bundle JSON (shape from Task 6) passed in the dispatch prompt; reference rubrics from Task 9 (read via `${CLAUDE_PLUGIN_ROOT}` path given in the dispatch prompt by Task 14's command).
- Produces: each oracle's **final message is exactly one JSON object**:

```json
{ "lens": "<lens-name>", "findings": [{"claim": "...", "evidence": "...", "basis": "FACT|INFERENCE|ASSUMPTION"}],
  "risks": [{"risk": "...", "severity": "high|medium|low", "evidence": "..."}],
  "confidence": "high|medium|low", "evidence_gaps": ["..."] }
```

All five files share this scaffold — **each file is written out in full** with its own `name`, `description`, LENS and IGNORE sections:

````markdown
---
name: <agent-name>
description: <one line — dispatched by Enigma commands with an evidence bundle; not for direct user invocation>
tools: Read, Grep, Glob
---

You are Enigma's <Lens> Oracle. You receive an evidence bundle (JSON) in your
prompt and judge it through ONE lens only. You do not fetch new data from
external systems; if evidence is missing, name it in `evidence_gaps`.

## Your lens
<lens bullets>

## Not your lens — do not comment on
<ignore bullets>

## Epistemic rules
- Weight FACT over INFERENCE over ASSUMPTION; say which basis each finding rests on.
- Never present an assumption as a finding without flagging it.
- Missing evidence is an evidence_gap, not something to fill with plausible fiction.
- Never use velocity, story points, ticket/PR/commit counts, or lines of code
  as individual performance measures.

## Output
Reply with EXACTLY one JSON object, no prose before or after:
{"lens": "<lens>", "findings": [{"claim","evidence","basis"}],
 "risks": [{"risk","severity","evidence"}],
 "confidence": "high|medium|low", "evidence_gaps": []}
````

- [ ] **Step 1: Write `agents/delivery-oracle.md`** — the scaffold with:
  - frontmatter `name: delivery-oracle`, description: `Judges an Enigma evidence bundle through the delivery lens (scope, timeline, capacity, blockers). Dispatched by Enigma commands with an evidence bundle; not for direct user invocation.`
  - Lens: scope vs. capacity; timeline credibility (dates backed by evidence vs. hope); dependencies and blockers; WIP and aging-work signals; forecast realism given delivery history in the bundle. If a rubric path is provided in the prompt, read `methodologies.md` → "Delivery-health lenses".
  - Ignore: product value judgments, architecture quality, individual performance, org design.

- [ ] **Step 2: Write `agents/product-oracle.md`** — scaffold with:
  - `name: product-oracle`, description: `Judges an Enigma evidence bundle through the product lens (user value, business impact, prioritization). Dispatched by Enigma commands with an evidence bundle; not for direct user invocation.`
  - Lens: user/customer value of the work in the bundle; business impact; prioritization coherence (is the team working on what matters?); product risk (building the wrong thing); presence/absence of customer evidence behind roadmap items.
  - Ignore: implementation details, team process choice, staffing, timeline mechanics.

- [ ] **Step 3: Write `agents/engineering-oracle.md`** — scaffold with:
  - `name: engineering-oracle`, description: `Judges an Enigma evidence bundle through the engineering lens (architecture, complexity, reliability, technical debt). Dispatched by Enigma commands with an evidence bundle; not for direct user invocation.`
  - Lens: architecture and complexity signals; technical dependencies between components in the bundle; reliability/incident signals; maintainability and technical-debt indications; delivery complexity of what is planned.
  - Ignore: business prioritization, people/staffing judgments, methodology preference.

- [ ] **Step 4: Write `agents/people-oracle.md`** — scaffold with:
  - `name: people-oracle`, description: `Judges an Enigma evidence bundle through the people/organization lens (ownership, load, bus factor, communication). Dispatched by Enigma commands with an evidence bundle; not for direct user invocation.`
  - Lens: ownership clarity (does every component/decision have a named owner?); team load and capacity vs. commitments; bus factor; cross-team/organizational dependencies; communication and stakeholder coverage. If a rubric path is provided, read `engineering-management.md` → health/dysfunction signals.
  - Ignore: technical design quality, product priorities, timeline arithmetic.

- [ ] **Step 5: Write `agents/risk-oracle.md`** — scaffold with:
  - `name: risk-oracle`, description: `Judges an Enigma evidence bundle through the risk lens (delivery, technical, organizational risk and unknowns). Dispatched by Enigma commands with an evidence bundle; not for direct user invocation.`
  - Lens: what could fail — delivery risk, technical risk, organizational risk; contradictions between sources in the bundle (e.g. roadmap date vs. ticket evidence — always surface these); UNKNOWN-status items and their materiality; single points of failure.
  - Ignore: restating other lenses' positive findings; recommending solutions (name risks, the Judge weighs responses).

- [ ] **Step 6: Verify all five have valid frontmatter and the output contract**

Run: `grep -l '"lens"' agents/*-oracle.md | wc -l && grep -c 'name:' agents/delivery-oracle.md`
Expected: `5` and at least `1`.

- [ ] **Step 7: Commit**

```bash
git add agents/product-oracle.md agents/engineering-oracle.md agents/delivery-oracle.md agents/people-oracle.md agents/risk-oracle.md
git commit -m "feat: five oracle subagents with lens isolation and JSON verdicts"
```

---

### Task 12: Judge agent

**Files:**
- Create: `agents/judge.md`

**Interfaces:**
- Consumes: the five oracle verdict JSONs + the evidence bundle (all passed in the dispatch prompt by Task 14).
- Produces: final message = markdown assessment with the exact section headings `## Recommendation`, `## Health by lens`, `## Disagreements`, `## Judgment model`, `## Evidence`, `## Unknowns` (Task 14's command embeds this output into the status report).

- [ ] **Step 1: Write `agents/judge.md`**

````markdown
---
name: judge
description: Combines Enigma oracle verdicts into one evidence-gated assessment. Dispatched by Enigma commands with oracle verdicts and an evidence bundle; not for direct user invocation.
tools: Read, Grep, Glob
---

You are Enigma's Judge. Your prompt contains an evidence bundle and up to
five oracle verdicts (product, engineering, delivery, people, risk). Combine
them into one honest assessment for a manager.

## Rules

- **Surface disagreements explicitly.** If Delivery says on-track and Risk
  flags an unowned dependency, present the conflict and resolve it with
  stated reasoning ("Risk wins because the security review has no owner and
  the date assumes it"). A report that hides an oracle conflict is worse
  than useless.
- **Respect epistemic status.** Findings resting on INFERENCE/ASSUMPTION
  lower your confidence; say so. If the bundle was INFERENCE-heavy, your
  overall confidence cannot be "high".
- **Missing oracle:** if a verdict is absent or malformed, proceed with the
  rest and state which lens is missing. Never fabricate the absent view.
- Never use velocity, story points, ticket/PR/commit counts, or LOC as
  individual performance measures.

## Output format (markdown, exactly these sections)

## Recommendation
One paragraph: overall health call and what the manager should do next.

## Health by lens
| Lens | Assessment | Confidence |  — one row per oracle received.

## Disagreements
Each oracle conflict, with your resolution and reasoning. "None" if none.

## Judgment model
Impact / Confidence / Effort / Risk / Urgency / Dependencies / Reversibility
— one line each, with a one-clause justification.

## Evidence
Key findings with their basis (FACT/INFERENCE/ASSUMPTION) and source types.

## Unknowns
Material open questions, including every evidence_gap two or more oracles
raised.
````

- [ ] **Step 2: Verify frontmatter**

Run: `head -6 agents/judge.md`
Expected: frontmatter with `name: judge` and `tools: Read, Grep, Glob`.

- [ ] **Step 3: Commit**

```bash
git add agents/judge.md
git commit -m "feat: judge agent combining oracle verdicts"
```

---

### Task 13: `/enigma:init` command

**Files:**
- Create: `commands/init.md`

**Interfaces:**
- Consumes: scripts CLIs (Tasks 3–7 exact flags), `references/discovery.md` + `references/memory-schema.md` (Task 8), skill invariants (Task 10).
- Produces: `/enigma:init [--company <url>] [--docs <path>] [--reference <path>] [--full]`.

- [ ] **Step 1: Write `commands/init.md`**

````markdown
---
description: Initialize Enigma - discover the harness and the company, build the organizational map and memory in ./.enigma
argument-hint: "[--company <url>] [--docs <path>] [--reference <path>] [--full]"
---

Initialize Enigma's organizational memory in the current directory. Follow
the invariants in the enigma-core skill. Everything here is READ-ONLY toward
external systems; the only writes are inside `./.enigma/`.

Arguments given: $ARGUMENTS

## Phase 0 — Preflight

If `./.enigma/` exists and `$ARGUMENTS` does not contain `--full`:
run `node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-state.mjs --dir .`, then
`node ${CLAUDE_PLUGIN_ROOT}/scripts/diff-state.mjs --dir .` and do an
INCREMENTAL run: only re-scan sources listed in `refresh` (Phase 2 below,
those sources only). Otherwise this is a FULL run.

## Phase 1 — Harness discovery (you, not a script)

Inventory your own environment — only you know your tool surface:
- Connected MCP servers/tools relevant to org knowledge (Jira, Confluence,
  Slack, GitHub/GitLab, Drive/Notion, trackers). A server listed as failed
  or erroring = status `degraded`, with a note.
- Local paths: the workspace itself, plus any `--docs` / `--reference`
  paths from `$ARGUMENTS` (verify they exist).
- `--company <url>` if provided.

Write the registry to `.enigma/index/sources.json` as
`{"sources": [{"id", "status": "available|degraded|unavailable", "tools": [...], "notes"}]}`
(schema: enigma-core `references/memory-schema.md`).

## Phase 2 — Company discovery (read-only, budgeted)

For each `available` source, follow the recipe and caps in enigma-core
`references/discovery.md`. Collect candidate entities and relationships into
one JSON file at `.enigma/state/candidates.json`:

```json
{ "entities": { "company": {}, "teams": [], "people": [], "projects": [], "components": [] },
  "relationships": [ {"from", "type", "to", "provenance": {…envelope}} ] }
```

Every candidate carries provenance. Thin evidence → INFERENCE/ASSUMPTION.
Questions you cannot answer → collect as UNKNOWNs for Phase 4 (do not drop
them). A source failing mid-scan → mark it `degraded` in sources.json and
continue.

Classify each team's process (per `references/discovery.md`) as an
`INFERENCE`-status field on the team entity unless documentation states it.

## Phase 3 — Build the map (script)

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/build-map.mjs --dir . --candidates .enigma/state/candidates.json`

If it reports `ok: false`, fix the candidate ids/relationships it names and
re-run. Then run `node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-state.mjs --dir .`
and confirm it passes.

## Phase 4 — Checkpoint and report

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/checkpoint.mjs --dir . --label init --scanned <comma-separated source ids you scanned>`
2. Write `.enigma/reports/company-overview.md`: teams (with inferred
   process + basis), projects and ownership, key components, relationship
   count, and an **Unknowns** section.
3. Present a summary in chat ending with the explicit UNKNOWN list, and ask
   the user (ONE batched round) which they can answer. Store answers as
   FACT envelopes with `source: {"type": "user"}` in
   `.enigma/memory/facts.jsonl` (append with `entity` field linking to the
   map id), and note the additions via
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/update-ledger.mjs --dir . --entry '{"type":"fact.added","entity":"<id>","source":"user"}'`.
````

- [ ] **Step 2: Verify frontmatter and phase structure**

Run: `grep -c '^## Phase' commands/init.md`
Expected: `5` (Phases 0–4).

- [ ] **Step 3: Commit**

```bash
git add commands/init.md
git commit -m "feat: /enigma:init command (4-phase discovery pipeline)"
```

---

### Task 14: `/enigma:status` command

**Files:**
- Create: `commands/status.md`

**Interfaces:**
- Consumes: `load-context.mjs` bundle shape (Task 6), oracle agents by name (Task 11), `judge` agent output sections (Task 12), gates (Task 8).
- Produces: `/enigma:status <project-or-team-id>`; report file `reports/status-<id>-<YYYY-MM-DD>.md`.

- [ ] **Step 1: Write `commands/status.md`**

````markdown
---
description: Evidence-gated project/team status via Enigma's oracle pipeline (read-only)
argument-hint: "<project-or-team-id>"
---

Produce a status assessment for: $ARGUMENTS
Follow the invariants in the enigma-core skill. This workflow is READ-ONLY
toward external systems.

## 1. Validate and load context

- `node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-state.mjs --dir .` — on
  errors, stop and report (offer ledger-based reconstruction). If `.enigma/`
  is missing, suggest `/enigma:init` and stop.
- If `$ARGUMENTS` is empty, list project ids from `.enigma/map/projects.json`
  and ask which one.
- `node ${CLAUDE_PLUGIN_ROOT}/scripts/load-context.mjs --dir . --entity <id>`
  — on unknown id, show the `known` list and ask.

## 2. Fill evidence gaps (read-only)

Compare the bundle against what a status report needs: recent tickets/epics,
recent PRs/commits, incidents, blockers, stated dates. Fetch ONLY the gaps
from `available` sources in `.enigma/index/sources.json` (respect the caps in
enigma-core `references/discovery.md`). Append new evidence to
`.enigma/memory/facts.jsonl` as envelopes with an `entity` field.

## 3. Ask only necessary questions

If something material cannot be answered from map + live sources, ask the
user now — ONE batched round. Store answers as FACT envelopes
(`source.type: "user"`).

## 4. Oracle fan-out (parallel — single message)

Dispatch ALL FIVE oracle agents (`product-oracle`, `engineering-oracle`,
`delivery-oracle`, `people-oracle`, `risk-oracle`) in ONE message so they run
concurrently. Each prompt contains:
1. The full evidence bundle JSON (from step 1, plus step 2/3 additions).
2. The rubric directory path: `${CLAUDE_PLUGIN_ROOT}/skills/enigma-core/references/`.
3. The instruction: "Judge this bundle through your lens only. Reply with
   exactly your JSON verdict."

Collect the five JSON verdicts. If one fails or returns non-JSON, keep going
with the rest and note the missing lens.

## 5. Judge

Dispatch the `judge` agent with: the verdicts you received, the evidence
bundle, and the note of any missing lens. Its markdown assessment
(Recommendation / Health by lens / Disagreements / Judgment model /
Evidence / Unknowns) is the core of the report.

## 6. Gates and presentation

Run the Context, Evidence, Delivery, and Risk gates from enigma-core
`references/gates.md`. Report any weak gate in the output ("Evidence Gate:
weak — no delivery data newer than 3 weeks").

Write `reports/status-<id>-<YYYY-MM-DD>.md` containing: title + date, gate
results, the Judge's assessment verbatim, and a provenance appendix (each
key finding's status and source type). Present the same content in chat.

## 7. Record

- `node ${CLAUDE_PLUGIN_ROOT}/scripts/update-ledger.mjs --dir . --entry '{"type":"status.assessed","entity":"<id>","source":"enigma","change":{"overall":"<one-line health call>","report":"reports/status-<id>-<date>.md"}}'`
- Append notable NEW facts discovered during this run to
  `.enigma/memory/facts.jsonl` (if not already done in step 2).
````

- [ ] **Step 2: Verify structure**

Run: `grep -c '^## ' commands/status.md`
Expected: `7`.

- [ ] **Step 3: Commit**

```bash
git add commands/status.md
git commit -m "feat: /enigma:status command (oracle fan-out pipeline)"
```

---

### Task 15: Fixture workspace and eval prompts

**Files:**
- Create: `fixtures/acme/docs/teams.md`, `fixtures/acme/docs/architecture.md`, `fixtures/acme/docs/roadmap.md`, `fixtures/acme/docs/delivery-log.md`
- Create: `evals/evals.json`

**Interfaces:**
- Consumes: nothing (static fixtures).
- Produces: a local-docs company ("Acme") for init evals, with a **planted contradiction**: `roadmap.md` says the Data Platform migration lands in June; `delivery-log.md` shows tickets slipping to September. Eval 3 passes only if the pipeline surfaces it.

- [ ] **Step 1: Write the fixture docs**

`fixtures/acme/docs/teams.md`:

```markdown
# Acme teams

## Data Engineering
Manager: Dana Reyes. Engineers: Miko Tan, Priya Shah, Leo Ortiz.
Owns: Airflow pipelines, the warehouse, the ingestion service.
Works in two-week sprints with sprint reviews.

## Platform
Manager: Sam Cole. Engineers: Ada Wu, Tom Rivera.
Owns: Kubernetes clusters, CI/CD, Vault.
Pull-based board, no sprints; WIP limit of 4.

## Security (partner team)
Lead: Noor Haddad. Reviews all identity-model changes.
```

`fixtures/acme/docs/architecture.md`:

```markdown
# Acme architecture notes

The Data Platform project migrates ingestion from the legacy ETL to Airflow.
The ingestion service depends on Vault (Platform team) for credentials.
Warehouse loads depend on the ingestion service. The identity model for the
new ingestion path still needs Security sign-off.
```

`fixtures/acme/docs/roadmap.md`:

```markdown
# Roadmap 2026 H1

- Data Platform migration: complete by end of June 2026 (committed to the
  exec team in January).
- Cluster upgrade (Platform): July 2026.
```

`fixtures/acme/docs/delivery-log.md`:

```markdown
# Delivery log — Data Platform

- 2026-08-10: DP-141 ingestion cutover re-scheduled, target now 2026-09-15.
- 2026-08-18: DP-150 Vault credential rotation blocked, waiting on Security
  review of the identity model (no reviewer assigned yet).
- 2026-08-25: DP-152 warehouse backfill running behind; ~60% complete.
```

- [ ] **Step 2: Write `evals/evals.json`**

```json
{
  "skill_name": "enigma",
  "evals": [
    {
      "id": 1,
      "prompt": "Run /enigma:init --docs ./docs for this workspace and show me the company overview.",
      "expected_output": "A .enigma/ tree with Acme's teams/people/projects/components mapped, relationships (data-eng owns airflow, ingestion depends_on vault, ...), process classifications marked INFERENCE (Data Engineering=Scrum-like, Platform=Kanban-like), ledger entries for every entity, and an explicit UNKNOWN list.",
      "files": ["fixtures/acme"]
    },
    {
      "id": 2,
      "prompt": "/enigma:status data-platform",
      "expected_output": "Full pipeline run: validate, context bundle, five oracle dispatches in one message, Judge assessment with all six sections, gate results reported, report file written, ledger entry appended.",
      "files": ["fixtures/acme (after init)"]
    },
    {
      "id": 3,
      "prompt": "/enigma:status data-platform — is the June date still realistic?",
      "expected_output": "The roadmap-June vs tickets-September contradiction is surfaced explicitly (Risk and/or Delivery oracle finding, appears in Judge's Disagreements or Recommendation), including the unowned Security review as a named blocker. The assessment does NOT parrot the June date as fact.",
      "files": ["fixtures/acme (after init)"]
    }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add fixtures evals
git commit -m "test: acme fixture company with planted contradiction + eval prompts"
```

---

### Task 16: Structural validation and end-to-end script smoke test

**Files:**
- Create: `scripts/test/smoke.test.mjs`

**Interfaces:**
- Consumes: every script module (Tasks 3–7).
- Produces: one test that walks the whole deterministic pipeline: buildMap → validateState → loadContext → checkpoint → diffState on a copy of what init would produce for Acme.

- [ ] **Step 1: Write the smoke test**

`scripts/test/smoke.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the full suite**

Run: `node --test scripts/test/`
Expected: PASS, all suites.

- [ ] **Step 3: Run the plugin validator**

Dispatch the `plugin-dev:plugin-validator` agent on the repo (or, if running
inline, check by hand): manifest parses; `commands/*.md`, `agents/*.md`,
`skills/enigma-core/SKILL.md` all have valid frontmatter; no dangling
references (every `references/*.md` mentioned in SKILL.md/commands exists;
agent names in `commands/status.md` match the files in `agents/`).
Expected: no structural errors. Fix anything reported and re-run.

- [ ] **Step 4: Commit**

```bash
git add scripts/test/smoke.test.mjs
git commit -m "test: end-to-end deterministic pipeline smoke test"
```

---

## Post-plan: evaluation loop (not part of task execution)

After all tasks: run the skill-creator eval loop using `evals/evals.json` —
spawn with-skill/baseline runs per eval against a copy of `fixtures/acme`,
grade (eval 3's assertion: the June/September contradiction and the unowned
Security review appear in the output), review results with the user, and
iterate on command/agent wording. This is interactive and driven from the
main session, so it is deliberately not a checkbox task here.
