#!/usr/bin/env node
// Rebuilds .enigma/index/{entities,aliases,keywords,topics}.json from map + memory + evidence.
// Index files are derived: always rebuilt whole, never patched.
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import {
  enigmaDir, readJson, writeJson, readJsonl, readEvidence, tokenize, parseArgs, isMain,
} from './lib/enigma.mjs';
import { appendLedger } from './update-ledger.mjs';

const KINDS = { teams: 'team', people: 'person', projects: 'project', components: 'component' };
const W = { entity: 3, title: 3, summary: 2, fact: 2, excerpt: 1 };
const INDEX_FILES = ['entities.json', 'aliases.json', 'keywords.json', 'topics.json'];

export async function buildIndex(root) {
  const dir = enigmaDir(root);
  const warnings = [];
  const entities = {};
  const aliasOwners = new Map();
  const keywords = new Map();
  const topics = {};

  const addAlias = (raw, id) => {
    const key = String(raw ?? '').toLowerCase().trim();
    if (!key) return;
    if (!aliasOwners.has(key)) aliasOwners.set(key, new Set());
    aliasOwners.get(key).add(id);
  };
  const addTerm = (term, ref, weight) => {
    if (!keywords.has(term)) keywords.set(term, new Map());
    const refs = keywords.get(term);
    refs.set(ref, (refs.get(ref) ?? 0) + weight);
  };

  for (const [kind, singular] of Object.entries(KINDS)) {
    for (const e of await readJson(path.join(dir, 'map', `${kind}.json`), [])) {
      const aliases = Array.isArray(e.aliases) ? e.aliases : [];
      entities[e.id] = {
        kind: singular,
        name: e.name ?? e.id,
        file: `map/${kind}.json`,
        aliases,
        evidence_count: 0,
      };
      addAlias(e.id, e.id);
      addAlias(e.name, e.id);
      for (const a of aliases) addAlias(a, e.id);
      for (const t of new Set(tokenize(`${e.name ?? ''} ${e.id} ${aliases.join(' ')}`))) {
        addTerm(t, e.id, W.entity);
      }
    }
  }

  for (const f of await readJsonl(path.join(dir, 'memory', 'facts.jsonl'))) {
    if (!f.entity || !entities[f.entity]) continue;
    for (const t of new Set(tokenize(String(f.value ?? '')))) addTerm(t, f.entity, W.fact);
  }

  // decisions.jsonl already counts toward index staleness — index it too.
  for (const d of await readJsonl(path.join(dir, 'memory', 'decisions.jsonl'))) {
    if (!d.entity || !entities[d.entity]) continue;
    const text = `${d.decision ?? ''} ${d.rationale ?? ''} ${d.value ?? ''}`;
    for (const t of new Set(tokenize(text))) addTerm(t, d.entity, W.fact);
  }

  for (const item of await readEvidence(root)) {
    for (const id of item.entities ?? []) {
      if (entities[id]) entities[id].evidence_count++;
    }
    for (const t of new Set(tokenize(item.title ?? ''))) addTerm(t, item.id, W.title);
    for (const t of new Set(tokenize(item.summary ?? ''))) addTerm(t, item.id, W.summary);
    for (const x of item.excerpts ?? []) {
      for (const t of new Set(tokenize(x.quote ?? ''))) addTerm(t, item.id, W.excerpt);
    }
    for (const raw of item.topics ?? []) {
      const topic = String(raw).toLowerCase();
      topics[topic] ??= { entities: [], evidence: [] };
      if (!topics[topic].evidence.includes(item.id)) topics[topic].evidence.push(item.id);
      for (const id of item.entities ?? []) {
        if (entities[id] && !topics[topic].entities.includes(id)) topics[topic].entities.push(id);
      }
    }
  }

  const aliases = {};
  for (const [alias, owners] of [...aliasOwners].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (owners.size > 1) {
      warnings.push(`alias "${alias}" maps to ${[...owners].sort().join(', ')} — omitted; confirm the right owner with the user`);
      continue;
    }
    aliases[alias] = [...owners][0];
  }

  const keywordsOut = {};
  for (const [term, refs] of [...keywords].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    keywordsOut[term] = [...refs]
      .map(([ref, weight]) => ({ ref, weight }))
      .sort((a, b) => b.weight - a.weight || (a.ref < b.ref ? -1 : 1));
  }

  await writeJson(path.join(dir, 'index', 'entities.json'), entities);
  await writeJson(path.join(dir, 'index', 'aliases.json'), aliases);
  await writeJson(path.join(dir, 'index', 'keywords.json'), keywordsOut);
  await writeJson(path.join(dir, 'index', 'topics.json'), topics);

  const counts = {
    entities: Object.keys(entities).length,
    aliases: Object.keys(aliases).length,
    keywords: Object.keys(keywordsOut).length,
    topics: Object.keys(topics).length,
  };
  await appendLedger(root, { type: 'index.rebuilt', entity: 'index', source: 'enigma', change: counts });
  return { ok: true, counts, warnings };
}

export async function indexIsStale(root) {
  const dir = enigmaDir(root);
  let oldestIndex = Infinity;
  for (const name of INDEX_FILES) {
    try {
      oldestIndex = Math.min(oldestIndex, (await fsp.stat(path.join(dir, 'index', name))).mtimeMs);
    } catch {
      return true;
    }
  }

  let newestSource = 0;
  const touch = async (file) => {
    try {
      newestSource = Math.max(newestSource, (await fsp.stat(file)).mtimeMs);
    } catch { /* absent files cannot make the index stale */ }
  };
  for (const name of ['company', 'teams', 'people', 'projects', 'components', 'relationships']) {
    await touch(path.join(dir, 'map', `${name}.json`));
  }
  for (const name of ['facts.jsonl', 'decisions.jsonl']) {
    await touch(path.join(dir, 'memory', name));
  }
  try {
    const evDir = path.join(dir, 'evidence');
    for (const d of await fsp.readdir(evDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      for (const name of await fsp.readdir(path.join(evDir, d.name))) {
        await touch(path.join(evDir, d.name, name));
      }
    }
  } catch { /* no evidence directory yet */ }

  return newestSource > oldestIndex;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = typeof args.dir === 'string' ? args.dir : process.cwd();
  const result = await buildIndex(root);
  console.log(JSON.stringify(result, null, 2));
}
