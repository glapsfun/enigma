#!/usr/bin/env node
// Reports what discovery actually read per source, so gates can be honest.
import path from 'node:path';
import { enigmaDir, readJson, parseArgs, isMain } from './lib/enigma.mjs';

export async function coverage(root, entityId = null) {
  const dir = enigmaDir(root);
  const { sources = [] } = await readJson(path.join(dir, 'index', 'sources.json'), { sources: [] });
  const discovery = await readJson(path.join(dir, 'state', 'discovery.json'), { sources: {}, queue: [] });

  const out = {};
  for (const s of sources) {
    const st = discovery.sources?.[s.id] ?? {};
    out[s.id] = {
      consent: s.consent ?? 'unset',
      status: s.status ?? 'unknown',
      depth: st.depth ?? 'none',
      read: st.read ?? 0,
      known: st.known ?? null,
      complete: st.complete ?? false,
      last_scanned: st.last_scanned ?? null,
    };
  }

  const q = discovery.queue ?? [];
  const count = (status) => q.filter((e) => e.status === status).length;
  const result = {
    ok: true,
    sources: out,
    queue: {
      pending: count('pending'),
      in_progress: count('in_progress'),
      done: count('done'),
      failed: count('failed'),
    },
  };

  if (entityId) {
    const areas = q.filter((e) => e.area === entityId);
    result.entity = {
      id: entityId,
      areas,
      deep_done: areas.some((e) => e.status === 'done'),
      pending: areas.filter((e) => e.status !== 'done').length,
    };
  }
  return result;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = typeof args.dir === 'string' ? args.dir : process.cwd();
  const entity = typeof args.entity === 'string' ? args.entity : null;
  console.log(JSON.stringify(await coverage(root, entity), null, 2));
}
