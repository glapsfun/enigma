#!/usr/bin/env node
// Emits the map/memory/ledger slice relevant to one entity as a JSON bundle.
import path from 'node:path';
import { enigmaDir, readJson, readJsonl, readEvidence, parseArgs, isMain } from './lib/enigma.mjs';
import { coverage } from './coverage.mjs';

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

  const fetchedMs = (item) => {
    const t = Date.parse(item.fetched_at ?? '');
    return Number.isNaN(t) ? 0 : t; // an undated item sorts oldest, never NaN
  };
  const evidence = (await readEvidence(root))
    .filter((item) => (item.entities ?? []).some((id) => relatedIds.has(id)))
    .sort((a, b) => fetchedMs(b) - fetchedMs(a))
    .slice(0, 30);
  const cov = await coverage(root, entityId);

  return {
    ok: true,
    bundle: {
      entity,
      kind,
      aliases: entity.aliases ?? [],
      team,
      members,
      components,
      relationships: rels,
      ledger,
      facts,
      decisions,
      evidence,
      coverage: { sources: cov.sources, queue: cov.queue, entity: cov.entity ?? null },
    },
  };
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
