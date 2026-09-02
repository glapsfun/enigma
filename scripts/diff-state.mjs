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
