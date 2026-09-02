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
        const mergedAliases = [...new Set([...(prev.aliases ?? []), ...(cand.aliases ?? [])])];
        if (mergedAliases.length) merged.aliases = mergedAliases;
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
