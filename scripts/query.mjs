#!/usr/bin/env node
// Resolves free text to entities and evidence: exact id -> alias -> keyword ranking.
import path from 'node:path';
import {
  enigmaDir, readJson, tokenize, evidenceFileFor, parseArgs, isMain,
} from './lib/enigma.mjs';
import { buildIndex, indexIsStale } from './build-index.mjs';

export async function query(root, q, { kind = null, limit = 10 } = {}) {
  if (await indexIsStale(root)) await buildIndex(root);

  const dir = enigmaDir(root);
  const entities = await readJson(path.join(dir, 'index', 'entities.json'), {});
  const aliases = await readJson(path.join(dir, 'index', 'aliases.json'), {});
  const keywords = await readJson(path.join(dir, 'index', 'keywords.json'), {});

  const text = String(q ?? '').trim();
  const lower = text.toLowerCase();
  const kindOk = (id) => !kind || entities[id]?.kind === kind;
  const entityHit = (id, why) => ({
    ref: id, kind: entities[id].kind, score: Infinity, title: entities[id].name, why: [why],
  });

  if (entities[text] && kindOk(text)) {
    return { ok: true, resolved: text, candidates: [], hits: [entityHit(text, 'exact id')] };
  }
  if (aliases[lower] && kindOk(aliases[lower])) {
    const id = aliases[lower];
    return { ok: true, resolved: id, candidates: [], hits: [entityHit(id, 'alias')] };
  }

  const scores = new Map();
  for (const term of tokenize(text)) {
    for (const { ref, weight } of keywords[term] ?? []) {
      const cur = scores.get(ref) ?? { score: 0, why: [] };
      cur.score += weight;
      if (!cur.why.includes(term)) cur.why.push(term);
      scores.set(ref, cur);
    }
  }

  const ranked = [...scores].sort((a, b) => {
    if (b[1].score !== a[1].score) return b[1].score - a[1].score;
    const aEntity = Boolean(entities[a[0]]);
    const bEntity = Boolean(entities[b[0]]);
    if (aEntity !== bEntity) return aEntity ? -1 : 1;
    return a[0] < b[0] ? -1 : 1;
  });

  const hits = [];
  for (const [ref, { score, why }] of ranked) {
    if (hits.length >= limit) break;
    if (entities[ref]) {
      if (!kindOk(ref)) continue;
      hits.push({ ref, kind: entities[ref].kind, score, title: entities[ref].name, why });
    } else {
      if (kind) continue;
      const item = await readJson(evidenceFileFor(root, ref), null);
      hits.push({ ref, kind: 'evidence', score, title: item?.title ?? ref, why });
    }
  }

  const entityHits = hits.filter((h) => h.kind !== 'evidence');
  let resolved = null;
  let candidates = [];
  if (entityHits.length === 1) {
    resolved = entityHits[0].ref;
  } else if (entityHits.length > 1) {
    if (entityHits[0].score > entityHits[1].score) resolved = entityHits[0].ref;
    else candidates = entityHits.filter((h) => h.score === entityHits[0].score).map((h) => h.ref);
  }
  return { ok: true, resolved, candidates, hits };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = typeof args.dir === 'string' ? args.dir : process.cwd();
  if (typeof args.q !== 'string') {
    console.error('usage: query.mjs --dir <workspace> --q "<text>" [--kind team|person|project|component] [--limit 10]');
    process.exit(1);
  }
  const result = await query(root, args.q, {
    kind: typeof args.kind === 'string' ? args.kind : null,
    limit: args.limit ? Number(args.limit) : 10,
  });
  console.log(JSON.stringify(result, null, 2));
}
